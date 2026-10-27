/**
 * Слой доступа к данным на встроенном SQLite (node:sqlite).
 * FTS5 используется общим Search-сервисом — один индекс, один источник правды.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Row = Record<string, unknown>;

export interface DbOptions {
  file: string;
  readonly?: boolean;
}

export class Db {
  readonly raw: DatabaseSync;
  readonly file: string;

  constructor(options: DbOptions) {
    this.file = options.file;
    if (options.file !== ':memory:') mkdirSync(dirname(options.file), { recursive: true });
    this.raw = new DatabaseSync(options.file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const r = this.raw.prepare(sql).run(...(params as never[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /** Транзакция с откатом при любой ошибке. */
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* транзакция уже откатилась */
      }
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}
