/**
 * Application store.
 *
 * A single observable state tree. The previous build kept workspace/openFile in
 * three separate places, which meant the agent literally could not see the file
 * the user had open. Everything now lives here and is read through
 * `useSyncExternalStore`, so there is exactly one source of truth.
 */
import { subscribeActivity, complete as completeActivity, resetActivity, publish } from "./lib/activity";
import { AgentEngine } from "./lib/engine";
import { api, isTauri } from "./lib/ipc";
import { loadSettings, saveSettings, EFFORT_PRESETS } from "./lib/settings";
import { EcosystemClient, EcosystemError, browserStorage, type EcoGrantScope } from "./lib/ecosystem";
import { createEcosystemTransport, type Transport } from "./lib/ecosystem-llm";
import type {
  ActivityEvent,
  AgentRunStats,
  EcoState,
  FsItem,
  GitStatus,
  LedgerEntry,
  Message,
  Msg,
  OpenFile,
  PendingQuestion,
  Settings,
  SwarmWorker,
  Toast,
  ToolCallRecord,
  Usage
} from "./types";

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface AppState {
  booted: boolean;
  root: string;
  projectName: string;
  info: { files: number; symbols: number; memories: number; is_repo: boolean };
  git: GitStatus | null;

  /* explorer */
  dirCache: Record<string, FsItem[]>;
  expanded: string[];
  loadingDirs: string[];

  /* editor */
  tabs: OpenFile[];
  activePath: string | null;
  saving: boolean;

  /* search */
  fileQuery: string;
  fileHits: SearchHit[];
  searching: boolean;

  /** One-shot "open this file and scroll to this line" request. */
  reveal: { path: string; line: number; id: number } | null;

  /* conversation */
  messages: Message[];
  streaming: string;
  isRunning: boolean;
  activity: ActivityEvent[];
  workers: SwarmWorker[];
  plan: string[];
  question: PendingQuestion | null;
  usage: Usage;

  /* engine / provider */
  providerStatus: "checking" | "ready" | "error" | "offline";
  providerMessage: string;

  /* infinity ecosystem */
  eco: EcoState;

  /* chrome */
  settings: Settings;
  toasts: Toast[];
  paletteOpen: boolean;
  settingsOpen: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

const PERSIST_KEY = "infinitycoder.session.v3";

const initial: AppState = {
  booted: false,
  root: "",
  projectName: "",
  info: { files: 0, symbols: 0, memories: 0, is_repo: false },
  git: null,
  dirCache: {},
  expanded: [],
  loadingDirs: [],
  tabs: [],
  activePath: null,
  saving: false,
  fileQuery: "",
  fileHits: [],
  searching: false,
  reveal: null,
  messages: [],
  streaming: "",
  isRunning: false,
  activity: [],
  workers: [],
  plan: [],
  question: null,
  usage: { prompt: 0, completion: 0, total: 0 },
  providerStatus: "checking",
  providerMessage: "Проверяю соединение…",
  eco: {
    status: "off",
    message: "Экосистема не подключена",
    url: "",
    account: null,
    models: [],
    providers: [],
    grants: [],
    syncCursor: 0,
    pendingChanges: 0,
    lastSync: null,
    diagnostics: null,
    error: null,
    memories: []
  },
  settings: loadSettings(),
  toasts: [],
  paletteOpen: false,
  settingsOpen: false,
  leftCollapsed: false,
  rightCollapsed: false
};

let state: AppState = initial;
const listeners = new Set<() => void>();
let toastSeq = 0;

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function getState(): AppState {
  return state;
}

function set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ================================================================== *
 * Persistence
 * ================================================================== */

function persist() {
  try {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        root: state.root,
        expanded: state.expanded,
        tabs: state.tabs.map(t => ({ path: t.path, content: t.content, saved: t.saved, language: t.language })),
        activePath: state.activePath,
        messages: state.messages.slice(-40),
        leftCollapsed: state.leftCollapsed,
        rightCollapsed: state.rightCollapsed
      })
    );
  } catch {
    /* quota */
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const j = JSON.parse(raw);
    set({
      root: typeof j.root === "string" ? j.root : "",
      expanded: Array.isArray(j.expanded) ? j.expanded : [],
      tabs: Array.isArray(j.tabs) ? j.tabs : [],
      activePath: j.activePath ?? null,
      messages: Array.isArray(j.messages) ? j.messages : [],
      leftCollapsed: !!j.leftCollapsed,
      rightCollapsed: !!j.rightCollapsed
    });
    if (state.root) state.projectName = basename(state.root);
  } catch {
    /* ignore */
  }
}

