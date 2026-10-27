/**
 * Core API — общий API экосистемы.
 * Один сервер, общий контракт для Windows / Android / Web.
 */

import { Router, bearerToken, type RequestContext } from './http/router.js';
import { Db } from './db/db.js';
import { AuthService } from './services/auth.js';
import { DataService } from './services/data.js';
import { SearchService } from './services/search.js';
import { AiRuntime, type Scope } from './services/ai-runtime.js';
import { MemoryService } from './services/memory.js';
import { ToolRuntime } from './services/tool-runtime.js';
import { SecretStore } from './services/crypto.js';
import { UnauthorizedError, ValidationError } from './errors.js';
import { buildAiRouter } from './ai/ai-router.js';
import { CoderService } from './coder/service.js';
import { CoderAgent } from './coder/agent.js';
import { registerCoderRoutes } from './coder/routes.js';
import { registerCoderTools } from './coder/tools.js';
import { dirname, join, resolve } from 'node:path';

export interface CoreConfig {
  dbFile: string;
  masterKey: string;
  /** Локальный режим по умолчанию для новых диалогов. */
  defaultMode: Scope;
  /** Базовый каталог рабочих проектов InfinityCoder. */
  coderWorkspace?: string;
  /**
   * CORS: разрешённые источники для веб-клиентов (InfinityCoder и др.).
   * По умолчанию `*` — токен передаётся в заголовке Authorization,
   * cookie не используются, поэтому чужая сессия не открывается.
   */
  corsOrigins?: string[];
}

export interface Core {
  db: Db;
  auth: AuthService;
  data: DataService;
  search: SearchService;
  ai: AiRuntime;
  memory: MemoryService;
  tools: ToolRuntime;
  router: Router;
  config: CoreConfig;
  coder: CoderService;
  coderAgent: CoderAgent;
}

export function createCore(config: CoreConfig): Core {
  const db = new Db({ file: config.dbFile });
  const secrets = new SecretStore(config.masterKey);
  const auth = new AuthService({ db });
  const data = new DataService({ db });
  const search = new SearchService({ db, data });
  const ai = new AiRuntime({ db, secrets });
  const memory = new MemoryService({ db });
  const tools = new ToolRuntime({ db });

  const workspaceBase = config.coderWorkspace
    ? resolve(config.coderWorkspace)
    : join(dirname(resolve(config.dbFile === ':memory:' ? './data/infinity.db' : config.dbFile)), 'coder-workspaces');

  const coder = new CoderService({ db, memory, workspaceBase });

  const router = new Router({
    cors: config.corsOrigins ?? ["*"],
    authenticate: (ctx) => {
      const token = bearerToken(ctx);
      if (!token) throw new UnauthorizedError();
      const user = auth.resolveToken(token);
      if (!user) throw new UnauthorizedError('Недействительный или отозванный токен');
      ctx.user = user;
    },
  });

  const core: Core = {
    db, auth, data, search, ai, memory, tools, router, config,
    coder,
    coderAgent: undefined as unknown as CoderAgent,
  };
  core.coderAgent = new CoderAgent(core, coder);

  registerCoreRoutes(core);
  buildAiRouter(core);
  registerCoderTools(core, coder);
  registerCoderRoutes({ core, service: coder, agent: core.coderAgent });
  return core;
}

function requireUser(ctx: RequestContext): { id: string; email: string; displayName: string } {
  if (!ctx.user) throw new UnauthorizedError();
  return ctx.user;
}

