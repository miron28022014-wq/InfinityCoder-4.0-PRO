/**
 * Дизайн-система Infinity Ecosystem.
 *
 * Единые токены для Windows, Android и Web. Приложения обязаны брать
 * цвета, отступы и радиусы отсюда, а не задавать свои значения.
 */

export const designTokens = {
  color: {
    bg: '#0d1117',
    bgElevated: '#161b22',
    bgElevated2: '#1c2129',
    border: '#2b323b',
    text: '#e6edf3',
    textDim: '#8b949e',
    accent: '#4c8dff',
    accentSoft: 'rgba(76, 141, 255, 0.14)',
    danger: '#f4685f',
    success: '#3fb950',
    warning: '#d29922',
  },
  space: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
  },
  radius: {
    sm: 6, md: 10, lg: 14, pill: 999,
  },
  font: {
    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    size: {
      xs: 11, sm: 12, md: 14, lg: 16, xl: 18,
    },
  },
  /** Статусы функций — единый словарь для всего экосистемы. */
  status: {
    done: 'РЕАЛИЗОВАНО И ПРОВЕРЕНО',
    doneUnverified: 'РЕАЛИЗОВАНО, НО НЕ ПРОВЕРЕНО',
    partial: 'ЧАСТИЧНО',
    notImplemented: 'НЕ РЕАЛИЗОВАНО',
  },
} as const;

export type DesignTokens = typeof designTokens;
export type FeatureStatus = (typeof designTokens.status)[keyof typeof designTokens.status];

/** CSS-переменные для веб-клиентов. */
export function cssVariables(): string {
  const c = designTokens.color;
  return `:root {
  --bg: ${c.bg};
  --bg-elev: ${c.bgElevated};
  --bg-elev-2: ${c.bgElevated2};
  --border: ${c.border};
  --text: ${c.text};
  --text-dim: ${c.textDim};
  --accent: ${c.accent};
  --accent-soft: ${c.accentSoft};
  --danger: ${c.danger};
  --ok: ${c.success};
  --warn: ${c.warning};
  --radius: ${designTokens.radius.md}px;
  --font: ${designTokens.font.family};
  --mono: ${designTokens.font.mono};
}`;
}
