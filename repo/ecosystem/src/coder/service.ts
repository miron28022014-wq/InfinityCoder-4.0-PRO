/**
 * Сервис InfinityCoder: проекты, файлы, сессии, запуски, вкладки, память.
 *
 * Сервис владеет доступом к данным и не отдаёт наружу внутренние пути:
 * клиент (Web/Android/Windows) работает с относительными путями внутри проекта.
 * Права проверяются по owner_id на каждой операции.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/db.js';
import { newId } from '../ids.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { MemoryService } from '../services/memory.js';
import {
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILE_SIZE,
  diffText,
  formatUnifiedDiff,
  listTree,
  readProjectFile,
  removeProjectFile,
  searchProjectFiles,
  writeProjectFile,
  type DiffResult,
  type SearchMatch,
  type TreeEntry,
} from './workspace.js';

export interface CoderSettings {
  /** Команда проверки (тесты). Например: npm test */
  testCommand?: string;
  /** Команда сборки. Например: npm run build */
  buildCommand?: string;
  /** Разрешённые команды терминала (префиксы). */
  allowedCommands: string[];
  /** Разрешить произвольные команды (всё равно требует подтверждения). */
  allowArbitraryCommands: boolean;
  /** Лимит размера файла, байт. */
  maxFileSize: number;
  /** Каталоги, исключённые из обхода и поиска. */
  ignorePatterns: string[];
}

export const DEFAULT_SETTINGS: CoderSettings = {
  testCommand: undefined,
  buildCommand: undefined,
  allowedCommands: [],
  allowArbitraryCommands: false,
  maxFileSize: DEFAULT_MAX_FILE_SIZE,
  ignorePatterns: [...DEFAULT_IGNORE],
};

export interface CoderProject {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  settings: CoderSettings;
  vcs: 'none' | 'git';
  createdAt: string;
  updatedAt: string;
}

export interface CoderSession {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  modelId: string | null;
  mode: 'local' | 'cloud';
  createdAt: string;
  updatedAt: string;
}

export interface CoderMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string | null;
  toolArgs: Record<string, unknown>;
  toolResult: string | null;
  status: string;
  errorCode: string | null;
  createdAt: string;
}

export interface CoderRun {
  id: string;
  ownerId: string;
  sessionId: string;
  projectId: string;
  parentRunId: string | null;
  agentName: string;
  kind: 'chat' | 'autonomous' | 'subagent';
  task: string;
  status: 'running' | 'awaiting_confirmation' | 'done' | 'failed' | 'cancelled';
  stepCount: number;
  maxSteps: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoderStep {
  id: string;
  runId: string;
  index: number;
  kind: 'model' | 'tool' | 'verify' | 'plan' | 'report' | 'subagent';
  title: string;
  detail: string;
  status: 'complete' | 'failed' | 'pending';
  createdAt: string;
}

export interface CoderTab {
  sessionId: string;
  path: string;
  position: number;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  root_path: string;
  settings: string;
  vcs: string;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  owner_id: string;
  project_id: string;
  title: string;
  model_id: string | null;
  mode: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_args: string;
  tool_result: string | null;
  status: string;
  error_code: string | null;
  created_at: string;
  client_request_id: string | null;
}

interface RunRow {
  id: string;
  owner_id: string;
  session_id: string;
  project_id: string;
  parent_run_id: string | null;
  agent_name: string;
  kind: string;
  task: string;
  status: string;
  step_count: number;
  max_steps: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface StepRow {
  id: string;
  run_id: string;
  index_no: number;
  kind: string;
  title: string;
  detail: string;
  status: string;
  created_at: string;
}

function parseSettings(raw: string): CoderSettings {
  let parsed: Partial<CoderSettings> = {};
  try {
    parsed = JSON.parse(raw) as Partial<CoderSettings>;
  } catch {
    parsed = {};
  }
  return {
    testCommand: typeof parsed.testCommand === 'string' && parsed.testCommand.trim() ? parsed.testCommand.trim() : undefined,
    buildCommand: typeof parsed.buildCommand === 'string' && parsed.buildCommand.trim() ? parsed.buildCommand.trim() : undefined,
    allowedCommands: Array.isArray(parsed.allowedCommands)
      ? parsed.allowedCommands.filter((c): c is string => typeof c === 'string')
      : [...DEFAULT_SETTINGS.allowedCommands],
    allowArbitraryCommands: parsed.allowArbitraryCommands === true,
    maxFileSize: typeof parsed.maxFileSize === 'number' && parsed.maxFileSize > 0
      ? Math.min(parsed.maxFileSize, 10 * 1024 * 1024)
      : DEFAULT_SETTINGS.maxFileSize,
    ignorePatterns: Array.isArray(parsed.ignorePatterns)
      ? parsed.ignorePatterns.filter((p): p is string => typeof p === 'string')
      : [...DEFAULT_SETTINGS.ignorePatterns],
  };
}

export interface CoderServiceOptions {
  db: Db;
  memory: MemoryService;
  /** Базовый каталог для автоматически создаваемых проектов. */
  workspaceBase: string;
}

export class CoderService {
  private readonly db: Db;
  private readonly memory: MemoryService;
  readonly workspaceBase: string;

