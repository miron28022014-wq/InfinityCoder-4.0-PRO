/**
 * Скриншоты реального интерфейса InfinityCoder 4.0.
 *
 * Запускается на собранном `dist` (scripts/serve-dist.cjs) + мосте терминала.
 * Ничего не подменяет: в браузер подкладывается виртуальная ФС приложения,
 * чтобы проводник и редактор показали настоящий проект.
 *
 *   node scripts/screenshots.mjs [outDir]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "screenshots"));
const PORT = Number(process.env.SHOT_PORT || 4183);
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 5299);
const URL = `http://127.0.0.1:${PORT}`;

const DEMO_FILES = {
  "/workspace/infinity/src/server.ts": `import express from "express";
import { authRouter } from "./routes/auth.js";
import { logger } from "./lib/logger.js";

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use("/auth", authRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.listen(8787, () => logger.info("core api up on :8787"));
`,
  "/workspace/infinity/src/routes/auth.ts": `import { Router } from "express";
import { issueToken } from "../lib/tokens.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const token = await issueToken(email, password);
  if (!token) return res.status(401).json({ error: "bad credentials" });
  res.json({ token, expiresIn: 3600 });
});
`,
  "/workspace/infinity/src/lib/tokens.ts": `import { sign } from "node:crypto";

const SECRET = process.env.INFINITY_MASTER_KEY ?? "dev";

export async function issueToken(email: string, password: string) {
  if (!email || !password) return null;
  return sign({ sub: email, iat: Date.now() }, SECRET);
}
`,
  "/workspace/infinity/package.json": `{
  "name": "@infinity/core",
  "version": "1.4.0",
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "test": "node --test test/*.test.ts"
  }
}
`,
  "/workspace/infinity/README.md": `# Infinity Core

Ядро экосистемы Infinity: identity, AI Runtime, Tool Runtime, поиск, память и синхронизация.

## Запуск

\`\`\`bash
npm run build
npm start
\`\`\`
`
};

const DEMO_MEMORY = [
  {
    id: "m1",
    key: "core-api-port",
    description: "Core API слушает 127.0.0.1:8787, CORS-Origins настраивается через INFINITY_CORS_ORIGINS",
    kind: "note",
    file_path: "src/server.ts",
    tags: "core,api",
    ts: Date.now() - 86400000
  },
  {
    id: "m2",
    key: "local-mode",
    description: "В локальном режиме маршрутизатор блокирует облачные вызовы, а не интерфейс",
    kind: "decision",
    file_path: "src/ai/ai-router.ts",
    tags: "ai,security",
    ts: Date.now() - 43200000
  }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function startProc(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
  return p;
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const bridge = startProc("node", ["scripts/bridge.cjs"], { BRIDGE_PORT: String(BRIDGE_PORT) });
  const server = startProc("node", ["scripts/serve-dist.cjs", String(PORT)], {
    BRIDGE_PORT: String(BRIDGE_PORT)
  });

  try {
    if (!(await waitFor(URL))) throw new Error("статика не поднялась");
    await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/api/ping`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 2 });
    await page.goto(URL, { waitUntil: "networkidle2" });

    // Виртуальная ФС и память приложения — то же хранилище, что использует веб-сборка.
    await page.evaluate(
      (files, memory) => {
        const now = Date.now();
        const vfs = {};
        for (const [p, content] of Object.entries(files)) vfs[p] = { content, ts: now };
        localStorage.setItem("infinitycoder.vfs.v3", JSON.stringify(vfs));
        localStorage.setItem("infinitycoder.memory.v3", JSON.stringify(memory));
        const s = JSON.parse(localStorage.getItem("infinitycoder.settings.v3") || "{}");
        localStorage.setItem(
          "infinitycoder.settings.v3",
          JSON.stringify({ ...s, sidebarTab: "files", autonomous: true, theme: "dark" })
        );
      },
      DEMO_FILES,
      DEMO_MEMORY
    );

    const shot = async (name, wait = 700) => {
      await sleep(wait);
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file });
      console.log("✔", path.relative(ROOT, file));
    };

    // 1. Стартовый экран
    await page.reload({ waitUntil: "networkidle2" });
    await shot("01-start", 1200);

    // 2. Основной IDE с проектом
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const open = btns.find(b => /Открыть проект/i.test(b.textContent || ""));
      open?.click();
    });
    await sleep(900);
    // Раскрываем дерево и открываем файл — так видно настоящий редактор.
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("[data-tree-row], .ic-list-row, button"));
      const dir = rows.find(r => /^infinity$/.test((r.textContent || "").trim()));
      dir?.click();
    });
    await sleep(700);
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("button, [role=treeitem], .ic-list-row"));
      rows.find(r => /^src$/.test((r.textContent || "").trim()))?.click();
    });
    await sleep(700);
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("button, [role=treeitem], .ic-list-row"));
      rows.find(r => /server\.ts/.test(r.textContent || ""))?.click();
    });
    await shot("02-ide", 1600);

    // 3. Панель «Экосистема»
    await page.evaluate(() => {
      const rail = document.querySelectorAll(".ic-rail__btn");
      rail[rail.length - 2]?.click();
    });
    await shot("03-ecosystem", 900);

    // 4. Панель «Память»
    await page.evaluate(() => {
      const rail = document.querySelectorAll(".ic-rail__btn");
      rail[rail.length - 3]?.click();
    });
    await shot("04-memory", 900);

    // 5. Агенты / рой
    await page.evaluate(() => {
      const rail = document.querySelectorAll(".ic-rail__btn");
      rail[rail.length - 4]?.click();
    });
    await shot("05-agents", 900);

    // 6. Настройки — автономность
    await page.evaluate(() => {
      const rail = document.querySelectorAll(".ic-rail__btn");
      rail[rail.length - 1]?.click();
    });
    await sleep(600);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("button, [role=button], div"));
      const t = items.find(el => (el.textContent || "").trim() === "Автономность");
      t?.click();
    });
    await shot("06-autonomy", 900);

    // 7. Светлая тема — стартовый экран
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("infinitycoder.settings.v3") || "{}");
      localStorage.setItem("infinitycoder.settings.v3", JSON.stringify({ ...s, theme: "light" }));
    });
    await page.reload({ waitUntil: "networkidle2" });
    await shot("07-light", 1400);

    await browser.close();
    writeFileSync(path.join(OUT, "README.md"), "Скриншоты InfinityCoder 4.0\n");
  } finally {
    bridge.kill();
    server.kill();
  }
}

main().catch(e => {
  console.error("✖", e);
  process.exit(1);
});
