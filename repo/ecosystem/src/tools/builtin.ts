/**
 * Встроенные инструменты Tool Runtime.
 *
 * Инструменты читают и пишут ТОЛЬКО через Data Service — это даёт
 * проверку прав и попадание в общий индекс поиска. Содержимое файлов
 * и страниц трактуется как данные, а не как инструкции для модели.
 */

import type { Core } from '../core.js';
import { newId } from '../ids.js';
import type { ToolDefinition } from '../services/tool-runtime.js';

export function registerBuiltinTools(core: Core): void {
  const { tools, data, search } = core;

  const searchObjects: ToolDefinition = {
    name: 'search_objects',
    description: 'Полнотекстовый поиск по объектам пользователя (Drive, Notes, задачи).',
    risk: 'read',
    args: { query: 'string', scope: 'string?' },
    async execute(ctx) {
      const query = String(ctx.args['query'] ?? '');
      const scope = (ctx.args['scope'] ?? 'all') as never;
      const result = search.search(ctx.ownerId, query, { scope, limit: 10 });
      return { ok: true, output: result };
    },
  };

  const readObject: ToolDefinition = {
    name: 'read_object',
    description: 'Читает объект пользователя по его Infinity ID.',
    risk: 'read',
    args: { id: 'string' },
    async execute(ctx) {
      const id = String(ctx.args['id'] ?? '');
      const obj = data.get(ctx.ownerId, id);
      if (!obj) return { ok: false, output: null, error: 'Объект не найден' };
      return { ok: true, output: obj };
    },
  };

  const createNote: ToolDefinition = {
    name: 'create_note',
    description: 'Создаёт заметку в Notes. Изменяющее действие — требует подтверждения.',
    risk: 'write',
    args: { title: 'string', body: 'string?' },
    async execute(ctx) {
      const obj = data.create(ctx.ownerId, {
        app: 'notes',
        kind: 'note',
        title: String(ctx.args['title'] ?? 'Без названия'),
        body: String(ctx.args['body'] ?? ''),
      });
      return { ok: true, output: { id: obj.id, title: obj.title } };
    },
  };

  const createTask: ToolDefinition = {
    name: 'create_task',
    description: 'Создаёт задачу в Plan. Изменяющее действие — требует подтверждения.',
    risk: 'write',
    args: { title: 'string', dueAt: 'string?' },
    async execute(ctx) {
      const now = new Date().toISOString();
      const id = newId('tsk');
      core.db.run(
        `INSERT INTO tasks (id, owner_id, title, status, priority, due_at, timezone, created_at, updated_at)
         VALUES (?, ?, ?, 'open', 3, ?, 'UTC', ?, ?)`,
        id, ctx.ownerId, String(ctx.args['title'] ?? ''),
        ctx.args['dueAt'] ? String(ctx.args['dueAt']) : null, now, now,
      );
      return { ok: true, output: { id, title: ctx.args['title'] } };
    },
  };

  for (const tool of [searchObjects, readObject, createNote, createTask]) {
    tools.register(tool);
  }
}