  constructor(options: CoderServiceOptions) {
    this.db = options.db;
    this.memory = options.memory;
    this.workspaceBase = options.workspaceBase;
  }

  // ── Проекты ─────────────────────────────────────────────────────────────

  async createProject(
    ownerId: string,
    input: { name: string; description?: string; rootPath?: string; settings?: Partial<CoderSettings> },
  ): Promise<CoderProject> {
    const name = input.name?.trim();
    if (!name) throw new ValidationError('Название проекта обязательно');
    if (name.length > 120) throw new ValidationError('Слишком длинное название проекта');

    const id = newId('prj');
    const rootPath = input.rootPath?.trim()
      ? path.resolve(input.rootPath)
      : path.join(this.workspaceBase, ownerId, id);

    if (input.rootPath?.trim()) {
      if (!path.isAbsolute(input.rootPath.trim())) {
        throw new ValidationError('rootPath должен быть абсолютным путём');
      }
      const stat = await fs.stat(rootPath).catch(() => null);
      if (!stat) {
        try {
          await fs.mkdir(rootPath, { recursive: true });
        } catch {
          throw new ValidationError(`Не удалось создать каталог проекта: ${rootPath}`);
        }
      } else if (!stat.isDirectory()) {
        throw new ValidationError('rootPath должен указывать на каталог');
      }
    } else {
      await fs.mkdir(rootPath, { recursive: true });
    }

    const settings: CoderSettings = {
      ...DEFAULT_SETTINGS,
      ...(input.settings ?? {}),
      ignorePatterns: input.settings?.ignorePatterns ?? [...DEFAULT_SETTINGS.ignorePatterns],
      allowedCommands: input.settings?.allowedCommands ?? [],
    };

    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO coder_projects (id, owner_id, name, description, root_path, settings, vcs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'none', ?, ?)`,
      id, ownerId, name, input.description?.trim() ?? '', rootPath, JSON.stringify(settings), now, now,
    );
    return this.getProject(ownerId, id)!;
  }

  listProjects(ownerId: string): CoderProject[] {
    return this.db
      .all<ProjectRow>('SELECT * FROM coder_projects WHERE owner_id = ? ORDER BY updated_at DESC', ownerId)
      .map((row) => this.toProject(row));
  }

  getProject(ownerId: string, id: string): CoderProject | null {
    const row = this.db.get<ProjectRow>('SELECT * FROM coder_projects WHERE id = ? AND owner_id = ?', id, ownerId);
    return row ? this.toProject(row) : null;
  }

  /** Бросает 404, если проекта нет или он принадлежит другому пользователю. */
  requireProject(ownerId: string, id: string): CoderProject {
    const project = this.getProject(ownerId, id);
    if (!project) throw new NotFoundError('Проект не найден');
    return project;
  }

  /** Внутренний путь проекта. Клиенту не отдаётся. */
  projectRoot(ownerId: string, id: string): string {
    const row = this.db.get<ProjectRow>('SELECT root_path FROM coder_projects WHERE id = ? AND owner_id = ?', id, ownerId);
    if (!row) throw new NotFoundError('Проект не найден');
    return row.root_path;
  }

  async updateProject(
    ownerId: string,
    id: string,
    patch: { name?: string; description?: string; settings?: Partial<CoderSettings> },
  ): Promise<CoderProject> {
    const project = this.requireProject(ownerId, id);
    const settings = patch.settings
      ? { ...project.settings, ...patch.settings }
      : project.settings;
    this.db.run(
      `UPDATE coder_projects SET name = ?, description = ?, settings = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
      patch.name?.trim() || project.name,
      patch.description?.trim() ?? project.description,
      JSON.stringify(settings),
      new Date().toISOString(),
      id,
      ownerId,
    );
    return this.getProject(ownerId, id)!;
  }

