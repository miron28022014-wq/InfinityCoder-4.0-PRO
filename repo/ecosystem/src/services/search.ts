/**
 * Search — общий поиск по Drive, Notes, истории чатов и памяти.
 *
 * Индекс FTS5 живёт рядом с данными, но доступ к результатам всегда
 * проходит через проверку владельца: индекс сам по себе не является
 * источником правды.
 */

import type { Db } from '../db/db.js';
import { DataService, type StoredObject } from './data.js';

export type SearchScope = 'all' | 'drive' | 'notes' | 'ai' | 'plan' | 'office' | 'memory';

export interface SearchHit {
  objectId: string;
  app: string;
  title: string;
  snippet: string;
  createdAt: string;
  updatedAt: string;
  score: number;
}

export interface SearchOptions {
  scope?: SearchScope;
  limit?: number;
  offset?: number;
  /** Ручной пересчёт индекса для конкретного объекта. */
}

interface IndexRow {
  object_id: string;
  owner_id: string;
  app: string;
  title: string;
  body: string;
}

export class SearchService {
  private readonly db: Db;
  private readonly data: DataService;
  /** Очередь фоновой индексации. */
  private pending = new Map<string, { ownerId: string; objectId: string }>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** Индексатор остановлен — новые элементы в очередь не принимаются. */
  private disposed = false;

  constructor(options: { db: Db; data: DataService }) {
    this.db = options.db;
    this.data = options.data;
    this.data.onIndex((ownerId, obj) => this.enqueue(ownerId, obj.id));
    this.data.onRemove((ownerId, objectId) => {
      this.removeFromIndex(ownerId, objectId);
    });
  }

  /** Ставит объект в очередь индексации (батчинг). */
  enqueue(ownerId: string, objectId: string): void {
    if (this.disposed) return;
    this.pending.set(`${ownerId}:${objectId}`, { ownerId, objectId });
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 25);
    this.flushTimer.unref?.();
  }

  /**
   * Останавливает индексатор: снимает отложенный flush и сливает очередь.
   * Вызывается перед закрытием БД — иначе отложенный таймер срабатывает
   * уже на закрытой базе.
   */
  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /** Прогоняет очередь индексации. Возвращает количество обработанных объектов. */
  flush(): number {
    if (this.pending.size === 0) return 0;
    const items = [...this.pending.values()];
    this.pending.clear();
    let processed = 0;
    this.db.tx(() => {
      for (const item of items) {
        const obj = this.data.get(item.ownerId, item.objectId);
        if (!obj) {
          this.removeFromIndex(item.ownerId, item.objectId);
          continue;
        }
        this.indexObject(item.ownerId, obj);
        processed += 1;
      }
    });
    return processed;
  }

  private indexObject(ownerId: string, obj: StoredObject): void {
    const checksum = DataService.contentChecksum(obj.title, obj.body);
    const existing = this.db.get<{ checksum: string }>(
      'SELECT checksum FROM search_meta WHERE object_id = ?', obj.id,
    );
    if (existing?.checksum === checksum) return;

    this.db.run('DELETE FROM search_index WHERE object_id = ?', obj.id);
    this.db.run(
      'INSERT INTO search_index (object_id, owner_id, app, title, body) VALUES (?, ?, ?, ?, ?)',
      obj.id, ownerId, obj.app, obj.title, obj.body ?? '',
    );
    this.db.run(
      `INSERT INTO search_meta (object_id, indexed_at, checksum) VALUES (?, ?, ?)
       ON CONFLICT(object_id) DO UPDATE SET indexed_at = excluded.indexed_at, checksum = excluded.checksum`,
      obj.id, new Date().toISOString(), checksum,
    );
  }

  removeFromIndex(ownerId: string, objectId: string): void {
    this.db.run('DELETE FROM search_index WHERE object_id = ? AND owner_id = ?', objectId, ownerId);
    this.db.run('DELETE FROM search_meta WHERE object_id = ?', objectId);
  }

  /**
   * Полнотекстовый поиск. Результаты всегда ограничены owner_id —
   * чужие объекты не попадают в выдачу даже при совпадении текста.
   */
  search(ownerId: string, query: string, options: SearchOptions = {}): { hits: SearchHit[]; total: number } {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const scope = options.scope ?? 'all';

    const scopeFilter = scope === 'all' ? '' : " AND s.app = ?";
    const params: unknown[] = [ownerId];
    if (scope !== 'all') params.push(scope);

    // FTS5: экранируем пользовательский ввод, чтобы спецсимволы не ломали запрос.
    const match = this.toFtsQuery(query);
    if (!match) return { hits: [], total: 0 };

    const rows = this.db.all<IndexRow & { snippet: string; score: number }>(
      `SELECT s.object_id, s.owner_id, s.app, s.title, s.body,
              snippet(search_index, 4, '<mark>', '</mark>', '…', 24) as snippet,
              bm25(search_index) as score
       FROM search_index s
       WHERE search_index MATCH ? AND s.owner_id = ?${scopeFilter}
       ORDER BY score ASC
       LIMIT ? OFFSET ?`,
      match, ...params, limit, offset,
    );

    const countRow = this.db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM search_index s
       WHERE search_index MATCH ? AND s.owner_id = ?${scopeFilter}`,
      match, ...params,
    );

    const hits: SearchHit[] = rows.map((r) => {
      const obj = this.data.get(ownerId, r.object_id);
      return {
        objectId: r.object_id,
        app: r.app,
        title: r.title,
        snippet: r.snippet.replace(/<\/?mark>/g, ''),
        createdAt: obj?.createdAt ?? '',
        updatedAt: obj?.updatedAt ?? '',
        score: -r.score,
      };
    });

    return { hits, total: countRow?.c ?? 0 };
  }

  /** Превращает пользовательский запрос в валидный FTS5 MATCH. */
  private toFtsQuery(query: string): string | null {
    const tokens = query
      .split(/[\s"()*:^-]+/)
      .map((t) => t.replace(/["]/g, '').trim())
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return null;
    // Префиксный поиск по последнему токену: "infin" находит "infinity".
    return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' AND ');
  }

  /** Диагностика индексатора: расхождения между данными и индексом. */
  diagnostics(ownerId: string): { indexed: number; stale: number; orphaned: number } {
    const indexed = this.db.get<{ c: number }>(
      'SELECT COUNT(*) as c FROM search_index WHERE owner_id = ?', ownerId,
    )?.c ?? 0;
    const stale = this.db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM search_meta m
       LEFT JOIN objects o ON o.id = m.object_id
       WHERE o.id IS NULL OR o.deleted_at IS NOT NULL`,
    )?.c ?? 0;
    const orphaned = this.db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM search_index s
       LEFT JOIN objects o ON o.id = s.object_id
       WHERE o.id IS NULL`,
    )?.c ?? 0;
    return { indexed, stale, orphaned };
  }

  /** Полная переиндексация данных пользователя. */
  reindexAll(ownerId: string): number {
    const objects = this.data.list(ownerId, { limit: 500, includeDeleted: false });
    this.db.tx(() => {
      this.db.run('DELETE FROM search_index WHERE owner_id = ?', ownerId);
      this.db.run('DELETE FROM search_meta WHERE object_id IN (SELECT id FROM objects WHERE owner_id = ?)', ownerId);
      for (const obj of objects) this.indexObject(ownerId, obj);
    });
    return objects.length;
  }
}
