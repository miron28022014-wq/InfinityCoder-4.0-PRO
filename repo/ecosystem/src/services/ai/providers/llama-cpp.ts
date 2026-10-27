/**
 * Провайдер llama.cpp (llama-server). Локальный: ключ не нужен,
 * адрес всегда loopback — это проверяется при регистрации провайдера.
 */

import type { ChatProvider, ChatRequest, ChatChunk } from '../provider.js';

export class LlamaCppProvider implements ChatProvider {
  readonly acceptsApiKey = false;
  readonly name = 'llama.cpp';
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  withApiKey(): ChatProvider {
    return this;
  }

  async listModels(): Promise<{ id: string; displayName?: string }[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => ({ id: m.id }));
  }

  async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
    // llama-server совместим с OpenAI-форматом, но поле max_tokens называется n_predict
    // в нативном API; через /v1 используется max_tokens.
    const body = {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(request.stop ? { stop: request.stop } : {}),
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              yield { type: 'done', reason: 'stop' };
              return;
            }
            let parsed: { choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
            try {
              parsed = JSON.parse(payload) as typeof parsed;
            } catch {
              continue;
            }
            const choice = parsed.choices?.[0];
            if (choice?.delta?.content) yield { type: 'delta', text: choice.delta.content };
            if (choice?.finish_reason) {
              yield { type: 'done', reason: choice.finish_reason === 'length' ? 'length' : 'stop' };
              return;
            }
          }
        }
      }
      yield { type: 'done', reason: 'stop' };
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }
}
