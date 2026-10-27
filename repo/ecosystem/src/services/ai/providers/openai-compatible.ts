/**
 * Провайдер для OpenAI-совместимых API (/v1/chat/completions, SSE-стрим).
 * Используется для облачных провайдеров и локальных серверов с тем же API.
 */

import type { ChatProvider, ChatRequest, ChatChunk } from '../provider.js';

export class OpenAICompatibleProvider implements ChatProvider {
  readonly acceptsApiKey = true;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(baseUrl: string, apiKey?: string, name = 'openai-compatible') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.name = name;
  }

  withApiKey(apiKey: string): ChatProvider {
    return new OpenAICompatibleProvider(this.baseUrl, apiKey, this.name);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  async listModels(): Promise<{ id: string; displayName?: string }[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => ({ id: m.id }));
  }

  async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
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
      headers: this.headers(),
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

        // SSE: события разделены пустой строкой
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
            let parsed: {
              choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
            };
            try {
              parsed = JSON.parse(payload) as typeof parsed;
            } catch {
              continue;
            }
            const choice = parsed.choices?.[0];
            const text = choice?.delta?.content;
            if (text) yield { type: 'delta', text };
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
