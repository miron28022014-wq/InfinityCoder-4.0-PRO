/**
 * Tool Runtime — выполнение инструментов с разрешениями и подтверждениями.
 *
 * Опасные инструменты (запись, удаление, shell) по умолчанию требуют
 * подтверждения. Файлы и веб-страницы — это ДАННЫЕ, а не инструкции:
 * их текст никогда не попадает в системный промпт как команда.
 */

import type { Db } from '../db/db.js';
import { newId } from '../ids.js';
import { ForbiddenError, ValidationError } from '../errors.js';

export type ToolScope = 'ask' | 'allow' | 'deny';
export type ToolRisk = 'read' | 'write' | 'exec';

export interface ToolContext {
  ownerId: string;
  /** Подтверждение дано пользователем в текущем вызове. */
  confirmed?: boolean;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  /**
   * Схема аргументов. Имя с суффиксом '?' — необязательный аргумент.
   */
  args: Record<string, ArgSpec>;
  execute(ctx: ToolContext): Promise<ToolResult>;
}

export type ArgType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export type ArgSpec = ArgType | `${ArgType}?`;

export interface ToolGrant {
  tool: string;
  scope: ToolScope;
  expiresAt: string | null;
}

interface GrantRow {
  tool: string;
  scope: string;
  expires_at: string | null;
}

export class ToolRuntime {
  private readonly db: Db;
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(options: { db: Db }) {
    this.db = options.db;
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  list(): { name: string; description: string; risk: ToolRisk; args: Record<string, string> }[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      risk: t.risk,
      args: t.args as Record<string, string>,
    }));
  }
  getGrant(ownerId: string, tool: string): ToolGrant {
    const row = this.db.get<GrantRow>(
      'SELECT tool, scope, expires_at FROM tool_grants WHERE owner_id = ? AND tool = ?',
      ownerId, tool,
    );
    if (!row) return { tool, scope: 'ask', expiresAt: null };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      // Истёкшее разрешение снимается автоматически.
      this.db.run('DELETE FROM tool_grants WHERE owner_id = ? AND tool = ?', ownerId, tool);
      return { tool, scope: 'ask', expiresAt: null };
    }
    return { tool, scope: row.scope as ToolScope, expiresAt: row.expires_at };
  }

  setGrant(ownerId: string, tool: string, scope: ToolScope, expiresAt: string | null = null): void {
    this.db.run(
      `INSERT INTO tool_grants (id, owner_id, tool, scope, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, tool) DO UPDATE SET scope = excluded.scope, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      newId('req'), ownerId, tool, scope, expiresAt, new Date().toISOString(),
    );
  }

  revokeGrant(ownerId: string, tool: string): void {
    this.db.run('DELETE FROM tool_grants WHERE owner_id = ? AND tool = ?', ownerId, tool);
  }

  /**
   * Выполняет инструмент, предварительно проверив разрешение.
   * Возвращает NEEDS_CONFIRMATION, если действие опасное и не подтверждено.
   */
  async execute(
    ownerId: string,
    toolName: string,
    args: Record<string, unknown>,
    confirmed = false,
  ): Promise<ToolResult & { needsConfirmation?: boolean; tool: string }> {
    const tool = this.tools.get(toolName);
    if (!tool) throw new ValidationError(`Инструмент «${toolName}» не зарегистрирован`);

    const grant = this.getGrant(ownerId, toolName);
    if (grant.scope === 'deny') {
      throw new ForbiddenError(`Инструмент «${toolName}» запрещён для этого пользователя`, { tool: toolName });
    }

    const needsConfirmation = tool.risk !== 'read' && grant.scope === 'ask' && !confirmed;
    if (needsConfirmation) {
      return {
        ok: false,
        output: null,
        tool: toolName,
        needsConfirmation: true,
        error: `Инструмент «${toolName}» требует подтверждения`,
      };
    }

    validateArgs(tool, args);
    return { ...(await tool.execute({ ownerId, args, confirmed })), tool: toolName };
  }
}

function validateArgs(tool: ToolDefinition, args: Record<string, unknown>): void {
  for (const [key, spec] of Object.entries(tool.args)) {
    const optional = spec.endsWith('?');
    const type = (optional ? spec.slice(0, -1) : spec) as ArgType;
    const value = args[key];

    if (value === undefined || value === null) {
      if (optional) continue;
      if (type === 'object' || type === 'array') continue;
      throw new ValidationError(`Отсутствует аргумент «${key}» для инструмента «${tool.name}»`);
    }
    const actual = typeof value;
    if (type === 'array' || type === 'object') {
      if (actual !== type) throw new ValidationError(`Аргумент «${key}» должен быть ${type}`);
    } else if (actual !== type) {
      throw new ValidationError(`Аргумент «${key}» должен быть ${type}, получено ${actual}`);
    }
  }
}
