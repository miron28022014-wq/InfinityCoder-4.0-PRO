/**
 * LLM transport.
 *
 * One OpenAI-compatible SSE reader for both the local llama-server and any
 * cloud gateway. Handles chunk boundaries that split a `data:` line, non-SSE
 * JSON replies, `reasoning_content` deltas, usage accounting, retries and
 * cooperative abort.
 */
import type { Msg, Usage } from "../types";

export interface LLMTarget {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Local llama.cpp extensions; never sent to strict cloud APIs. */
  local: boolean;
}

export interface LLMOptions {
  temperature: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called with the *raw* delta; the caller decides what to display. */
  onDelta?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  /** Abort a non-productive stream. Default 240s. */
  timeoutMs?: number;
  retries?: number;
}

export interface LLMResult {
  text: string;
  /** Chain-of-thought from reasoning models, when the gateway forwards it. */
  reasoning: string;
  usage: Usage;
  finishReason: string;
  ms: number;
}

export class LLMError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "LLMError";
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function isAbort(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")
  ) || (err instanceof Error && err.name === "AbortError");
}

/** Rough token estimate when the gateway does not report usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export async function complete(
  messages: Msg[],
  target: LLMTarget,
  opts: LLMOptions
): Promise<LLMResult> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new LLMError("Отменено пользователем");
    try {
      return await attemptOnce(messages, target, opts);
    } catch (e) {
      if (isAbort(e) || opts.signal?.aborted) throw e;
      lastErr = e;
      const retryable = e instanceof LLMError ? e.retryable : true;
      if (!retryable || attempt === retries) break;
      await sleep(500 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastErr instanceof Error ? lastErr : new LLMError(String(lastErr));
}

async function attemptOnce(
  messages: Msg[],
  target: LLMTarget,
  opts: LLMOptions
): Promise<LLMResult> {
  const started = Date.now();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;

  const body: Record<string, unknown> = {
    model: target.model,
    messages,
    stream: true,
    temperature: opts.temperature
  };
  if (target.local) {
    body.n_predict = -1;
    body.cache_prompt = true;
  } else if (opts.maxTokens) {
    body.max_tokens = opts.maxTokens;
  }

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 240_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${target.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(body)
    });
  } catch (e) {
    if (isAbort(e)) {
      if (opts.signal?.aborted) throw e;
      throw new LLMError("Провайдер не ответил вовремя", undefined, true);
    }
    throw new LLMError(`Сеть недоступна: ${(e as Error).message}`, undefined, true);
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 500);
    const retryable = res.status === 429 || res.status >= 500;
    throw new LLMError(`${res.status}: ${text || res.statusText}`, res.status, retryable);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new LLMError("Провайдер вернул пустой поток");

  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let reasoning = "";
  let usage: Usage | undefined;
  let finishReason = "";
  let sawData = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });

    const lines = pending.split("\n");
    pending = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      sawData = true;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // keep-alive comment or truncated frame
      }

      const choice = json.choices?.[0];
      const delta = choice?.delta ?? choice?.message ?? {};
      const content = typeof delta.content === "string" ? delta.content : "";
      const think = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
      if (think) {
        reasoning += think;
        opts.onReasoning?.(think);
      }
      if (content) {
        text += content;
        opts.onDelta?.(content);
      }
      if (choice?.finish_reason) finishReason = String(choice.finish_reason);
      if (json.usage) {
        usage = {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0
        };
      }
    }
  }

  // Gateways occasionally answer with a plain JSON body despite stream:true.
  if (!sawData && pending.trim()) {
    try {
      const j = JSON.parse(pending.trim());
      const content = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content ?? "";
      if (typeof content === "string" && content) {
        text = content;
        opts.onDelta?.(content);
      }
      if (j.usage) {
        usage = {
          prompt: j.usage.prompt_tokens ?? 0,
          completion: j.usage.completion_tokens ?? 0,
          total: j.usage.total_tokens ?? 0
        };
      }
    } catch {
      /* nothing usable */
    }
  }

  if (!text.trim() && !finishReason) {
    throw new LLMError("Модель вернула пустой ответ", undefined, true);
  }

  return {
    text,
    reasoning,
    finishReason: finishReason || "stop",
    usage: usage ?? {
      prompt: estimateTokens(messages.map(m => m.content).join("\n")),
      completion: estimateTokens(text),
      total: 0
    },
    ms: Date.now() - started
  };
}
