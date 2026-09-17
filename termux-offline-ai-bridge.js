#!/data/data/com.termux/files/usr/bin/node
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8081;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 8080;

function corsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type');
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function proxy(req, res) {
  corsHeaders(req, res);
  const upstream = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${TARGET_HOST}:${TARGET_PORT}`
    }
  }, upstreamRes => {
    res.statusCode = upstreamRes.statusCode || 502;
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (key.toLowerCase() === 'access-control-allow-origin' ||
          key.toLowerCase() === 'access-control-allow-credentials' ||
          key.toLowerCase() === 'access-control-allow-methods' ||
          key.toLowerCase() === 'access-control-allow-headers' ||
          key.toLowerCase() === 'access-control-allow-private-network') continue;
      if (value !== undefined) res.setHeader(key, value);
    }
    upstreamRes.pipe(res);
  });

  upstream.on('error', err => {
    if (!res.headersSent) {
      corsHeaders(req, res);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'Offline AI bridge could not reach llama-server.', detail: err.message } }));
    } else {
      res.destroy(err);
    }
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  corsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  proxy(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Thinkora Offline AI bridge listening on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
