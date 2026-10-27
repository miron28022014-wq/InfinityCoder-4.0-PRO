/**
 * InfinityCoder icon set.
 * Hand-rolled 24×24 stroke icons — no icon-font, no emoji, no runtime deps.
 * Every glyph is drawn on the same grid with a 1.7 stroke so the UI stays even.
 */
import type { CSSProperties } from "react";

export type IconName =
  | "infinity" | "folder" | "folderOpen" | "file" | "fileCode" | "fileText"
  | "chevronRight" | "chevronDown" | "chevronLeft" | "chevronUp"
  | "search" | "settings" | "brain" | "swarm" | "memory" | "send" | "stop"
  | "check" | "checkCircle" | "x" | "xCircle" | "alert" | "terminal" | "edit"
  | "trash" | "plus" | "refresh" | "play" | "save" | "sun" | "moon"
  | "user" | "bot" | "sparkles" | "branch" | "commit" | "clock" | "layers"
  | "panelLeft" | "panelRight" | "book" | "zap" | "shield" | "copy"
  | "external" | "more" | "cornerDownRight" | "hash" | "activity" | "target"
  | "rocket" | "wand" | "bookOpen" | "list" | "download" | "eye" | "eyeOff"
  | "key" | "server" | "cpu" | "disk" | "history" | "rotate" | "arrowUp"
  | "arrowRight" | "grid" | "stack" | "flask" | "shieldCheck" | "globe" | "info"
  | "link" | "unlink" | "pin" | "menu" | "square" | "checkSquare" | "squareOff";

