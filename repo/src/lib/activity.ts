/**
 * Activity bus.
 *
 * One append-only event stream describing what the runtime is actually doing.
 * The chat transcript and the swarm board are both pure views over it, which is
 * why a worker and the lead can share the same telemetry without extra plumbing.
 */
import type { ActivityEvent, ActivityStatus, ActivityKind, ToolCall, ToolOutcome } from "../types";

type Listener = (e: ActivityEvent) => void;

let seq = 0;
const listeners = new Set<Listener>();
/** Latest state per id so a `complete()` can find the original event. */
const byId = new Map<number, ActivityEvent>();

export function publish(e: {
  kind: ActivityKind;
  label: string;
  detail?: string;
  agentId: string;
  tool?: ToolCall;
  turn?: number;
}): ActivityEvent {
  const ev: ActivityEvent = {
    id: ++seq,
    kind: e.kind,
    label: e.label,
    detail: e.detail,
    agentId: e.agentId,
    tool: e.tool,
    turn: e.turn,
    status: "running",
    ts: Date.now()
  };
  byId.set(ev.id, ev);
  emit(ev);
  return ev;
}

export function complete(id: number, status: Exclude<ActivityStatus, "running">, result?: ToolOutcome) {
  const prev = byId.get(id);
  if (!prev) return;
  const next: ActivityEvent = { ...prev, status, result, detail: result?.preview ?? prev.detail };
  byId.set(id, next);
  emit(next);
}

export function amend(id: number, patch: Partial<ActivityEvent>) {
  const prev = byId.get(id);
  if (!prev) return;
  const next = { ...prev, ...patch };
  byId.set(id, next);
  emit(next);
}

function emit(e: ActivityEvent) {
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* one bad subscriber must not stall the engine */
    }
  }
}

export function subscribeActivity(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetActivity() {
  byId.clear();
  seq = 0;
}

/** Human label for an activity kind, used when a label is not supplied. */
export const KIND_LABEL: Record<ActivityKind, string> = {
  thinking: "Размышляет",
  plan: "Планирует",
  tool: "Инструмент",
  memory: "Память",
  swarm_spawn: "Воркер",
  swarm_merge: "Сведение",
  verify: "Проверка",
  error: "Ошибка",
  done: "Готово"
};
