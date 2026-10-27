/**
 * CLI миграций: node packages/core/dist/cli/migrate.js
 */

import { Db } from '../db/db.js';
import { migrate } from '../db/migrate.js';

const dbFile = process.env['INFINITY_DB'] ?? './data/infinity.db';
const db = new Db({ file: dbFile });
const result = migrate(db);
db.close();

console.log(`[infinity] схема актуальна (версия ${result.version})`);
if (result.applied.length) console.log(`[infinity] применено: ${result.applied.join(', ')}`);
else console.log('[infinity] новых миграций не было');
