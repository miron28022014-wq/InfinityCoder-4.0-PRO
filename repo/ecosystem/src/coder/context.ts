/**
 * Контекст выполнения инструмента.
 *
 * Чтобы блокировки файлов между субагентами работали и при прямом вызове
 * инструмента из агента, контекст запуска передаётся через AsyncLocalStorage:
 * инструмент знает, кто и в каком запуске работает, и не обязан доверять
 * аргументам модели.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RunContext {
  runId: string;
  agentName: string;
  projectId: string;
  /** Файлы, закреплённые за агентом. null — агент не ограничен. */
  allowedFiles: string[] | null;
  /** Глубина вложенности: main → subagent → subagent. */
  depth: number;
}

const storage = new AsyncLocalStorage<RunContext>();

export function withRunContext<T>(context: RunContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRunContext(): RunContext | undefined {
  return storage.getStore();
}
