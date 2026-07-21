const https = require('https');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');

const OUT_PATH = path.join(__dirname, '..', 'public', 'stack-health.json');
const STACK_LIST_PATH = path.join(__dirname, '..', 'stack-list.json');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function getCommandVersion(command, args = ['--version']) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
  } catch (err) {
    return null;
  }
}

function findPsqlVersion() {
  const direct = getCommandVersion('psql', ['--version']);
  if (direct) return { version: direct, path: 'psql' };

  const paths = [
    'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe'
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      const result = getCommandVersion(p, ['--version']);
      if (result) return { version: result, path: p };
    }
  }

  return null;
}

function compareVersionMajor(actual, required) {
  if (!actual || !required) return 0;
  const pa = actual.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = required.split('.').map((n) => parseInt(n, 10) || 0);
  if (pa[0] > pb[0]) return 1;
  if (pa[0] < pb[0]) return -1;
  return 0;
}

function normalizeVersion(v) {
  if (!v) return null;
  return v.replace(/^[\^~>=< ]+/, '');
}

function compareSemver(a, b) {
  if (!a || !b) return 0;
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function writeReport(report) {
  report.generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
}

function readPackageJsonVersions() {
  if (!fs.existsSync(PACKAGE_JSON_PATH)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return Object.assign(
      {},
      pkg.dependencies || {},
      pkg.devDependencies || {},
      pkg.peerDependencies || {},
      pkg.optionalDependencies || {}
    );
  } catch {
    return {};
  }
}

function checkTcpPort(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    function finish(result) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

(async function main() {
  let stackList = [];
  try {
    stackList = JSON.parse(fs.readFileSync(STACK_LIST_PATH, 'utf8'));
  } catch (e) {
    console.warn('No stack-list.json found; using empty list');
  }

  const packageJsonVersions = readPackageJsonVersions();
  const psqlInfo = findPsqlVersion();
  const mongoListening = await checkTcpPort('127.0.0.1', 27017, 500);
  const mysqlListening = await checkTcpPort('127.0.0.1', 3306, 500);

  const runtimeChecks = [
    {
      name: 'node',
      required: '22',
      actual: process.version.slice(1),
      status: compareVersionMajor(process.version.slice(1), '22') >= 0 ? 'ok' : 'outdated'
    },
    {
      name: 'docker',
      required: 'installed',
      actual: getCommandVersion('docker', ['--version']),
      status: getCommandVersion('docker', ['--version']) ? 'installed' : 'missing'
    },
    {
      name: 'psql',
      required: 'installed',
      actual: psqlInfo ? psqlInfo.version : null,
      path: psqlInfo ? psqlInfo.path : null,
      status: psqlInfo ? 'installed' : 'missing'
    },
    {
      name: 'MongoDB',
      required: 'online',
      actual: '127.0.0.1:27017',
      status: mongoListening ? 'online' : 'offline'
    },
    {
      name: 'MySQL',
      required: 'online',
      actual: '127.0.0.1:3306',
      status: mysqlListening ? 'online' : 'offline'
    }
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    runtime: runtimeChecks,
    packages: stackList.map((entry) => {
      const declaredVersion = entry.current || packageJsonVersions[entry.package] || null;
      return {
        package: entry.package,
        declared: normalizeVersion(declaredVersion),
        latest: null,
        latestTime: null,
        status: 'pending'
      };
    }),
    progress: {
      current: 0,
      total: stackList.length
    }
  };

  fs.mkdirSync(path.join(__dirname, '..', 'public'), { recursive: true });
  writeReport(report);

  for (let idx = 0; idx < stackList.length; idx++) {
    const entry = stackList[idx];
    const pkg = entry.package;
    const declaredVersion = entry.current || packageJsonVersions[pkg] || null;
    const declared = normalizeVersion(declaredVersion);
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;
    let latest = null;
    let latestTime = null;

    try {
      const data = await fetchJson(registryUrl);
      latest = normalizeVersion(data.version);
      latestTime = data.time || null;
    } catch (err) {
      console.error(`Failed to fetch ${pkg}:`, err.message);
    }

    const cmp = declared && latest ? compareSemver(declared, latest) : 0;
    const status = declared ? (cmp >= 0 ? 'up-to-date' : 'outdated') : 'unknown';

    Object.assign(report.packages[idx], {
      declared,
      latest,
      latestTime,
      status
    });
    report.progress.current = idx + 1;
    writeReport(report);
  }

  console.log('Wrote', OUT_PATH);
})();