/* ================================================================== *
 * Helpers
 * ================================================================== */

const basename = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;
const dirname = (p: string) => {
  const n = p.replace(/[\\/]+$/, "");
  const i = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
  return i <= 0 ? n : n.slice(0, i);
};

export const LANGS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", json: "json", jsonc: "json",
  rs: "rust", py: "python", rb: "ruby", go: "go", java: "java", kt: "kotlin",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php", swift: "swift",
  sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell", bat: "bat",
  css: "css", scss: "scss", less: "less", html: "html", htm: "html",
  vue: "html", svelte: "html", svg: "xml", xml: "xml", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", cfg: "ini", env: "ini", sql: "sql", md: "markdown",
  markdown: "markdown", txt: "plaintext", log: "plaintext", lock: "plaintext",
  dockerfile: "dockerfile", nsh: "ini", gradle: "xml", proto: "proto"
};

export function languageOf(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (/^dockerfile/i.test(name)) return "dockerfile";
  if (/^makefile/i.test(name)) return "makefile";
  return LANGS[ext] ?? "plaintext";
}

export const fileIconFor = (item: FsItem | string): string => {
  const name = typeof item === "string" ? basename(item) : item.name;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "rb", "php", "swift", "kt", "cs", "c", "cpp", "h", "hpp"].includes(ext)) return "fileCode";
  if (["md", "txt", "log", "rst"].includes(ext)) return "fileText";
  if (["json", "yaml", "yml", "toml", "ini", "cfg", "env"].includes(ext)) return "fileText";
  return "file";
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function toast(kind: Toast["kind"], text: string, detail?: string) {
  const t: Toast = { id: ++toastSeq, kind, text, detail };
  set(s => ({ toasts: [...s.toasts.slice(-4), t] }));
  window.setTimeout(() => {
    set(s => ({ toasts: s.toasts.filter(x => x.id !== t.id) }));
  }, kind === "error" ? 7000 : 3800);
}

export function dismissToast(id: number) {
  set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
}

/* ================================================================== *
 * Infinity Ecosystem
 * ================================================================== */

/** Клиент Core API. null — экосистема не настроена. */
let ecoClient: EcosystemClient | null = null;

const ecoStorage = browserStorage();

/** Инструмент IDE → инструмент экосистемы (общие гранты Tool Runtime). */
const ECO_TOOL_ALIAS: Record<string, string> = {
  read_file: "coder_read_file",
  write_file: "coder_write_file",
  edit_file: "coder_write_file",
  delete_file: "coder_write_file",
  move_file: "coder_write_file",
  create_dir: "coder_write_file",
  list_dir: "coder_list_files",
  search_files: "coder_search_files",
  run_command: "coder_run_command",
  git_status: "coder_git_status",
  git_diff: "coder_git_diff",
  git_log: "coder_git_log",
  git_commit: "coder_git_commit"
};

/** Грант экосистемы для инструмента IDE (null — гранта нет). */
export function ecoGrantFor(tool: string): EcoGrantScope | null {
  const alias = ECO_TOOL_ALIAS[tool];
  if (!alias) return null;
  const grant = state.eco.grants.find(g => g.tool === alias);
  return grant ? grant.scope : null;
}

function ecoSet(patch: Partial<EcoState>) {
  set(s => ({ eco: { ...s.eco, ...patch } }));
}

