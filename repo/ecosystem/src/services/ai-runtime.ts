/**
 * AI Runtime — маршрутизация запросов к моделям.
 *
 * Ключевое требование экосистемы: локальный режим блокирует облачные
 * вызовы на уровне маршрутизатора, а не на уровне UI. Проверка живёт
 * здесь, поэтому её нельзя обойти, вызвав провайдера напрямую.
 */

import type { Db } from '../db/db.js';
import { newId } from '../ids.js';
import { LocalModeBlockedError, NotFoundError, ValidationError, UpstreamError } from '../errors.js';
import { SecretStore } from './crypto.js';
import type { ChatProvider, ChatRequest, ChatChunk, ProviderTestResult } from './ai/provider.js';
import { OpenAICompatibleProvider } from './ai/providers/openai-compatible.js';
import { LlamaCppProvider } from './ai/providers/llama-cpp.js';

export type ProviderKind = 'local_llama' | 'openai_compatible';
export type Scope = 'local' | 'cloud';

export interface ProviderRecord {
  id: string;
  ownerId: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  scope: Scope;
  enabled: boolean;
  isDefault: boolean;
  options: Record<string, unknown>;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRecord {
  id: string;
  providerId: string;
  remoteName: string;
  displayName: string;
  contextSize: number;
  capabilities: string[];
}

export interface GenerationParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  timeoutMs?: number;
}

interface ProviderRow {
  id: string;
  owner_id: string;
  name: string;
  kind: string;
  base_url: string;
  scope: string;
  api_key_enc: string | null;
  enabled: number;
  is_default: number;
  options: string;
  created_at: string;
  updated_at: string;
}

interface ModelRow {
  id: string;
  provider_id: string;
  remote_name: string;
  display_name: string;
  context_size: number;
  capabilities: string;
}

function toProvider(row: ProviderRow): ProviderRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    kind: row.kind as ProviderKind,
    baseUrl: row.base_url,
    scope: row.scope as Scope,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    options: JSON.parse(row.options) as Record<string, unknown>,
    hasApiKey: Boolean(row.api_key_enc),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toModel(row: ModelRow): ModelRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    remoteName: row.remote_name,
    displayName: row.display_name,
    contextSize: row.context_size,
    capabilities: JSON.parse(row.capabilities) as string[],
  };
}

export interface AddProviderInput {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  scope: Scope;
  apiKey?: string;
  options?: Record<string, unknown>;
  isDefault?: boolean;
}

export class AiRuntime {
  private readonly db: Db;
  private readonly secrets: SecretStore;
  private readonly providers = new Map<string, ChatProvider>();

  constructor(options: { db: Db; secrets: SecretStore }) {
    this.db = options.db;
    this.secrets = options.secrets;
  }

