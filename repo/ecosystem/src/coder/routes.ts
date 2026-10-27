/**
 * API InfinityCoder — часть общего контракта /api/v1.
 *
 * Один и тот же контракт используют Windows, Android и Web: права проверяются
 * на сервере по владельцу (Infinity ID) на каждом запросе, внутренние пути
 * клиенту не отдаются.
 */

import type { RequestContext } from '../http/router.js';
import type { Core } from '../core.js';
import { AppError, NotFoundError, ValidationError } from '../errors.js';
import type { CoderAgent, CoderAgentEvent } from './agent.js';
import type { CoderService } from './service.js';

export interface CoderRoutesOptions {
  core: Core;
  service: CoderService;
  agent: CoderAgent;
}

function requireUser(ctx: RequestContext): { id: string; email: string; displayName: string } {
  if (!ctx.user) throw new AppError(401, 'UNAUTHORIZED', 'Требуется авторизация');
  return ctx.user;
}

export function registerCoderRoutes(options: CoderRoutesOptions): void {
  const { core, service, agent } = options;
  const { router } = core;

  // ── Проекты ─────────────────────────────────────────────────────────────

  router.get('/api/v1/coder/projects', (ctx) => {
    const user = requireUser(ctx);
    return service.listProjects(user.id);
  });

  router.post('/api/v1/coder/projects', async (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as {
      name?: string;
      description?: string;
      rootPath?: string;
      settings?: Record<string, unknown>;
    };
    const project = await service.createProject(user.id, {
      name: body.name ?? '',
      description: body.description,
      rootPath: body.rootPath,
      settings: body.settings as never,
    });
    return project;
  });

  router.get('/api/v1/coder/projects/:id', (ctx) => {
    const user = requireUser(ctx);
    return service.requireProject(user.id, ctx.params['id']!);
  });

  router.patch('/api/v1/coder/projects/:id', async (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as {
      name?: string;
      description?: string;
      settings?: Record<string, unknown>;
    };
    return service.updateProject(user.id, ctx.params['id']!, {
      name: body.name,
      description: body.description,
      settings: body.settings as never,
    });
  });

  router.delete('/api/v1/coder/projects/:id', (ctx) => {
    const user = requireUser(ctx);
    service.deleteProject(user.id, ctx.params['id']!);
    return { ok: true };
  });

  // ── Файлы ───────────────────────────────────────────────────────────────

  router.get('/api/v1/coder/projects/:id/tree', async (ctx) => {
    const user = requireUser(ctx);
    const path = ctx.query.get('path') ?? '';
    return service.tree(user.id, ctx.params['id']!, path);
  });

  router.get('/api/v1/coder/projects/:id/file', async (ctx) => {
    const user = requireUser(ctx);
    const path = ctx.query.get('path');
    if (!path) throw new ValidationError('Параметр path обязателен');
    return service.readFile(user.id, ctx.params['id']!, path);
  });

  router.put('/api/v1/coder/projects/:id/file', async (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { path?: string; content?: string };
    if (!body.path) throw new ValidationError('Поле path обязательно');
    if (typeof body.content !== 'string') throw new ValidationError('Поле content обязательно');
    return service.writeFile(user.id, ctx.params['id']!, body.path, body.content, 'user');
  });

  router.delete('/api/v1/coder/projects/:id/file', async (ctx) => {
    const user = requireUser(ctx);
    const path = ctx.query.get('path');
    if (!path) throw new ValidationError('Параметр path обязателен');
    await service.removeFile(user.id, ctx.params['id']!, path);
    return { ok: true };
  });

  router.get('/api/v1/coder/projects/:id/file/versions', (ctx) => {
    const user = requireUser(ctx);
    const path = ctx.query.get('path');
    if (!path) throw new ValidationError('Параметр path обязателен');
    return service.listVersions(user.id, ctx.params['id']!, path);
  });

  router.get('/api/v1/coder/projects/:id/search', async (ctx) => {
    const user = requireUser(ctx);
    const query = ctx.query.get('q') ?? '';
    if (!query.trim()) throw new ValidationError('Параметр q обязателен');
    return service.search(user.id, ctx.params['id']!, query, {
      limit: Number(ctx.query.get('limit') ?? 100),
      caseSensitive: ctx.query.get('caseSensitive') === 'true',
    });
  });

  router.post('/api/v1/coder/projects/:id/diff', async (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { path?: string; before?: string };
    if (!body.path) throw new ValidationError('Поле path обязательно');
    return service.diff(user.id, ctx.params['id']!, body.path, body.before);
  });

  // ── Память проекта ──────────────────────────────────────────────────────

  router.get('/api/v1/coder/projects/:id/memory', (ctx) => {
    const user = requireUser(ctx);
    return service.listProjectMemory(user.id, ctx.params['id']!);
  });

  router.post('/api/v1/coder/projects/:id/memory', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { content?: string; importance?: number };
    if (!body.content?.trim()) throw new ValidationError('Поле content обязательно');
    return service.addProjectMemory(user.id, ctx.params['id']!, body.content, body.importance);
  });

  router.delete('/api/v1/coder/projects/:id/memory/:memoryId', (ctx) => {
    const user = requireUser(ctx);
    service.removeProjectMemory(user.id, ctx.params['id']!, ctx.params['memoryId']!);
    return { ok: true };
  });

  // ── Сессии ──────────────────────────────────────────────────────────────

  router.get('/api/v1/coder/projects/:id/sessions', (ctx) => {
    const user = requireUser(ctx);
    return service.listSessions(user.id, ctx.params['id']!);
  });

  router.post('/api/v1/coder/projects/:id/sessions', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { title?: string; modelId?: string; mode?: 'local' | 'cloud' };
    return service.createSession(user.id, ctx.params['id']!, body);
  });

  router.get('/api/v1/coder/sessions/:id', (ctx) => {
    const user = requireUser(ctx);
    const session = service.requireSession(user.id, ctx.params['id']!);
    return { ...session, messages: service.listMessages(user.id, session.id) };
  });

  router.delete('/api/v1/coder/sessions/:id', (ctx) => {
    const user = requireUser(ctx);
    service.deleteSession(user.id, ctx.params['id']!);
    return { ok: true };
  });

  // ── Вкладки ─────────────────────────────────────────────────────────────

  router.get('/api/v1/coder/sessions/:id/tabs', (ctx) => {
    const user = requireUser(ctx);
    return service.listTabs(user.id, ctx.params['id']!);
  });

  router.post('/api/v1/coder/sessions/:id/tabs', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { path?: string; position?: number };
    if (!body.path) throw new ValidationError('Поле path обязательно');
    return service.openTab(user.id, ctx.params['id']!, body.path, body.position);
  });

  router.patch('/api/v1/coder/sessions/:id/tabs', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { path?: string; position?: number };
    if (!body.path) throw new ValidationError('Поле path обязательно');
    return service.openTab(user.id, ctx.params['id']!, body.path, body.position);
  });

  router.delete('/api/v1/coder/sessions/:id/tabs', (ctx) => {
    const user = requireUser(ctx);
    const path = ctx.query.get('path');
    if (!path) throw new ValidationError('Параметр path обязателен');
    service.closeTab(user.id, ctx.params['id']!, path);
    return { ok: true };
  });

  // ── Чат: сообщение + поток агента (SSE) ─────────────────────────────────

  router.post('/api/v1/coder/sessions/:id/messages', async (ctx) => {
    const user = requireUser(ctx);
    const session = service.requireSession(user.id, ctx.params['id']!);
    const body = (ctx.body ?? {}) as {
      content?: string;
      modelId?: string;
      mode?: 'local' | 'cloud';
      clientRequestId?: string;
    };

    const content = (body.content ?? '').trim();
    if (!content) throw new ValidationError('Текст сообщения не может быть пустым');
    const mode = resolveMode(body.mode ?? session.mode);

    // Идемпотентность: повтор запроса не создаёт второе сообщение.
    if (body.clientRequestId) {
      const existing = service.findMessageByClientRequest(session.id, body.clientRequestId);
      if (existing) {
        const messages = service.listMessages(user.id, session.id);
        return { duplicate: true, userMessageId: existing.id, messages };
      }
    }

    const modelId = body.modelId ?? session.modelId ?? core.ai.resolveDefaultModel(user.id, mode)?.id;
    if (!modelId) {
      throw new ValidationError('Не выбрана модель. Укажите modelId или настройте модель по умолчанию.');
    }
    const model = core.ai.getModel(modelId);
    if (!model) throw new NotFoundError('Модель не найдена');
    const provider = core.ai.getProvider(user.id, model.providerId);
    if (!provider) throw new NotFoundError('Провайдер модели не найден');
    // Локальный режим блокирует облако на маршрутизаторе, а не в UI.
    if (mode === 'local' && provider.scope === 'cloud') {
      throw new AppError(403, 'LOCAL_MODE_BLOCKED', `Облачный провайдер «${provider.name}» недоступен в локальном режиме`, {
        provider: provider.name,
      });
    }

    const userMessage = service.addMessage(user.id, session.id, {
      role: 'user',
      content,
      status: 'complete',
      clientRequestId: body.clientRequestId,
    });
    service.updateSession(user.id, session.id, { modelId, mode });

    const run = service.createRun(user.id, {
      sessionId: session.id,
      projectId: session.projectId,
      kind: 'chat',
      task: content,
      maxSteps: Number(ctx.query.get('maxSteps') ?? 12),
    });

    const { res } = ctx;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('start', {
      runId: run.id,
      sessionId: session.id,
      userMessageId: userMessage.id,
      modelId,
      providerId: provider.id,
      mode,
    });

    const controller = new AbortController();
    agent.attachController(run.id, controller);
    ctx.req.on('close', () => {
      if (!res.writableEnded) agent.cancel(run.id);
    });

    const emit = (event: CoderAgentEvent) => {
      send(event.type, event);
    };

    try {
      await agent.execute({
        runId: run.id,
        ownerId: user.id,
        sessionId: session.id,
        projectId: session.projectId,
        modelId,
        mode,
        kind: 'chat',
        task: content,
        emit,
        signal: controller.signal,
      });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AGENT_ERROR';
      const message = err instanceof Error ? err.message : String(err);
      service.updateRun(run.id, { status: 'failed', error: message });
      send('error', { code, message });
    } finally {
      res.end();
    }
    return undefined;
  });

  router.post('/api/v1/coder/sessions/:id/cancel', (ctx) => {
    const user = requireUser(ctx);
    const session = service.requireSession(user.id, ctx.params['id']!);
    const cancelled = agent.cancelBySession(user.id, session.id);
    return { cancelled: cancelled.length, runIds: cancelled };
  });

  // ── Автономный запуск (план → действие → проверка → исправление) ───────

  router.post('/api/v1/coder/projects/:id/runs', async (ctx) => {
    const user = requireUser(ctx);
    const project = service.requireProject(user.id, ctx.params['id']!);
    const body = (ctx.body ?? {}) as {
      task?: string;
      sessionId?: string;
      modelId?: string;
      mode?: 'local' | 'cloud';
      maxSteps?: number;
      verify?: boolean;
    };
    const task = (body.task ?? '').trim();
    if (!task) throw new ValidationError('Поле task обязательно');
    const mode = resolveMode(body.mode ?? 'cloud');

    const session = body.sessionId
      ? service.requireSession(user.id, body.sessionId)
      : service.createSession(user.id, project.id, { title: task.slice(0, 60), mode });

    const modelId = body.modelId ?? session.modelId ?? core.ai.resolveDefaultModel(user.id, mode)?.id;
    if (!modelId) throw new ValidationError('Не выбрана модель для автономного запуска');
    const model = core.ai.getModel(modelId);
    if (!model) throw new NotFoundError('Модель не найдена');
    const provider = core.ai.getProvider(user.id, model.providerId);
    if (!provider) throw new NotFoundError('Провайдер модели не найден');
    if (mode === 'local' && provider.scope === 'cloud') {
      throw new AppError(403, 'LOCAL_MODE_BLOCKED', `Облачный провайдер «${provider.name}» недоступен в локальном режиме`, {
        provider: provider.name,
      });
    }

    const run = service.createRun(user.id, {
      sessionId: session.id,
      projectId: project.id,
      kind: 'autonomous',
      task,
      maxSteps: body.maxSteps ?? 12,
    });

    const controller = new AbortController();
    agent.attachController(run.id, controller);

    // Запуск идёт в фоне: клиент следит за прогрессом по /runs/:id.
    void agent
      .execute({
        runId: run.id,
        ownerId: user.id,
        sessionId: session.id,
        projectId: project.id,
        modelId,
        mode,
        kind: 'autonomous',
        task,
        maxSteps: body.maxSteps ?? 12,
        verify: body.verify === true,
        emit: () => {
          /* прогресс пишется в шаги запуска */
        },
        signal: controller.signal,
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        service.updateRun(run.id, { status: 'failed', error: message });
      });

    return { run, sessionId: session.id };
  });

  router.get('/api/v1/coder/projects/:id/runs', (ctx) => {
    const user = requireUser(ctx);
    service.requireProject(user.id, ctx.params['id']!);
    return service.listRuns(user.id, {
      projectId: ctx.params['id']!,
      limit: Number(ctx.query.get('limit') ?? 50),
    });
  });

  router.get('/api/v1/coder/runs/:id', (ctx) => {
    const user = requireUser(ctx);
    const run = service.getRun(ctx.params['id']!);
    if (!run || run.ownerId !== user.id) throw new NotFoundError('Запуск не найден');
    return { ...run, steps: service.listSteps(run.id) };
  });

  router.post('/api/v1/coder/runs/:id/cancel', (ctx) => {
    const user = requireUser(ctx);
    const run = service.getRun(ctx.params['id']!);
    if (!run || run.ownerId !== user.id) throw new NotFoundError('Запуск не найден');
    const cancelled = agent.cancel(run.id);
    if (cancelled) service.updateRun(run.id, { status: 'cancelled' });
    return { cancelled, runId: run.id };
  });

  router.post('/api/v1/coder/runs/:id/confirm', (ctx) => {
    const user = requireUser(ctx);
    const run = service.getRun(ctx.params['id']!);
    if (!run || run.ownerId !== user.id) throw new NotFoundError('Запуск не найден');
    const body = (ctx.body ?? {}) as { approved?: boolean };
    const approved = body.approved === true;
    const applied = agent.confirm(run.id, approved);
    if (!applied) {
      return { applied: false, reason: 'Инструмент не ожидает подтверждения' };
    }
    return { applied: true, approved };
  });

  // ── Диагностика ─────────────────────────────────────────────────────────

  router.get('/api/v1/coder/diagnostics', (ctx) => {
    const user = requireUser(ctx);
    const projects = service.listProjects(user.id);
    const runs = service.listRuns(user.id, { limit: 200 });
    return {
      projects: projects.length,
      sessions: service.listRuns(user.id, { limit: 200 }).length ? runs.length : 0,
      runs: runs.length,
      active: runs.filter((r) => r.status === 'running' || r.status === 'awaiting_confirmation').length,
      locks: projects.reduce((sum, project) => sum + service.listLocks(project.id).length, 0),
      tools: core.tools.list().filter((t) => t.name.startsWith('coder_')).map((t) => t.name),
    };
  });
}

/** Режим local/cloud: неизвестное значение — ошибка, а не молчаливый local. */
function resolveMode(value: string): 'local' | 'cloud' {
  if (value === 'local' || value === 'cloud') return value;
  throw new ValidationError(`Неизвестный режим «${value}». Допустимо: local, cloud`);
}