/** Подключение к Core API: проверка живости, модели, провайдеры, гранты. */
export async function ecoConnect(url?: string, opts: { silent?: boolean } = {}): Promise<boolean> {
  const target = (url ?? state.settings.ecosystemUrl ?? state.eco.url ?? "").trim();
  if (!target) {
    ecoSet({ status: "off", message: "Укажите адрес Core API", error: null });
    return false;
  }
  // Токен берём из хранилища: иначе после перезагрузки страницы аккаунт
  // теряется, хотя он был получен раньше.
  if (!ecoClient) ecoClient = EcosystemClient.fromStorage(ecoStorage);
  ecoClient.setUrl(target);
  const client = ecoClient;

  ecoSet({ status: "connecting", message: "Подключение…", url: client.url, error: null });
  try {
    const health = await client.health();
    if (!health?.ok) throw new EcosystemError("Core API не отвечает", "NOT_READY");

    let account = state.eco.account;
    if (client.authed) {
      account = await client.me().catch(() => null);
      if (!account) client.setToken(null);
    }
    ecoSet({
      status: "online",
      message: client.authed ? `подключено · ${account?.email ?? "аккаунт"}` : "подключено · без входа",
      account
    });
    patchSettings({ ecosystemUrl: client.url });
    await ecoRefresh();
    if (state.settings.ecosystemSync) void ecoSync();
    if (!opts.silent) toast("ok", "Экосистема подключена", client.url);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ecoSet({ status: "error", message: "Не удалось подключиться", error: message });
    if (!opts.silent) toast("error", "Экосистема недоступна", message);
    return false;
  }
}

