/**
 * Tool registry.
 *
 * Every capability the model can invoke is declared here with a JSON Schema,
 * a risk level and a usage line that goes into the system prompt. The executor
 * maps each tool to a real backend call — nothing is simulated.
 */
import { api, isTauri, matchGlob } from "./ipc";
import type { EcosystemClient } from "./ecosystem";
import type { ToolCall, ToolName, ToolOutcome, ToolRisk, ToolSpec } from "../types";

const t = (description: string, type = "string", required = true, extra: Record<string, unknown> = {}) => ({
  type,
  description,
  required,
  ...extra
});

export const TOOLS: ToolSpec[] = [
  /* ---------------- file system ---------------- */
  {
    name: "read_file",
    summary: "Прочитать файл (с необязательным диапазоном строк)",
    usage: 'read_file {"path":"src/App.tsx","start_line":1,"end_line":120}',
    risk: "safe",
    icon: "fileText",
    schema: {
      path: t("Путь к файлу относительно корня проекта"),
      start_line: t("Первая строка (1-based). Необязательно.", "number", false),
      end_line: t("Последняя строка включительно. Необязательно.", "number", false)
    }
  },
  {
    name: "write_file",
    summary: "Создать или полностью перезаписать файл",
    usage: 'write_file {"path":"src/lib/new.ts","content":"..."}',
    risk: "write",
    icon: "save",
    schema: {
      path: t("Путь к файлу относительно корня проекта"),
      content: t("Полное содержимое файла")
    }
  },
  {
    name: "edit_file",
    summary: "Точечная замена фрагмента в существующем файле",
    usage: 'edit_file {"path":"src/App.tsx","old_string":"const a = 1","new_string":"const a = 2"}',
    risk: "write",
    icon: "edit",
    schema: {
      path: t("Путь к файлу"),
      old_string: t("Точный фрагмент, который заменяем. Должен встречаться в файле."),
      new_string: t("Новый фрагмент"),
      replace_all: t("Заменить все вхождения. Необязательно.", "boolean", false)
    }
  },
  {
    name: "delete_file",
    summary: "Удалить файл или каталог",
    usage: 'delete_file {"path":"old/legacy.ts"}',
    risk: "destructive",
    icon: "trash",
    schema: { path: t("Путь к удаляемому файлу или каталогу") }
  },
  {
    name: "move_file",
    summary: "Переименовать или переместить файл",
    usage: 'move_file {"from":"a.ts","to":"lib/a.ts"}',
    risk: "write",
    icon: "arrowRight",
    schema: {
      from: t("Текущий путь"),
      to: t("Новый путь")
    }
  },
  {
    name: "create_dir",
    summary: "Создать каталог (включая вложенные)",
    usage: 'create_dir {"path":"src/components/ui"}',
    risk: "safe",
    icon: "folder",
    schema: { path: t("Путь к каталогу") }
  },
  {
    name: "list_dir",
    summary: "Содержимое каталога",
    usage: 'list_dir {"path":"src","depth":2}',
    risk: "safe",
    icon: "list",
    schema: {
      path: t("Путь к каталогу. Необязательно — корень проекта."),
      depth: t("Глубина рекурсии (1–4). Необязательно.", "number", false)
    }
  },
  {
    name: "search_files",
    summary: "Поиск по содержимому файлов (grep)",
    usage: 'search_files {"query":"useEffect","glob":"src/**/*.ts","path":""}',
    risk: "safe",
    icon: "search",
    schema: {
      query: t("Регулярное выражение или подстрока для поиска"),
      path: t("Ограничить поиск каталогом. Необязательно.", "string", false),
      glob: t("Фильтр по шаблону пути, например src/**/*.tsx", "string", false)
    }
  },
  {
    name: "file_stat",
    summary: "Метаданные файла (размер, путь, время изменения)",
    usage: 'file_stat {"path":"package.json"}',
    risk: "safe",
    icon: "disk",
    schema: { path: t("Путь к файлу") }
  },

  /* ---------------- process ---------------- */
  {
    name: "run_command",
    summary: "Выполнить команду в терминале проекта",
    usage: 'run_command {"command":"npm test","timeout_seconds":120}',
    risk: "exec",
    icon: "terminal",
    schema: {
      command: t("Команда для выполнения в корне проекта"),
      timeout_seconds: t("Таймаут в секундах (1–600)", "number", false)
    }
  },

  /* ---------------- project memory ---------------- */
  {
    name: "memory_search",
    summary: "Поиск по памяти проекта (Ledger): файлы, символы, решения",
    usage: 'memory_search {"query":"auth token","limit":8}',
    risk: "safe",
    icon: "memory",
    schema: {
      query: t("Что ищем: символ, файл, архитектурное решение"),
      limit: t("Сколько записей вернуть", "number", false)
    }
  },
  {
    name: "memory_write",
    summary: "Записать факт в память проекта",
    usage: 'memory_write {"key":"auth:flow","description":"JWT хранится в httpOnly cookie","file_path":"src/auth.ts","kind":"decision"}',
    risk: "safe",
    icon: "book",
    schema: {
      key: t("Короткий уникальный ключ"),
      description: t("Сам факт: что, где, зачем"),
      file_path: t("Связанный файл проекта", "string", false),
      kind: t("Тип записи", "string", false, { enum: ["note", "decision", "symbol", "file", "gotcha"] }),
      tags: t("Теги через запятую", "string", false)
    }
  },
  {
    name: "memory_list",
    summary: "Показать записи памяти проекта",
    usage: 'memory_list {"limit":30,"kind":"decision"}',
    risk: "safe",
    icon: "list",
    schema: {
      limit: t("Сколько записей", "number", false),
      kind: t("Фильтр по типу. Необязательно.", "string", false)
    }
  },
  {
    name: "memory_forget",
    summary: "Удалить запись из памяти проекта",
    usage: 'memory_forget {"key":"old:note"}',
    risk: "destructive",
    icon: "trash",
    schema: { key: t("Ключ записи") }
  },

  /* ---------------- version control ---------------- */
  {
    name: "git_status",
    summary: "Состояние git-репозитория",
    usage: 'git_status {}',
    risk: "safe",
    icon: "branch",
    schema: {}
  },
  {
    name: "git_diff",
    summary: "Незакоммиченные изменения",
    usage: 'git_diff {"path":"src/App.tsx"}',
    risk: "safe",
    icon: "commit",
    schema: { path: t("Ограничить один файл. Необязательно.", "string", false) }
  },
  {
    name: "git_log",
    summary: "Последние коммиты",
    usage: 'git_log {"limit":10}',
    risk: "safe",
    icon: "history",
    schema: { limit: t("Сколько коммитов", "number", false) }
  },
  {
    name: "git_commit",
    summary: "Закоммитить все изменения",
    usage: 'git_commit {"message":"feat: add auth flow"}',
    risk: "destructive",
    icon: "commit",
    schema: { message: t("Сообщение коммита") }
  },

  /* ---------------- network ---------------- */
  {
    name: "web_fetch",
    summary: "Загрузить содержимое URL",
    usage: 'web_fetch {"url":"https://example.com/docs"}',
    risk: "safe",
    icon: "globe",
    schema: { url: t("Адрес страницы (http/https)") }
  },
  {
    name: "web_search",
    summary: "Быстрый поиск в интернете",
    usage: 'web_search {"query":"tauri v2 permissions"}',
    risk: "safe",
    icon: "search",
    schema: {
      query: t("Поисковый запрос"),
      limit: t("Сколько результатов", "number", false)
    }
  },

  /* ---------------- Infinity Ecosystem ---------------- */
  {
    name: "ecosystem_search",
    summary: "Поиск по всем приложениям Infinity Ecosystem (Notes, Drive, история, память)",
    usage: 'ecosystem_search {"query":"архитектура API","scope":"all"}',
    risk: "safe",
    icon: "search",
    schema: {
      query: t("Что ищем в экосистеме"),
      scope: t("Область: all | drive | notes | ai | plan | office | memory", "string", false),
      limit: t("Сколько результатов", "number", false)
    }
  },
  {
    name: "ecosystem_remember",
    summary: "Записать факт в общую память Infinity Ecosystem (увидят и другие приложения)",
    usage: 'ecosystem_remember {"content":"Сборка проекта — npm run build"}',
    risk: "write",
    icon: "memory",
    schema: {
      content: t("Сам факт: что, где, зачем"),
      title: t("Короткий заголовок для источника", "string", false),
      kind: t("Тип записи", "string", false, { enum: ["note", "decision", "gotcha"] })
    }
  },
  {
    name: "ecosystem_object",
    summary: "Прочитать объект экосистемы по Infinity ID (заметка, файл, задача)",
    usage: 'ecosystem_object {"id":"nte_01J..."}',
    risk: "safe",
    icon: "fileText",
    schema: { id: t("Infinity ID объекта") }
  }
];