  // ── Реестр провайдеров ─────────────────────────────────────────────────
  addProvider(ownerId: string, input: AddProviderInput): ProviderRecord {
    if (!input.name?.trim()) throw new ValidationError('Имя провайдера обязательно');
    if (!/^https?:\/\//.test(input.baseUrl)) {
      throw new ValidationError('baseUrl должен быть http(s)-адресом');
    }
    // Локальный llama.cpp по соглашению обслуживается на loopback.
    if (input.kind === 'local_llama' && !isLoopback(input.baseUrl)) {
      throw new ValidationError('Локальный провайдер должен указывать на loopback-адрес');
    }
    const now = new Date().toISOString();
    const id = newId('prv');
    const encrypted = input.apiKey ? this.secrets.encrypt(input.apiKey) : null;
    this.db.run(
      `INSERT INTO providers (id, owner_id, name, kind, base_url, scope, api_key_enc, enabled, is_default, options, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      id, ownerId, input.name.trim(), input.kind, input.baseUrl.replace(/\/+$/, ''), input.scope,
      encrypted, input.isDefault ? 1 : 0, JSON.stringify(input.options ?? {}), now, now,
    );
    if (input.isDefault) this.setDefault(ownerId, id);
    return this.getProvider(ownerId, id)!;
  }

  listProviders(ownerId: string): ProviderRecord[] {
    return this.db
      .all<ProviderRow>('SELECT * FROM providers WHERE owner_id = ? ORDER BY created_at', ownerId)
      .map(toProvider);
  }

  getProvider(ownerId: string, id: string): ProviderRecord | null {
    const row = this.db.get<ProviderRow>('SELECT * FROM providers WHERE id = ? AND owner_id = ?', id, ownerId);
    return row ? toProvider(row) : null;
  }

  setProviderEnabled(ownerId: string, id: string, enabled: boolean): ProviderRecord {
    const provider = this.getProvider(ownerId, id);
    if (!provider) throw new NotFoundError('Провайдер не найден');
    this.db.run('UPDATE providers SET enabled = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
      enabled ? 1 : 0, new Date().toISOString(), id, ownerId);
    this.providers.delete(id);
    return this.getProvider(ownerId, id)!;
  }

  setDefault(ownerId: string, id: string): void {
    this.db.run('UPDATE providers SET is_default = 0 WHERE owner_id = ?', ownerId);
    this.db.run('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ? AND owner_id = ?',
      new Date().toISOString(), id, ownerId);
  }

  deleteProvider(ownerId: string, id: string): void {
    const res = this.db.run('DELETE FROM providers WHERE id = ? AND owner_id = ?', id, ownerId);
    if (res.changes === 0) throw new NotFoundError('Провайдер не найден');
    this.providers.delete(id);
  }

  // ── Модели ─────────────────────────────────────────────────────────────
  addModel(ownerId: string, providerId: string, input: {
    remoteName: string;
    displayName?: string;
    contextSize?: number;
    capabilities?: string[];
  }): ModelRecord {
    if (!this.getProvider(ownerId, providerId)) throw new NotFoundError('Провайдер не найден');
    const id = newId('mdl');
    this.db.run(
      `INSERT INTO models (id, provider_id, remote_name, display_name, context_size, capabilities, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, providerId, input.remoteName, input.displayName ?? input.remoteName,
      input.contextSize ?? 4096, JSON.stringify(input.capabilities ?? []), new Date().toISOString(),
    );
    return this.getModel(id)!;
  }

  getModel(id: string): ModelRecord | null {
    const row = this.db.get<ModelRow>('SELECT * FROM models WHERE id = ?', id);
    return row ? toModel(row) : null;
  }

  listModels(ownerId: string): ModelRecord[] {
    return this.db
      .all<ModelRow>(
        `SELECT m.* FROM models m JOIN providers p ON p.id = m.provider_id
         WHERE p.owner_id = ? ORDER BY m.created_at`,
        ownerId,
      )
      .map(toModel);
  }

  deleteModel(ownerId: string, modelId: string): void {
    const model = this.getModel(modelId);
    if (!model || !this.getProvider(ownerId, model.providerId)) {
      throw new NotFoundError('Модель не найдена');
    }
    this.db.run('DELETE FROM models WHERE id = ?', modelId);
  }

  /** Модель по умолчанию: заданная явно, иначе первая доступная. */
  resolveDefaultModel(ownerId: string, scope: Scope): ModelRecord | null {
    const models = this.listModels(ownerId);
    const scoped = models.filter((m) => {
      const provider = this.getProvider(ownerId, m.providerId);
      return provider && provider.enabled && provider.scope === scope;
    });
    if (scoped.length === 0) return null;
    const withDefault = scoped.find((m) => {
      const provider = this.getProvider(ownerId, m.providerId)!;
      return provider.isDefault;
    });
    return withDefault ?? scoped[0]!;
  }

  /**
   * ГЛАВНАЯ ТОЧКА КОНТРОЛЯ: маршрутизатор.
   * Если режим local — облачный провайдер недостижим на уровне Runtime.
   */
  resolveProvider(ownerId: string, providerId: string, mode: Scope): ChatProvider {
    const record = this.getProvider(ownerId, providerId);
    if (!record) throw new NotFoundError('Провайдер не найден');
    if (!record.enabled) throw new ValidationError('Провайдер отключён');
    if (mode === 'local' && record.scope === 'cloud') {
      throw new LocalModeBlockedError(record.name, { providerId: record.id });
    }
    return this.instantiate(record);
  }

  private instantiate(record: ProviderRecord): ChatProvider {
    const cached = this.providers.get(record.id);
    if (cached) return cached;
    const apiKey = record.options && typeof record.options['apiKeyPlain'] === 'string'
      ? (record.options['apiKeyPlain'] as string)
      : undefined;
    const provider: ChatProvider =
      record.kind === 'local_llama'
        ? new LlamaCppProvider(record.baseUrl)
        : new OpenAICompatibleProvider(record.baseUrl, apiKey);
    this.providers.set(record.id, provider);
    return provider;
  }

  /** Секрет провайдера расшифровывается только в момент запроса. */
  private secretFor(providerId: string): string | undefined {
    const row = this.db.get<{ api_key_enc: string | null }>(
      'SELECT api_key_enc FROM providers WHERE id = ?', providerId,
    );
    if (!row?.api_key_enc) return undefined;
    try {
      return this.secrets.decrypt(row.api_key_enc);
    } catch {
      return undefined;
    }
  }

  /**
   * Потоковая генерация. Возвращает async-итератор чанков.
   * Ошибка провайдера превращается в UpstreamError; отмена — в AbortError.
   */
  async *stream(options: {
    ownerId: string;
    providerId: string;
    modelId: string;
    mode: Scope;
    request: ChatRequest;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatChunk> {
    const provider = this.resolveProvider(options.ownerId, options.providerId, options.mode);
    const model = this.getModel(options.modelId);
    if (!model) throw new NotFoundError('Модель не найдена');
    const secret = this.secretFor(options.providerId);
    const bound = secret && provider.acceptsApiKey
      ? provider.withApiKey(secret)
      : provider;
    try {
      yield* bound.stream({ ...options.request, model: model.remoteName, signal: options.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new UpstreamError(this.getProvider(options.ownerId, options.providerId)?.name ?? 'unknown', err);
    }
  }

  /**
   * Тест подключения: делает РЕАЛЬНЫЙ запрос к провайдеру.
   * Возвращает факт успеха и задержку, а не фиктивный "ok".
   */
  async testProvider(ownerId: string, providerId: string): Promise<ProviderTestResult> {
    const record = this.getProvider(ownerId, providerId);
    if (!record) throw new NotFoundError('Провайдер не найден');
    const provider = this.instantiate(record);
    const secret = this.secretFor(providerId);
    const bound = secret && provider.acceptsApiKey ? provider.withApiKey(secret) : provider;
    const started = Date.now();
    try {
      const models = await bound.listModels();
      return { ok: true, latencyMs: Date.now() - started, detail: `доступно моделей: ${models.length}` };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Диагностика: сводка по провайдерам и моделям. */
  diagnostics(ownerId: string): {
    providers: number;
    enabled: number;
    models: number;
    local: number;
    cloud: number;
  } {
    const providers = this.listProviders(ownerId);
    return {
      providers: providers.length,
      enabled: providers.filter((p) => p.enabled).length,
      models: this.listModels(ownerId).length,
      local: providers.filter((p) => p.scope === 'local').length,
      cloud: providers.filter((p) => p.scope === 'cloud').length,
    };
  }
}

export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}
