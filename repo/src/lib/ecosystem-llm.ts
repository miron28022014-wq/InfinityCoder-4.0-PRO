/**
 * Транспорт LLM через Infinity Ecosystem.
 *
 * Вместо прямого обращения к провайдеру IDE ходит в AI Runtime ядра:
 *  — ключи провайдеров хранит сервер, клиент их не видит;
 *  — выбор модели и провайдера — на сервере;
 *  — локальный режим блокирует облако на маршрутизаторе, а не в UI.
 *
 * Формат ответа совпадает с локальным транспортом, поэтому движок агента
 * не различает, где именно идёт генерация.
 */
import type { Msg, Usage } from "../types";
import {
  EcosystemError,
  type EcosystemClient,
  type EcoMessage,
  type EcoScope
} from "./ecosystem";

export interface TransportResult {
  text: string;
  usage: Usage;
  reasoning: string;
}

export interface TransportOptions {
  temperature: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (chunk: string) => void;
}

export interface Transport {
  id: string;
  /** Человеческое описание — показывается в статус-баре. */
  label: string;
  complete(messages: Msg[], opts: TransportOptions): Promise<TransportResult>;
}

/** Грубая оценка токенов, когда сервер их не прислал. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export function createEcosystemTransport(
  client: EcosystemClient,
  options: { modelId: string; mode: EcoScope; label?: string }
): Transport {
  return {
    id: `ecosystem:${options.modelId}`,
    label: options.label ?? `экосистема · ${options.mode === "local" ? "локально" : "облако"}`,
    async complete(messages: Msg[], opts: TransportOptions): Promise<TransportResult> {
      const payload: EcoMessage[] = messages.map(m => ({
        role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
        content: m.content
      }));
      try {
        const res = await client.completion({
          modelId: options.modelId,
          mode: options.mode,
          messages: payload,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          signal: opts.signal,
          onDelta: opts.onDelta
        });
        return {
          text: res.text,
          reasoning: "",
          usage: {
            prompt: estimateTokens(messages.map(m => m.content).join("\n")),
            completion: estimateTokens(res.text),
            total: 0
          }
        };
      } catch (e) {
        if (e instanceof EcosystemError) {
          // Локальный режим и отказ провайдера — понятные пользователю ошибки.
          if (e.code === "LOCAL_MODE_BLOCKED") {
            throw new EcosystemError(
              "Локальный режим заблокировал облачного провайдера. Выберите локальную модель в панели «Экосистема».",
              e.code,
              e.status
            );
          }
          if (e.code === "UNAUTHORIZED") {
            throw new EcosystemError(
              "Токен экосистемы недействителен. Войдите заново в панели «Экосистема».",
              e.code,
              e.status
            );
          }
        }
        throw e;
      }
    }
  };
}