export const TOOL_BY_NAME = new Map<string, ToolSpec>(TOOLS.map(s => [s.name, s]));
export const TOOL_NAMES = TOOLS.map(s => s.name);

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOL_BY_NAME.get(name);
}

export function toolIcon(name: string): string {
  return TOOL_BY_NAME.get(name)?.icon ?? "zap";
}

export function toolRisk(name: string): ToolRisk {
  return TOOL_BY_NAME.get(name)?.risk ?? "exec";
}

/** Инструменты, доступные только при подключённой экосистеме. */
export const ECOSYSTEM_TOOLS = new Set<ToolName>([
  "ecosystem_search",
  "ecosystem_remember",
  "ecosystem_object"
]);

/** Compact, model-readable tool documentation injected into the system prompt. */
export function toolDigest(allow?: ToolName[], opts: { ecosystem?: boolean } = {}): string {
  const list = (allow && allow.length ? TOOLS.filter(x => allow.includes(x.name)) : TOOLS).filter(
    x => opts.ecosystem !== false || !ECOSYSTEM_TOOLS.has(x.name)
  );
  return list
    .map(s => {
      const args = Object.entries(s.schema)
        .map(([k, v]) => `${k}${v.required ? "" : "?"}`)
        .join(", ");
      return `- ${s.name}({${args}}): ${s.summary}. ${s.usage}`;
    })
    .join("\n");
}

