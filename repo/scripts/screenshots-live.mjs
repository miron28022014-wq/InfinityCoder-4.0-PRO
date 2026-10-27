/**
 * Скриншоты интерфейса, подключённого к живой экосистеме.
 *
 * Требует запущенной связки: Core API (8787) + веб-IDE (8090).
 * Вход выполняется через настоящий Infinity ID — скриншоты показывают
 * реальное подключение, а не нарисованное состояние.
 *
 *   node scripts/screenshots-live.mjs [url] [coreUrl] [outDir]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const IDE = process.argv[2] || "http://127.0.0.1:8090";
const CORE = process.argv[3] || "http://127.0.0.1:8787";
const OUT = path.resolve(process.argv[4] || path.join(ROOT, "screenshots"));

const EMAIL = `demo@infinity.local`;
const PASSWORD = "Infinity-Demo-2026";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Регистрация (или вход) — настоящий аккаунт в локальном ядре.
  let auth = await fetch(`${CORE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  }).catch(() => null);

  if (!auth || !auth.ok) {
    auth = await fetch(`${CORE}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, displayName: "Infinity User" })
    });
  }
  const session = await auth.json();
  if (!session?.token) throw new Error(`не удалось войти: ${JSON.stringify(session).slice(0, 200)}`);
  console.log("✔ вход выполнен:", session.user?.email);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 2 });

  await page.goto(IDE, { waitUntil: "networkidle2" });
  await page.evaluate(
    (core, token, settings) => {
      localStorage.setItem("infinitycoder.ecosystem.token.v4", token);
      localStorage.setItem("infinitycoder.ecosystem.url.v4", core);
      const cur = JSON.parse(localStorage.getItem("infinitycoder.settings.v3") || "{}");
      localStorage.setItem(
        "infinitycoder.settings.v3",
        JSON.stringify({
          ...cur,
          theme: "dark",
          ecosystemUrl: core,
          ecosystemUse: true,
          ecosystemAutoConnect: true,
          ecosystemSync: true,
          ecosystemShareMemory: true,
          autonomous: true,
          sidebarTab: "ecosystem"
        })
      );
    },
    CORE,
    session.token,
    {}
  );

  const shot = async (name, wait = 900) => {
    await sleep(wait);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log("✔", path.relative(ROOT, file));
  };

  await page.reload({ waitUntil: "networkidle2" });
  await sleep(2500);
  await shot("10-ecosystem-connected", 1500);

  // Панель «Память» — общая память экосистемы
  await page.evaluate(() => {
    const rail = document.querySelectorAll(".ic-rail__btn");
    rail[rail.length - 3]?.click();
  });
  await shot("11-memory-shared", 900);

  // Панель «Агенты»
  await page.evaluate(() => {
    const rail = document.querySelectorAll(".ic-rail__btn");
    rail[rail.length - 4]?.click();
  });
  await shot("12-agents", 900);

  // Проводник
  await page.evaluate(() => {
    const rail = document.querySelectorAll(".ic-rail__btn");
    rail[rail.length - 5]?.click();
  });
  await shot("13-files", 900);

  await browser.close();
}

main().catch(e => {
  console.error("✖", e);
  process.exit(1);
});
