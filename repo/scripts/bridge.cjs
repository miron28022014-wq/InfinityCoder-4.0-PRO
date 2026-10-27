// Local terminal bridge.
//
// The browser build of InfinityCoder has no access to the Rust backend, so this
// tiny proxy gives it a real shell in a chosen directory. It is a development
// aid — the desktop app talks to Rust directly and never uses this.
//
//   npm run bridge                 # listens on http://127.0.0.1:5299
//   BRIDGE_CWD=/path/to/project npm run bridge
//
// Vite proxies /api → this server (see vite.config.ts).
//
// SECURITY: this executes arbitrary shell commands and binds to loopback only.
// Never expose it on a network interface.

const http = require("http");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.BRIDGE_PORT || 5299);
let CWD = process.env.BRIDGE_CWD || process.cwd();

const isWindows = process.platform === "win32";
const ALLOWED_ROOTS = process.env.BRIDGE_ROOTS
  ? process.env.BRIDGE_ROOTS.split(path.delimiter).map((p) => path.resolve(p))
  : null;

function send(res, code, obj) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(obj));
}

function insideAllowed(target) {
  if (!ALLOWED_ROOTS) return true;
  const resolved = path.resolve(target);
  return ALLOWED_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });

  if (req.url === "/api/ping") {
    return send(res, 200, { ok: true, cwd: CWD, allowedRoots: ALLOWED_ROOTS });
  }

  if (req.url === "/api/cwd" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e5) req.destroy();
    });
    req.on("end", () => {
      try {
        const j = JSON.parse(body || "{}");
        if (j.cwd && fs.existsSync(j.cwd) && insideAllowed(j.cwd)) {
          CWD = path.resolve(j.cwd);
          return send(res, 200, { ok: true, cwd: CWD });
        }
        send(res, 400, { error: "каталог недоступен" });
      } catch {
        send(res, 400, { error: "плохой json" });
      }
    });
    return;
  }

  if (req.url === "/api/exec" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      let cmd;
      try {
        cmd = JSON.parse(body);
      } catch {
        return send(res, 400, { error: "плохой json" });
      }
      const command = String(cmd.command ?? "").trim();
      if (!command) return send(res, 400, { error: "пустая команда" });

      const cwd =
        cmd.cwd && fs.existsSync(cmd.cwd) && insideAllowed(cmd.cwd) ? cmd.cwd : CWD;
      if (!insideAllowed(cwd)) return send(res, 403, { error: "каталог запрещён" });

      const timeout = Math.min(Math.max(Number(cmd.timeout_s) || 120, 1), 600) * 1000;
      const child = exec(
        command,
        { cwd, timeout, maxBuffer: 16 * 1024 * 1024, shell: isWindows ? "cmd.exe" : "/bin/sh" },
        (err, stdout, stderr) => {
          send(res, 200, {
            stdout: String(stdout).slice(0, 200000),
            stderr: String(stderr).slice(0, 100000),
            exit_code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
            timed_out: !!(err && err.killed)
          });
        }
      );
      req.on("aborted", () => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      });
    });
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] InfinityCoder terminal bridge → http://127.0.0.1:${PORT}`);
  console.log(`[bridge] commands run in: ${CWD}`);
  if (ALLOWED_ROOTS) console.log(`[bridge] restricted to: ${ALLOWED_ROOTS.join(", ")}`);
});
