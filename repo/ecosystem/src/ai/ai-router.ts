/**
 * AI Runtime: диалоги, сообщения, потоковая генерация.
 *
 * Ключевые сценарии (критерии приёмки Infinity AI):
 *  — диалог сохраняется и переживает перезапуск;
 *  — повторный запрос не создаёт дубликатов (идемпотентность по clientRequestId);
 *  — отмена прерывает генерацию;
 *  — выбор модели реально меняет провайдера;
 *  — локальный режим блокирует облако на уровне маршрутизатора.
 */

import type { RequestContext } from '../http/router.js';
import type { Core } from '../core.js';
import { newId } from '../ids.js';
import { NotFoundError, ValidationError, AppError } from '../errors.js';
import type { Scope } from '../services/ai-runtime.js';

interface ConversationRow {
  id: string;
  owner_id: string;
  title: string;
  model_id: string | null;
  mode: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model_id: string | null;
  provider_id: string | null;
  status: string;
  error_code: string | null;
  tool_calls: string;
  created_at: string;
}

/** Активные генерации — для отмены. */
const activeStreams = new Map<string, AbortController>();

function toConversation(row: ConversationRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    modelId: row.model_id,
    mode: row.mode as Scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    modelId: row.model_id,
    providerId: row.provider_id,
    status: row.status,
    errorCode: row.error_code,
    toolCalls: JSON.parse(row.tool_calls) as unknown[],
    createdAt: row.created_at,
  };
}

