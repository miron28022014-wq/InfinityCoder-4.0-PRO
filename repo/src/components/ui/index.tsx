import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { Icon, type IconName } from "../../icons";

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

type Variant = "ghost" | "outline" | "primary" | "danger";
type Size = "md" | "sm";

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  variant?: Variant;
  size?: Size;
  active?: boolean;
  tip?: string;
  tipSide?: "top" | "right" | "left";
  loading?: boolean;
}

export function Btn({
  icon,
  variant = "ghost",
  size = "md",
  active,
  tip,
  tipSide = "top",
  loading,
  className = "",
  children,
  ...rest
}: BtnProps) {
  const cls = [
    "ic-btn",
    variant === "ghost" && "ic-btn--ghost",
    variant === "outline" && "ic-btn--outline",
    variant === "primary" && "ic-btn--primary",
    variant === "danger" && "ic-btn--danger",
    size === "sm" && "ic-btn--sm",
    !children && "ic-btn--icon",
    active && "is-active",
    tip && tipSide !== "top" && `ic-tip ic-tip--${tipSide}`,
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      data-tip={tip}
      className={cls}
      style={rest.style}
      aria-label={rest["aria-label"] ?? (children ? undefined : tip)}
      aria-pressed={active === undefined ? undefined : active}
    >
      {loading ? (
        <Spinner size={13} />
      ) : (
        icon && <Icon name={icon} size={size === "sm" ? 13 : 15} />
      )}
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "1.6px solid rgb(var(--ic-line-strong))",
        borderTopColor: "rgb(var(--ic-accent))",
        animation: "ic-spin .7s linear infinite",
        display: "inline-block",
        flex: "none"
      }}
    />
  );
}

export function Dots() {
  return (
    <span className="ic-dots" aria-label="работает">
      <span />
      <span />
      <span />
    </span>
  );
}

export function Equalizer() {
  return (
    <span className="ic-equalizer" aria-label="работает">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  htmlFor
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-[12.5px] font-medium leading-tight text-ink">{label}</span>
        {hint && <span className="text-[11px] leading-tight text-ink-mute">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ic-input ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`ic-input ${props.className ?? ""}`} />;
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  className = ""
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <select
      className={`ic-input ${className}`}
      value={value}
      onChange={e => onChange(e.target.value as T)}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="ic-switch"
      data-on={checked}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  items
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ value: T; label: string; icon?: IconName; tip?: string }>;
}) {
  return (
    <div className="ic-seg" role="tablist">
      {items.map(it => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          data-on={value === it.value}
          data-tip={it.tip}
          onClick={() => onChange(it.value)}
        >
          {it.icon && <Icon name={it.icon} size={13} />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Row({
  icon,
  title,
  subtitle,
  right,
  children,
  onClick,
  active
}: {
  icon?: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <div
      className={`flex items-start gap-3 rounded-xl2 border border-line p-3 transition-all duration-200 ${
        active ? "bg-accent/8 border-accent/30" : "bg-raised/50"
      }`}
    >
      {icon && (
        <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-lg bg-sunken border border-line text-ink-soft">
          <Icon name={icon} size={14} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <Tag
          {...(onClick ? { onClick, type: "button" as const } : {})}
          className={`text-left text-[12.5px] font-medium text-ink ${onClick ? "hover:text-accent transition-colors" : ""}`}
        >
          {title}
        </Tag>
        {subtitle && <p className="mt-0.5 text-[11.5px] leading-snug text-ink-mute">{subtitle}</p>}
        {children}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

export function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  width = 560
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        // Trap focus so the dialog is fully keyboard-navigable.
        const nodes = ref.current.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])'
        );
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const t = window.setTimeout(() => {
      const nodes = ref.current?.querySelectorAll<HTMLElement>("input,button,select,textarea");
      nodes?.[0]?.focus();
    }, 60);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ic-overlay grid place-items-center p-6" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ic-modal w-full overflow-hidden rounded-xl3 border border-line-strong bg-surface"
        style={{ maxWidth: width }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          {icon && (
            <span
              className="grid h-8 w-8 place-items-center rounded-lg text-white"
              style={{ background: "var(--ic-grad)" }}
            >
              <Icon name={icon} size={15} />
            </span>
          )}
          <h2 id={titleId} className="flex-1 text-[14px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <Btn icon="x" tip="Закрыть  Esc" onClick={onClose} />
        </div>
        <div className="ic-scroll max-h-[min(70vh,640px)] px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-raised/40 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

export function StatusDot({
  status,
  size = 7
}: {
  status: "ready" | "error" | "checking" | "offline";
  size?: number;
}) {
  const color: Record<string, string> = {
    ready: "rgb(var(--ic-ok))",
    error: "rgb(var(--ic-danger))",
    checking: "rgb(var(--ic-warn))",
    offline: "rgb(var(--ic-ink-mute))"
  };
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color[status],
        boxShadow: `0 0 8px ${color[status]}`,
        animation: status === "checking" || status === "offline" ? "ic-blink 1.4s ease-in-out infinite" : undefined
      }}
    />
  );
}

export function Empty({
  icon,
  title,
  hint,
  action
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 max-w-md flex-col items-center justify-center gap-4 px-8 py-14 text-center">
      <span
        className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-line text-ink-mute"
        style={{
          background: "linear-gradient(160deg, rgb(var(--ic-accent) / 0.14), rgb(var(--ic-raised) / 0.6))",
          boxShadow: "0 18px 44px -22px rgb(var(--ic-accent) / 0.8)"
        }}
      >
        <Icon name={icon} size={26} />
      </span>
      <div className="min-w-0">
        <p className="text-balance text-[15px] font-semibold tracking-tight text-ink">{title}</p>
        {hint && (
          <p className="mx-auto mt-1.5 max-w-[min(38ch,100%)] text-pretty text-[12.5px] leading-relaxed text-ink-mute">
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ic-kbd">{children}</kbd>;
}

export function Bar({
  value,
  color,
  className = "",
  style
}: {
  value: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`ic-bar-stripes h-1 w-full overflow-hidden rounded-full bg-line/60 ${className}`}
      style={style}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-spring"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color ?? "var(--ic-grad)" }}
      />
    </div>
  );
}
