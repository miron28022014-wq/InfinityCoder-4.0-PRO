/**
 * Инструменты InfinityCoder, зарегистрированные в общем Tool Runtime.
 *
 * Все инструменты проходят через проверку разрешений Tool Runtime
 * (ask/allow/deny) и подтверждение пользователя для действий risk=write/exec.
 * Инструменты работают с РЕАЛЬНЫМИ файлами и РЕАЛЬНЫМИ командами — заглушек нет.
 */

import type { Core } from '../core.js';
import { ValidationError, NotFoundError } from '../errors.js';
import type { ToolDefinition, ToolResult } from '../services/tool-runtime.js';
import type { CoderService } from './service.js';
import { currentRunContext } from './context.js';
import { isForbiddenCommand, runCommand, tokenizeCommand } from './workspace.js';

function ok(output: unknown): ToolResult {
  return { ok: true, output };
}

function fail(error: string): ToolResult {
  return { ok: false, output: null, error };
}

/**
 * Проверяет, что файл не закреплён за другим агентом.
 * Возвращает текст ошибки, если доступ закрыт.
 */
function lockConflict(service: CoderService, projectId: string, filePath: string): string | null {
  const context = currentRunContext();
  if (!context) return null;
  const lock = service.listLocks(projectId).find((l) => l.path === filePath);
  if (!lock) return null;
  if (lock.runId === context.runId) return null;
  return `Файл «${filePath}» закреплён за агентом «${lock.agentName}» — конфликт координации`;
}

