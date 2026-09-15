const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 10000);
const INTERNAL_PORT = PORT + 1;
const childEnv = { ...process.env, PORT: String(INTERNAL_PORT) };
const child = spawn(process.execPath, ['-r', './web-search-guard.js', 'server.js'], { env: childEnv, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));

const proxy = http.createServer((req, res) => {
  const opts = { hostname: '127.0.0.1', port: INTERNAL_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${INTERNAL_PORT}` } };
  const upstream = http.request(opts, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = String(response.headers['content-type'] || '');
      if ((req.url === '/' || req.url === '/index.html') && contentType.includes('text/html') && !body.includes(Buffer.from('offline-mode-integration.js'))) {
        const html = body.toString('utf8').replace('</head>', '<script src="/offline-mode-integration.js"></script></head>');
        const headers = { ...response.headers, 'content-length': Buffer.byteLength(html) };
        delete headers['content-encoding'];
        res.writeHead(response.statusCode || 200, headers);
        res.end(html);
        return;
      }
      res.writeHead(response.statusCode || 200, response.headers);
      res.end(body);
    });
  });
  upstream.on('error', err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Thinkora backend unavailable: ${err.message}` })); });
  req.pipe(upstream);
});

proxy.listen(PORT, '0.0.0.0', () => console.log(`Thinkora production bootstrap listening on port ${PORT}`));