  /** Удаляет запись проекта. Файлы на диске не трогаются — это необратимое действие. */
  deleteProject(ownerId: string, id: string): void {
    this.requireProject(ownerId, id);
    this.db.run('DELETE FROM coder_projects WHERE id = ? AND owner_id = ?', id, ownerId);
  }

  private toProject(row: ProjectRow): CoderProject {
    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      description: row.description,
      settings: parseSettings(row.settings),
      vcs: row.vcs === 'git' ? 'git' : 'none',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── Файлы ───────────────────────────────────────────────────────────────

  async tree(ownerId: string, projectId: string, relative = ''): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const project = this.requireProject(ownerId, projectId);
    const root = this.projectRoot(ownerId, projectId);
    await this.assertRootExists(root);
    return listTree(root, relative, { ignore: project.settings.ignorePatterns });
  }

  async readFile(ownerId: string, projectId: string, relative: string) {
    const project = this.requireProject(ownerId, projectId);
    const root = this.projectRoot(ownerId, projectId);
    await this.assertRootExists(root);
    return readProjectFile(root, relative, project.settings.maxFileSize);
  }

  async writeFile(
    ownerId: string,
    projectId: string,
    relative: string,
    content: string,
    author = 'user',
  ): Promise<{ path: string; size: number; version: number }> {
    const project = this.requireProject(ownerId, projectId);
    const root = this.projectRoot(ownerId, projectId);
    await this.assertRootExists(root);
    const previous = await readProjectFile(root, relative, project.settings.maxFileSize).catch(() => null);
    if (previous) {
      // Состояние до изменения сохраняется один раз: если последняя версия
      // уже совпадает, дублировать её не нужно.
      const last = await this.lastVersionContent(ownerId, projectId, relative);
      if (last !== previous.content) {
        await this.saveVersion(ownerId, projectId, relative, previous.content, author);
      }
    }
    const result = await writeProjectFile(root, relative, content, project.settings.maxFileSize);
    const version = await this.saveVersion(ownerId, projectId, relative, content, author);
    this.db.run('UPDATE coder_projects SET updated_at = ? WHERE id = ? AND owner_id = ?',
      new Date().toISOString(), projectId, ownerId);
    return { ...result, version };
  }

  async removeFile(ownerId: string, projectId: string, relative: string): Promise<void> {
    this.requireProject(ownerId, projectId);
    const root = this.projectRoot(ownerId, projectId);
    await this.assertRootExists(root);
    await removeProjectFile(root, relative);
  }

