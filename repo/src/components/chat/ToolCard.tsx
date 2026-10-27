import { useState } from "react";
import { Icon, type IconName } from "../../icons";
import { formatMs } from "../../hooks/useStore";
import { toolIcon, toolSpec } from "../../lib/tools";
import type { ToolCallRecord } from "../../types";

/** Human summary of a tool's arguments, without dumping the payload. */
export function summarizeArgs(tool: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  switch (tool) {
    case "run_command":
      return s(args.command);
    case "write_file":
    case "read_file":
    case "delete_file":
    case "file_stat":
    case "create_dir":
    case "memory_forget":
      return s(args.path);
    case "edit_file":
      return `${s(args.path)}  ·  ${truncate(s(args.old_string), 40)} → ${truncate(s(args.new_string), 40)}`;
    case "move_file":
      return `${s(args.from)} → ${s(args.to)}`;
    case "search_files":
      return `${truncate(s(args.query), 48)}${args.glob ? `  ·  ${s(args.glob)}` : ""}`;
    case "memory_search":
      return s(args.query);
    case "memory_write":
      return `${s(args.key)}${s(args.description) ? `  ·  ${truncate(s(args.description), 52)}` : ""}`;
    case "git_commit":
      return s(args.message);
    case "web_fetch":
    case "web_search":
      return s(args.url ?? args.query);
    default: {
      const first = Object.entries(args)[0];
      return first ? `${first[0]}: ${truncate(s(first[1]), 60)}` : "";
    }
  }
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

const TONE: Record<string, { color: string; bg: string }> = {
  ok: { color: "rgb(var(--ic-ok))", bg: "rgb(var(--ic-ok) / 0.1)" },
  error: { color: "rgb(var(--ic-danger))", bg: "rgb(var(--ic-danger) / 0.1)" },
  denied: { color: "rgb(var(--ic-warn))", bg: "rgb(var(--ic-warn) / 0.1)" },
  running: { color: "rgb(var(--ic-accent))", bg: "rgb(var(--ic-accent) / 0.1)" }
};

export function ToolCard({
  record,
  agentTint,
  compact
}: {
  record: ToolCallRecord;
  agentTint?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const spec = toolSpec(record.tool);
  const icon = (spec?.icon ?? toolIcon(record.tool)) as IconName;
  const tone = TONE[record.status] ?? TONE.ok;
  const summary = summarizeArgs(record.tool, record.args);
  const hasBody = !!record.output;

  return (
    <div
      className="my-1 overflow-hidden rounded-xl2 border transition-all duration-200"
      style={{
        borderColor: record.status === "running" ? "rgb(var(--ic-accent) / 0.32)" : "rgb(var(--ic-line))",
        background: "rgb(var(--ic-raised) / 0.5)",
        boxShadow: record.status === "running" ? "0 0 0 3px rgb(var(--ic-accent) / 0.07)" : undefined
      }}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen(o => !o)}
        className={`flex w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-overlay/40 ${compact ? "py-1.5" : "py-2"} ${hasBody ? "cursor-pointer" : "cursor-default"}`}
      >
        <span
          className="ic-tool__icon"
          style={{ background: tone.bg, color: record.status === "running" ? undefined : tone.color }}
        >
          {record.status === "running" ? (
            <span className="block h-2.5 w-2.5 rounded-full border-[1.6px] border-accent/30 border-t-accent" style={{ animation: "ic-spin .7s linear infinite" }} />
          ) : (
            <Icon name={icon} size={12.5} />
          )}
        </span>

        <span
          className="ic-tool__name"
          style={agentTint ? { color: agentTint } : undefined}
        >
          {spec?.summary ?? record.tool}
        </span>

        {summary && (
          <span className="ic-tool__args" title={summary}>
            {summary}
          </span>
        )}

        {record.ms !== undefined && (
          <span className="shrink-0 text-[10.5px] tabular text-ink-mute">{formatMs(record.ms)}</span>
        )}

        {record.status !== "running" && (
          <Icon
            name={record.status === "ok" ? "check" : record.status === "denied" ? "xCircle" : "x"}
            size={12}
            style={{ color: tone.color }}
          />
        )}

        {hasBody && (
          <Icon
            name="chevronDown"
            size={13}
            className="shrink-0 text-ink-mute transition-transform duration-200"
            style={{ transform: open ? "rotate(180deg)" : undefined }}
          />
        )}
      </button>

      {open && hasBody && (
        <div
          className="ic-anim-in border-t border-line bg-sunken/60 px-3 py-2"
          style={{ animationDuration: "180ms" }}
        >
          <pre className="ic-scroll max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-soft">
            {record.output}
          </pre>
        </div>
      )}
    </div>
  );
}
