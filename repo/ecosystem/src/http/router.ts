/**
 * Минимальное HTTP-ядро на node:http: роутер, парсинг тела, ошибки.
 * Один слой для всех приложений экосистемы — контракт API общий.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppError, ValidationError } from '../errors.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string | undefined>;
  /** Заполняется middleware аутентификации. */
  user?: { id: string; email: string; displayName: string };
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

interface Route {
  method: Method;
  pattern: string;
  segments: string[];
  handler: Handler;
  /** Публичный маршрут — не требует аутентификации. */
  isPublic: boolean;
}

export interface RouterOptions {
  /** Middleware, выполняемый до обработчика. Может бросить Unauthorized. */
  authenticate?: (ctx: RequestContext) => void | Promise<void>;
  /**
   * CORS: список разрешённых источников. `*` — любой источник (без cookie,
   * токен живёт в заголовке Authorization, поэтому это не даёт доступа к
   * чужой сессии). Пустой массив — CORS выключен.
   */
  cors?: string[];
}

export class Router {
  private readonly routes: Route[] = [];
  private readonly options: RouterOptions;

  constructor(options: RouterOptions = {}) {
    this.options = options;
  }

  add(method: Method, pattern: string, handler: Handler, isPublic = false): this {
    this.routes.push({
      method,
      pattern,
      segments: pattern.split('/').filter(Boolean),
      handler,
      isPublic,
    });
    return this;
  }

  /** Регистрирует маршрут без обязательной аутентификации. */
  public(method: Method, pattern: string, handler: Handler): this {
    return this.add(method, pattern, handler, true);
  }

  get(p: string, h: Handler) { return this.add('GET', p, h); }
  post(p: string, h: Handler) { return this.add('POST', p, h); }
  patch(p: string, h: Handler) { return this.add('PATCH', p, h); }
  put(p: string, h: Handler) { return this.add('PUT', p, h); }
  delete(p: string, h: Handler) { return this.add('DELETE', p, h); }

  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const seg = route.segments[i]!;
        const value = parts[i]!;
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(value);
        } else if (seg !== value) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const ctx: RequestContext = {
      req,
      res,
      params: {},
      query: url.searchParams,
      body: undefined,
      headers: req.headers as Record<string, string | undefined>,
    };

    try {
      this.applyCors(req, res);
      // Preflight-запрос браузера: отвечаем сразу, тело не читаем.
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }

      const matched = this.match(req.method ?? 'GET', url.pathname);
      if (!matched) {
        throw new AppError(404, 'ROUTE_NOT_FOUND', `Маршрут ${req.method} ${url.pathname} не найден`);
      }
      ctx.params = matched.params;

      if (req.method !== 'GET' && req.method !== 'DELETE') {
        ctx.body = await readJsonBody(req);
      }

      if (!matched.route.isPublic && this.options.authenticate) {
        await this.options.authenticate(ctx);
      }

      const result = await matched.route.handler(ctx);
      if (res.writableEnded) return; // handler сам отдал ответ (SSE)
      sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      sendError(res, err);
    }
  }
  /**
   * CORS-заголовки. Токен передаётся в Authorization, cookie не используются,
   * поэтому `Access-Control-Allow-Origin: *` не открывает доступ к чужой
   * сессии — запрос без корректного токена всё равно будет отклонён.
   */
  private applyCors(req: IncomingMessage, res: ServerResponse): void {
    const allowed = this.options.cors;
    if (!allowed || allowed.length === 0) return;
    const origin = req.headers.origin;
    if (!origin) return;
    const value = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : null;
    if (!value) return;
    res.setHeader('Access-Control-Allow-Origin', value);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, X-Requested-With, X-Client-Request-Id',
    );
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Внутренние детали не утекают наружу, но пишутся в лог сервера.
  console.error('[infinity] необработанная ошибка:', err);
  sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' } });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8 * 1024 * 1024) {
      throw new ValidationError('Тело запроса превышает 8 МБ');
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError('Тело запроса — некорректный JSON');
  }
}

export function createRouterServer(router: Router): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void router.handle(req, res);
  });
}

/** Извлекает Bearer-токен из заголовка Authorization. */
export function bearerToken(ctx: RequestContext): string | null {
  const header = ctx.headers['authorization'];
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1]!.trim() : null;
}