/** Single-path glyphs keep the bundle small; multi-part glyphs use fragments. */
const PATHS: Record<IconName, string> = {
  infinity:
    "M12 12c-1.6-2.4-3-3.6-4.6-3.6A3.4 3.4 0 0 0 4 11.8a3.4 3.4 0 0 0 3.4 3.4c2.6 0 4-4.4 6.6-4.4 1.6 0 3 1.2 4.6 3.4M12 12c1.6-2.4 3-3.6 4.6-3.6A3.4 3.4 0 0 1 20 11.8a3.4 3.4 0 0 1-3.4 3.4c-2.6 0-4-4.4-6.6-4.4-1.6 0-3 1.2-4.6 3.4",
  folder: "M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z",
  folderOpen: "M3 8.5A1.5 1.5 0 0 1 4.5 7h3.8l1.8 2.4h9.4A1.5 1.5 0 0 1 21 10.9v.6M3.6 18.6A1.5 1.5 0 0 0 5 19.9h13.1a1.5 1.5 0 0 0 1.44-1.08L21 13.4H6.2a1.5 1.5 0 0 0-1.44 1.08z",
  file: "M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5zM14 3.5V7a.5.5 0 0 0 .5.5H18",
  fileCode: "M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5zM14 3.5V7a.5.5 0 0 0 .5.5H18M10 12.5L8 14.5l2 2M14 12.5l2 2-2 2",
  fileText: "M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5zM14 3.5V7a.5.5 0 0 0 .5.5H18M9 12h6M9 15.5h4",
  chevronRight: "M9.5 5.5 16 12l-6.5 6.5",
  chevronDown: "M5.5 9.5 12 16l6.5-6.5",
  chevronLeft: "M14.5 5.5 8 12l6.5 6.5",
  chevronUp: "M5.5 14.5 12 8l6.5 6.5",
  search: "M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13M15.8 15.8 20 20",
  settings:
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4M19.3 14.6a1.5 1.5 0 0 0 .3 1.65l.06.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.91 1.37V20a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06a1.8 1.8 0 1 1-2.55-2.55l.06-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.91H4.4a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.06-.06A1.8 1.8 0 1 1 8.06 4.76l.06.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .91-1.37V3.6a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.8 1.8 0 1 1 2.55 2.55l-.06.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.91h.14a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.37.91z",
  brain:
    "M9.5 4.2A2.7 2.7 0 0 0 6.8 6.9a2.6 2.6 0 0 0-1.9 4.4A2.8 2.8 0 0 0 6.6 15a2.6 2.6 0 0 0 2.9 3.2 2.4 2.4 0 0 0 2.5-1.8V6.4a2.4 2.4 0 0 0-2.5-2.2M14.5 4.2A2.7 2.7 0 0 1 17.2 6.9a2.6 2.6 0 0 1 1.9 4.4A2.8 2.8 0 0 1 17.4 15a2.6 2.6 0 0 1-2.9 3.2 2.4 2.4 0 0 1-2.5-1.8V6.4A2.4 2.4 0 0 1 14.5 4.2M9.5 9.5H8M14.5 9.5H16M9.5 13h-.5M14.5 13H15",
  swarm:
    "M12 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5M5 19.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5M19 19.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5M10.6 7 6.4 15.2M13.4 7l4.2 8.2M7.25 17.25h9.5",
  memory:
    "M12 8.5c-3.9 0-7 1.35-7 3s3.1 3 7 3 7-1.35 7-3-3.1-3-7-3M5 11.5v6c0 1.65 3.1 3 7 3s7-1.35 7-3v-6M5 14v5c0 1.65 3.1 3 7 3s7-1.35 7-3v-5",
  send: "M12 19.5V5M12 5 6.5 10.5M12 5l5.5 5.5",
  stop: "M7.5 7.5h9v9h-9z",
  check: "M5 12.5 9.5 17 19 7",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12.2l2.7 2.7L16 9.5",
  x: "M6 6l12 12M18 6 6 18",
  xCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9 9l6 6M15 9l-6 6",
  alert: "M12 4.5 21 19.5H3zM12 10v4M12 16.8v.2",
  terminal: "M5 7.5 9.5 12 5 16.5M12 17h7",
  edit: "M4.5 19.5h3.2L18.4 8.8a2.26 2.26 0 0 0-3.2-3.2L4.5 16.3zM14.5 6.5l3 3",
  trash: "M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v5.5M14 11v5.5",
  plus: "M12 5.5v13M5.5 12h13",
  refresh: "M20 12a8 8 0 1 1-2.6-5.9M20 4.5V10h-5.4",
  play: "M8 5.5 18.5 12 8 18.5z",
  save: "M5 5.8A1.8 1.8 0 0 1 6.8 4h9.4L20 7.8v11.4A1.8 1.8 0 0 1 18.2 21H6.8A1.8 1.8 0 0 1 5 19.2zM8.5 4v5.5h6.5V4.4M8 21v-6h8v6",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4",
  moon: "M20 13.4A8.5 8.5 0 0 1 10.6 4a8.5 8.5 0 1 0 9.4 9.4z",
  user: "M12 12a3.75 3.75 0 1 0 0-7.5A3.75 3.75 0 0 0 12 12M4.5 20.2a7.5 7.5 0 0 1 15 0",
  bot: "M12 3.5v3M6.5 9.5h11A2.5 2.5 0 0 1 20 12v5.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V12a2.5 2.5 0 0 1 2.5-2.5M9.5 13.5v1.5M14.5 13.5v1.5",
  sparkles: "M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
  branch: "M7 5.5v13M7 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 9.5a4 4 0 0 1-4 4H9.5M7 15.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  commit: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9M12 7.5V4M3.5 12h2M18.5 12h2",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5.3l3.3 2",
  layers: "M12 3.5 21 8l-9 4.5L3 8zM3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5",
  panelLeft: "M4 5.8A1.8 1.8 0 0 1 5.8 4h12.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2zM9.5 4v16",
  panelRight: "M4 5.8A1.8 1.8 0 0 1 5.8 4h12.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2zM14.5 4v16",
  book: "M5 5.2A1.7 1.7 0 0 1 6.7 3.5H19v14.8H6.7A1.7 1.7 0 0 0 5 20v.3M5 20a1.7 1.7 0 0 0 1.7 1.7H19v-3.4",
  zap: "M13.5 3 5.5 13.2h5.6L10.5 21l8-10.2h-5.6z",
  shield: "M12 3.5 5 6.2v5.4c0 4.2 2.9 8.1 7 9.4 4.1-1.3 7-5.2 7-9.4V6.2z",
  shieldCheck: "M12 3.5 5 6.2v5.4c0 4.2 2.9 8.1 7 9.4 4.1-1.3 7-5.2 7-9.4V6.2zM9 12l2.2 2.2L15.5 10",
  copy: "M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5zM15 8V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H9",
  external: "M13.5 4.5H19.5v6M19.5 4.5 11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  cornerDownRight: "M6 4.5v7a2 2 0 0 0 2 2h9M14 10.5l3 3-3 3",
  hash: "M5 9.5h14M5 14.5h14M10 4l-2 16M16 4l-2 16",
  activity: "M3.5 12h4l2.5-7 4 14 2.5-7h4",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4",
  rocket: "M13.5 4.5c3.5 0 6 2.5 6 6 0 4-4.2 7.5-8.5 9l-2.5-2.5C10 12.7 13.5 8.5 13.5 4.5M9.5 14.5 6 18M6.8 10.5 4 10l2.2-3.2M13 17v2.5l-3.2-2.2",
  wand: "M5 19 16 8M14 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.6 1.3 1.4.5-1.4.6-.6 1.3-.6-1.3-1.4-.6 1.4-.5z",
  bookOpen: "M12 6.5S10 4.5 6 4.5c-1.2 0-2 .2-2 .2v13s.8-.2 2-.2c4 0 6 2 6 2s2-2 6-2c1.2 0 2 .2 2 .2v-13s-.8-.2-2-.2c-4 0-6 2-6 2M12 6.5v13",
  list: "M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01",
  download: "M12 4v11M12 15l-4-4M12 15l4-4M4.5 18.5h15",
  eye: "M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6",
  eyeOff: "M9.6 6.3A9.3 9.3 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.8 3.5M6.3 7.8A15 15 0 0 0 2.5 12S6 18 12 18a9 6 0 0 0 3.4-.6M4 4l16 16M10.4 10.4a2.8 2.8 0 0 0 3.2 3.2",
  key: "M15.5 9.5a3.5 3.5 0 1 1-3.5-3.5 3.5 3.5 0 0 1 3.5 3.5M13 12 4.5 20.5M7.5 17l2-2M10 14.5l2-2",
  server: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v3A1.5 1.5 0 0 1 18.5 11h-13A1.5 1.5 0 0 1 4 9.5zM4 14.5A1.5 1.5 0 0 1 5.5 13h13a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM7.5 8h.01M7.5 16h.01",
  cpu: "M7.5 7.5h9v9h-9zM9.5 3.5v2M14.5 3.5v2M9.5 18.5v2M14.5 18.5v2M3.5 9.5h2M3.5 14.5h2M18.5 9.5h2M18.5 14.5h2",
  disk: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  history: "M4 12a8 8 0 1 0 2.4-5.7M4 4.5V10h5.5M12 8v4.5l3 1.8",
  rotate: "M3.5 12a8.5 8.5 0 1 1 2.6 6.1M3.5 20.5V15H9",
  arrowUp: "M12 20V5M12 5 6 11M12 5l6 6",
  arrowRight: "M4.5 12h15M14 6.5l5.5 5.5L14 17.5",
  grid: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  stack: "M4 6.5 12 3l8 3.5-8 3.5zM4 12l8 3.5 8-3.5M4 17l8 3.5 8-3.5",
  flask: "M10 3.5h4M10.8 3.5v5.2L5.4 17.3A2 2 0 0 0 7.1 20.2h9.8a2 2 0 0 0 1.7-2.9l-5.4-8.6V3.5M7.8 14.5h8.4",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3.5 12h17M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 7.6v.2",
  link: "M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.2 1.2M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.2-1.2",
  unlink: "M9.5 14.5 5 19M8 12.5l-1 1a3.5 3.5 0 0 0 5 5l2-2M16 11.5l1-1a3.5 3.5 0 0 0-5-5l-1.5 1.5M4 4l16 16",
  pin: "M12 21v-6.5M8.5 3.5h7l-1 5 2.5 3v2.5H7V11.5l2.5-3z",
  menu: "M4 7h16M4 12h16M4 17h16",
  square: "M6 6h12v12H6z",
  checkSquare: "M4.5 6.8A1.8 1.8 0 0 1 6.3 5h11.4a1.8 1.8 0 0 1 1.8 1.8v10.4a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8zM8.5 12l2.5 2.5 4.5-5",
  squareOff: "M6 6h12v12H6zM4 4l16 16"
};

/** Glyphs that need an extra dot/square head — kept out of the main path string. */
const FILLED = new Set<IconName>(["more"]);

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  /** Solid render for glyphs that read better filled (stop, play, diamond). */
  solid?: boolean;
  title?: string;
}

export function Icon({ name, size = 16, className = "", style, strokeWidth = 1.7, solid, title }: IconProps) {
  const filled = solid ?? FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ic-drag-none shrink-0 ${className}`}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {filled ? (
        <path d={PATHS[name]} fill="currentColor" stroke="none" />
      ) : (
        <path d={PATHS[name]} />
      )}
    </svg>
  );
}

/** Brand mark — infinity glyph in a gradient tile. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      className="ic-drag-none relative inline-grid place-items-center rounded-[9px]"
      style={{
        width: size,
        height: size,
        background: "var(--ic-grad)",
        boxShadow: "0 4px 14px -4px rgb(var(--ic-accent) / 0.75), inset 0 1px 0 rgb(255 255 255 / 0.25)",
      }}
    >
      <Icon name="infinity" size={size * 0.68} strokeWidth={2} style={{ color: "#fff" }} />
    </span>
  );
}
