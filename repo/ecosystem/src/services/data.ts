/**
 * Data Services — общий слой доступа к объектам всех приложений.
 * Один сервис — один источник правды; приложения не дублируют хранилища.
 */

import { createHash } from 'node:crypto';
import type { Db } from '../db/db.js';
import { newId, compareIds } from '../ids.js';
import { NotFoundError, ValidationError } from '../errors.js';

export interface StoredObject {
  id: string;
  ownerId: string;
  app: string;
  kind: string;
  title: string;
  body: string | null;
  parentId: string | null;
  tags: string[];
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ObjectRow {
  id: string;
  owner_id: string;
  app: string;
  kind: string;
  title: string;
  body: string | null;
  parent_id: string | null;
  tags: string;
  meta: string;
  created_at: string;
  updated_at: string;
}

function rowToObject(row: ObjectRow): StoredObject {
  return {
    id: row.id,
    ownerId: row.owner_id,
    app: row.app,
    kind: row.kind,
    title: row.title,
    body: row.body,
    parentId: row.parent_id,
    tags: JSON.parse(row.tags) as string[],
    meta: JSON.parse(row.meta) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateObjectInput {
  app: string;
  kind: string;
  title?: string;
  body?: string | null;
  parentId?: string | null;
  tags?: string[];
  meta?: Record<string, unknown>;
  id?: string;
}

export interface ListObjectsFilter {
  app?: string;
  kind?: string;
  parentId?: string | null;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export class DataService {
  private readonly db: Db;
  /** Колбэк индексатора: вызывается при каждом изменении объекта. */
  private indexer?: (ownerId: string, obj: StoredObject) => void;
  private remover?: (ownerId: string, objectId: string) => void;

  constructor(options: { db: Db }) {
    this.db = options.db;
  }

  onIndex(fn: (ownerId: string, obj: StoredObject) => void): void {
    this.indexer = fn;
  }

  onRemove(fn: (ownerId: string, objectId: string) => void): void {
    this.remover = fn;
  }

  create(ownerId: string, input: CreateObjectInput): StoredObject {
    if (!input.app || !input.kind) throw new ValidationError('app и kind обязательны');
    const now = new Date().toISOString();
    const id = input.id ?? newId(input.app === 'drive' ? 'fil' : input.app === 'notes' ? 'nte' : 'req');
    this.db.run(
      `INSERT INTO objects (id, owner_id, app, kind, title, body, parent_id, tags, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ownerId,
      input.app,
      input.kind,
      input.title ?? '',
      input.body ?? null,
      input.parentId ?? null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.meta ?? {}),
      now,
      now,
    );
    const obj = this.get(ownerId, id)!;
    // Версия 1 — исходное состояние объекта.
    this.createVersion(ownerId, id, ownerId);
    this.indexer?.(ownerId, obj);
    this.logSync(ownerId, input.app, id, 'upsert', obj);
    return obj;
  }

  get(ownerId: string, id: string): StoredObject | null {
    const row = this.db.get<ObjectRow>(
      'SELECT * FROM objects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId,
    );
    return row ? rowToObject(row) : null;
  }

  /** Возвращает объект, даже если он помечен удалённым (для восстановления). */
  getIncludingDeleted(ownerId: string, id: string): StoredObject | null {
    const row = this.db.get<ObjectRow>('SELECT * FROM objects WHERE id = ? AND owner_id = ?', id, ownerId);
    return row ? rowToObject(row) : null;
  }

  /** Бросает 404, если объект не найден или принадлежит другому пользователю. */
  require(ownerId: string, id: string): StoredObject {
    const obj = this.get(ownerId, id);
    if (!obj) throw new NotFoundError(`Объект ${id} не найден`);
    return obj;
  }

  list(ownerId: string, filter: ListObjectsFilter = {}): StoredObject[] {
    const where: string[] = ['owner_id = ?'];
    const params: unknown[] = [ownerId];
    if (!filter.includeDeleted) where.push('deleted_at IS NULL');
    if (filter.app) {
      where.push('app = ?');
      params.push(filter.app);
    }
    if (filter.kind) {
      where.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.parentId !== undefined) {
      if (filter.parentId === null) where.push('parent_id IS NULL');
      else {
        where.push('parent_id = ?');
        params.push(filter.parentId);
      }
    }
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    params.push(limit, offset);
    const rows = this.db.all<ObjectRow>(
      `SELECT * FROM objects WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ...params,
    );
    return rows.map(rowToObject);
  }

  update(ownerId: string, id: string, patch: Partial<CreateObjectInput>, authorId = ownerId): StoredObject {
    // Снимок текущего состояния сохраняется ДО изменения — версия 1 это
    // исходное содержимое объекта.
    this.require(ownerId, id);
    this.createVersion(ownerId, id, authorId);
    return this.applyPatch(ownerId, id, patch);
  }

  /** Внутреннее применение изменения без создания версии (используется при восстановлении). */
  private applyPatch(ownerId: string, id: string, patch: Partial<CreateObjectInput>): StoredObject {
    const current = this.require(ownerId, id);
    const next = {
      title: patch.title ?? current.title,
      body: patch.body === undefined ? current.body : patch.body,
      parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
      tags: patch.tags ?? current.tags,
      meta: patch.meta ?? current.meta,
    };
    this.db.run(
      `UPDATE objects SET title = ?, body = ?, parent_id = ?, tags = ?, meta = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
      next.title,
      next.body,
      next.parentId,
      JSON.stringify(next.tags),
      JSON.stringify(next.meta),
      new Date().toISOString(),
      id,
      ownerId,
    );
    const obj = this.require(ownerId, id);
    this.indexer?.(ownerId, obj);
    this.logSync(ownerId, obj.app, id, 'upsert', obj);
    return obj;
  }

  /** Мягкое удаление: объект скрыт, но данные и версии сохраняются. */
  softDelete(ownerId: string, id: string): void {
    this.require(ownerId, id);
    const now = new Date().toISOString();
    this.db.run('UPDATE objects SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
      now, now, id, ownerId);
    this.remover?.(ownerId, id);
    const obj = this.getIncludingDeleted(ownerId, id);
    if (obj) this.logSync(ownerId, obj.app, id, 'delete', obj);
  }

  restore(ownerId: string, id: string): StoredObject {
    const obj = this.getIncludingDeleted(ownerId, id);
    if (!obj) throw new NotFoundError(`Объект ${id} не найден`);
    this.db.run('UPDATE objects SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?',
      new Date().toISOString(), id, ownerId);
    const restored = this.require(ownerId, id);
    this.indexer?.(ownerId, restored);
    this.logSync(ownerId, restored.app, id, 'upsert', restored);
    return restored;
  }

  // ── Версии ──────────────────────────────────────────────────────────────
  createVersion(ownerId: string, objectId: string, authorId: string): number {
    const obj = this.require(ownerId, objectId);
    const last = this.db.get<{ v: number }>(
      'SELECT MAX(version) as v FROM object_versions WHERE object_id = ?', objectId,
    );
    const version = (last?.v ?? 0) + 1;
    this.db.run(
      `INSERT INTO object_versions (id, object_id, version, title, body, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId('ver'), objectId, version, obj.title, obj.body, authorId, new Date().toISOString(),
    );
    return version;
  }

  listVersions(ownerId: string, objectId: string): { version: number; title: string; body: string | null; createdAt: string }[] {
    this.require(ownerId, objectId);
    return this.db
      .all<{ version: number; title: string; body: string | null; created_at: string }>(
        'SELECT version, title, body, created_at FROM object_versions WHERE object_id = ? ORDER BY version DESC',
        objectId,
      )
      .map((r) => ({ version: r.version, title: r.title, body: r.body, createdAt: r.created_at }));
  }

  restoreVersion(ownerId: string, objectId: string, version: number): StoredObject {
    this.require(ownerId, objectId);
    const row = this.db.get<{ title: string; body: string | null }>(
      'SELECT title, body FROM object_versions WHERE object_id = ? AND version = ?',
      objectId, version,
    );
    if (!row) throw new NotFoundError(`Версия ${version} не найдена`);
    // Восстановление применяется напрямую: сам момент восстановления
    // не должен переписывать историю версий.
    return this.applyPatch(ownerId, objectId, { title: row.title, body: row.body });
  }

  // ── Sync ────────────────────────────────────────────────────────────────
  logSync(ownerId: string, app: string, objectId: string, op: 'upsert' | 'delete', payload: unknown): void {
    this.db.run(
      `INSERT INTO sync_log (owner_id, app, object_id, op, payload, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ownerId, app, objectId, op, JSON.stringify(payload), new Date().toISOString(),
    );
  }

  /** Инкрементальная выдача изменений с последнего cursor. */
  changesSince(ownerId: string, since: number, limit = 200): { cursor: number; changes: unknown[] } {
    const rows = this.db.all<{ seq: number; app: string; object_id: string; op: string; payload: string; changed_at: string }>(
      `SELECT seq, app, object_id, op, payload, changed_at FROM sync_log
       WHERE owner_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
      ownerId, since, limit,
    );
    return {
      cursor: rows.length ? rows[rows.length - 1]!.seq : since,
      changes: rows.map((r) => ({
        seq: r.seq,
        app: r.app,
        objectId: r.object_id,
        op: r.op,
        payload: JSON.parse(r.payload),
        changedAt: r.changed_at,
      })),
    };
  }

  /** Контрольная сумма содержимого — для определения устаревших индексов. */
  static contentChecksum(title: string, body: string | null): string {
    return createHash('sha256').update(`${title} ${body ?? ''}`).digest('hex');
  }
}

export { compareIds };
