/**
 * Клиент Infinity Ecosystem (Core API).
 *
 * Единый контракт `/api/v1` — тот же, что у Windows, Android и Web. Через него
 * IDE получает:
 *   • Infinity ID — вход и идентификация пользователя;
 *   • AI Runtime — модели, провайдеры и потоковая генерация (секреты и режим
 *     local/cloud проверяет сервер, а не клиент);
 *   • Tool Runtime — общие разрешения инструментов (ask/allow/deny);
 *   • Data Services и Search — объекты других приложений и общий поиск;
 *   • Память и Sync — общая память и журнал изменений.
 *
 * Вне экосистемы IDE полностью работоспособен: все вызовы помечены
 * «недоступно», а не подменяются выдуманными данными.
 */

export type EcoScope = "local" | "cloud";
export type EcoGrantScope = "ask" | "allow" | "deny";

export interface EcoUser {
  id: string;
  email: string;
  displayName: string;
  createdAt?: string;
}

export interface EcoProvider {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  scope: EcoScope;
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
}

export interface EcoModel {
  id: string;
  providerId: string;
  remoteName: string;
  displayName: string;
  contextSize: number;
  capabilities: string[];
}

export interface EcoTool {
  name: string;
  description: string;
  risk: "read" | "write" | "exec";
}

export interface EcoGrant {
  tool: string;
  scope: EcoGrantScope;
  expiresAt: string | null;
}

export interface EcoSearchHit {
  objectId: string;
  app: string;
  title: string;
  snippet: string;
  updatedAt: string;
  score: number;
}

export interface EcoObject {
  id: string;
  app: string;
  kind: string;
  title: string;
  body: string | null;
  tags: string[];
  meta: Record<string, unknown>;
  updatedAt: string;
}

export interface EcoMemory {
  id: string;
  content: string;
  source: { type: string; objectId?: string; title?: string; snippet?: string };
  importance: number;
  updatedAt: string;
}

export interface EcoChange {
  seq: number;
  app: string;
  objectId: string;
  op: string;
  changedAt: string;
}

export interface EcoDiagnostics {
  ai: { providers: number; enabled: number; models: number; local: number; cloud: number };
  search: { indexed: number; stale: number; orphaned: number };
}

export interface EcoCoderProject {
  id: string;
  name: string;
  description: string;
  settings: {
    testCommand?: string;
    buildCommand?: string;
    allowedCommands: string[];
    allowArbitraryCommands: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export class EcosystemError extends Error {
  constructor(
    message: string,
    readonly code = "ECOSYSTEM_ERROR",
    readonly status = 0
  ) {
    super(message);
    this.name = "EcosystemError";
  }
}

export interface EcoMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface CompletionOptions {
  modelId: string;
  mode: EcoScope;
  messages: EcoMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
  /** Кусочек текста, пришедший от модели. */
  onDelta?: (text: string) => void;
}

/** Хранилище с безопасным откатом в память (Node, приватный режим). */
export interface EcoStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStorage(): EcoStorage {
  const map = new Map<string, string>();
  return {
    get: k => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: k => void map.delete(k)
  };
}

export function browserStorage(): EcoStorage {
  try {
    if (typeof localStorage !== "undefined") {
      return {
        get: k => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
        remove: k => localStorage.removeItem(k)
      };
    }
  } catch {
    /* приватный режим — работаем в памяти */
  }
  return memoryStorage();
}

const TOKEN_KEY = "infinitycoder.ecosystem.token.v4";
const URL_KEY = "infinitycoder.ecosystem.url.v4";

export class EcosystemClient {
  private token: string | null;
  private baseUrl: string;

  constructor(baseUrl: string, token: string | null = null, private storage: EcoStorage = browserStorage()) {
    this.baseUrl = normalizeUrl(baseUrl);
    this.token = token;
  }

  static fromStorage(storage: EcoStorage = browserStorage()): EcosystemClient {
    return new EcosystemClient(storage.get(URL_KEY) ?? "", storage.get(TOKEN_KEY), storage);
  }

  get url(): string {
    return this.baseUrl;
  }

  get authed(): boolean {
    return Boolean(this.token);
  }

  get account(): string | null {
    return this.token;
  }

  setUrl(url: string): void {
    this.baseUrl = normalizeUrl(url);
    this.storage.set(URL_KEY, this.baseUrl);
  }

  setToken(token: string | null): void {
    this.token = token;
    if (token) this.storage.set(TOKEN_KEY, token);
    else this.storage.remove(TOKEN_KEY);
  }

  /* ------------------------------------------------------------------ *
   * Транспорт
   * ------------------------------------------------------------------ */

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", ...(extra ?? {}) };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.raw(path, init);
    const text = await res.text();
    let data: any = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      const message = data?.error?.message ?? `HTTP ${res.status}`;
      throw new EcosystemError(message, data?.error?.code ?? "HTTP_ERROR", res.status);
    }
    return data as T;
  }

