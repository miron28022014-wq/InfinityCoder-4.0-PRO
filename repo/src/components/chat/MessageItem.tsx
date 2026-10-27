import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../../icons";
import { Markdown } from "../ui/Markdown";
import { ToolCard } from "./ToolCard";
import { formatMs, useElapsed } from "../../hooks/useStore";
import type { Message, SwarmWorker } from "../../types";

/* ================================================================== *
 * Swarm worker card
 * ================================================================== */

export function WorkerCard({ worker }: { worker: SwarmWorker }) {
  const [open, setOpen] = useState(false);
  const running = worker.status === "running";
  const ms = useElapsed(worker.startedAt, running || worker.status === "pending");
  const tint = `rgb(${worker.profile.tint})`;

  const tone =
    worker.status === "ok"
      ? "rgb(var(--ic-ok))"
      : worker.status === "error"
        ? "rgb(var(--ic-danger))"
        : "rgb(var(--ic-ink-mute))";

  return (
    <div
      className="overflow-hidden rounded-xl2 border transition-all duration-300"
      style={{
        borderColor: running ? `rgb(${worker.profile.tint} / 0.35)` : "rgb(var(--ic-line))",
        background: "rgb(var(--ic-surface))"
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-raised/50"
      >
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${running ? "ic-worker-ring" : ""}`}
          style={{ background: `rgb(${worker.profile.tint} / 0.14)`, color: tint }}
        >
          <Icon name={worker.profile.icon as IconName} size={12.5} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-ink">
              {worker.profile.name} #{worker.index + 1}
            </span>
            {worker.status === "pending" && (
              <span className="ic-badge" style={{ height: 16, fontSize: 9.5 }}>
                очередь
              </span>
            )}
          </span>
          <span className="block truncate text-[11px] text-ink-mute">
            {worker.status === "error"
              ? worker.error
              : running
                ? worker.current || "работает"
                : worker.subtask}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2 text-[10.5px] tabular text-ink-mute">
          {worker.toolCalls > 0 && (
            <span className="flex items-center gap-0.5">
              <Icon name="zap" size={10} />
              {worker.toolCalls}
            </span>
          )}
          {ms > 0 && <span>{formatMs(ms)}</span>}
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
        </span>

        <Icon
          name="chevronDown"
          size={13}
          className="shrink-0 text-ink-mute transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {running && (
        <div className="ic-scan relative h-px w-full overflow-hidden">
          <div
            className="h-full w-full"
            style={{ background: `linear-gradient(90deg, transparent, rgb(${worker.profile.tint} / 0.5), transparent)` }}
          />
        </div>
      )}

      {open && (
        <div className="ic-anim-in border-t border-line px-3 py-2.5" style={{ animationDuration: "200ms" }}>
          <p className="text-[11.5px] leading-relaxed text-ink-soft">{worker.subtask}</p>
          {worker.touched.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {worker.touched.slice(0, 8).map(f => (
                <span key={f} className="ic-mono rounded-md border border-line bg-sunken px-1.5 py-0.5 text-[10.5px] text-ink-mute">
                  {f.split(/[\\/]/).pop()}
                </span>
              ))}
            </div>
          )}
          {worker.output && (
            <div className="mt-2.5 border-t border-line pt-2.5">
              <Markdown text={worker.output} dense />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * Message
 * ================================================================== */

export function MessageItem({
  message,
  streaming,
  isLast
}: {
  message: Message;
  streaming?: boolean;
  isLast?: boolean;
}) {
  const isUser = message.role === "user";
  const live = !!streaming;
  const calls = message.toolCalls ?? [];
  const runs = useElapsed(message.stats?.startedAt, !!streaming);

  const tint = useMemo(() => {
    const w = message.swarm?.workers[0];
    return w ? `rgb(${w.profile.tint})` : undefined;
  }, [message.swarm]);

  return (
    <article className="ic-anim-in group/msg" style={{ animationDuration: "260ms" }}>
      <div className="ic-msg">
        {/* avatar */}
        <span
          className="ic-msg__avatar text-white"
          style={
            isUser
              ? { background: "rgb(var(--ic-raised))", border: "1px solid rgb(var(--ic-line))", color: "rgb(var(--ic-ink-soft))" }
              : { background: "var(--ic-grad)", boxShadow: "0 4px 12px -4px rgb(var(--ic-accent) / 0.7)" }
          }
        >
          <Icon name={isUser ? "user" : "infinity"} size={14} strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="ic-msg__who">
              {isUser ? "Вы" : message.swarm ? `Рой · ${message.swarm.workers.length} агента` : "InfinityCoder"}
            </span>
            {message.swarm && (
              <span className="flex items-center -space-x-1">
                {message.swarm.workers.map(w => (
                  <span
                    key={w.id}
                    className="grid h-4 w-4 place-items-center rounded-full border border-surface"
                    style={{ background: `rgb(${w.profile.tint} / 0.9)`, color: "#fff" }}
                    title={w.profile.name}
                  >
                    <Icon name={w.profile.icon as IconName} size={9} strokeWidth={2} />
                  </span>
                ))}
              </span>
            )}
            <span className="ic-msg__meta tabular">
              {message.stats?.finishedAt
                ? formatMs(message.stats.finishedAt - (message.stats.startedAt ?? message.ts))
                : live
                  ? formatMs(runs)
                  : ""}
            </span>
            {message.stats && message.stats.toolCalls > 0 && (
              <span className="flex items-center gap-0.5 text-[10.5px] tabular text-ink-mute">
                <Icon name="zap" size={9.5} />
                {message.stats.toolCalls}
              </span>
            )}
          </div>

          {/* tool cards */}
          {calls.length > 0 && (
            <div className="mb-1.5 space-y-0.5">
              {calls.map(c => (
                <ToolCard key={c.id} record={c} agentTint={c.agentId.startsWith("w") ? undefined : tint} />
              ))}
            </div>
          )}

          {/* body */}
          {isUser ? (
            <p
              className="whitespace-pre-wrap rounded-xl2 border border-line bg-raised/45 px-3 py-2 text-[13.5px] leading-relaxed text-ink"
            >
              {message.content}
            </p>
          ) : (
            <div className="text-ink-soft">
              {message.content ? (
                <Markdown text={message.content} />
              ) : live ? (
                <ThinkingDots />
              ) : (
                <p className="text-ink-mute italic">—</p>
              )}
              {live && message.content && <span className="ic-caret" />}
            </div>
          )}

          {message.error && (
            <div className="mt-2 flex items-start gap-2 rounded-xl2 border border-danger/25 bg-danger/8 px-2.5 py-2">
              <Icon name="alert" size={13} className="mt-0.5 text-danger" />
              <p className="text-[12px] leading-relaxed text-danger">{message.error}</p>
            </div>
          )}

          {message.swarm && <SwarmBoard workers={message.swarm.workers} plan={message.swarm.plan} />}

          {isLast && !live && message.stats?.finishedAt && (
            <RunFooter message={message} />
          )}
        </div>
      </div>
    </article>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-2 py-1">
      <span className="ic-dots">
        <span />
        <span />
        <span />
      </span>
      <span className="text-[12px] text-ink-mute">анализирую задачу…</span>
    </span>
  );
}

function RunFooter({ message }: { message: Message }) {
  const s = message.stats;
  if (!s) return null;
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-ink-mute transition-colors hover:text-ink-soft"
      >
        <Icon name="activity" size={11} />
        {s.turns} ходов · {s.toolCalls} вызовов
        {s.usage.total > 0 && ` · ${s.usage.total} токенов`}
        <Icon name="chevronDown" size={10} style={{ transform: open ? "rotate(180deg)" : undefined }} className="transition-transform" />
      </button>
      {open && (
        <div className="ic-anim-in mt-1.5 rounded-xl2 border border-line bg-raised/40 px-2.5 py-2" style={{ animationDuration: "180ms" }}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
            <dt className="text-ink-mute">Модель</dt>
            <dd className="ic-mono text-ink-soft">{s.model}</dd>
            <dt className="text-ink-mute">Время</dt>
            <dd className="tabular text-ink-soft">{formatMs((s.finishedAt ?? Date.now()) - s.startedAt)}</dd>
            {s.usage.total > 0 && (
              <>
                <dt className="text-ink-mute">Токены</dt>
                <dd className="tabular text-ink-soft">
                  {s.usage.total} (prompt {s.usage.prompt} · gen {s.usage.completion})
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

export function SwarmBoard({ workers, plan }: { workers: SwarmWorker[]; plan: string[] }) {
  const done = workers.filter(w => w.status === "ok" || w.status === "error").length;
  const total = workers.length;
  return (
    <div className="ic-anim-in mt-2.5 space-y-1.5" style={{ animationDuration: "300ms" }}>
      {plan.length > 0 && (
        <details className="rounded-xl2 border border-line bg-raised/40 px-2.5 py-2 group/plan">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] text-ink-soft marker:hidden">
            <Icon name="list" size={12} />
            План · {plan.length} шагов
            <Icon
              name="chevronDown"
              size={11}
              className="ml-auto transition-transform duration-200 group-open/plan:rotate-180"
            />
          </summary>
          <ol className="mt-2 space-y-1">
            {plan.map((p, i) => (
              <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-mute">
                <span className="shrink-0 tabular text-accent">{i + 1}.</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="flex items-center gap-2 px-0.5">
        <Icon name="swarm" size={12} className="text-ink-mute" />
        <span className="text-[11px] text-ink-mute">
          Воркеры: {done} из {total} завершили
        </span>
        <span className="ml-auto flex gap-0.5">
          {workers.map(w => (
            <span
              key={w.id}
              className="h-1 w-6 overflow-hidden rounded-full bg-line"
              title={`${w.profile.name} — ${w.status}`}
            >
              <span
                className="block h-full rounded-full transition-all duration-500"
                style={{
                  width: w.status === "ok" || w.status === "error" ? "100%" : "45%",
                  background: w.status === "error" ? "rgb(var(--ic-danger))" : `rgb(${w.profile.tint})`
                }}
              />
            </span>
          ))}
        </span>
      </div>
      <div className="space-y-1">
        {workers.map(w => (
          <WorkerCard key={w.id} worker={w} />
        ))}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Activity stream (live, collapsible)
 * ================================================================== */

const KIND_ICON: Record<string, IconName> = {
  thinking: "brain",
  plan: "layers",
  tool: "zap",
  memory: "memory",
  swarm_spawn: "swarm",
  swarm_merge: "stack",
  verify: "shieldCheck",
  error: "alert",
  done: "checkCircle"
};

export function ActivityStream({
  items,
  onOpenFile
}: {
  items: import("../../types").ActivityEvent[];
  onOpenFile?: (path: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (open) ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [items.length, open]);

  if (!items.length) return null;
  const running = items.filter(i => i.status === "running").length;

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-raised/40"
      >
        {running > 0 ? (
          <span className="ic-equalizer">
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Icon name="activity" size={12} className="text-ink-mute" />
        )}
        <span className="text-[11px] font-medium text-ink-soft">
          {running > 0 ? `Выполняется · ${running}` : "Журнал действий"}
        </span>
        <span className="ic-badge ml-auto" style={{ height: 17, fontSize: 10 }}>
          {items.length}
        </span>
        <Icon
          name="chevronDown"
          size={12}
          className="text-ink-mute transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {open && (
        <div ref={ref} className="ic-scroll max-h-[178px] space-y-px px-2 pb-2">
          {items.map(e => {
            const icon = KIND_ICON[e.kind] ?? "zap";
            const color =
              e.status === "error"
                ? "rgb(var(--ic-danger))"
                : e.status === "ok"
                  ? "rgb(var(--ic-ink-mute))"
                  : "rgb(var(--ic-accent))";
            const path = e.tool?.args?.path ? String(e.tool.args.path) : null;
            return (
              <div
                key={e.id}
                className="ic-anim-in flex items-center gap-2 rounded-lg px-2 py-[5px] text-[11.5px] transition-colors hover:bg-raised/50"
                style={{ animationDuration: "200ms" }}
              >
                <span
                  className="grid h-4 w-4 shrink-0 place-items-center"
                  style={{ color: e.status === "running" ? undefined : color }}
                >
                  {e.status === "running" ? (
                    <span className="block h-2 w-2 rounded-full border-[1.4px] border-accent/30 border-t-accent" style={{ animation: "ic-spin .7s linear infinite" }} />
                  ) : (
                    <Icon name={icon} size={11} />
                  )}
                </span>
                <span className="shrink-0 text-ink-soft">{e.label}</span>
                {e.detail && (
                  <span className="ic-mono min-w-0 flex-1 truncate text-ink-mute" title={e.detail}>
                    {e.detail}
                  </span>
                )}
                {e.agentId && e.agentId !== "main" && (
                  <span className="shrink-0 text-[10px] text-ink-mute">{e.agentId}</span>
                )}
                {path && onOpenFile && (
                  <button
                    onClick={() => onOpenFile(path)}
                    className="shrink-0 rounded px-1 text-[10px] text-accent transition-colors hover:bg-accent/10"
                  >
                    открыть
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
