/**
 * Дизайн-система Infinity Ecosystem.
 *
 * Значения совпадают с `packages/core/src/design/tokens.ts` в ядре: один
 * словарь цветов, радиусов, отступов и статусов для Windows, Android и Web.
 * IDE не заводит собственную палитру — она берёт отсюда.
 */

export const ecoColors = {
  bg: "#0d1117",
  bgElevated: "#161b22",
  bgElevated2: "#1c2129",
  border: "#2b323b",
  text: "#e6edf3",
  textDim: "#8b949e",
  accent: "#4c8dff",
  accentSoft: "rgba(76, 141, 255, 0.14)",
  danger: "#f4685f",
  success: "#3fb950",
  warning: "#d29922"
} as const;

export const ecoSpace = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const ecoRadius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const ecoFont = {
  family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
} as const;

/**
 * Статусы функций — единый словарь экосистемы. Используется в панели
 * «Экосистема» и в отчётах, чтобы статусы совпадали с остальными приложениями.
 */
export const ecoStatus = {
  done: "РЕАЛИЗОВАНО И ПРОВЕРЕНО",
  doneUnverified: "РЕАЛИЗОВАНО, НО НЕ ПРОВЕРЕНО",
  partial: "ЧАСТИЧНО",
  notImplemented: "НЕ РЕАЛИЗОВАНО"
} as const;

export type EcoStatus = (typeof ecoStatus)[keyof typeof ecoStatus];

/** RGB-тройки для CSS-переменных (совпадают с `--ic-*` в index.css). */
export const ecoCssVariables = `
  --eco-bg: ${ecoColors.bg};
  --eco-bg-elevated: ${ecoColors.bgElevated};
  --eco-bg-elevated-2: ${ecoColors.bgElevated2};
  --eco-border: ${ecoColors.border};
  --eco-text: ${ecoColors.text};
  --eco-text-dim: ${ecoColors.textDim};
  --eco-accent: ${ecoColors.accent};
  --eco-accent-soft: ${ecoColors.accentSoft};
  --eco-danger: ${ecoColors.danger};
  --eco-success: ${ecoColors.success};
  --eco-warning: ${ecoColors.warning};
`;

/** hex → "r g b" для Tailwind-переменных вида rgb(var(--eco-accent) / <alpha>). */
export function rgbTriple(hex: string): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}