  async raw(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    if (!this.baseUrl) throw new EcosystemError("Адрес экосистемы не задан", "NO_URL");
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: this.headers(),
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      });
    } catch (e) {
      throw new EcosystemError(
        `Экосистема недоступна: ${e instanceof Error ? e.message : String(e)}`,
        "NETWORK"
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Infinity ID
   * ------------------------------------------------------------------ */

  async register(email: string, password: string, displayName?: string): Promise<EcoUser> {
    const res = await this.request<{ user: EcoUser; token: string }>("/api/v1/auth/register", {
      method: "POST",
      body: { email, password, displayName }
    });
    this.setToken(res.token);
    return res.user;
  }

  async login(email: string, password: string): Promise<EcoUser> {
    const res = await this.request<{ user: EcoUser; token: string }>("/api/v1/auth/login", {
      method: "POST",
      body: { email, password }
    });
    this.setToken(res.token);
    return res.user;
  }

  async me(): Promise<EcoUser> {
    return this.request<EcoUser>("/api/v1/me");
  }

  async health(): Promise<{ ok: boolean; service: string }> {
    return this.request<{ ok: boolean; service: string }>("/api/v1/health");
  }

  /* ------------------------------------------------------------------ *
   * AI Runtime
   * ------------------------------------------------------------------ */

  async providers(): Promise<EcoProvider[]> {
    return this.request<EcoProvider[]>("/api/v1/providers");
  }

  async models(): Promise<EcoModel[]> {
    return this.request<EcoModel[]>("/api/v1/models");
  }

  async addProvider(input: {
    name: string;
    kind: string;
    baseUrl: string;
    scope: EcoScope;
    apiKey?: string;
    isDefault?: boolean;
  }): Promise<EcoProvider> {
    return this.request<EcoProvider>("/api/v1/providers", { method: "POST", body: input });
  }

  async testProvider(id: string): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    return this.request(`/api/v1/providers/${id}/test`, { method: "POST" });
  }

  async deleteProvider(id: string): Promise<void> {
    await this.request(`/api/v1/providers/${id}`, { method: "DELETE" });
  }

  /**
   * Потоковая генерация через AI Runtime.
   * Локальный режим блокируется маршрутизатором сервера: облачный провайдер
   * в режиме `local` недостижим, запрос не дойдёт до облака.
   */
  async completion(opts: CompletionOptions): Promise<{ text: string; reason: string }> {
    const res = await this.raw("/api/v1/ai/completions", {
      method: "POST",
      body: {
        modelId: opts.modelId,
        mode: opts.mode,
        messages: opts.messages,
        ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
        ...(opts.topP === undefined ? {} : { topP: opts.topP })
      }
    });
    if (!res.ok) {
      const text = await res.text();
      let message = `HTTP ${res.status}`;
      let code = "HTTP_ERROR";
      try {
        const parsed = JSON.parse(text);
        message = parsed?.error?.message ?? message;
        code = parsed?.error?.code ?? code;
      } catch {
        /* не JSON */
      }
      throw new EcosystemError(message, code, res.status);
    }
    return readSse(res, opts.onDelta);
  }

  /* ------------------------------------------------------------------ *
   * Tool Runtime
   * ------------------------------------------------------------------ */

  async tools(): Promise<EcoTool[]> {
    return this.request<EcoTool[]>("/api/v1/tools");
  }

  async toolGrants(): Promise<(EcoTool & { grant: EcoGrant })[]> {
    return this.request("/api/v1/tools/grants");
  }

  async setToolGrant(tool: string, scope: EcoGrantScope): Promise<void> {
    await this.request("/api/v1/tools/grants", { method: "POST", body: { tool, scope } });
  }

  /* ------------------------------------------------------------------ *
   * Data Services и Search
   * ------------------------------------------------------------------ */

  async search(query: string, scope = "all", limit = 20): Promise<{ hits: EcoSearchHit[]; total: number }> {
    const q = encodeURIComponent(query);
    const s = encodeURIComponent(scope);
    return this.request(`/api/v1/search?q=${q}&scope=${s}&limit=${limit}`);
  }

  async object(id: string): Promise<EcoObject> {
    return this.request<EcoObject>(`/api/v1/objects/${encodeURIComponent(id)}`);
  }

  async createObject(input: {
    app: string;
    kind: string;
    title: string;
    body?: string;
    tags?: string[];
    meta?: Record<string, unknown>;
  }): Promise<EcoObject> {
    return this.request<EcoObject>("/api/v1/objects", { method: "POST", body: input });
  }

  /* ------------------------------------------------------------------ *
   * Память и Sync
   * ------------------------------------------------------------------ */

  async memories(limit = 50): Promise<EcoMemory[]> {
    return this.request<EcoMemory[]>(`/api/v1/memory?limit=${limit}`);
  }

  async addMemory(content: string, source: EcoMemory["source"], importance = 0.6): Promise<EcoMemory> {
    return this.request<EcoMemory>("/api/v1/memory", { method: "POST", body: { content, source, importance } });
  }

  async removeMemory(id: string): Promise<void> {
    await this.request(`/api/v1/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async changes(since = 0): Promise<{ cursor: number; changes: EcoChange[] }> {
    return this.request(`/api/v1/sync/changes?since=${since}`);
  }

  /* ------------------------------------------------------------------ *
   * Серверные проекты InfinityCoder (Core API)
   * ------------------------------------------------------------------ */

  async coderProjects(): Promise<EcoCoderProject[]> {
    return this.request<EcoCoderProject[]>("/api/v1/coder/projects");
  }

  async createCoderProject(name: string): Promise<EcoCoderProject> {
    return this.request<EcoCoderProject>("/api/v1/coder/projects", { method: "POST", body: { name } });
  }

  async coderSessions(projectId: string): Promise<{ id: string; title: string }[]> {
    return this.request(`/api/v1/coder/projects/${projectId}/sessions`);
  }

  async createCoderSession(projectId: string, modelId?: string, mode?: EcoScope): Promise<{ id: string }> {
    return this.request(`/api/v1/coder/projects/${projectId}/sessions`, {
      method: "POST",
      body: { title: "Сессия", modelId, mode }
    });
  }

  /* ------------------------------------------------------------------ *
   * Диагностика
   * ------------------------------------------------------------------ */

  async diagnostics(): Promise<EcoDiagnostics> {
    return this.request<EcoDiagnostics>("/api/v1/diagnostics");
  }

  async coderDiagnostics(): Promise<{
    projects: number;
    runs: number;
    active: number;
    locks: number;
    tools: string[];
  }> {
    return this.request("/api/v1/coder/diagnostics");
  }
}

/* -------------------------------------------------------------------- *
 * Утилиты
 * -------------------------------------------------------------------- */

export function normalizeUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * Читает SSE-поток Core API: `event: delta` → onDelta,
 * `event: error` → исключение, `event: done` → конец.
 */
export async function readSse(
  res: Response,
  onDelta?: (text: string) => void
): Promise<{ text: string; reason: string }> {
  const reader = res.body?.getReader();
  if (!reader) throw new EcosystemError("Экосистема вернула пустой поток", "EMPTY_STREAM");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reason = "stop";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data: any;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      if (event === "delta") {
        const chunk = String(data?.text ?? "");
        text += chunk;
        onDelta?.(chunk);
      } else if (event === "done") {
        reason = String(data?.reason ?? "stop");
      } else if (event === "error") {
        throw new EcosystemError(String(data?.message ?? "Ошибка генерации"), String(data?.code ?? "UPSTREAM_ERROR"));
      }
    }
  }
  return { text, reason };
}

/** Человеческое название режима. */
export function scopeLabel(scope: EcoScope): string {
  return scope === "local" ? "локально" : "облако";
}
