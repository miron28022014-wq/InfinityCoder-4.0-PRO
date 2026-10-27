import { useEffect, useState } from "react";
import { Icon, type IconName } from "../../icons";
import { Btn, Empty } from "../ui";
import { useElapsed, useStore, shallow } from "../../hooks/useStore";
import { AGENTS } from "../../lib/agents";
import { memory, patchSettings } from "../../store";
import { EFFORT_PRESETS } from "../../lib/settings";
import type { EcoMemory, LedgerEntry, SwarmWorker } from "../../types";

export function AgentsPanel() {
  const workers = useStore(s => s.workers, shallow);
  const settings = useStore(s => s.settings, shallow);
  const running = useStore(s => s.isRunning);
  const mode = useStore(s => s.settings.mode);

  return (
    <div className="ic-scroll flex h-full flex-col gap-2 p-2">
      {/* live swarm */}
      {workers.length > 0 && (
        <section className="space-y-1.5">
          <SectionHead icon="swarm" title="Живой рой" right={`${workers.filter(w => w.status === "ok").length}/${workers.length}`} />
          {workers.map(w => (
            <LiveWorkerRow key={w.id} worker={w} />
          ))}
        </section>
      )}

      {/* mode switch */}
      <section className="space-y-1.5">
        <SectionHead icon="layers" title="Режим" />
        <div className="ic-seg w-full">
          <button
            className="flex-1 justify-center"
            data-on={mode === "agent"}
            disabled={running}
            onClick={() => patchSettings({ mode: "agent" })}
          >
            <Icon name="bot" size={12} /> Один агент
          </button>
          <button
            className="flex-1 justify-center"
            data-on={mode === "swarm"}
            disabled={running}
            onClick={() => patchSettings({ mode: "swarm" })}
          >
            <Icon name="swarm" size={12} /> Рой
          </button>
        </div>
        {mode === "swarm" && <SwarmControls disabled={running} />}
      </section>

      {/* roster */}
      <section className="space-y-1.5">
        <SectionHead icon="bot" title="Роли" />
        {!settings.autoRoute && (
          <p className="px-0.5 text-[11px] leading-snug text-ink-mute">
            Автовыбор выключен — активна роль ниже.
          </p>
        )}
        {AGENTS.map(a => {
          const on = settings.activeAgent === a.id;
          const preset = EFFORT_PRESETS[a.effort];
          return (
            <button
              key={a.id}
              onClick={() => patchSettings({ activeAgent: a.id, autoRoute: false })}
              className="w-full rounded-xl2 border px-2.5 py-2 text-left transition-all duration-200"
              style={{
                borderColor: on ? `rgb(${a.tint} / 0.45)` : "rgb(var(--ic-line))",
                background: on ? `rgb(${a.tint} / 0.08)` : "rgb(var(--ic-raised) / 0.4)"
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
                  style={{ background: `rgb(${a.tint} / 0.16)`, color: `rgb(${a.tint})` }}
                >
                  <Icon name={a.icon as IconName} size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{a.name}</span>
                  <span className="block truncate text-[10.5px] text-ink-mute">
                    {a.allow.length ? `${a.allow.length} инструментов` : "все инструменты"} · {preset.label}
                  </span>
                </span>
                {on && <Icon name="check" size={13} style={{ color: `rgb(${a.tint})` }} />}
              </div>
            </button>
          );
        })}
        <Btn
          size="sm"
          variant="outline"
          icon="wand"
          className="w-full"
          onClick={() => patchSettings({ autoRoute: true })}
          disabled={settings.autoRoute}
        >
          Включить автовыбор роли
        </Btn>
      </section>
    </div>
  );
}

/** Separate component so the elapsed-timer hook is not called inside a loop. */
function LiveWorkerRow({ worker }: { worker: SwarmWorker }) {
  const ms = useElapsed(worker.startedAt, worker.status === "running");
  const running = worker.status === "running";
  return (
    <div
      className="rounded-xl2 border border-line bg-raised/40 p-2 transition-colors"
      style={
        running
          ? { borderColor: `rgb(${worker.profile.tint} / 0.4)`, background: `rgb(${worker.profile.tint} / 0.06)` }
          : undefined
      }
    >
      <div className="flex items-center gap-2">
        <span
          className={`grid h-5 w-5 place-items-center rounded-md ${running ? "ic-worker-ring" : ""}`}
          style={{ background: `rgb(${worker.profile.tint} / 0.16)`, color: `rgb(${worker.profile.tint})` }}
        >
          <Icon name={worker.profile.icon as IconName} size={11} />
        </span>
        <span className="flex-1 truncate text-[12px] font-medium text-ink">
          {worker.profile.name} #{worker.index + 1}
        </span>
        {ms > 0 && <span className="text-[10px] tabular text-ink-mute">{(ms / 1000).toFixed(0)}с</span>}
        <StatusPill status={worker.status} />
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-mute">
        {worker.status === "error" ? worker.error : running ? worker.current || worker.subtask : worker.subtask}
      </p>
    </div>
  );
}

function SwarmControls({ disabled }: { disabled: boolean }) {
  const settings = useStore(s => s.settings, shallow);
  return (
    <div className="space-y-2 rounded-xl2 border border-line bg-raised/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-ink-soft">Воркеров</span>
        <div className="ic-seg">
          {[2, 3, 4, 5, 6].map(n => (
            <button key={n} data-on={settings.swarmSize === n} disabled={disabled} onClick={() => patchSettings({ swarmSize: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-ink-soft">Параллельно</span>
        <div className="ic-seg">
          <button data-on={settings.parallelSwarm} disabled={disabled} onClick={() => patchSettings({ parallelSwarm: true })}>
            ∥ Да
          </button>
          <button data-on={!settings.parallelSwarm} disabled={disabled} onClick={() => patchSettings({ parallelSwarm: false })}>
            По очереди
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ icon, title, right }: { icon: IconName; title: string; right?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-0.5">
      <Icon name={icon} size={11} className="text-ink-mute" />
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-mute">{title}</span>
      {right && <span className="ml-auto text-[10.5px] tabular text-ink-mute">{right}</span>}
    </div>
  );
}

const STATUS_PILL: Record<string, { label: string; style: React.CSSProperties }> = {
  pending: { label: "ждёт", style: { color: "rgb(var(--ic-ink-mute))" } },
  running: { label: "работает", style: { color: "rgb(var(--ic-accent))" } },
  ok: { label: "готово", style: { color: "rgb(var(--ic-ok))" } },
  error: { label: "ошибка", style: { color: "rgb(var(--ic-danger))" } }
};

function StatusPill({ status }: { status: keyof typeof STATUS_PILL }) {
  const p = STATUS_PILL[status];
  return <span className="text-[10px] font-medium" style={p.style}>{p.label}</span>;
}

/* ================================================================== *
 * Memory (Ledger) panel
 * ================================================================== */

const KIND_META: Record<string, { label: string; color: string; icon: IconName }> = {
  decision: { label: "решение", color: "178 122 255", icon: "target" },
  gotcha: { label: "грабли", color: "255 138 172", icon: "alert" },
  symbol: { label: "символ", color: "108 133 255", icon: "hash" },
  file: { label: "файл", color: "61 214 140", icon: "file" },
  note: { label: "заметка", color: "156 166 184", icon: "book" }
};

/** Общая память экосистемы: факты, доступные всем приложениям. */
function SharedMemory({ items }: { items: EcoMemory[] }) {
  return (
    <section className="shrink-0 border-b border-line">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <Icon name="server" size={12} className="text-accent" />
        <span className="text-[11.5px] font-medium text-ink-soft">Общая память экосистемы</span>
        <span className="ic-badge ml-auto" style={{ height: 16, fontSize: 9.5 }}>
          {items.length}
        </span>
      </div>
      <div className="ic-scroll max-h-[168px] space-y-1 px-2 pb-2">
        {items.map(m => (
          <div
            key={m.id}
            className="rounded-lg border border-line bg-raised/40 px-2 py-1.5"
            title={m.content}
          >
            <p className="line-clamp-3 text-[11.5px] leading-relaxed text-ink-soft">{m.content}</p>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-mute">
              <Icon name="layers" size={9.5} />
              <span className="truncate">{m.source?.title || m.source?.type || "общая память"}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MemoryPanel() {
  const root = useStore(s => s.root);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ key: "", description: "", file_path: "", kind: "note" });

  const load = async (q: string) => {
    if (!root) return;
    setLoading(true);
    const data = q.trim() ? await memory.search(q) : await memory.load(true);
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(query), 220);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const eco = useStore(s => s.eco);
  const shared = eco.memories ?? [];

  if (!root) {
    return (
      <div className="flex h-full flex-col">
        {shared.length > 0 && <SharedMemory items={shared} />}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Empty
            icon="memory"
            title="Память проекта"
            hint="Откройте проект — агент начнёт накапливать знания о нём."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {shared.length > 0 && <SharedMemory items={shared} />}
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <div className="relative flex-1">
          <Icon name="search" size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            className="ic-input h-7 pl-7 text-[12px]"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск по памяти…"
          />
        </div>
        <Btn
          size="sm"
          icon="plus"
          tip="Добавить запись"
          onClick={() => setAdding(a => !a)}
          active={adding}
        />
        <Btn size="sm" icon="refresh" tip="Переиндексировать проект" onClick={() => void memoryReindex(setRows)} />
      </div>

      {adding && (
        <div className="space-y-1.5 border-b border-line bg-raised/30 p-2">
          <input
            className="ic-input h-7 text-[12px]"
            placeholder="Ключ (например auth:flow)"
            value={draft.key}
            onChange={e => setDraft({ ...draft, key: e.target.value })}
          />
          <textarea
            className="ic-input text-[12px]"
            rows={2}
            placeholder="Что за факт"
            value={draft.description}
            onChange={e => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="flex gap-1.5">
            <select
              className="ic-input h-7 flex-1 text-[11.5px]"
              value={draft.kind}
              onChange={e => setDraft({ ...draft, kind: e.target.value })}
            >
              {Object.entries(KIND_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <Btn
              size="sm"
              variant="primary"
              icon="check"
              disabled={!draft.key.trim()}
              onClick={async () => {
                await memory.add(draft.key, draft.description, draft.file_path, draft.kind);
                setDraft({ key: "", description: "", file_path: "", kind: "note" });
                setAdding(false);
                void load(query);
              }}
            >
              Сохранить
            </Btn>
          </div>
        </div>
      )}

      <div className="ic-scroll flex-1 p-1.5">
        {loading ? (
          <div className="flex justify-center py-6">
            <span className="block h-4 w-4 rounded-full border-2 border-line border-t-accent" style={{ animation: "ic-spin .7s linear infinite" }} />
          </div>
        ) : rows.length === 0 ? (
          <Empty
            icon="memory"
            title="Память пуста"
            hint="Агент записывает сюда файлы, символы, решения и найденные грабли — автоматически."
          />
        ) : (
          rows.map(e => <MemoryRow key={e.key} entry={e} onChanged={() => void load(query)} />)
        )}
      </div>
    </div>
  );
}

async function memoryReindex(setRows: (r: LedgerEntry[]) => void) {
  await memory.reindex();
  setRows(await memory.load(true));
}

function MemoryRow({
  entry,
  onChanged
}: {
  entry: LedgerEntry;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const kind = KIND_META[entry.kind ?? "note"] ?? KIND_META.note;

  return (
    <div className="group rounded-xl2 border border-line bg-raised/35 transition-colors hover:border-line-strong">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
      >
        <span
          className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded"
          style={{ background: `rgb(${kind.color} / 0.16)`, color: `rgb(${kind.color})` }}
        >
          <Icon name={kind.icon} size={9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[11.5px] text-ink-soft">{entry.key}</span>
          {!open && <span className="block truncate text-[10.5px] text-ink-mute">{entry.description}</span>}
        </span>
        <Icon
          name="chevronDown"
          size={11}
          className="mt-1 shrink-0 text-ink-mute transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && (
        <div className="ic-anim-in border-t border-line px-2.5 py-2" style={{ animationDuration: "180ms" }}>
          <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-soft">{entry.description}</p>
          {entry.file_path && (
            <p className="ic-mono mt-1.5 truncate text-[10.5px] text-ink-mute">{entry.file_path}</p>
          )}
          <div className="mt-2 flex gap-1">
            <span className="ic-badge" style={{ height: 17, fontSize: 9.5 }}>
              {kind.label}
            </span>
            {entry.updated_at ? (
              <span className="ic-badge" style={{ height: 17, fontSize: 9.5 }}>
                {new Date(entry.updated_at * 1000).toLocaleDateString("ru-RU")}
              </span>
            ) : null}
            <span className="flex-1" />
            <button
              onClick={async () => {
                await memory.remove(entry.key);
                onChanged();
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Icon name="trash" size={10} />
              удалить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
