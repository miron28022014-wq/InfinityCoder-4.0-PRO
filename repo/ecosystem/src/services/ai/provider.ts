/**
 * Контракт AI-провайдера. Все реализации (llama.cpp, OpenAI-совместимые)
 * следуют одному интерфейсу — маршрутизатору не важно, кто под капотом.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  signal?: AbortSignal;
}

export type ChatChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; reason: 'stop' | 'length' | 'cancelled' | 'error' }
  | { type: 'error'; message: string; code?: string };

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export interface ChatProvider {
  readonly acceptsApiKey: boolean;
  /** Имя провайдера для логов и ошибок. */
  readonly name: string;

  listModels(): Promise<{ id: string; displayName?: string }[]>;

  stream(request: ChatRequest): AsyncGenerator<ChatChunk>;

  /** Возвращает копию провайдера с ключом (ключ не мутирует общий инстанс). */
  withApiKey(apiKey: string): ChatProvider;
}
