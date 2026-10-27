/**
 * Файловый слой InfinityCoder.
 *
 * Правила безопасности:
 *  — путь клиента всегда относительный, абсолютные пути и `..` запрещены;
 *  — итоговый путь проверяется на принадлежность корню проекта (включая
 *    проверку символических ссылок — realpath);
 *  — содержимое файлов и вывод команд — это ДАННЫЕ, они никогда не
 *    интерпретируются как инструкции;
 *  — команды выполняются без shell (execFile), поэтому инъекка через
 *    `;`, `&&`, `|` невозможна.
 */

import { execFile } from 'node:child_process';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { PathTraversalError, ValidationError } from '../errors.js';

/** Каталоги, которые не обходятся по умолчанию. */
export const DEFAULT_IGNORE = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.cache',
  '.venv',
  '__pycache__',
  '.idea',
  '.vscode',
];

export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1 МБ
const MAX_TREE_ENTRIES = 4000;
const MAX_SEARCH_FILES = 20000;

/** Каталоги/файлы, которые всегда исключаются из обхода. */
export function isIgnored(relPath: string, ignore: string[] = DEFAULT_IGNORE): boolean {
  const parts = relPath.split('/').filter(Boolean);
  return parts.some((part) => ignore.includes(part));
}

/**
 * Приводит относительный путь клиента к абсолютному внутри корня.
 * Бросает PathTraversalError, если путь выходит за пределы проекта.
 */
export function safeJoin(root: string, relative: string): string {
  const raw = (relative ?? '').trim();
  if (raw.includes('\0')) throw new ValidationError('Путь содержит недопустимые символы');
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new PathTraversalError('Абсолютные пути запрещены');
  }
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, normalized);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new PathTraversalError(`Путь «${raw}» выходит за пределы проекта`);
  }
  return target;
}

/**
 * Проверяет, что цель остаётся внутри корня даже после разрешения
 * символических ссылок (проверяется ближайший существующий предок).
 */
export async function assertInsideRoot(root: string, target: string): Promise<void> {
  const rootResolved = path.resolve(root);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(rootResolved);
  } catch {
    realRoot = rootResolved;
  }

  let probe = target;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new PathTraversalError('Символическая ссылка указывает за пределы проекта');
      }
      return;
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      const parent = path.dirname(probe);
      if (parent === probe) return;
      probe = parent;
    }
  }
}

export interface TreeEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt: string;
}

export interface TreeOptions {
  ignore?: string[];
  maxEntries?: number;
}

/** Обход каталога проекта. Возвращает плоский список относительных путей. */
export async function listTree(
  root: string,
  relative = '',
  options: TreeOptions = {},
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const maxEntries = options.maxEntries ?? MAX_TREE_ENTRIES;
  const base = safeJoin(root, relative);
  const entries: TreeEntry[] = [];
  let truncated = false;

  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (truncated) return;
    let items: Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of items) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (ignore.includes(item.name)) continue;
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        entries.push({ path: rel, name: item.name, type: 'dir', size: 0, modifiedAt: '' });
        await walk(abs, rel);
      } else if (item.isFile()) {
        let size = 0;
        let modifiedAt = '';
        try {
          const stat = await fs.stat(abs);
          size = stat.size;
          modifiedAt = stat.mtime.toISOString();
        } catch {
          /* файл мог исчезнуть между readdir и stat */
        }
        entries.push({ path: rel, name: item.name, type: 'file', size, modifiedAt });
      }
    }
  };

  await walk(base, relative.replace(/^\/+|\/+$/g, ''));
  return { entries, truncated };
}

export interface ReadResult {
  path: string;
  content: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  modifiedAt: string;
}

/** Читает файл проекта. Бинарные файлы не возвращаются текстом. */
export async function readProjectFile(
  root: string,
  relative: string,
  maxBytes = DEFAULT_MAX_FILE_SIZE,
): Promise<ReadResult> {
  const abs = safeJoin(root, relative);
  await assertInsideRoot(root, abs);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(abs);
  } catch {
    throw new ValidationError(`Файл «${relative}» не найден`);
  }
  if (!stat.isFile()) throw new ValidationError(`«${relative}» — не файл`);
  if (stat.size > maxBytes) {
    throw new ValidationError(`Файл «${relative}» больше лимита (${maxBytes} байт)`);
  }
  const buffer = await fs.readFile(abs);
  const binary = buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
  return {
    path: relative,
    content: binary ? '' : buffer.toString('utf8'),
    size: stat.size,
    binary,
    truncated: false,
    modifiedAt: stat.mtime.toISOString(),
  };
}

/** Записывает файл проекта, создавая каталоги при необходимости. */
export async function writeProjectFile(
  root: string,
  relative: string,
  content: string,
  maxBytes = DEFAULT_MAX_FILE_SIZE,
): Promise<{ path: string; size: number }> {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new ValidationError(`Содержимое превышает лимит ${maxBytes} байт`);
  }
  const abs = safeJoin(root, relative);
  await assertInsideRoot(root, abs);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return { path: relative, size: Buffer.byteLength(content, 'utf8') };
}

