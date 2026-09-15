const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 10000);
const root = __dirname;
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const integration = fs.readFileSync(path.join(root, "offline-mode-integration.js"), "utf8");
const previewHtml = index.replace("</head>", `<script>\n${integration}\n</script></head>`);

const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/chat" || url.pathname === "/api/vision") {
    res.writeHead(503, { "Content-Type":"application/json; charset=utf-8" });
    res.end(JSON.stringify({ error:"Online API is intentionally unavailable in this isolated offline test service." }));
    return;
  }
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type":"application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok:true, test:"offline-integration" }));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" });
    res.end(previewHtml);
    return;
  }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type":mime[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`Thinkora offline integration test server running on port ${PORT}`));