/** Обновление моделей, провайдеров, грантов и диагностики. */
export async function ecoRefresh(): Promise<void> {
  if (!ecoClient) return;
  const client = ecoClient;
  try {
    const [models, providers, grants, diagnostics, memories] = await Promise.all([
      client.models().catch(() => []),
      client.providers().catch(() => []),
      client.toolGrants().catch(() => []),
      client.diagnostics().catch(() => null),
      client.memories(30).catch(() => [])
    ]);
    const modelScope = (id: string): "local" | "cloud" => {
      const p = providers.find(x => x.id === id);
      return p?.scope ?? "cloud";
    };
    ecoSet({
      models: models.map(m => ({
        id: m.id,
        displayName: m.displayName || m.remoteName,
        providerId: m.providerId,
        scope: modelScope(m.providerId)
      })),
      providers: providers.map(p => ({
        id: p.id,
        name: p.name,
        scope: p.scope,
        enabled: p.enabled,
        isDefault: p.isDefault
      })),
      grants: grants.map(g => ({ tool: g.name, scope: g.grant?.scope ?? "ask" })),
      diagnostics: diagnostics
        ? {
            providers: diagnostics.ai.providers,
            enabled: diagnostics.ai.enabled,
            models: diagnostics.ai.models,
            local: diagnostics.ai.local,
            cloud: diagnostics.ai.cloud,
            indexed: diagnostics.search.indexed,
            stale: diagnostics.search.stale
          }
        : null,
      memories
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ecoSet({ error: message });
  }
}

/** Вход в Infinity ID. */
export async function ecoLogin(email: string, password: string): Promise<boolean> {
  if (!ecoClient) ecoClient = EcosystemClient.fromStorage(ecoStorage);
  ecoSet({ status: "connecting", message: "Вход…", error: null });
  try {
    const user = await ecoClient.login(email, password);
    ecoSet({ status: "online", account: user, message: `вошли как ${user.email}` });
    await ecoRefresh();
    if (state.settings.ecosystemSync) void ecoSync();
    toast("ok", "Вход выполнен", user.email);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ecoSet({ status: "error", error: message, message: "Ошибка входа" });
    toast("error", "Не удалось войти", message);
    return false;
  }
}

/** Регистрация в Infinity ID. */
export async function ecoRegister(email: string, password: string, displayName?: string): Promise<boolean> {
  if (!ecoClient) ecoClient = EcosystemClient.fromStorage(ecoStorage);
  ecoSet({ status: "connecting", message: "Регистрация…", error: null });
  try {
    const user = await ecoClient.register(email, password, displayName);
    ecoSet({ status: "online", account: user, message: `зарегистрированы как ${user.email}` });
    await ecoRefresh();
    toast("ok", "Аккаунт создан", user.email);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ecoSet({ status: "error", error: message, message: "Ошибка регистрации" });
    toast("error", "Не удалось зарегистрироваться", message);
    return false;
  }
}

/** Выход: токен удаляется, IDE продолжает работать автономно. */
export async function ecoLogout(): Promise<void> {
  ecoClient?.setToken(null);
  ecoSet({
    account: null,
    models: [],
    providers: [],
    grants: [],
    message: "вышли из аккаунта"
  });
  toast("info", "Вы вышли из Infinity ID", "IDE работает автономно");
}

/** Смена общего разрешения инструмента (ask/allow/deny). */
export async function ecoSetGrant(tool: string, scope: EcoGrantScope): Promise<void> {
  if (!ecoClient) return;
  try {
    await ecoClient.setToolGrant(tool, scope);
    ecoSet({
      grants: state.eco.grants.some(g => g.tool === tool)
        ? state.eco.grants.map(g => (g.tool === tool ? { ...g, scope } : g))
        : [...state.eco.grants, { tool, scope }]
    });
    toast("ok", "Разрешение сохранено", `${tool} → ${scope}`);
  } catch (e) {
    toast("error", "Не удалось сохранить разрешение", e instanceof Error ? e.message : String(e));
  }
}

/** Забрать изменения экосистемы (Sync). */
export async function ecoSync(): Promise<number> {
  if (!ecoClient?.authed) return 0;
  try {
    const res = await ecoClient.changes(state.eco.syncCursor);
    const pending = state.eco.pendingChanges + res.changes.length;
    ecoSet({
      syncCursor: res.cursor || state.eco.syncCursor,
      pendingChanges: pending,
      lastSync: Date.now()
    });
    return res.changes.length;
  } catch {
    return 0;
  }
}

/** Сохранить отчёт агента в общую заметку экосистемы (Infinity Notes). */
export async function ecoSaveReport(title: string, body: string): Promise<boolean> {
  if (!ecoClient?.authed) {
    toast("warn", "Нужен вход в Infinity ID", "Войдите в панели «Экосистема»");
    return false;
  }
  try {
    const obj = await ecoClient.createObject({
      app: "notes",
      kind: "note",
      title,
      body,
      tags: ["infinitycoder"],
      meta: { source: "infinitycoder" }
    });
    toast("ok", "Сохранено в Infinity Notes", obj.title);
    return true;
  } catch (e) {
    toast("error", "Не удалось сохранить", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Поиск по всем приложениям экосистемы. */
export async function ecoSearch(query: string, scope = "all"): Promise<
  { objectId: string; app: string; title: string; snippet: string }[]
> {
  if (!ecoClient) return [];
  try {
    const res = await ecoClient.search(query, scope, 25);
    return res.hits.map(h => ({
      objectId: h.objectId,
      app: h.app,
      title: h.title,
      snippet: h.snippet.replace(/<\/?mark>/g, "")
    }));
  } catch (e) {
    toast("error", "Поиск не удался", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** Активный клиент экосистемы (или null). */
export function eco(): EcosystemClient | null {
  return ecoClient;
}

/** Транспорт генерации: экосистема или локальный провайдер. */
export function ecoTransport(): Transport | null {
  const s = state.settings;
  if (!s.ecosystemUse || !ecoClient?.authed || !s.ecosystemModelId) return null;
  try {
    return createEcosystemTransport(ecoClient, {
      modelId: s.ecosystemModelId,
      mode: s.ecosystemScope
    });
  } catch {
    return null;
  }
}

/* ================================================================== *
 * Engine wiring
 * ================================================================== */

let engine: AgentEngine | null = null;

function getEngine(): AgentEngine {
  if (engine) return engine;
  engine = new AgentEngine({
    getSettings: () => state.settings,
    getRoot: () => state.root,
    getOpenFile: () => state.tabs.find(t => t.path === state.activePath) ?? null,
    onQuestion: q => set({ question: q }),
    onTouched: paths => {
      // Drop caches for every parent of a touched path so the tree stays truthful.
      const dirty = new Set<string>();
      for (const p of paths) {
        let d = dirname(p);
        for (let i = 0; i < 12; i++) {
          if (!d) break;
          dirty.add(d);
          const n = dirname(d);
          if (n === d) break;
          d = n;
        }
      }
      set(s => {
        const cache = { ...s.dirCache };
        for (const d of dirty) delete cache[d];
        return { dirCache: cache };
      });
      void refreshDirs();
    },
    onWorkers: w => set({ workers: w }),
    onUsage: u => set({ usage: u }),
    onTextDelta: text => set(s => ({ streaming: s.streaming + text })),
    getTransport: () => ecoTransport(),
    getEco: () => (state.settings.ecosystemUse ? ecoClient : null),
    getGrant: tool => ecoGrantFor(tool)
  });
  return engine;
}

subscribeActivity(e => {
  set(s => {
    const idx = s.activity.findIndex(x => x.id === e.id);
    if (idx >= 0) {
      const copy = s.activity.slice();
      copy[idx] = e;
      return { activity: copy };
    }
    return { activity: [...s.activity.slice(-120), e] };
  });
});

/* ================================================================== *
 * Boot / provider
 * ================================================================== */

let statusTimer: number | undefined;

export async function checkProvider() {
  const s = state.settings;
  set({ providerStatus: "checking", providerMessage: "Проверяю соединение…" });
  if (s.provider === "local") {
    const st = await api.aiStatus();
    if (st === "ready") set({ providerStatus: "ready", providerMessage: s.localModel });
    else if (st.startsWith("error:")) set({ providerStatus: "error", providerMessage: st.slice(6) });
    else set({ providerStatus: "checking", providerMessage: "Загружаю локальную модель…" });
    return;
  }
  if (!s.apiKey) {
    set({ providerStatus: "offline", providerMessage: "Нет API-ключа" });
    return;
  }
  try {
    const r = await fetch(`${s.baseUrl.replace(/\/+$/, "")}/v1/models`, {
      headers: { authorization: `Bearer ${s.apiKey}` },
      signal: AbortSignal.timeout(9000)
    });
    if (r.ok) set({ providerStatus: "ready", providerMessage: s.model });
    else if (r.status === 401 || r.status === 403) {
      set({ providerStatus: "error", providerMessage: "Ключ отклонён (401)" });
    } else {
      set({ providerStatus: "error", providerMessage: `Ошибка ${r.status}` });
    }
  } catch {
    set({ providerStatus: "error", providerMessage: "Сеть недоступна" });
  }
}

export function startStatusPolling() {
  window.clearInterval(statusTimer);
  void checkProvider();
  statusTimer = window.setInterval(() => void checkProvider(), state.settings.provider === "local" ? 2500 : 30_000);
}

export function stopStatusPolling() {
  window.clearInterval(statusTimer);
}

export async function boot() {
  if (state.booted) return;
  restore();
  set({ booted: true });
  startStatusPolling();
  if (state.settings.ecosystemAutoConnect && state.settings.ecosystemUrl) {
    void ecoConnect(state.settings.ecosystemUrl, { silent: true });
  }
  if (state.root) {
    await refreshInfo();
    await refreshGit();
    await refreshDirs();
    // Validate the persisted root still exists (it may have been deleted).
    try {
      const items = await api.listDir(state.root, state.root);
      set(s => ({ dirCache: { ...s.dirCache, [state.root]: items } }));
    } catch {
      toast("warn", "Проект недоступен", "Папка не найдена — откройте заново");
      set({ root: "", projectName: "", tabs: [], activePath: null });
    }
  }
}

export async function refreshInfo() {
  if (!state.root) return;
  const info = await api.workspaceInfo(state.root).catch(() => null);
  if (info) set({ info });
}

export async function refreshGit() {
  if (!state.root) return set({ git: null });
  const g = await api.gitStatus(state.root).catch(() => null);
  set({ git: g && g.is_repo ? g : null });
}

/* ================================================================== *
 * Workspace
 * ================================================================== */

export async function openFolder() {
  try {
    const p = await api.openFolder();
    if (!p) return;
    set({
      root: p,
      projectName: basename(p),
      dirCache: {},
      // Корень раскрыт сразу — проводник не должен быть пустым после открытия.
      expanded: [p],
      workers: [],
      plan: [],
      activity: []
    });
    await refreshInfo();
    await refreshGit();
    await refreshDirs();
    toast("ok", "Проект открыт", p);
    persist();
  } catch (e) {
    toast("error", "Не удалось открыть проект", String(e));
  }
}

export async function refreshDirs() {
  const paths = new Set<string>([state.root, ...state.expanded]);
  if (!paths.size) return;
  set({ loadingDirs: [...paths] });
  const entries = await Promise.all(
    [...paths].map(async p => {
      try {
        return [p, await api.listDir(state.root, p)] as const;
      } catch {
        return [p, null] as const;
      }
    })
  );
  set(s => {
    const cache = { ...s.dirCache };
    for (const [p, items] of entries) {
      if (items) cache[p] = items;
      else delete cache[p];
    }
    return { dirCache: cache, loadingDirs: [] };
  });
}

export async function toggleDir(path: string) {
  const expanded = state.expanded.includes(path)
    ? state.expanded.filter(p => p !== path)
    : [...state.expanded, path];
  set({ expanded });
  if (!state.dirCache[path] && expanded.includes(path)) {
    try {
      const items = await api.listDir(state.root, path);
      set(s => ({ dirCache: { ...s.dirCache, [path]: items } }));
    } catch {
      /* ignore */
    }
  }
  persist();
}

export function collapseAll() {
  set({ expanded: [] });
  persist();
}

export async function revealPath(path: string) {
  const chain: string[] = [];
  let d = dirname(path);
  while (d && d !== "." && d !== "/" && d.length >= state.root.length) {
    chain.unshift(d);
    const p = dirname(d);
    if (p === d) break;
    d = p;
  }
  set({ expanded: Array.from(new Set([...state.expanded, ...chain])) });
  await refreshDirs();
}

export async function openFile(path: string) {
  const existing = state.tabs.find(t => t.path === path);
  if (existing) return set({ activePath: path });
  try {
    const content = await api.readFile(state.root, path);
    const file: OpenFile = { path, content, saved: content, language: languageOf(path) };
    set(s => ({ tabs: [...s.tabs, file].slice(-12), activePath: path }));
    persist();
  } catch (e) {
    toast("error", "Не удалось открыть файл", String(e));
  }
}

export function closeTab(path: string) {
  set(s => {
    const i = s.tabs.findIndex(t => t.path === path);
    const tabs = s.tabs.filter(t => t.path !== path);
    const activePath = s.activePath === path ? tabs[Math.max(0, i - 1)]?.path ?? null : s.activePath;
    return { tabs, activePath };
  });
  persist();
}

let revealSeq = 0;

/** Open a file and scroll the editor to `line` once it is mounted. */
export async function revealLocation(path: string, line?: number) {
  await openFile(path);
  set({ reveal: { path, line: line ?? 1, id: ++revealSeq } });
}

export function clearReveal(id: number) {
  set(s => (s.reveal?.id === id ? { reveal: null } : {}));
}

export function setActiveTab(path: string) {
  set({ activePath: path });
  persist();
}

export function updateEditorContent(path: string, content: string) {
  set(s => ({ tabs: s.tabs.map(t => (t.path === path ? { ...t, content } : t)) }));
}

export function isDirty(f: OpenFile): boolean {
  return f.content !== f.saved;
}

export async function saveFile(path?: string) {
  const target = path ?? state.activePath;
  if (!target) return;
  const file = state.tabs.find(t => t.path === target);
  if (!file) return;
  if (!isDirty(file)) return;
  set({ saving: true });
  try {
    await api.writeFile(state.root, target, file.content);
    set(s => ({ tabs: s.tabs.map(t => (t.path === target ? { ...t, saved: t.content } : t)) }));
    set(s => {
      const cache = { ...s.dirCache };
      delete cache[dirname(target)];
      return { dirCache: cache };
    });
    void refreshDirs();
    void refreshInfo();
    toast("ok", "Сохранено", basename(target));
  } catch (e) {
    toast("error", "Ошибка сохранения", String(e));
  } finally {
    set({ saving: false });
  }
}

export async function saveAll() {
  const dirty = state.tabs.filter(isDirty);
  for (const f of dirty) await saveFile(f.path);
}

export async function createFile(path: string, content = "") {
  try {
    await api.writeFile(state.root, path, content);
    await revealPath(path);
    await refreshInfo();
    await openFile(path);
    toast("ok", "Файл создан", path);
  } catch (e) {
    toast("error", "Не удалось создать файл", String(e));
  }
}

export async function createFolder(path: string) {
  try {
    await api.createDir(state.root, path);
    await revealPath(path);
    await refreshDirs();
    toast("ok", "Папка создана", path);
  } catch (e) {
    toast("error", "Не удалось создать папку", String(e));
  }
}

export async function deletePath(path: string) {
  try {
    await api.deleteFile(state.root, path);
    set(s => ({
      dirCache: Object.fromEntries(Object.entries(s.dirCache).filter(([k]) => k !== path && !k.startsWith(path + "/"))),
      tabs: s.tabs.filter(t => !t.path.startsWith(path)),
      activePath: s.tabs.some(t => t.path === path) ? null : s.activePath,
      expanded: s.expanded.filter(p => !p.startsWith(path))
    }));
    await refreshDirs();
    await refreshInfo();
    toast("ok", "Удалено", basename(path));
  } catch (e) {
    toast("error", "Не удалось удалить", String(e));
  }
}

export async function renamePath(from: string, to: string) {
  try {
    await api.moveFile(state.root, from, to);
    const content = state.tabs.find(t => t.path === from)?.content ?? "";
    if (content) {
      set(s => ({
        tabs: s.tabs.map(t => (t.path === from ? { ...t, path: to, language: languageOf(to) } : t)),
        activePath: s.activePath === from ? to : s.activePath
      }));
    }
    await refreshDirs();
    await refreshInfo();
    toast("ok", "Переименовано", `${basename(from)} → ${basename(to)}`);
  } catch (e) {
    toast("error", "Не удалось переименовать", String(e));
  }
}

export async function searchInProject(query: string) {
  set({ fileQuery: query });
  if (query.trim().length < 2) return set({ fileHits: [], searching: false });
  set({ searching: true });
  const q = query.trim();
  const hits = await api.searchFiles(state.root, "", q, undefined, 200).catch(() => []);
  set({ fileHits: hits, searching: false });
}

/* ================================================================== *
 * Memory panel
 * ================================================================== */

let memoryCache: LedgerEntry[] = [];

export const memory = {
  all: (): LedgerEntry[] => memoryCache,
  async load(force = false): Promise<LedgerEntry[]> {
    if (!state.root) return [];
    if (!force && memoryCache.length) return memoryCache;
    memoryCache = await api.memoryList(state.root, 200).catch(() => []);
    set(s => ({ info: { ...s.info, memories: memoryCache.length } }));
    return memoryCache;
  },
  async search(query: string): Promise<LedgerEntry[]> {
    if (!state.root) return [];
    if (!query.trim()) return memory.load();
    const hits = await api.memorySearch(state.root, query, 60).catch(() => []);
    return hits;
  },
  async add(key: string, description: string, filePath: string, kind: string) {
    if (!key.trim()) return toast("error", "Нужен ключ");
    await api.memoryWrite(state.root, key.trim(), description.trim(), filePath, kind);
    memoryCache = [];
    await memory.load(true);
    await refreshInfo();
    toast("ok", "Записано в память", key);
  },
  async remove(key: string) {
    await api.memoryForget(state.root, key);
    memoryCache = [];
    await memory.load(true);
    await refreshInfo();
    toast("ok", "Запись удалена", key);
  },
  async reindex() {
    const n = await api.memoryReindex(state.root).catch(() => 0);
    memoryCache = [];
    await memory.load(true);
    await refreshInfo();
    toast("ok", "Индекс пересобран", n ? `${n} файлов` : "нечего индексировать");
  }
};

/* ================================================================== *
 * Conversation
 * ================================================================== */

function pushMessage(m: Message) {
  set(s => ({ messages: [...s.messages, m] }));
  persist();
}

function patchMessage(id: string, patch: Partial<Message>) {
  set(s => ({ messages: s.messages.map(m => (m.id === id ? { ...m, ...patch } : m)) }));
}

function attachActivity(msgId: string, agentId?: string) {
  set(s => {
    const events = agentId
      ? s.activity.filter(a => a.agentId === agentId)
      : s.activity;
    return { messages: s.messages.map(m => (m.id === msgId ? { ...m, activity: events.slice(-60) } : m)) };
  });
}

const historyFor = (messages: Message[]): Msg[] =>
  messages
    .filter(m => m.role === "user" || (m.role === "assistant" && m.content.trim()))
    .slice(-8)
    .map(m => ({ role: m.role, content: m.content }));

export async function send(text: string) {
  const task = text.trim();
  if (!task || state.isRunning || !state.root) return;
  if (state.providerStatus !== "ready") {
    toast("warn", "Провайдер не готов", state.providerMessage);
    return;
  }

  const userMsg: Message = { id: uid(), role: "user", content: task, ts: Date.now() };
  const replyId = uid();
  const reply: Message = { id: replyId, role: "assistant", content: "", ts: Date.now(), toolCalls: [] };
  const history = historyFor(state.messages);

  resetActivity();
  set({
    messages: [...state.messages, userMsg, reply],
    isRunning: true,
    streaming: "",
    activity: [],
    workers: [],
    plan: [],
    question: null
  });
  persist();

  const stats: AgentRunStats = {
    turns: 0,
    toolCalls: 0,
    startedAt: Date.now(),
    usage: { prompt: 0, completion: 0, total: 0 },
    cost: 0,
    model: state.settings.provider === "cloud" ? state.settings.model : state.settings.localModel
  };
  patchMessage(replyId, { stats });

  const records: ToolCallRecord[] = [];

  const unsub = subscribeActivity(e => {
    if (e.kind === "tool" && e.tool && e.status !== "running") {
      const rec: ToolCallRecord = {
        id: `${e.id}`,
        tool: e.tool.tool,
        args: e.tool.args,
        label: e.label,
        status: e.status === "ok" ? "ok" : "error",
        output: e.result?.preview,
        ms: e.result?.ms,
        agentId: e.agentId
      };
      const existing = records.findIndex(r => r.id === rec.id);
      if (existing >= 0) records[existing] = rec;
      else records.push(rec);
      patchMessage(replyId, { toolCalls: [...records] });
    }
  });

  try {
    const eng = getEngine();
    eng.reset();
    const result = await eng.run(task, history);

    stats.turns = result.turns;
    stats.toolCalls = result.toolCalls;
    stats.finishedAt = Date.now();
    stats.usage = result.usage;

    patchMessage(replyId, {
      content: result.text,
      stats: { ...stats },
      swarm: result.workers.length ? { workers: result.workers, plan: result.plan } : undefined
    });
    set({ plan: result.plan });

    // Persist the outcome as durable project memory so the next session benefits.
    if (result.text.trim()) {
      void api
        .memoryWrite(
          state.root,
          `session:${Date.now()}`,
          `Запрос: ${task.slice(0, 1200)}\nРезультат: ${result.text.slice(0, 4000)}`,
          "",
          "note"
        )
        .then(async () => {
          memoryCache = [];
          await refreshInfo();
        })
        .catch(() => {});
    }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    patchMessage(replyId, {
      content: state.streaming.trim(),
      error: msg,
      stats: { ...stats, finishedAt: Date.now() }
    });
    const ev = publish({ kind: "error", label: "Сбой выполнения", detail: msg, agentId: "main" });
    completeActivity(ev.id, "error");
  } finally {
    unsub();
    set({ isRunning: false, streaming: "", question: null });
    attachActivity(replyId);
    persist();
    void refreshGit();
    void refreshInfo();
  }
}

export function stop() {
  getEngine().cancel();
  const last = state.activity[state.activity.length - 1];
  if (last?.status === "running") completeActivity(last.id, "error");
  set({ isRunning: false, streaming: "", question: null });
  toast("info", "Остановлено");
}

export function respond(answer: boolean) {
  const q = state.question;
  if (!q) return;
  window.dispatchEvent(new CustomEvent("infinitycoder:answer", { detail: { id: q.id, answer } }));
  set({ question: null });
}

export function clearChat() {
  getEngine().reset();
  resetActivity();
  set({ messages: [], streaming: "", activity: [], workers: [], plan: [] });
  persist();
}

/* ================================================================== *
 * Settings
 * ================================================================== */

export function patchSettings(patch: Partial<Settings>) {
  set(s => {
    const next = { ...s.settings, ...patch };
    saveSettings(next);
    return { settings: next };
  });
  if (patch.provider !== undefined || patch.apiKey !== undefined || patch.baseUrl !== undefined || patch.model !== undefined) {
    void checkProvider();
  }
  persist();
}

export function resetSettings() {
  set(s => {
    saveSettings(s.settings);
    return { settings: loadSettings() };
  });
}

export function setTheme(theme: "dark" | "light") {
  patchSettings({ theme });
  document.documentElement.dataset.theme = theme;
}

export function togglePalette(open?: boolean) {
  set(s => ({ paletteOpen: open ?? !s.paletteOpen }));
}
export function openSettings(open: boolean) {
  set({ settingsOpen: open });
}
export function toggleLeft() {
  set(s => ({ leftCollapsed: !s.leftCollapsed }));
  persist();
}
export function toggleRight() {
  set(s => ({ rightCollapsed: !s.rightCollapsed }));
  persist();
}

/* ================================================================== *
 * Misc
 * ================================================================== */

export function pushSampleMessage(text: string) {
  pushMessage({ id: uid(), role: "assistant", content: text, ts: Date.now() });
}

export function activeFile(): OpenFile | null {
  return state.tabs.find(t => t.path === state.activePath) ?? null;
}

export function currentEffort() {
  return EFFORT_PRESETS[state.settings.effort];
}

export { isTauri };
