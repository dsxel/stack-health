const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 5001;
let refreshProcess = null;
let refreshError = null;

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

  if (url === '/refresh') {
    if (refreshProcess) {
      res.writeHead(409, { 'Content-Type': 'text/plain' });
      return res.end('Refresh already in progress');
    }

    const checker = path.join(__dirname, 'check-stack.js');
    refreshError = null;
    refreshProcess = spawn(process.execPath, [checker], { cwd: path.join(__dirname, '..') });

    refreshProcess.on('close', (code) => {
      refreshProcess = null;
      if (code !== 0) {
        refreshError = `Checker exited with code ${code}`;
      }
    });

    refreshProcess.on('error', (err) => {
      refreshProcess = null;
      refreshError = err.message;
    });

    res.writeHead(202, { 'Content-Type': 'text/plain' });
    return res.end('Refresh started');
  }

  if (url === '/refresh-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ running: Boolean(refreshProcess), error: refreshError }));
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

server.listen(PORT, () => console.log(`Stack Health UI available at http://localhost:${PORT}`));