  async search(
    ownerId: string,
    projectId: string,
    query: string,
    options: { limit?: number; caseSensitive?: boolean } = {},
  ): Promise<{ matches: SearchMatch[]; filesScanned: number; truncated: boolean }> {
    const project = this.requireProject(ownerId, projectId);
    const root = this.projectRoot(ownerId, projectId);
    await this.assertRootExists(root);
    return searchProjectFiles(root, query, {
      limit: options.limit,
      caseSensitive: options.caseSensitive,
      ignore: project.settings.ignorePatterns,
    });
  }

  /** Diff: против переданного текста или против предыдущей версии файла. */
  async diff(
    ownerId: string,
    projectId: string,
    relative: string,
    before?: string,
  ): Promise<DiffResult & { unified: string }> {
    const project = this.requireProject(ownerId, projectId);
    const root = this.projectRoot(ownerId, projectId);
    await this.assertRootExists(root);
    const current = await readProjectFile(root, relative, project.settings.maxFileSize);
    // Без явного «before» показываем последнее изменение файла:
    // текущее содержимое против предыдущей сохранённой версии.
    const oldText = before ?? (await this.previousVersionContent(projectId, relative)) ?? '';
    const result = diffText(oldText, current.content, relative);
    return { ...result, unified: formatUnifiedDiff(result) };
  }

