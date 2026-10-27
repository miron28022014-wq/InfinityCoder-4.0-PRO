/**
 * Тесты клиента Infinity Ecosystem.
 *
 * Поднимается настоящий HTTP-сервер с тем же контрактом `/api/v1`, что и
 * Core API ядра, и проверяется поведение клиента: вход, модели, поток
 * генерации, блокировка облака в локальном режиме, гранты, поиск, память и
 * журнал изменений.
 *
 *   npx tsx test/ecosystem.test.mts
 */
import { createServer, type Server } from "node:http";
import { EcosystemClient, EcosystemError, memoryStorage } from "../src/lib/ecosystem.ts";

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}\n  got:  ${a}\n  want: ${b}`);
  }
}

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ *
 * Подставной Core API с реальным контрактом
 * ------------------------------------------------------------------ */

const TOKEN = "infk_test_token";

interface FakeOptions {
  /** Облачный провайдер — в локальном режиме должен быть заблокирован. */
  cloudProvider?: boolean;
}

async function startCoreApi(options: FakeOptions = {}): Promise<{ url: string; close: () => Promise<void>; requests: string[] }> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = req.headers.authorization;
    const path = url.pathname;
    requests.push(`${req.method} ${path}`);

    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };

    if (path === "/api/v1/health") return json(200, { ok: true, service: "infinity-core" });

    if (path === "/api/v1/auth/login") {
      return json(200, {
        user: { id: "usr_1", email: "dev@infinity.local", displayName: "Dev" },
        token: TOKEN
      });
    }

    if (auth !== `Bearer ${TOKEN}`) {
      return json(401, { error: { code: "UNAUTHORIZED", message: "Требуется авторизация" } });
    }

    if (path === "/api/v1/me") {
      return json(200, { id: "usr_1", email: "dev@infinity.local", displayName: "Dev" });
    }

    if (path === "/api/v1/models") {
      return json(200, [
        {
          id: "mdl_local",
          providerId: "prv_local",
          remoteName: "qwen-coder",
          displayName: "Qwen Coder",
          contextSize: 32768,
          capabilities: []
        }
      ]);
    }

    if (path === "/api/v1/providers") {
      const providers = [
        { id: "prv_local", name: "Локальный", kind: "local_llama", baseUrl: "http://127.0.0.1:8080", scope: "local", enabled: true, isDefault: true, hasApiKey: false }
      ];
      if (options.cloudProvider) {
        providers.push({
          id: "prv_cloud",
          name: "Облако",
          kind: "openai_compatible",
          baseUrl: "https://api.example.com",
          scope: "cloud",
          enabled: true,
          isDefault: false,
          hasApiKey: true
        });
      }
      return json(200, providers);
    }

    if (path === "/api/v1/ai/completions") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { modelId?: string; mode?: string; messages?: unknown[] };
        // Роурутер ядра: облачный провайдер в локальном режиме недостижим.
        if (parsed.mode === "local" && parsed.modelId === "mdl_cloud") {
          return json(403, {
            error: { code: "LOCAL_MODE_BLOCKED", message: "Облачный провайдер «Облако» недоступен в локальном режиме" }
          });
        }
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache"
        });
        const send = (event: string, data: unknown) =>
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send("start", { modelId: parsed.modelId, mode: parsed.mode });
        send("delta", { text: "Экосистемный " });
        send("delta", { text: "ответ" });
        send("done", { reason: "stop" });
        res.end();
      });
      return;
    }

    if (path === "/api/v1/tools/grants") {
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => res.end(JSON.stringify({ ok: true })));
        return;
      }
      return json(200, [
        {
          name: "coder_write_file",
          description: "Записать файл",
          risk: "write",
          grant: { tool: "coder_write_file", scope: "ask", expiresAt: null }
        },
        {
          name: "coder_run_command",
          description: "Команда",
          risk: "exec",
          grant: { tool: "coder_run_command", scope: "deny", expiresAt: null }
        }
      ]);
    }

    if (path === "/api/v1/search") {
      return json(200, {
        hits: [
          { objectId: "nte_1", app: "notes", title: "Архитектура", snippet: "описание <mark>архитектуры</mark>", updatedAt: "", createdAt: "", score: 1 }
        ],
        total: 1
      });
    }

    if (path === "/api/v1/memory") {
      if (req.method === "POST") {
        return json(200, {
          id: "mem_1",
          content: "Сборка — npm run build",
          source: { type: "user", title: "InfinityCoder" },
          importance: 0.7,
          updatedAt: "2026-10-22T00:00:00.000Z",
          createdAt: "2026-10-22T00:00:00.000Z"
        });
      }
      return json(200, [
        {
          id: "mem_1",
          content: "Сборка — npm run build",
          source: { type: "user", title: "InfinityCoder" },
          importance: 0.7,
          updatedAt: "2026-10-22T00:00:00.000Z"
        }
      ]);
    }

    if (path === "/api/v1/sync/changes") {
      return json(200, {
        cursor: 42,
        changes: [{ seq: 42, app: "notes", objectId: "nte_1", op: "upsert", changedAt: "2026-10-22T00:00:00.000Z" }]
      });
    }

    if (path === "/api/v1/diagnostics") {
      return json(200, {
        ai: { providers: 2, enabled: 2, models: 3, local: 1, cloud: 2 },
        search: { indexed: 12, stale: 0, orphaned: 0 }
      });
    }

    if (path === "/api/v1/objects/obj_1") {
      return json(200, {
        id: "obj_1",
        app: "notes",
        kind: "note",
        title: "Заметка",
        body: "тело",
        tags: [],
        meta: {},
        updatedAt: "2026-10-22T00:00:00.000Z"
      });
    }

    return json(404, { error: { code: "ROUTE_NOT_FOUND", message: "нет маршрута" } });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

/* ------------------------------------------------------------------ *
 * Проверки
 * ------------------------------------------------------------------ */

const core = await startCoreApi({ cloudProvider: true });
const storage = memoryStorage();
const client = new EcosystemClient(core.url, null, storage);

console.log("== InfinityCoder 4.0: клиент экосистемы ==");

try {
  /* ---- подключение и вход ---- */
  const health = await client.health();
  eq("Core API отвечает", health.ok, true);

  const user = await client.login("dev@infinity.local", "password-123");
  eq("вход возвращает пользователя", user.email, "dev@infinity.local");
  ok("токен сохранён", client.authed);
  eq("токен попал в хранилище", storage.get("infinitycoder.ecosystem.token.v4"), TOKEN);

  const me = await client.me();
  eq("профиль доступен", me.id, "usr_1");

  /* ---- AI Runtime ---- */
  const models = await client.models();
  eq("модели загружены", models.length, 1);
  eq("имя модели", models[0]!.displayName, "Qwen Coder");

  const providers = await client.providers();
  eq("провайдеров два", providers.length, 2);
  eq("облачный провайдер найден", providers.find(p => p.scope === "cloud")?.id, "prv_cloud");

  /* ---- поток генерации ---- */
  const chunks: string[] = [];
  const completion = await client.completion({
    modelId: "mdl_local",
    mode: "local",
    messages: [{ role: "user", content: "привет" }],
    onDelta: t => chunks.push(t)
  });
  eq("текст собран из потока", completion.text, "Экосистемный ответ");
  eq("дельта пришла отдельными частями", chunks.length, 2);

  /* ---- локальный режим блокирует облако ---- */
  let blocked: EcosystemError | null = null;
  try {
    await client.completion({
      modelId: "mdl_cloud",
      mode: "local",
      messages: [{ role: "user", content: "привет" }]
    });
  } catch (e) {
    blocked = e instanceof EcosystemError ? e : null;
  }
  ok("облако заблокировано в локальном режиме", blocked !== null);
  eq("код блокировки", blocked?.code, "LOCAL_MODE_BLOCKED");

  /* ---- Tool Runtime ---- */
  const grants = await client.toolGrants();
  eq("грантов два", grants.length, 2);
  eq("грант по умолчанию — ask", grants.find(g => g.name === "coder_write_file")?.grant.scope, "ask");
  eq("запрет зафиксирован", grants.find(g => g.name === "coder_run_command")?.grant.scope, "deny");
  await client.setToolGrant("coder_write_file", "allow");
  ok("изменение гранта принято", core.requests.includes("POST /api/v1/tools/grants"));

  /* ---- Search и Data Services ---- */
  const search = await client.search("архитектура");
  eq("поиск вернул совпадение", search.hits.length, 1);
  eq("приложение источника", search.hits[0]!.app, "notes");
  const obj = await client.object("obj_1");
  eq("объект прочитан", obj.title, "Заметка");

  /* ---- память ---- */
  const mem = await client.addMemory("Сборка — npm run build", { type: "user", title: "InfinityCoder" });
  eq("запись памяти создана", mem.id, "mem_1");
  const memories = await client.memories();
  eq("память прочитана", memories.length, 1);

  /* ---- Sync ---- */
  const changes = await client.changes(0);
  eq("изменение получено", changes.changes.length, 1);
  eq("курсор обновлён", changes.cursor, 42);

  /* ---- диагностика ---- */
  const diag = await client.diagnostics();
  eq("провайдеров в диагностике", diag.ai.providers, 2);
  eq("в индексе поиска", diag.search.indexed, 12);

  /* ---- отказ без токена ---- */
  const anon = new EcosystemClient(core.url, null, memoryStorage());
  let unauthorized: EcosystemError | null = null;
  try {
    await anon.models();
  } catch (e) {
    unauthorized = e instanceof EcosystemError ? e : null;
  }
  ok("без токена запрос отклонён", unauthorized !== null);
  eq("код отказа", unauthorized?.code, "UNAUTHORIZED");
} finally {
  await core.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
