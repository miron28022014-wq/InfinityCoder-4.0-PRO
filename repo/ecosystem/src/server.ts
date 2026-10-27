/**
 * Точка входа Core API.
 * Запуск: node packages/core/dist/server.js
 */

import { createCore } from './core.js';
import { migrate } from './db/migrate.js';
import { createRouterServer } from './http/router.js';
import { registerBuiltinTools } from './tools/builtin.js';

const PORT = Number(process.env['INFINITY_PORT'] ?? 8787);
const HOST = process.env['INFINITY_HOST'] ?? '127.0.0.1';
const DB_FILE = process.env['INFINITY_DB'] ?? './data/infinity.db';
const MASTER_KEY = process.env['INFINITY_MASTER_KEY'];

if (!MASTER_KEY) {
  console.error('INFINITY_MASTER_KEY обязателен. Сгенерируйте: openssl rand -hex 32');
  process.exit(1);
}

const core = createCore({
  dbFile: DB_FILE,
  masterKey: MASTER_KEY,
  defaultMode: (process.env['INFINITY_DEFAULT_MODE'] as 'local' | 'cloud') ?? 'cloud',
  coderWorkspace: process.env['INFINITY_CODER_WORKSPACE'],
  corsOrigins: (process.env['INFINITY_CORS_ORIGINS'] ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
});

const { applied } = migrate(core.db);
if (applied.length) console.log(`[infinity] применены миграции: ${applied.join(', ')}`);

registerBuiltinTools(core);

const server = createRouterServer(core.router);

server.listen(PORT, HOST, () => {
  console.log(`[infinity] Core API слушает http://${HOST}:${PORT}`);
  console.log(`[infinity] БД: ${DB_FILE}`);
});

const shutdown = (signal: string) => {
  console.log(`[infinity] получен ${signal}, останавливаюсь`);
  server.close(() => {
    // Сливаем очередь индексации до закрытия БД.
    core.search.dispose();
    core.db.close();
    process.exit(0);
  });
  // Страховка: если сокеты не закроются — выходим принудительно.
  setTimeout(() => process.exit(0), 3000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
