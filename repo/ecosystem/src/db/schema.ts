export const SCHEMA_SQL = String.raw`
-- Infinity Ecosystem: общая схема ядра.
-- Общие сервисы (Core API, Data Services, Search, Sync, AI Runtime, Tool Runtime)
-- живут в одной БД, чтобы идентичность, права и синхронизация были едиными.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

-- ── Infinity ID / identity ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  scopes      TEXT NOT NULL DEFAULT '[]',
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- ── Data Services: единое хранилище объектов всех приложений ──────────────
CREATE TABLE IF NOT EXISTS objects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app         TEXT NOT NULL,          -- drive | notes | plan | office | ai | ...
  kind        TEXT NOT NULL,          -- file | note | task | chat | sheet | slide ...
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT,                   -- JSON-текст (markdown, структура документа)
  parent_id   TEXT,                   -- иерархия (папки, проекты)
  tags        TEXT NOT NULL DEFAULT '[]',
  meta        TEXT NOT NULL DEFAULT '{}',
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objects_owner_app ON objects(owner_id, app, deleted_at);
CREATE INDEX IF NOT EXISTS idx_objects_parent ON objects(parent_id);

-- Версии объектов — используются Drive, Notes и Office.
CREATE TABLE IF NOT EXISTS object_versions (
  id          TEXT PRIMARY KEY,
  object_id   TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT,
  author_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(object_id, version)
);

-- ── Search: полнотекстовый индекс (FTS5) ─────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  object_id UNINDEXED,
  owner_id  UNINDEXED,
  app       UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS search_meta (
  object_id  TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  indexed_at TEXT NOT NULL,
  checksum   TEXT NOT NULL
);

-- ── AI Runtime: провайдеры и модели ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS providers (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- local_llama | openai_compatible
  base_url      TEXT NOT NULL,
  scope         TEXT NOT NULL,        -- local | cloud
  api_key_enc   TEXT,                 -- шифрованный секрет (никогда в логах)
  enabled       INTEGER NOT NULL DEFAULT 1,
  is_default    INTEGER NOT NULL DEFAULT 0,
  options       TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_owner ON providers(owner_id);

CREATE TABLE IF NOT EXISTS models (
  id            TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  remote_name   TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  context_size  INTEGER NOT NULL DEFAULT 4096,
  capabilities  TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

-- ── AI Runtime: диалоги и сообщения ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Новый диалог',
  model_id    TEXT,
  mode        TEXT NOT NULL DEFAULT 'cloud',  -- local | cloud
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,        -- user | assistant | tool
  content         TEXT NOT NULL,
  model_id        TEXT,
  provider_id     TEXT,
  status          TEXT NOT NULL DEFAULT 'complete', -- pending | streaming | complete | cancelled | error
  error_code      TEXT,
  tool_calls      TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  client_request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
-- Идемпотентность: один client_request_id на диалог.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_request
  ON messages(conversation_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- ── AI Runtime: память с источниками ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  source      TEXT NOT NULL,           -- json: {type, object_id, title, snippet}
  importance  REAL NOT NULL DEFAULT 0.5,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner_id, updated_at DESC);

-- ── Tool Runtime: разрешения инструментов ─────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_grants (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool        TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'ask',  -- ask | allow | deny
  expires_at  TEXT,
  updated_at  TEXT NOT NULL,
  UNIQUE(owner_id, tool)
);

-- ── Sync: журнал изменений для клиентов ──────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    TEXT NOT NULL,
  app         TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  op          TEXT NOT NULL,          -- upsert | delete
  payload     TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_log_owner ON sync_log(owner_id, seq);

-- ── Hub: расширения ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS extensions (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- app | model | integration
  source        TEXT NOT NULL,
  signature     TEXT,
  manifest      TEXT NOT NULL,
  api_version   TEXT NOT NULL,
  permissions   TEXT NOT NULL DEFAULT '[]',
  state         TEXT NOT NULL DEFAULT 'available', -- available | installed | disabled | error
  installed_at  TEXT,
  updated_at    TEXT NOT NULL,
  UNIQUE(owner_id, slug)
);

-- ── Link: доверенные устройства ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL,
  public_key    TEXT,
  permissions   TEXT NOT NULL DEFAULT '[]',
  confirmed_at  TEXT NOT NULL,
  last_seen_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash   TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

-- ── Plan: задачи ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | done | archived
  priority      INTEGER NOT NULL DEFAULT 3,
  due_at        TEXT,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  repeat_rule   TEXT,
  project_id    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id, status, due_at);
`;
