/**
 * Создание/обновление схемы. Миграции идемпотентны и применяются по версии.
 *
 * Версия 2 добавляет модуль InfinityCoder. Миграция только добавляет таблицы:
 * данные пользователей не удаляются, существующие таблицы не переписываются.
 */

import type { Db } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import { CODER_SCHEMA_SQL } from '../coder/schema.js';

export const SCHEMA_VERSION = 2;

export function migrate(db: Db): { version: number; applied: string[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied: string[] = [];
  const current = db.get<{ version: number }>('SELECT MAX(version) as version FROM schema_migrations');
  const from = current?.version ?? 0;

  if (from < 1) {
    db.exec(SCHEMA_SQL);
    db.run('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      1, new Date().toISOString());
    applied.push('001_core_schema');
  }

  if (from < 2) {
    db.exec(CODER_SCHEMA_SQL);
    db.run('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      2, new Date().toISOString());
    applied.push('002_coder_schema');
  }

  return { version: SCHEMA_VERSION, applied };
}