  async saveVersion(
    ownerId: string,
    projectId: string,
    relative: string,
    content: string,
    author = 'user',
  ): Promise<number> {
    const last = this.db.get<{ v: number }>(
      'SELECT MAX(version) as v FROM coder_file_versions WHERE project_id = ? AND path = ?',
      projectId, relative,
    );
    const version = (last?.v ?? 0) + 1;
    this.db.run(
      `INSERT INTO coder_file_versions (id, project_id, path, content, version, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId('cfv'), projectId, relative, content, version, author, new Date().toISOString(),
    );
    return version;
  }

  listVersions(ownerId: string, projectId: string, relative: string) {
    this.requireProject(ownerId, projectId);
    return this.db
      .all<{ version: number; author: string; created_at: string; size: number }>(
        `SELECT version, author, created_at, LENGTH(content) as size
         FROM coder_file_versions WHERE project_id = ? AND path = ? ORDER BY version DESC`,
        projectId, relative,
      )
      .map((r) => ({ version: r.version, author: r.author, createdAt: r.created_at, size: r.size }));
  }

  private async lastVersionContent(ownerId: string, projectId: string, relative: string): Promise<string | null> {
    const row = this.db.get<{ content: string }>(
      `SELECT content FROM coder_file_versions WHERE project_id = ? AND path = ? ORDER BY version DESC LIMIT 1`,
      projectId, relative,
    );
    return row?.content ?? null;
  }

  /** Состояние файла до последнего изменения (версия N-1). */
  private async previousVersionContent(projectId: string, relative: string): Promise<string | null> {
    const row = this.db.get<{ content: string }>(
      `SELECT content FROM coder_file_versions WHERE project_id = ? AND path = ?
       ORDER BY version DESC LIMIT 1 OFFSET 1`,
      projectId, relative,
    );
    return row?.content ?? null;
  }

  private async assertRootExists(root: string): Promise<void> {
    const stat = await fs.stat(root).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new NotFoundError('Каталог проекта недоступен на этом узле');
    }
  }

  // ── Сессии ──────────────────────────────────────────────────────────────

  createSession(
    ownerId: string,
    projectId: string,
    input: { title?: string; modelId?: string; mode?: 'local' | 'cloud' } = {},
  ): CoderSession {
    this.requireProject(ownerId, projectId);
    const id = newId('cos');
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO coder_sessions (id, owner_id, project_id, title, model_id, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ownerId, projectId, input.title?.trim() || 'Сессия', input.modelId ?? null,
      input.mode ?? 'cloud', now, now,
    );
    return this.getSession(ownerId, id)!;
  }

  listSessions(ownerId: string, projectId: string): CoderSession[] {
    this.requireProject(ownerId, projectId);
    return this.db
      .all<SessionRow>(
        'SELECT * FROM coder_sessions WHERE owner_id = ? AND project_id = ? ORDER BY updated_at DESC',
        ownerId, projectId,
      )
      .map((row) => this.toSession(row));
  }

  getSession(ownerId: string, id: string): CoderSession | null {
    const row = this.db.get<SessionRow>('SELECT * FROM coder_sessions WHERE id = ? AND owner_id = ?', id, ownerId);
    return row ? this.toSession(row) : null;
  }

  requireSession(ownerId: string, id: string): CoderSession {
    const session = this.getSession(ownerId, id);
    if (!session) throw new NotFoundError('Сессия не найдена');
    return session;
  }

  updateSession(ownerId: string, id: string, patch: { title?: string; modelId?: string; mode?: 'local' | 'cloud' }): CoderSession {
    const session = this.requireSession(ownerId, id);
    this.db.run(
      'UPDATE coder_sessions SET title = ?, model_id = ?, mode = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
      patch.title?.trim() || session.title,
      patch.modelId === undefined ? session.modelId : patch.modelId,
      patch.mode ?? session.mode,
      new Date().toISOString(),
      id, ownerId,
    );
    return this.getSession(ownerId, id)!;
  }

  deleteSession(ownerId: string, id: string): void {
    this.requireSession(ownerId, id);
    this.db.run('DELETE FROM coder_sessions WHERE id = ? AND owner_id = ?', id, ownerId);
  }

  private toSession(row: SessionRow): CoderSession {
    return {
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      title: row.title,
      modelId: row.model_id,
      mode: row.mode === 'local' ? 'local' : 'cloud',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── Сообщения ───────────────────────────────────────────────────────────

  addMessage(
    ownerId: string,
    sessionId: string,
    input: {
      role: 'user' | 'assistant' | 'tool';
      content?: string;
      toolName?: string;
      toolArgs?: Record<string, unknown>;
      toolResult?: string;
      status?: string;
      errorCode?: string;
      clientRequestId?: string;
    },
  ): CoderMessage {
    const id = newId('msg');
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO coder_messages
         (id, session_id, role, content, tool_name, tool_args, tool_result, status, error_code, created_at, client_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, sessionId, input.role, input.content ?? '', input.toolName ?? null,
      JSON.stringify(input.toolArgs ?? {}), input.toolResult ?? null,
      input.status ?? 'complete', input.errorCode ?? null, now, input.clientRequestId ?? null,
    );
    this.db.run('UPDATE coder_sessions SET updated_at = ? WHERE id = ?', now, sessionId);
    return this.getMessage(id)!;
  }

  getMessage(id: string): CoderMessage | null {
    const row = this.db.get<MessageRow>('SELECT * FROM coder_messages WHERE id = ?', id);
    return row ? this.toMessage(row) : null;
  }

  findMessageByClientRequest(sessionId: string, clientRequestId: string): CoderMessage | null {
    const row = this.db.get<MessageRow>(
      'SELECT * FROM coder_messages WHERE session_id = ? AND client_request_id = ?',
      sessionId, clientRequestId,
    );
    return row ? this.toMessage(row) : null;
  }

  listMessages(ownerId: string, sessionId: string, limit = 200): CoderMessage[] {
    this.requireSession(ownerId, sessionId);
    return this.db
      .all<MessageRow>(
        'SELECT * FROM coder_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ?',
        sessionId, limit,
      )
      .map((row) => this.toMessage(row));
  }

  private toMessage(row: MessageRow): CoderMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as 'user' | 'assistant' | 'tool',
      content: row.content,
      toolName: row.tool_name,
      toolArgs: JSON.parse(row.tool_args) as Record<string, unknown>,
      toolResult: row.tool_result,
      status: row.status,
      errorCode: row.error_code,
      createdAt: row.created_at,
    };
  }

  // ── Запуски и шаги ──────────────────────────────────────────────────────

  createRun(
    ownerId: string,
    input: {
      sessionId: string;
      projectId: string;
      kind?: 'chat' | 'autonomous' | 'subagent';
      task?: string;
      parentRunId?: string | null;
      agentName?: string;
      maxSteps?: number;
    },
  ): CoderRun {
    const id = newId('cor');
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO coder_runs
         (id, owner_id, session_id, project_id, parent_run_id, agent_name, kind, task, status, step_count, max_steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', 0, ?, ?, ?)`,
      id, ownerId, input.sessionId, input.projectId, input.parentRunId ?? null,
      input.agentName ?? 'main', input.kind ?? 'chat', input.task ?? '',
      input.maxSteps ?? 12, now, now,
    );
    return this.getRun(id)!;
  }