/* ================================================================== *
 * Execution
 * ================================================================== */

const asStr = (v: unknown, fallback = ""): string =>
  v === undefined || v === null ? fallback : String(v);
const asNum = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const asBool = (v: unknown): boolean => v === true || v === "true";

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + "\n…[обрезано]" : s);

const firstLine = (s: string, n = 90): string => s.split("\n")[0]?.slice(0, n) ?? "";

function ok(label: string, data: unknown, extra: Partial<ToolOutcome> = {}): ToolOutcome {
  return { ok: true, label, data, ...extra };
}
function fail(label: string, err: unknown): ToolOutcome {
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, label, data: { error: msg }, preview: msg };
}

export interface ExecContext {
  root: string;
  agentId: string;
  /** Roles the profile may not exceed. */
  allow: ToolName[];
  signal?: AbortSignal;
  /** Клиент Infinity Ecosystem; без него инструменты экосистемы недоступны. */
  eco?: EcosystemClient | null;
  /** Делиться фактами из памяти проекта с общей памятью экосистемы. */
  shareMemory?: boolean;
}

/** Run one parsed tool call against the real backend. */
export async function execTool(call: ToolCall, ctx: ExecContext): Promise<ToolOutcome> {
  const spec = toolSpec(call.tool);
  if (!spec) return fail(`Неизвестный инструмент: ${call.tool}`, new Error(`tool "${call.tool}" не существует`));
  if (ctx.allow.length && !ctx.allow.includes(spec.name)) {
    return fail(`${call.tool} недоступен этой роли`, new Error(`Роль не может вызывать ${call.tool}`));
  }

  const a = call.args ?? {};
  const started = Date.now();
  const ms = () => Date.now() - started;

  try {
    switch (spec.name as ToolName) {
      /* -------- files -------- */
      case "read_file": {
        const path = asStr(a.path);
        if (!path) throw new Error("Не указан path");
        const raw = await api.readFile(ctx.root, path, asNum(a.start_line, 0) || undefined, asNum(a.end_line, 0) || undefined);
        const lines = raw.split("\n");
        return ok(`Прочитал ${path}`, clip(raw, 60_000), {
          preview: `${lines.length} строк · ${raw.length} симв.`,
          ms: ms()
        });
      }
      case "write_file": {
        const path = asStr(a.path);
        if (!path) throw new Error("Не указан path");
        const content = asStr(a.content);
        await api.writeFile(ctx.root, path, content);
        return ok(`Записал ${path}`, { ok: true, path, bytes: content.length }, {
          preview: `${content.split("\n").length} строк · ${content.length} симв.`,
          touched: [path],
          ms: ms()
        });
      }
      case "edit_file": {
        const path = asStr(a.path);
        const oldS = asStr(a.old_string);
        const newS = asStr(a.new_string);
        if (!path || !oldS) throw new Error("Нужны path и old_string");
        const note = await api.editFile(ctx.root, path, oldS, newS, asBool(a.replace_all));
        return ok(`Изменил ${path}`, { ok: true, path, note }, { preview: firstLine(note, 120), touched: [path], ms: ms() });
      }
      case "delete_file": {
        const path = asStr(a.path);
        if (!path) throw new Error("Не указан path");
        await api.deleteFile(ctx.root, path);
        return ok(`Удалил ${path}`, { ok: true, path }, { touched: [path], ms: ms() });
      }
      case "move_file": {
        const from = asStr(a.from);
        const to = asStr(a.to);
        if (!from || !to) throw new Error("Нужны from и to");
        await api.moveFile(ctx.root, from, to);
        return ok(`Переместил ${from} → ${to}`, { ok: true, from, to }, { touched: [from, to], ms: ms() });
      }
      case "create_dir": {
        const path = asStr(a.path);
        if (!path) throw new Error("Не указан path");
        await api.createDir(ctx.root, path);
        return ok(`Создал каталог ${path}`, { ok: true, path }, { touched: [path], ms: ms() });
      }
      case "list_dir": {
        const path = asStr(a.path) || ctx.root;
        const depth = Math.min(4, Math.max(1, asNum(a.depth, 1)));
        const out: string[] = [];
        const walk = async (p: string, d: number, prefix: string) => {
          const items = await api.listDir(ctx.root, p);
          for (const it of items) {
            out.push(`${prefix}${it.is_dir ? "📁" : "📄"} ${it.name}`);
            if (it.is_dir && d > 1) await walk(it.path, d - 1, prefix + "  ");
          }
        };
        await walk(path, depth, "");
        const text = out.join("\n");
        return ok(`Список ${path}`, text || "(пусто)", { preview: `${out.length} элементов`, ms: ms() });
      }
      case "search_files": {
        const query = asStr(a.query);
        if (!query) throw new Error("Не указан query");
        const glob = asStr(a.glob);
        const base = asStr(a.path);
        let hits = await api.searchFiles(ctx.root, base, query, glob || undefined);
        if (glob && !base) hits = hits.filter(h => matchGlob(h.path, glob));
        const text = hits.length
          ? hits.map(h => `${h.path}:${h.line}: ${h.text}`).join("\n")
          : "Совпадений не найдено";
        return ok(`Поиск «${query}»`, clip(text, 40_000), {
          preview: `${hits.length} совпадений`,
          touched: [...new Set(hits.map(h => h.path))].slice(0, 40),
          ms: ms()
        });
      }
      case "file_stat": {
        const path = asStr(a.path);
        const meta = await api.fileStat(ctx.root, path);
        return ok(`Метаданные ${path}`, JSON.stringify(meta), { preview: `${meta.size} байт`, ms: ms() });
      }

      /* -------- process -------- */
      case "run_command": {
        const command = asStr(a.command);
        if (!command) throw new Error("Не указан command");
        const res = await api.runCommand(ctx.root, command, Math.min(600, Math.max(1, asNum(a.timeout_seconds, 120))));
        const combined = [res.stdout, res.stderr && `\n[stderr]\n${res.stderr}`].filter(Boolean).join("");
        return {
          ok: res.exit_code === 0,
          label: `Команда: ${command}`,
          data: res,
          preview: clip(combined || "(пустой вывод)", 4000),
          ms: ms()
        };
      }

      /* -------- memory -------- */
      case "memory_search": {
        const query = asStr(a.query);
        if (!query) throw new Error("Не указан query");
        const entries = await api.memorySearch(ctx.root, query, asNum(a.limit, 8));
        const text = entries.length
          ? entries.map(e => `• [${e.kind ?? "note"}] ${e.key} (${e.file_path})\n  ${e.description}`).join("\n")
          : "В памяти проекта ничего не найдено.";
        return ok(`Память: «${query}»`, text, { preview: `${entries.length} записей`, ms: ms() });
      }
      case "memory_write": {
        const key = asStr(a.key);
        if (!key) throw new Error("Не указан key");
        const description = asStr(a.description);
        await api.memoryWrite(ctx.root, key, description, asStr(a.file_path), asStr(a.kind, "note"), asStr(a.tags));
        // Тот же факт уходит в общую память экосистемы — его увидят другие приложения.
        let shared = false;
        if (ctx.eco && ctx.shareMemory) {
          shared = await ctx.eco
            .addMemory(`${key}: ${description}`, { type: "user", title: "InfinityCoder" }, 0.7)
            .then(() => true)
            .catch(() => false);
        }
        return ok(`Память: ${key}`, { ok: true, key, shared }, {
          preview: shared ? "сохранено локально и в экосистеме" : undefined,
          ms: ms()
        });
      }
      case "memory_list": {
        const entries = await api.memoryList(ctx.root, asNum(a.limit, 40), asStr(a.kind));
        const text = entries.length
          ? entries.map(e => `• [${e.kind ?? "note"}] ${e.key}${e.file_path ? ` (${e.file_path})` : ""}\n  ${e.description}`).join("\n")
          : "Память проекта пуста.";
        return ok(`Память: ${entries.length} записей`, text, { preview: `${entries.length} записей`, ms: ms() });
      }
      case "memory_forget": {
        const key = asStr(a.key);
        if (!key) throw new Error("Не указан key");
        await api.memoryForget(ctx.root, key);
        return ok(`Забыл ${key}`, { ok: true, key }, { ms: ms() });
      }

      /* -------- git -------- */
      case "git_status": {
        const s = await api.gitStatus(ctx.root);
        if (!s.is_repo) return ok("Git", "Это не git-репозиторий.");
        return ok(
          `Git · ветка ${s.branch}`,
          JSON.stringify(s),
          { preview: `${s.changed} изменено · ${s.untracked} новых`, ms: ms() }
        );
      }
      case "git_diff": {
        const d = await api.gitDiff(ctx.root, asStr(a.path));
        return ok("Git diff", clip(d || "(нет изменений)", 40_000), { preview: firstLine(d, 100), ms: ms() });
      }
      case "git_log": {
        const log = await api.gitLog(ctx.root, asNum(a.limit, 15));
        const text = log.length
          ? log.map(c => `${c.hash.slice(0, 8)}  ${c.date}  ${c.author}\n    ${c.message}`).join("\n")
          : "История коммитов пуста.";
        return ok(`Git log · ${log.length}`, text, { ms: ms() });
      }
      case "git_commit": {
        const message = asStr(a.message);
        if (!message) throw new Error("Не указан message");
        const out = await api.gitCommit(ctx.root, message);
        return ok("Коммит создан", out, { ms: ms() });
      }

      /* -------- network -------- */
      case "web_fetch": {
        const url = asStr(a.url);
        if (!/^https?:\/\//i.test(url)) throw new Error("Нужен полный http(s)-адрес");
        const html = await api.webFetch(url);
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return ok(`Загрузил ${url}`, clip(text || html, 40_000), { preview: `${text.length} симв.`, ms: ms() });
      }
      case "web_search": {
        const query = asStr(a.query);
        if (!query) throw new Error("Не указан query");
        const res = await api.webSearch(query, asNum(a.limit, 5));
        const text = res.length
          ? res.map(r => `• ${r.title}\n  ${r.url}\n  ${r.snippet}`).join("\n")
          : "Ничего не найдено.";
        return ok(`Поиск: «${query}»`, text, { preview: `${res.length} результатов`, ms: ms() });
      }

      /* -------- Infinity Ecosystem -------- */
      case "ecosystem_search": {
        const query = asStr(a.query);
        if (!query) throw new Error("Не указан query");
        if (!ctx.eco) throw new Error("Экосистема не подключена — войдите в панели «Экосистема»");
        const res = await ctx.eco.search(query, asStr(a.scope, "all"), asNum(a.limit, 20));
        const text = res.hits.length
          ? res.hits
              .map(h => `• [${h.app}] ${h.title}\n  ${h.snippet.replace(/<[^>]+>/g, "").slice(0, 300)}\n  id: ${h.objectId}`)
              .join("\n")
          : "В экосистеме ничего не найдено.";
        return ok(`Экосистема: «${query}»`, clip(text, 30_000), {
          preview: `${res.hits.length} результатов`,
          ms: ms()
        });
      }
      case "ecosystem_remember": {
        const content = asStr(a.content);
        if (!content) throw new Error("Не указан content");
        if (!ctx.eco) throw new Error("Экосистема не подключена — войдите в панели «Экосистема»");
        const kind = asStr(a.kind, "note");
        const title = asStr(a.title, "InfinityCoder");
        const rec = await ctx.eco.addMemory(content, { type: "user", title }, kind === "decision" ? 0.8 : 0.6);
        return ok(`Память экосистемы: ${title}`, { ok: true, id: rec.id }, {
          preview: content.slice(0, 160),
          ms: ms()
        });
      }
      case "ecosystem_object": {
        const id = asStr(a.id);
        if (!id) throw new Error("Не указан id");
        if (!ctx.eco) throw new Error("Экосистема не подключена — войдите в панели «Экосистема»");
        const obj = await ctx.eco.object(id);
        const text = [
          `id: ${obj.id}`,
          `приложение: ${obj.app} · тип: ${obj.kind}`,
          `заголовок: ${obj.title}`,
          obj.body ? `содержимое:\n${obj.body}` : ""
        ]
          .filter(Boolean)
          .join("\n");
        return ok(`Объект ${obj.id}`, clip(text, 30_000), { preview: obj.title, ms: ms() });
      }

      default:
        return fail(call.tool, new Error("Инструмент не реализован"));
    }
  } catch (e) {
    return fail(spec.summary, e);
  }
}

export const BROWSER_ONLY_TOOLS = new Set<ToolName>(["git_status", "git_diff", "git_log", "git_commit", "file_stat", "create_dir"]);

export function unavailableInBrowser(name: string): boolean {
  return !isTauri && BROWSER_ONLY_TOOLS.has(name as ToolName);
}