export async function removeProjectFile(root: string, relative: string): Promise<void> {
  const abs = safeJoin(root, relative);
  await assertInsideRoot(root, abs);
  try {
    await fs.unlink(abs);
  } catch {
    throw new ValidationError(`Файл «${relative}» не найден`);
  }
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

/** Поиск по файлам проекта. Возвращает реальные совпадения с номерами строк. */
export async function searchProjectFiles(
  root: string,
  query: string,
  options: { limit?: number; ignore?: string[]; caseSensitive?: boolean } = {},
): Promise<{ matches: SearchMatch[]; filesScanned: number; truncated: boolean }> {
  const limit = options.limit ?? 200;
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const needle = options.caseSensitive ? query : query.toLowerCase();
  if (!query) return { matches: [], filesScanned: 0, truncated: false };

  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (truncated) return;
    let items: Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (truncated) return;
      if (ignore.includes(item.name)) continue;
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!item.isFile()) continue;
      if (filesScanned >= MAX_SEARCH_FILES) {
        truncated = true;
        return;
      }
      filesScanned += 1;
      let buffer: Buffer;
      try {
        const stat = await fs.stat(abs);
        if (stat.size > DEFAULT_MAX_FILE_SIZE) continue;
        buffer = await fs.readFile(abs);
      } catch {
        continue;
      }
      if (buffer.subarray(0, 4000).includes(0)) continue; // бинарный
      const text = buffer.toString('utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        const haystack = options.caseSensitive ? line : line.toLowerCase();
        if (haystack.includes(needle)) {
          matches.push({ path: rel, line: i + 1, text: line.slice(0, 400) });
          if (matches.length >= limit) {
            truncated = true;
            return;
          }
        }
      }
    }
  };

  await walk(path.resolve(root), '');
  return { matches, filesScanned, truncated };
}

// ── Diff ──────────────────────────────────────────────────────────────────

export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffResult {
  path: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
}

const MAX_DIFF_LINES = 5000;

/**
 * Построчный diff (LCS). Возвращает честную разницу, а не «файлы отличаются».
 */
export function diffText(oldText: string, newText: string, filePath = ''): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return {
      path: filePath,
      lines: [],
      additions: 0,
      deletions: 0,
      binary: false,
      truncated: true,
    };
  }

  const n = oldLines.length;
  const m = newLines.length;
  // LCS через динамику; память O(n*m) — файлы ограничены MAX_DIFF_LINES.
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = table[i]!;
    const next = table[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = oldLines[i] === newLines[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ kind: 'context', text: oldLines[i]!, oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: 'remove', text: oldLines[i]!, oldLine: i + 1, newLine: null });
      deletions += 1;
      i += 1;
    } else {
      lines.push({ kind: 'add', text: newLines[j]!, oldLine: null, newLine: j + 1 });
      additions += 1;
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ kind: 'remove', text: oldLines[i]!, oldLine: i + 1, newLine: null });
    deletions += 1;
    i += 1;
  }
  while (j < m) {
    lines.push({ kind: 'add', text: newLines[j]!, oldLine: null, newLine: j + 1 });
    additions += 1;
    j += 1;
  }

  return { path: filePath, lines, additions, deletions, binary: false, truncated: false };
}

/** Разворачивает diff в unified-формат. */
export function formatUnifiedDiff(result: DiffResult): string {
  if (result.truncated) return `--- ${result.path}\n+++ ${result.path}\n@@ файл слишком велик для построчного diff @@\n`;
  const out: string[] = [`--- a/${result.path}`, `+++ b/${result.path}`];
  for (const line of result.lines) {
    const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';
    out.push(`${marker}${line.text}`);
  }
  return out.join('\n');
}

// ── Команды ───────────────────────────────────────────────────────────────

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Выполняет команду в каталоге проекта БЕЗ shell.
 * Аргументы разбираются простым токенизатором, поэтому `;`/`&&`/`|` не
 * выполняются как отдельные команды — инъекка невозможна.
 */
export function runCommand(
  cwd: string,
  command: string,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxOutput = options.maxOutputBytes ?? 200_000;
  const argv = tokenizeCommand(command);
  if (argv.length === 0) {
    return Promise.reject(new ValidationError('Пустая команда'));
  }
  const [bin, ...args] = argv as [string, ...string[]];
  const started = Date.now();

  return new Promise<CommandResult>((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: maxOutput, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        const result: CommandResult = {
          command,
          exitCode: err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0,
          stdout: truncate(stdout, maxOutput),
          stderr: truncate(stderr, maxOutput),
          durationMs: Date.now() - started,
          timedOut: Boolean(err && (err as { killed?: boolean }).killed),
        };
        if (err && result.exitCode === null) {
          reject(err);
          return;
        }
        resolve(result);
      },
    );
  });
}

/** Разбирает команду в аргументы. Поддерживает кавычки, но не выполняет shell-операторы. */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (вывод обрезан, ${text.length - max} байт пропущено)`;
}

/** Команды, которые запрещены независимо от настроек проекта. */
const FORBIDDEN_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bdd\s+if=/,
  /\b:\(\)\{/,
  /\bcurl\b.*\|\s*(ba)?sh/,
  /\bwget\b.*\|\s*(ba)?sh/,
  /\bchmod\s+-R\s+777\s+\//,
];

export function isForbiddenCommand(command: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(command));
}