  getRun(id: string): CoderRun | null {
    const row = this.db.get<RunRow>('SELECT * FROM coder_runs WHERE id = ?', id);
    return row ? this.toRun(row) : null;
  }

  listRuns(ownerId: string, filter: { sessionId?: string; projectId?: string; limit?: number } = {}): CoderRun[] {
    const where: string[] = ['owner_id = ?'];
    const params: unknown[] = [ownerId];
    if (filter.sessionId) {
      where.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.projectId) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    params.push(Math.min(Math.max(filter.limit ?? 50, 1), 200));
    return this.db
      .all<RunRow>(`SELECT * FROM coder_runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, ...params)
      .map((row) => this.toRun(row));
  }

  updateRun(id: string, patch: { status?: CoderRun['status']; stepCount?: number; error?: string | null }): void {
    const run = this.getRun(id);
    if (!run) return;
    this.db.run(
      'UPDATE coder_runs SET status = ?, step_count = ?, error = ?, updated_at = ? WHERE id = ?',
      patch.status ?? run.status,
      patch.stepCount ?? run.stepCount,
      patch.error === undefined ? run.error : patch.error,
      new Date().toISOString(),
      id,
    );
  }

  addStep(
    runId: string,
    input: { kind: CoderStep['kind']; title: string; detail?: string; status?: CoderStep['status'] },
  ): CoderStep {
    const last = this.db.get<{ i: number }>('SELECT MAX(index_no) as i FROM coder_steps WHERE run_id = ?', runId);
    const index = (last?.i ?? 0) + 1;
    const id = newId('cst');
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO coder_steps (id, run_id, index_no, kind, title, detail, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, runId, index, input.kind, input.title, input.detail ?? '', input.status ?? 'complete', now,
    );
    const run = this.getRun(runId);
    if (run) this.updateRun(runId, { stepCount: index });
    return {
      id, runId, index, kind: input.kind, title: input.title,
      detail: input.detail ?? '', status: input.status ?? 'complete', createdAt: now,
    };
  }

  listSteps(runId: string): CoderStep[] {
    return this.db
      .all<StepRow>('SELECT * FROM coder_steps WHERE run_id = ? ORDER BY index_no ASC', runId)
      .map((row) => ({
        id: row.id,
        runId: row.run_id,
        index: row.index_no,
        kind: row.kind as CoderStep['kind'],
        title: row.title,
        detail: row.detail,
        status: row.status as CoderStep['status'],
        createdAt: row.created_at,
      }));
  }

  private toRun(row: RunRow): CoderRun {
    return {
      id: row.id,
      ownerId: row.owner_id,
      sessionId: row.session_id,
      projectId: row.project_id,
      parentRunId: row.parent_run_id,
      agentName: row.agent_name,
      kind: row.kind as CoderRun['kind'],
      task: row.task,
      status: row.status as CoderRun['status'],
      stepCount: row.step_count,
      maxSteps: row.max_steps,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── Блокировки файлов (координация субагентов) ──────────────────────────

  acquireLock(projectId: string, runId: string, agentName: string, filePath: string): { ok: boolean; holder?: string } {
    const existing = this.db.get<{ agent_name: string; run_id: string }>(
      'SELECT agent_name, run_id FROM coder_locks WHERE project_id = ? AND path = ?',
      projectId, filePath,
    );
    if (existing) {
      if (existing.run_id === runId) return { ok: true };
      const run = this.getRun(existing.run_id);
      if (run && (run.status === 'running' || run.status === 'awaiting_confirmation')) {
        return { ok: false, holder: existing.agent_name };
      }
      // Освобождаем мёртвую блокировку.
      this.db.run('DELETE FROM coder_locks WHERE project_id = ? AND path = ?', projectId, filePath);
    }
    this.db.run(
      'INSERT INTO coder_locks (id, project_id, run_id, agent_name, path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId('lck'), projectId, runId, agentName, filePath, new Date().toISOString(),
    );
    return { ok: true };
  }

  releaseLocks(runId: string): void {
    this.db.run('DELETE FROM coder_locks WHERE run_id = ?', runId);
  }

  listLocks(projectId: string): { path: string; agentName: string; runId: string }[] {
    return this.db
      .all<{ path: string; agent_name: string; run_id: string }>(
        'SELECT path, agent_name, run_id FROM coder_locks WHERE project_id = ?',
        projectId,
      )
      .map((r) => ({ path: r.path, agentName: r.agent_name, runId: r.run_id }));
  }

  // ── Вкладки ─────────────────────────────────────────────────────────────

  listTabs(ownerId: string, sessionId: string): CoderTab[] {
    this.requireSession(ownerId, sessionId);
    return this.db
      .all<{ path: string; position: number; updated_at: string }>(
        'SELECT path, position, updated_at FROM coder_tabs WHERE session_id = ? ORDER BY position ASC',
        sessionId,
      )
      .map((r) => ({ sessionId, path: r.path, position: r.position, updatedAt: r.updated_at }));
  }

  openTab(ownerId: string, sessionId: string, filePath: string, position?: number): CoderTab {
    this.requireSession(ownerId, sessionId);
    const now = new Date().toISOString();
    const existing = this.db.get<{ position: number }>(
      'SELECT position FROM coder_tabs WHERE session_id = ? AND path = ?', sessionId, filePath,
    );
    const pos = position ?? existing?.position ?? this.listTabs(ownerId, sessionId).length;
    this.db.run(
      `INSERT INTO coder_tabs (id, session_id, path, position, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, path) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
      newId('tab'), sessionId, filePath, pos, now,
    );
    return { sessionId, path: filePath, position: pos, updatedAt: now };
  }