export function buildAiRouter(core: Core): void {
  const { router, db, ai, memory } = core;

  // ── Диалоги ────────────────────────────────────────────────────────────
  router.get('/api/v1/ai/conversations', (ctx) => {
    const user = requireUser(ctx);
    return db
      .all<ConversationRow>(
        'SELECT * FROM conversations WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100',
        user.id,
      )
      .map(toConversation);
  });

  router.post('/api/v1/ai/conversations', (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as { title?: string; modelId?: string; mode?: Scope };
    const mode: Scope = body.mode ?? core.config.defaultMode;
    const id = newId('cvs');
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO conversations (id, owner_id, title, model_id, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, user.id, body.title ?? 'Новый диалог', body.modelId ?? null, mode, now, now,
    );
    return toConversation(db.get<ConversationRow>('SELECT * FROM conversations WHERE id = ?', id)!);
  });

  router.get('/api/v1/ai/conversations/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = requireConversation(ctx, db, user.id);
    const messages = db
      .all<MessageRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id', row.id)
      .map(toMessage);
    return { ...toConversation(row), messages };
  });

  router.delete('/api/v1/ai/conversations/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = requireConversation(ctx, db, user.id);
    db.run('DELETE FROM conversations WHERE id = ? AND owner_id = ?', row.id, user.id);
    return { ok: true };
  });

  // ── Отправка сообщения (потоковый ответ через SSE) ─────────────────────
  router.post('/api/v1/ai/conversations/:id/messages', async (ctx) => {
    const user = requireUser(ctx);
    const conversation = requireConversation(ctx, db, user.id);
    const body = (ctx.body ?? {}) as {
      content?: string;
      modelId?: string;
      mode?: Scope;
      clientRequestId?: string;
      confirmed?: boolean;
    };

    const content = (body.content ?? '').trim();
    if (!content) throw new ValidationError('Текст сообщения не может быть пустым');

    const mode = resolveMode(body.mode ?? (conversation.mode as Scope));

    // Идемпотентность: повтор того же clientRequestId не создаёт дубликат.
    // Ответ отдаётся в том же SSE-формате, что и обычный поток, — клиенту
    // не нужно знать, был ли запрос новым или повторным.
    if (body.clientRequestId) {
      const existing = db.get<MessageRow>(
        'SELECT * FROM messages WHERE conversation_id = ? AND client_request_id = ?',
        conversation.id, body.clientRequestId,
      );
      if (existing) {
        const assistant = db.get<MessageRow>(
          `SELECT * FROM messages WHERE conversation_id = ? AND role = 'assistant'
             AND created_at >= ? AND id != ? ORDER BY created_at ASC LIMIT 1`,
          conversation.id, existing.created_at, existing.id,
        );
        const { res } = ctx;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        const send = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        send('start', {
          userMessageId: existing.id,
          assistantId: assistant?.id ?? null,
          mode,
          duplicate: true,
        });
        if (assistant?.content) {
          send('delta', { text: assistant.content });
        }
        send('done', { reason: 'duplicate' });
        res.end();
        return undefined;
      }
    }

    const modelId = body.modelId ?? conversation.model_id;
    if (!modelId) {
      throw new ValidationError('Не выбрана модель. Укажите modelId или настройте модель по умолчанию.');
    }
    const model = ai.getModel(modelId);
    if (!model) throw new NotFoundError('Модель не найдена');
    const provider = ai.getProvider(user.id, model.providerId);
    if (!provider) throw new NotFoundError('Провайдер модели не найден');

    // Проверка режима на маршрутизаторе — до начала генерации.
    if (mode === 'local' && provider.scope === 'cloud') {
      throw new AppError(403, 'LOCAL_MODE_BLOCKED', `Облачный провайдер «${provider.name}» недоступен в локальном режиме`, {
        provider: provider.name,
      });
    }

    const now = new Date().toISOString();
    const userMessageId = newId('msg');
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, model_id, provider_id, status, created_at, client_request_id)
       VALUES (?, ?, 'user', ?, ?, ?, 'complete', ?, ?)`,
      userMessageId, conversation.id, content, modelId, provider.id, now, body.clientRequestId ?? null,
    );

    const assistantId = newId('msg');
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, model_id, provider_id, status, created_at)
       VALUES (?, ?, 'assistant', '', ?, ?, 'streaming', ?)`,
      assistantId, conversation.id, modelId, provider.id, now,
    );

    db.run('UPDATE conversations SET updated_at = ?, model_id = ?, mode = ? WHERE id = ?',
      now, modelId, mode, conversation.id);

    // Контекст: история диалога + релевантная память.
    const history = db
      .all<MessageRow>(
        "SELECT * FROM messages WHERE conversation_id = ? AND role IN ('user','assistant') AND status = 'complete' ORDER BY created_at, id LIMIT 40",
        conversation.id,
      )
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const relevant = memory.retrieveContext(user.id, content, 3);
    const systemMessages = relevant.length
      ? [{
          role: 'system' as const,
          content:
            'Релевантные факты из памяти пользователя (источники указаны, используй только при релевантности):\n' +
            relevant.map((m) => `- ${m.content} [источник: ${m.source.title ?? m.source.type}]`).join('\n'),
        }]
      : [];

    const messages = [...systemMessages, ...history, { role: 'user' as const, content }];

    // ── SSE-стрим ───────────────────────────────────────────────────────
    const { res } = ctx;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const controller = new AbortController();
    activeStreams.set(assistantId, controller);
    // Отмена по закрытию соединения (пользователь ушёл со страницы).
    ctx.req.on('close', () => {
      if (!activeStreams.has(assistantId)) return;
      controller.abort();
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('start', { userMessageId, assistantId, modelId, providerId: provider.id, mode });

    let accumulated = '';
    try {
      for await (const chunk of ai.stream({
        ownerId: user.id,
        providerId: provider.id,
        modelId,
        mode,
        request: { model: model.remoteName, messages },
        signal: controller.signal,
      })) {
        if (chunk.type === 'delta') {
          accumulated += chunk.text;
          send('delta', { text: chunk.text });
        } else if (chunk.type === 'done') {
          send('done', { reason: chunk.reason });
        } else if (chunk.type === 'error') {
          send('error', { message: chunk.message, code: chunk.code });
        }
      }

      const status = accumulated ? 'complete' : 'cancelled';
      db.run(
        'UPDATE messages SET content = ?, status = ?, error_code = ? WHERE id = ?',
        accumulated, status, status === 'cancelled' ? 'CANCELLED' : null, assistantId,
      );
      if (accumulated) {
        send('saved', { assistantId, length: accumulated.length });
      }
    } catch (err) {
      const cancelled = err instanceof Error && err.name === 'AbortError';
      const code = cancelled ? 'CANCELLED' : err instanceof AppError ? err.code : 'UPSTREAM_ERROR';
      db.run(
        'UPDATE messages SET content = ?, status = ?, error_code = ? WHERE id = ?',
        accumulated, cancelled ? 'cancelled' : 'error', code, assistantId,
      );
      send('error', {
        message: cancelled ? 'Генерация отменена' : err instanceof Error ? err.message : String(err),
        code,
      });
    } finally {
      activeStreams.delete(assistantId);
      res.end();
    }

    return undefined;
  });

  // ── Stateless-комплишен ───────────────────────────────────────────────
  // Вызывающий сам приносит историю диалога. Используется клиентами, у
  // которых свой ReAct-цикл (например, InfinityCoder): маршрутизатор,
  // выбор модели, секреты и режим local/cloud остаются на сервере.
  router.post('/api/v1/ai/completions', async (ctx) => {
    const user = requireUser(ctx);
    const body = (ctx.body ?? {}) as {
      modelId?: string;
      mode?: Scope;
      messages?: { role?: string; content?: string; name?: string }[];
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stop?: string[];
    };

    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages = raw
      .filter((m) => m && typeof m.content === 'string' && m.content.length > 0)
      .map((m) => ({
        role: normalizeRole(m.role),
        content: m.content as string,
        ...(m.name ? { name: m.name } : {}),
      }));
    if (!messages.length) throw new ValidationError('Поле messages обязательно и не может быть пустым');

    const mode = resolveMode(body.mode ?? core.config.defaultMode);
    const modelId = body.modelId ?? core.ai.resolveDefaultModel(user.id, mode)?.id;
    if (!modelId) {
      throw new ValidationError('Не выбрана модель. Укажите modelId или настройте модель по умолчанию.');
    }
    const model = core.ai.getModel(modelId);
    if (!model) throw new NotFoundError('Модель не найдена');
    const provider = core.ai.getProvider(user.id, model.providerId);
    if (!provider) throw new NotFoundError('Провайдер модели не найден');

    // Локальный режим блокируется маршрутизатором, а не клиентом.
    if (mode === 'local' && provider.scope === 'cloud') {
      throw new AppError(403, 'LOCAL_MODE_BLOCKED', `Облачный провайдер «${provider.name}» недоступен в локальном режиме`, {
        provider: provider.name,
      });
    }

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
    send('start', { modelId, providerId: provider.id, mode });

    const streamId = newId('msg');
    const controller = new AbortController();
    activeStreams.set(streamId, controller);
    ctx.req.on('close', () => {
      if (activeStreams.has(streamId)) controller.abort();
    });

    let accumulated = '';
    try {
      for await (const chunk of ai.stream({
        ownerId: user.id,
        providerId: provider.id,
        modelId,
        mode,
        request: {
          model: model.remoteName,
          messages,
          ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
          ...(body.maxTokens === undefined ? {} : { maxTokens: body.maxTokens }),
          ...(body.topP === undefined ? {} : { topP: body.topP }),
          ...(body.stop === undefined ? {} : { stop: body.stop }),
        },
        signal: controller.signal,
      })) {
        if (chunk.type === 'delta') {
          accumulated += chunk.text;
          send('delta', { text: chunk.text });
        } else if (chunk.type === 'done') {
          send('done', { reason: chunk.reason, length: accumulated.length });
        } else if (chunk.type === 'error') {
          send('error', { message: chunk.message, code: chunk.code });
        }
      }
    } catch (err) {
      const cancelled = err instanceof Error && err.name === 'AbortError';
      const code = cancelled ? 'CANCELLED' : err instanceof AppError ? err.code : 'UPSTREAM_ERROR';
      send('error', {
        message: cancelled ? 'Генерация отменена' : err instanceof Error ? err.message : String(err),
        code,
      });
    } finally {
      activeStreams.delete(streamId);
      res.end();
    }
    return undefined;
  });

  // ── Отмена генерации ──────────────────────────────────────────────────
  router.post('/api/v1/ai/messages/:id/cancel', (ctx) => {
    const user = requireUser(ctx);
    const messageId = ctx.params['id']!;
    const row = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId);
    if (!row || row.conversation_id === undefined) throw new NotFoundError('Сообщение не найдено');
    requireConversation(ctx, db, user.id, row.conversation_id);

    const controller = activeStreams.get(messageId);
    if (!controller) {
      // Генерация уже завершена — сообщаем честно, а не имитируем отмену.
      const current = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId)!;
      return { cancelled: false, reason: 'Генерация не активна', status: current.status };
    }
    controller.abort();
    return { cancelled: true, reason: 'Сигнал отмены отправлен' };
  });

  // ── Повтор ответа ─────────────────────────────────────────────────────
  router.post('/api/v1/ai/messages/:id/retry', async (ctx) => {
    const user = requireUser(ctx);
    const messageId = ctx.params['id']!;
    const row = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId);
    if (!row) throw new NotFoundError('Сообщение не найдено');
    const conversation = requireConversation(ctx, db, user.id, row.conversation_id);

    // Убираем прежний ответ ассистента и просим заново.
    db.run('DELETE FROM messages WHERE id = ?', messageId);
    const body = (ctx.body ?? {}) as { content?: string; modelId?: string; mode?: Scope };
    const lastUser = db.get<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1",
      conversation.id,
    );
    const content = body.content ?? lastUser?.content;
    if (!content) throw new ValidationError('Нет сообщения для повтора');

    const modelId = body.modelId ?? conversation.model_id;
    if (!modelId) throw new ValidationError('Не выбрана модель');
    const model = ai.getModel(modelId);
    if (!model) throw new NotFoundError('Модель не найдена');
    const provider = ai.getProvider(user.id, model.providerId);
    if (!provider) throw new NotFoundError('Провайдер не найден');
    const mode = resolveMode(body.mode ?? (conversation.mode as Scope));
    if (mode === 'local' && provider.scope === 'cloud') {
      throw new AppError(403, 'LOCAL_MODE_BLOCKED', `Облачный провайдер «${provider.name}» недоступен в локальном режиме`);
    }

    const assistantId = newId('msg');
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, model_id, provider_id, status, created_at)
       VALUES (?, ?, 'assistant', '', ?, ?, 'streaming', ?)`,
      assistantId, conversation.id, modelId, provider.id, now,
    );

    const history = db
      .all<MessageRow>(
        "SELECT * FROM messages WHERE conversation_id = ? AND role IN ('user','assistant') AND status = 'complete' ORDER BY created_at, id LIMIT 40",
        conversation.id,
      )
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const { res } = ctx;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('start', { assistantId, modelId, providerId: provider.id, mode });

    const controller = new AbortController();
    activeStreams.set(assistantId, controller);
    let accumulated = '';
    try {
      for await (const chunk of ai.stream({
        ownerId: user.id,
        providerId: provider.id,
        modelId,
        mode,
        request: { model: model.remoteName, messages: [...history, { role: 'user', content }] },
        signal: controller.signal,
      })) {
        if (chunk.type === 'delta') {
          accumulated += chunk.text;
          send('delta', { text: chunk.text });
        } else if (chunk.type === 'done') {
          send('done', { reason: chunk.reason });
        }
      }
      db.run('UPDATE messages SET content = ?, status = ? WHERE id = ?', accumulated, accumulated ? 'complete' : 'cancelled', assistantId);
    } catch (err) {
      const cancelled = err instanceof Error && err.name === 'AbortError';
      db.run('UPDATE messages SET content = ?, status = ?, error_code = ? WHERE id = ?',
        accumulated, cancelled ? 'cancelled' : 'error', cancelled ? 'CANCELLED' : 'STREAM_ERROR', assistantId);
      send('error', { message: cancelled ? 'Генерация отменена' : String(err) });
    } finally {
      activeStreams.delete(assistantId);
      res.end();
    }
    return undefined;
  });

  // ── Редактирование сообщения ──────────────────────────────────────────
  router.patch('/api/v1/ai/messages/:id', (ctx) => {
    const user = requireUser(ctx);
    const messageId = ctx.params['id']!;
    const row = db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId);
    if (!row) throw new NotFoundError('Сообщение не найдено');
    requireConversation(ctx, db, user.id, row.conversation_id);
    const body = (ctx.body ?? {}) as { content?: string };
    if (body.content === undefined) throw new ValidationError('content обязателен');
    if (row.role !== 'user') throw new ValidationError('Редактировать можно только сообщения пользователя');
    db.run('UPDATE messages SET content = ? WHERE id = ?', body.content, messageId);
    return toMessage(db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId)!);
  });

  // ── Экспорт данных ────────────────────────────────────────────────────
  router.get('/api/v1/ai/export', (ctx) => {
    const user = requireUser(ctx);
    const conversations = db
      .all<ConversationRow>('SELECT * FROM conversations WHERE owner_id = ? ORDER BY created_at', user.id)
      .map(toConversation);
    const messages = db
      .all<MessageRow>(
        `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.owner_id = ? ORDER BY m.created_at`,
        user.id,
      )
      .map(toMessage);
    return { exportedAt: new Date().toISOString(), conversations, messages };
  });
}

/** Приводит роль к допустимому виду. `tool` отдаётся как `user`: строгие
 *  OpenAI-совместимые серверы требуют `tool_call_id`, которого у клиента нет. */
function normalizeRole(role: string | undefined): 'system' | 'user' | 'assistant' {
  if (role === 'assistant') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

function requireUser(ctx: RequestContext): { id: string; email: string; displayName: string } {
  if (!ctx.user) throw new AppError(401, 'UNAUTHORIZED', 'Требуется авторизация');
  return ctx.user;
}

/** Приводит режим к допустимому виду; неизвестное значение — ошибка, а не молчаливый local. */
function resolveMode(value: string): Scope {
  if (value === 'local' || value === 'cloud') return value;
  throw new ValidationError(`Неизвестный режим «${value}». Допустимо: local, cloud`);
}

function requireConversation(ctx: RequestContext, db: Core['db'], ownerId: string, forcedId?: string): ConversationRow {
  const id = forcedId ?? ctx.params['id']!;
  const row = db.get<ConversationRow>('SELECT * FROM conversations WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!row) throw new NotFoundError('Диалог не найден');
  return row;
}