function registerCoreRoutes(core: Core): void {
  const { router, auth, data, search, ai, memory, tools } = core;

  // ── Публичные маршруты (регистрация/вход) ──────────────────────────────
  router.public('POST', '/api/v1/auth/register', (ctx) => {
    const body = (ctx.body ?? {}) as { email?: string; password?: string; displayName?: string };
    if (!body.email || !body.password) throw new ValidationError('email и password обязательны');
    const user = auth.register(body.email, body.password, body.displayName ?? '');
    const { key } = auth.createApiKey(user.id, 'bootstrap');
    return { user, token: key };
  });

  router.public('POST', '/api/v1/auth/login', (ctx) => {
    const body = (ctx.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) throw new ValidationError('email и password обязательны');
    const user = auth.login(body.email, body.password);
    const { key } = auth.createApiKey(user.id, 'session');
    return { user, token: key };
  });

  router.public('GET', '/api/v1/health', () => ({ ok: true, service: 'infinity-core' }));

  // ── Профиль и ключи ───────────────────────────────────────────────────
  router.get('/api/v1/me', (ctx) => requireUser(ctx));

  router.post('/api/v1/me/keys', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { label?: string; scopes?: string[] };
    return auth.createApiKey(user.id, body.label ?? 'api-key', body.scopes ?? []);
  });

  router.get('/api/v1/me/keys', (ctx) => {
    const user = requireUser(ctx);
    return core.db.all(
      `SELECT id, label, scopes, revoked_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
      user.id,
    );
  });

  router.delete('/api/v1/me/keys/:id', (ctx) => {
    const user = requireUser(ctx);
    auth.revokeApiKey(user.id, ctx.params['id']!);
    return { ok: true };
  });

  // ── Объекты (Data Services) ───────────────────────────────────────────
  router.get('/api/v1/objects', (ctx) => {
    const user = requireUser(ctx);
    return data.list(user.id, {
      app: ctx.query.get('app') ?? undefined,
      kind: ctx.query.get('kind') ?? undefined,
      limit: Number(ctx.query.get('limit') ?? 100),
      offset: Number(ctx.query.get('offset') ?? 0),
    });
  });

  router.post('/api/v1/objects', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    return data.create(user.id, body as never);
  });

  router.get('/api/v1/objects/:id', (ctx) => {
    const user = requireUser(ctx);
    return data.require(user.id, ctx.params['id']!);
  });

  router.patch('/api/v1/objects/:id', (ctx) => {
    const user = requireUser(ctx);
    return data.update(user.id, ctx.params['id']!, (ctx.body ?? {}) as never);
  });

  router.delete('/api/v1/objects/:id', (ctx) => {
    const user = requireUser(ctx);
    data.softDelete(user.id, ctx.params['id']!);
    return { ok: true };
  });

  router.get('/api/v1/objects/:id/versions', (ctx) => {
    const user = requireUser(ctx);
    return data.listVersions(user.id, ctx.params['id']!);
  });

  router.post('/api/v1/objects/:id/versions/:version/restore', (ctx) => {
    const user = requireUser(ctx);
    return data.restoreVersion(user.id, ctx.params['id']!, Number(ctx.params['version']));
  });

  // ── Search ─────────────────────────────────────────────────────────────
  router.get('/api/v1/search', (ctx) => {
    const user = requireUser(ctx);
    const q = ctx.query.get('q') ?? '';
    const scope = (ctx.query.get('scope') ?? 'all') as never;
    const result = search.search(user.id, q, {
      scope,
      limit: Number(ctx.query.get('limit') ?? 20),
      offset: Number(ctx.query.get('offset') ?? 0),
    });
    return result;
  });

  router.post('/api/v1/search/reindex', (ctx) => {
    const user = requireUser(ctx);
    return { reindexed: search.reindexAll(user.id) };
  });

  router.get('/api/v1/search/diagnostics', (ctx) => {
    const user = requireUser(ctx);
    return search.diagnostics(user.id);
  });

  // ── Провайдеры и модели ───────────────────────────────────────────────
  router.get('/api/v1/providers', (ctx) => {
    const user = requireUser(ctx);
    return ai.listProviders(user.id);
  });

  router.post('/api/v1/providers', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as never;
    return ai.addProvider(user.id, body);
  });

  router.patch('/api/v1/providers/:id', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { enabled?: boolean; isDefault?: boolean };
    if (body.isDefault) ai.setDefault(user.id, ctx.params['id']!);
    if (body.enabled !== undefined) {
      return ai.setProviderEnabled(user.id, ctx.params['id']!, body.enabled);
    }
    return ai.getProvider(user.id, ctx.params['id']!);
  });

  router.delete('/api/v1/providers/:id', (ctx) => {
    const user = requireUser(ctx);
    ai.deleteProvider(user.id, ctx.params['id']!);
    return { ok: true };
  });

  router.post('/api/v1/providers/:id/test', async (ctx) => {
    const user = requireUser(ctx);
    return ai.testProvider(user.id, ctx.params['id']!);
  });

  router.get('/api/v1/models', (ctx) => {
    const user = requireUser(ctx);
    return ai.listModels(user.id);
  });

  router.post('/api/v1/models', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { providerId: string; remoteName: string; displayName?: string; contextSize?: number };
    return ai.addModel(user.id, body.providerId, body);
  });

  router.delete('/api/v1/models/:id', (ctx) => {
    const user = requireUser(ctx);
    ai.deleteModel(user.id, ctx.params['id']!);
    return { ok: true };
  });

  router.get('/api/v1/diagnostics', (ctx) => {
    const user = requireUser(ctx);
    return { ai: ai.diagnostics(user.id), search: search.diagnostics(user.id) };
  });

  // ── Память ─────────────────────────────────────────────────────────────
  router.get('/api/v1/memory', (ctx) => {
    const user = requireUser(ctx);
    return memory.list(user.id);
  });

  router.post('/api/v1/memory', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { content: string; source: never; importance?: number };
    return memory.add(user.id, body);
  });

  router.delete('/api/v1/memory/:id', (ctx) => {
    const user = requireUser(ctx);
    memory.remove(user.id, ctx.params['id']!);
    return { ok: true };
  });

  // ── Инструменты ───────────────────────────────────────────────────────
  router.get('/api/v1/tools', () => tools.list());

  router.get('/api/v1/tools/grants', (ctx) => {
    const user = requireUser(ctx);
    return tools.list().map((t) => ({ ...t, grant: tools.getGrant(user.id, t.name) }));
  });

  router.post('/api/v1/tools/grants', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { tool: string; scope: 'ask' | 'allow' | 'deny'; expiresAt?: string };
    tools.setGrant(user.id, body.tool, body.scope, body.expiresAt ?? null);
    return { ok: true };
  });

  router.post('/api/v1/tools/:name/invoke', async (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { args?: Record<string, unknown>; confirmed?: boolean };
    return tools.execute(user.id, ctx.params['name']!, body.args ?? {}, body.confirmed ?? false);
  });

  // ── Sync ───────────────────────────────────────────────────────────────
  router.get('/api/v1/sync/changes', (ctx) => {
    const user = requireUser(ctx);
    const since = Number(ctx.query.get('since') ?? 0);
    return data.changesSince(user.id, Number.isFinite(since) ? since : 0);
  });
}