  closeTab(ownerId: string, sessionId: string, filePath: string): void {
    this.requireSession(ownerId, sessionId);
    this.db.run('DELETE FROM coder_tabs WHERE session_id = ? AND path = ?', sessionId, filePath);
  }

  // ── Память проекта ───────────────────────────────────────────────────────
  // Факты хранятся в общей памяти экосистемы (memories) с источником «file»
  // и objectId проекта: их видит и Infinity AI, и другие приложения.

  listProjectMemory(ownerId: string, projectId: string, limit = 50) {
    this.requireProject(ownerId, projectId);
    return this.memory
      .list(ownerId, 200)
      .filter((m) => m.source.objectId === projectId)
      .slice(0, limit);
  }

  addProjectMemory(ownerId: string, projectId: string, content: string, importance = 0.6) {
    const project = this.requireProject(ownerId, projectId);
    return this.memory.add(ownerId, {
      content,
      source: { type: 'file', objectId: projectId, title: `Проект: ${project.name}` },
      importance,
    });
  }

  removeProjectMemory(ownerId: string, projectId: string, memoryId: string): void {
    const record = this.memory.get(ownerId, memoryId);
    if (!record || record.source.objectId !== projectId) {
      throw new NotFoundError('Запись памяти не найдена');
    }
    this.memory.remove(ownerId, memoryId);
  }
}
