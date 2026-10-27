import { Icon, type IconName } from "../icons";
import { useStore, shallowArray } from "../hooks/useStore";
import { dismissToast } from "../store";
import type { Toast } from "../types";

const TONE: Record<Toast["kind"], { icon: IconName; color: string; bg: string; border: string }> = {
  info: { icon: "info", color: "rgb(var(--ic-info))", bg: "rgb(var(--ic-info) / 0.1)", border: "rgb(var(--ic-info) / 0.3)" },
  ok: { icon: "checkCircle", color: "rgb(var(--ic-ok))", bg: "rgb(var(--ic-ok) / 0.1)", border: "rgb(var(--ic-ok) / 0.3)" },
  warn: { icon: "alert", color: "rgb(var(--ic-warn))", bg: "rgb(var(--ic-warn) / 0.1)", border: "rgb(var(--ic-warn) / 0.3)" },
  error: { icon: "xCircle", color: "rgb(var(--ic-danger))", bg: "rgb(var(--ic-danger) / 0.1)", border: "rgb(var(--ic-danger) / 0.3)" }
};

export function Toasts() {
  const toasts = useStore(s => s.toasts, shallowArray);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-8 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map(t => {
        const tone = TONE[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className="ic-toast pointer-events-auto flex max-w-md items-start gap-2 rounded-xl2 border px-3 py-2 shadow-pop backdrop-blur-md"
            style={{ background: `rgb(var(--ic-overlay) / 0.92)`, borderColor: tone.border }}
          >
            <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: tone.bg, color: tone.color }}>
              <Icon name={tone.icon} size={12} />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink">{t.text}</p>
              {t.detail && <p className="mt-0.5 text-[11px] leading-snug text-ink-mute">{t.detail}</p>}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="ml-1 rounded p-0.5 text-ink-mute transition-colors hover:bg-raised hover:text-ink"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
