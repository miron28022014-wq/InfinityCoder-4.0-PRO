/**
 * Схема модуля InfinityCoder (миграция 002).
 *
 * Миграция только добавляет таблицы: пользовательские данные не удаляются,
 * уже существующие таблицы не переписываются.
 */

export const CODER_SCHEMA_SQL = String.raw`
-- ── Проекты ────────────────────────────────────────────────────────────────
-- root_path — путь на сервере (узле), клиенту не отдаётся: браузер не должен
-- получать прямой доступ к диску, пути известны только бэкенду.
CREATE TABLE IF NOT EXISTS coder_projects (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  root_path     TEXT NOT NULL,
  settings      TEXT NOT NULL DEFAULT '{}',
  vcs           TEXT NOT NULL DEFAULT 'none',   -- none | git
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coder_projects_owner ON coder_projects(owner_id, updated_at DESC);

-- ── Сессии (AI-чат проекта) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coder_sessions (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES coder_projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Сессия',
  model_id      TEXT,
  mode          TEXT NOT NULL DEFAULT 'cloud',   -- local | cloud
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coder_sessions_project ON coder_sessions(project_id, updated_at DESC);

-- ── Сообщения чата ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coder_messages (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES coder_sessions(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,                -- user | assistant | tool
  content           TEXT NOT NULL DEFAULT '',
  tool_name         TEXT,
  tool_args         TEXT NOT NULL DEFAULT '{}',
  tool_result       TEXT,
  status            TEXT NOT NULL DEFAULT 'complete',
  error_code        TEXT,
  created_at        TEXT NOT NULL,
  client_request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_coder_messages_session ON coder_messages(session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coder_messages_client_request
  ON coder_messages(session_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- ── Запуски агента (чат, автономный цикл, субагенты) ──────────────────────
CREATE TABLE IF NOT EXISTS coder_runs (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL REFERENCES coder_sessions(id) ON DELETE CASCADE,
  project_id     TEXT NOT NULL REFERENCES coder_projects(id) ON DELETE CASCADE,
  parent_run_id  TEXT,
  agent_name     TEXT NOT NULL DEFAULT 'main',
  kind           TEXT NOT NULL DEFAULT 'chat',   -- chat | autonomous | subagent
  task           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'running',-- running | awaiting_confirmation | done | failed | cancelled
  step_count     INTEGER NOT NULL DEFAULT 0,
  max_steps      INTEGER NOT NULL DEFAULT 12,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coder_runs_session ON coder_runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coder_runs_project ON coder_runs(project_id, created_at DESC);

-- ── Шаги запуска (журнал цикла) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coder_steps (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES coder_runs(id) ON DELETE CASCADE,
  index_no    INTEGER NOT NULL,
  kind        TEXT NOT NULL,                    -- model | tool | verify | plan | report | subagent
  title       TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'complete', -- complete | failed | pending
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coder_steps_run ON coder_steps(run_id, index_no);

-- ── Блокировки файлов между субагентами ───────────────────────────────────
CREATE TABLE IF NOT EXISTS coder_locks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES coder_projects(id) ON DELETE CASCADE,
  run_id      TEXT NOT NULL,
  agent_name  TEXT NOT NULL,
  path        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(project_id, path)
);

-- ── Версии файлов (история и diff) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coder_file_versions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES coder_projects(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  version     INTEGER NOT NULL,
  author      TEXT NOT NULL DEFAULT 'user',
  created_at  TEXT NOT NULL,
  UNIQUE(project_id, path, version)
);
CREATE INDEX IF NOT EXISTS idx_coder_file_versions_path ON coder_file_versions(project_id, path, version DESC);

-- ── Вкладки редактора (состояние оболочки, синхронизируется между клиентами) ─
CREATE TABLE IF NOT EXISTS coder_tabs (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES coder_sessions(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  UNIQUE(session_id, path)
);
`;
