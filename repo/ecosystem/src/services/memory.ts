/**
 * Память AI с источниками. Каждый факт привязан к источнику, чтобы
 * ассистент мог показать, откуда взялась информация.
 */

import type { Db } from '../db/db.js';
import { newId } from '../ids.js';
import { NotFoundError, ValidationError } from '../errors.js';

export interface MemorySource {
  type: 'conversation' | 'note' | 'file' | 'user' | 'task';
  objectId?: string;
  title?: string;
  snippet?: string;
}

export interface MemoryRecord {
  id: string;
  ownerId: string;
  content: string;
  source: MemorySource;
  importance: number;
  createdAt: string;
  updatedAt: string;
}

interface MemoryRow {
  id: string;
  owner_id: string;
  content: string;
  source: string;
  importance: number;
  created_at: string;
  updated_at: string;
}

function toMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    content: row.content,
    source: JSON.parse(row.source) as MemorySource,
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MemoryService {
  private readonly db: Db;

  constructor(options: { db: Db }) {
    this.db = options.db;
  }

  add(ownerId: string, input: { content: string; source: MemorySource; importance?: number }): MemoryRecord {
    const content = input.content.trim();
    if (!content) throw new ValidationError('Содержимое памяти не может быть пустым');
    if (!input.source?.type) throw new ValidationError('Источник памяти обязателен');
    const now = new Date().toISOString();
    const id = newId('mem');
    this.db.run(
      `INSERT INTO memories (id, owner_id, content, source, importance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, ownerId, content, JSON.stringify(input.source),
      Math.min(Math.max(input.importance ?? 0.5, 0), 1), now, now,
    );
    return this.get(ownerId, id)!;
  }

  get(ownerId: string, id: string): MemoryRecord | null {
    const row = this.db.get<MemoryRow>('SELECT * FROM memories WHERE id = ? AND owner_id = ?', id, ownerId);
    return row ? toMemory(row) : null;
  }

  list(ownerId: string, limit = 50): MemoryRecord[] {
    return this.db
      .all<MemoryRow>(
        'SELECT * FROM memories WHERE owner_id = ? ORDER BY importance DESC, updated_at DESC LIMIT ?',
        ownerId, Math.min(Math.max(limit, 1), 200),
      )
      .map(toMemory);
  }

  remove(ownerId: string, id: string): void {
    const res = this.db.run('DELETE FROM memories WHERE id = ? AND owner_id = ?', id, ownerId);
    if (res.changes === 0) throw new NotFoundError('Запись памяти не найдена');
  }

  /**
   * Извлечение релевантного контекста.
   * Без эмбеддинг-адаптера используется лексический подбор (tf-idf-подобный).
   * Слой абстракции позволяет подключить реальный embedding adapter позже,
   * не меняя контракт.
   */
  retrieveContext(ownerId: string, query: string, limit = 5): MemoryRecord[] {
    const all = this.list(ownerId, 200);
    if (all.length === 0) return [];
    const terms = tokenize(query);
    if (terms.size === 0) return all.slice(0, limit);

    const scored = all.map((mem) => {
      const tokens = tokenize(mem.content);
      let overlap = 0;
      for (const term of terms) {
        if (tokens.has(term)) overlap += 1;
      }
      return { mem, score: overlap / terms.size + mem.importance * 0.1 };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.mem);
  }
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter((t) => t.length > 1),
  );
}
