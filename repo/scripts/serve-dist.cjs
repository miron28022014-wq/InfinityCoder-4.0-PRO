// Static file server for the prebuilt web bundle.
//
// Usage:  node scripts/serve-dist.cjs [port]
//
// /api is proxied to the local terminal bridge (scripts/bridge.cjs) so the web
// build can run REAL shell commands, exactly like the desktop build does.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "dist");
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 5299);
const BRIDGE_HOST = process.env.BRIDGE_HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json"
};

function proxyApi(req, res) {
  const proxy = http.request(
    { host: BRIDGE_HOST, port: BRIDGE_PORT, path: req.url, method: req.method, headers: req.headers },
    up => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  proxy.on("error", err => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "мост недоступен", detail: String(err && err.message) }));
  });
  req.pipe(proxy);
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    if (url === "/api" || url.startsWith("/api/")) return proxyApi(req, res);
    let file = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, "index.html");
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`InfinityCoder → http://127.0.0.1:${PORT}`);
  });
