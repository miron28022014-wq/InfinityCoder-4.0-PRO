/** InfinityCoder design tokens → Tailwind theme. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic layers (mapped to CSS variables so themes swap instantly)
        canvas: "rgb(var(--ic-canvas) / <alpha-value>)",
        surface: "rgb(var(--ic-surface) / <alpha-value>)",
        raised: "rgb(var(--ic-raised) / <alpha-value>)",
        sunken: "rgb(var(--ic-sunken) / <alpha-value>)",
        overlay: "rgb(var(--ic-overlay) / <alpha-value>)",
        line: "rgb(var(--ic-line) / <alpha-value>)",
        "line-strong": "rgb(var(--ic-line-strong) / <alpha-value>)",
        ink: "rgb(var(--ic-ink) / <alpha-value>)",
        "ink-soft": "rgb(var(--ic-ink-soft) / <alpha-value>)",
        "ink-mute": "rgb(var(--ic-ink-mute) / <alpha-value>)",
        accent: "rgb(var(--ic-accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--ic-accent-soft) / <alpha-value>)",
        "accent-ink": "rgb(var(--ic-accent-ink) / <alpha-value>)",
        violet: "rgb(var(--ic-violet) / <alpha-value>)",
        ok: "rgb(var(--ic-ok) / <alpha-value>)",
        warn: "rgb(var(--ic-warn) / <alpha-value>)",
        danger: "rgb(var(--ic-danger) / <alpha-value>)",
        info: "rgb(var(--ic-info) / <alpha-value>)"
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI Variable", "Segoe UI", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "SF Mono", "Consolas", "ui-monospace", "monospace"]
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }]
      },
      borderRadius: { xl2: "0.875rem", xl3: "1.125rem" },
      boxShadow: {
        soft: "var(--ic-shadow-soft)",
        pop: "var(--ic-shadow-pop)",
        inset: "inset 0 1px 0 0 rgb(var(--ic-hi) / 0.05)"
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
        emphasized: "cubic-bezier(0.4, 0, 0.2, 1)"
      }
    }
  },
  plugins: []
};
