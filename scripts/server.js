const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 5001;
let refreshProcess = null;
let refreshError = null;
const sseClients = new Set();
let reportWatcher = null;

function readLatestReport() {
  const reportPath = path.join(PUBLIC_DIR, 'stack-health.json');
  if (!fs.existsSync(reportPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function broadcastStatus() {
  const report = readLatestReport();
  const payload = {
    running: Boolean(refreshProcess),
    error: refreshError,
    progress: report && report.progress ? report.progress : null,
    generatedAt: report && report.generatedAt ? report.generatedAt : null,
    report
  };
  const message = `event: refresh-status\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of Array.from(sseClients)) {
    try {
      client.write(message);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

function setupReportWatcher() {
  if (reportWatcher) return;

  try {
    reportWatcher = fs.watch(PUBLIC_DIR, (eventType, filename) => {
      if (filename === 'stack-health.json') {
        broadcastStatus();
      }
    });
  } catch (err) {
    reportWatcher = null;
  }
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  }
  if (url === '/stack-health.json' || url === '/public/stack-health.json') {
    const p = path.join(PUBLIC_DIR, 'stack-health.json');
    if (fs.existsSync(p)) return sendFile(res, p, 'application/json');
    res.writeHead(204);
    return res.end();
  }

  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    sseClients.add(res);

    req.on('close', () => sseClients.delete(res));
    req.on('end', () => sseClients.delete(res));
    broadcastStatus();
    return;
  }

  if (url === '/refresh') {
    if (refreshProcess) {
      res.writeHead(409, { 'Content-Type': 'text/plain' });
      return res.end('Refresh already in progress');
    }

    const checker = path.join(__dirname, 'check-stack.js');
    refreshError = null;
    refreshProcess = spawn(process.execPath, [checker], { cwd: path.join(__dirname, '..') });
    broadcastStatus();

    refreshProcess.on('close', (code) => {
      refreshProcess = null;
      if (code !== 0) {
        refreshError = `Checker exited with code ${code}`;
      }
      broadcastStatus();
    });

    refreshProcess.on('error', (err) => {
      refreshProcess = null;
      refreshError = err.message;
      broadcastStatus();
    });

    res.writeHead(202, { 'Content-Type': 'text/plain' });
    return res.end('Refresh started');
  }

  if (url === '/refresh-status') {
    const report = readLatestReport();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      running: Boolean(refreshProcess),
      error: refreshError,
      progress: report && report.progress ? report.progress : null,
      generatedAt: report && report.generatedAt ? report.generatedAt : null,
      report
    }));
  }

  // Per-package details page
  if (url.startsWith('/package/')) {
    const pkgName = decodeURIComponent(url.slice('/package/'.length));
    const report = readLatestReport();
    if (!report) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('No report available');
    }

    const pkg = (report.packages || []).find((p) => p.package === pkgName);
    if (!pkg) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Package not found');
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Package ${pkg.package}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Inter,system-ui,Arial;background:#071028;color:#e6eef8;padding:24px}a{color:#7dd3fc}</style></head><body><h1>${pkg.package}</h1><p><strong>Declared:</strong> ${pkg.declared || '—'}</p><p><strong>Latest:</strong> ${pkg.latest || '—'}</p><p><strong>Status:</strong> ${pkg.status || '—'}</p>${pkg.latestTime?`<p><strong>Published:</strong> ${pkg.latestTime}</p>`:''}<p><a href="https://www.npmjs.com/package/${encodeURIComponent(pkg.package)}" target="_blank" rel="noopener">Open on npm</a></p><p><a href="/">Back</a></p></body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // Serve static assets
  const filePath = path.join(PUBLIC_DIR, url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.html': 'text/html' };
    return sendFile(res, filePath, types[ext] || 'application/octet-stream');
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  setupReportWatcher();
  console.log(`Stack Health UI available at http://localhost:${PORT}`);
});
