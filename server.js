const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 32 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";

    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      data += chunk;
    });

    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "thinkora-core",
        version: "core-intelligence-v1",
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";

      if (!message) {
        return sendJson(res, 400, { error: "message is required" });
      }

      // Core Intelligence boundary: the model provider will be connected here.
      // Secrets must remain server-side and must never be placed in index.html.
      return sendJson(res, 503, {
        error: "AI provider is not connected yet",
        code: "AI_NOT_CONFIGURED",
      });
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const indexPath = path.join(__dirname, "index.html");
      const html = fs.readFileSync(indexPath, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      return res.end(html);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const status = Number(error.status) || 500;
    if (!res.headersSent) {
      return sendJson(res, status, { error: status === 500 ? "Internal server error" : error.message });
    }
    res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Thinkora Core listening on port ${PORT}`);
});