export function registerCoderTools(core: Core, service: CoderService): void {
  const { tools } = core;

  // ── Чтение файла ────────────────────────────────────────────────────────
  const readFile: ToolDefinition = {
    name: 'coder_read_file',
    description: 'Читает файл проекта по относительному пути. Возвращает текст файла.',
    risk: 'read',
    args: { projectId: 'string', path: 'string' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      const path = String(ctx.args['path'] ?? '');
      try {
        const file = await service.readFile(ctx.ownerId, projectId, path);
        if (file.binary) {
          return ok({ path: file.path, binary: true, size: file.size, content: '' });
        }
        return ok({ path: file.path, content: file.content, size: file.size, modifiedAt: file.modifiedAt });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  // ── Запись файла ────────────────────────────────────────────────────────
  const writeFile: ToolDefinition = {
    name: 'coder_write_file',
    description: 'Создаёт или перезаписывает файл проекта по относительному пути.',
    risk: 'write',
    args: { projectId: 'string', path: 'string', content: 'string' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      const path = String(ctx.args['path'] ?? '');
      const content = String(ctx.args['content'] ?? '');
      const conflict = lockConflict(service, projectId, path);
      if (conflict) return fail(conflict);
      const context = currentRunContext();
      if (context?.allowedFiles && !context.allowedFiles.includes(path)) {
        return fail(`Файл «${path}» не закреплён за этим агентом`);
      }
      try {
        const result = await service.writeFile(ctx.ownerId, projectId, path, content, context?.agentName ?? 'agent');
        return ok(result);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  // ── Дерево файлов ───────────────────────────────────────────────────────
  const listFiles: ToolDefinition = {
    name: 'coder_list_files',
    description: 'Возвращает дерево файлов проекта (относительные пути).',
    risk: 'read',
    args: { projectId: 'string', path: 'string?' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      const path = ctx.args['path'] === undefined ? '' : String(ctx.args['path']);
      try {
        const tree = await service.tree(ctx.ownerId, projectId, path);
        return ok({ entries: tree.entries, truncated: tree.truncated });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  // ── Поиск по проекту ───────────────────────────────────────────────────
  const searchFiles: ToolDefinition = {
    name: 'coder_search_files',
    description: 'Ищет подстроку по файлам проекта. Возвращает совпадения с номерами строк.',
    risk: 'read',
    args: { projectId: 'string', query: 'string', limit: 'number?' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      const query = String(ctx.args['query'] ?? '');
      const limit = ctx.args['limit'] === undefined ? 50 : Number(ctx.args['limit']);
      try {
        const result = await service.search(ctx.ownerId, projectId, query, { limit });
        return ok(result);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  // ── Терминал ────────────────────────────────────────────────────────────
  const runCmd: ToolDefinition = {
    name: 'coder_run_command',
    description:
      'Выполняет команду в каталоге проекта без shell. Разрешённые команды задаются в настройках проекта.',
    risk: 'exec',
    args: { projectId: 'string', command: 'string', timeoutMs: 'number?' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      const command = String(ctx.args['command'] ?? '').trim();
      if (!command) return fail('Пустая команда');
      if (isForbiddenCommand(command)) {
        return fail(`Команда «${command}» запрещена политикой безопасности`);
      }
      let project;
      try {
        project = service.requireProject(ctx.ownerId, projectId);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      if (!project.settings.allowArbitraryCommands && !isCommandAllowed(project.settings.allowedCommands, command)) {
        return fail(
          `Команда «${command}» не разрешена для проекта. Разрешённые команды: ` +
            (project.settings.allowedCommands.length ? project.settings.allowedCommands.join(', ') : 'нет'),
        );
      }
      const timeoutMs = ctx.args['timeoutMs'] === undefined ? 60_000 : Number(ctx.args['timeoutMs']);
      try {
        const root = service.projectRoot(ctx.ownerId, projectId);
        const result = await runCommand(root, command, { timeoutMs });
        return ok(result);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  // ── Тесты ───────────────────────────────────────────────────────────────
  const runTests: ToolDefinition = {
    name: 'coder_run_tests',
    description: 'Запускает тестовую команду проекта (настройка testCommand) и возвращает вывод.',
    risk: 'exec',
    args: { projectId: 'string', timeoutMs: 'number?' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      let project;
      try {
        project = service.requireProject(ctx.ownerId, projectId);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      if (!project.settings.testCommand) {
        return fail('Тестовая команда не настроена для проекта (settings.testCommand)');
      }
      const timeoutMs = ctx.args['timeoutMs'] === undefined ? 120_000 : Number(ctx.args['timeoutMs']);
      try {
        const root = service.projectRoot(ctx.ownerId, projectId);
        const result = await runCommand(root, project.settings.testCommand, { timeoutMs });
        return ok(result);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  // ── Сборка ──────────────────────────────────────────────────────────────
  const runBuild: ToolDefinition = {
    name: 'coder_run_build',
    description: 'Запускает команду сборки проекта (настройка buildCommand) и возвращает вывод.',
    risk: 'exec',
    args: { projectId: 'string', timeoutMs: 'number?' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      let project;
      try {
        project = service.requireProject(ctx.ownerId, projectId);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      if (!project.settings.buildCommand) {
        return fail('Команда сборки не настроена для проекта (settings.buildCommand)');
      }
      const timeoutMs = ctx.args['timeoutMs'] === undefined ? 120_000 : Number(ctx.args['timeoutMs']);
      try {
        const root = service.projectRoot(ctx.ownerId, projectId);
        const result = await runCommand(root, project.settings.buildCommand, { timeoutMs });
        return ok(result);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  // ── Git ─────────────────────────────────────────────────────────────────
  const gitStatus: ToolDefinition = {
    name: 'coder_git_status',
    description: 'Возвращает статус репозитория git проекта (ветка, изменённые файлы).',
    risk: 'read',
    args: { projectId: 'string' },
    async execute(ctx) {
      return runGit(ctx.ownerId, service, String(ctx.args['projectId'] ?? ''), ['status', '--porcelain=v1', '--branch']);
    },
  };

  const gitDiff: ToolDefinition = {
    name: 'coder_git_diff',
    description: 'Возвращает diff репозитория git проекта (по умолчанию — незакоммиченные изменения).',
    risk: 'read',
    args: { projectId: 'string', path: 'string?' },
    async execute(ctx) {
      const args = ['diff'];
      const path = ctx.args['path'];
      if (path !== undefined) args.push('--', String(path));
      return runGit(ctx.ownerId, service, String(ctx.args['projectId'] ?? ''), args);
    },
  };

  const gitLog: ToolDefinition = {
    name: 'coder_git_log',
    description: 'Возвращает последние коммиты репозитория git проекта.',
    risk: 'read',
    args: { projectId: 'string', limit: 'number?' },
    async execute(ctx) {
      const limit = ctx.args['limit'] === undefined ? 10 : Math.min(Math.max(Number(ctx.args['limit']), 1), 100);
      return runGit(ctx.ownerId, service, String(ctx.args['projectId'] ?? ''), ['log', `--max-count=${limit}`, '--oneline']);
    },
  };

  // ── Память проекта ──────────────────────────────────────────────────────
  const remember: ToolDefinition = {
    name: 'coder_remember',
    description: 'Сохраняет факт о проекте в общую память Infinity (его видят и другие приложения).',
    risk: 'write',
    args: { projectId: 'string', content: 'string' },
    async execute(ctx) {
      const projectId = String(ctx.args['projectId'] ?? '');
      const content = String(ctx.args['content'] ?? '').trim();
      if (!content) return fail('Пустая запись памяти');
      try {
        const record = service.addProjectMemory(ctx.ownerId, projectId, content);
        return ok({ id: record.id, content: record.content });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  for (const tool of [
    readFile, writeFile, listFiles, searchFiles,
    runCmd, runTests, runBuild,
    gitStatus, gitDiff, gitLog,
    remember,
  ]) {
    tools.register(tool);
  }
}

/** Команда разрешена, если она совпадает с одним из разрешённых префиксов. */
export function isCommandAllowed(allowed: string[], command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ');
  const tokens = tokenizeCommand(normalized);
  if (tokens.length === 0) return false;
  return allowed.some((rule) => {
    const normalizedRule = rule.trim().replace(/\s+/g, ' ');
    if (!normalizedRule) return false;
    if (normalized === normalizedRule) return true;
    // Правило совпадает, если это префикс по целым аргументам.
    const ruleTokens = tokenizeCommand(normalizedRule);
    if (ruleTokens.length > tokens.length) return false;
    return ruleTokens.every((token, index) => tokens[index] === token);
  });
}

async function runGit(
  ownerId: string,
  service: CoderService,
  projectId: string,
  args: string[],
): Promise<ToolResult> {
  try {
    service.requireProject(ownerId, projectId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  try {
    const root = service.projectRoot(ownerId, projectId);
    const result = await runCommand(root, `git ${args.join(' ')}`, { timeoutMs: 30_000 });
    if (result.exitCode !== 0 && /not a git repository|fatal:/.test(result.stderr)) {
      return fail(`Каталог проекта не является git-репозиторием: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return ok(result);
  } catch (err) {
    if (err instanceof NotFoundError) return fail(err.message);
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Инструменты, доступные агенту (для системного промпта). */
export const CODER_TOOL_NAMES = [
  'coder_read_file',
  'coder_write_file',
  'coder_list_files',
  'coder_search_files',
  'coder_run_command',
  'coder_run_tests',
  'coder_run_build',
  'coder_git_status',
  'coder_git_diff',
  'coder_git_log',
  'coder_remember',
] as const;

export function assertToolKnown(name: string): void {
  if (!(CODER_TOOL_NAMES as readonly string[]).includes(name)) {
    throw new ValidationError(`Инструмент «${name}» не существует`);
  }
}
