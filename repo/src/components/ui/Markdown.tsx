/**
 * Compact Markdown renderer.
 *
 * Agent output is Markdown-ish, so a real renderer matters for readability.
 * This one is intentionally small: headings, lists, quotes, fences, tables,
 * rules, links and the usual inline marks. No HTML pass-through — everything
 * goes through React children, so a model can never inject markup.
 */
import { memo, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../icons";

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

type Inline = string;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first so its content is never re-parsed as markup.
  const pattern =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]*\]\([^)\s]*\))|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded-md border border-line bg-sunken px-1.5 py-0.5 font-mono text-[0.86em] text-violet"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("[")) {
      const mLink = /^\[([^\]]*)\]\(([^)\s]*)\)$/.exec(tok);
      if (mLink) {
        out.push(
          <a
            key={key}
            href={mLink[2]}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
          >
            {mLink[1] || mLink[2]}
          </a>
        );
      }
    } else if (tok.startsWith("http")) {
      out.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
        >
          {tok.replace(/^https?:\/\//, "").slice(0, 60)}
        </a>
      );
    } else {
      out.push(
        <em key={key} className="italic text-ink-soft">
          {tok.slice(1, -1)}
        </em>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ------------------------------------------------------------------ *
 * Code fence
 * ------------------------------------------------------------------ */

const LANG_LABEL: Record<string, string> = {
  ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX", json: "JSON",
  rust: "Rust", py: "Python", sh: "Shell", bash: "Shell", css: "CSS",
  html: "HTML", sql: "SQL", yaml: "YAML", toml: "TOML", md: "Markdown", rs: "Rust"
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const label = LANG_LABEL[lang.toLowerCase()] ?? (lang || "code");
  const lines = code.split("\n").length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-sunken">
      <div className="flex items-center gap-2 border-b border-line bg-raised/60 px-2.5 py-1.5">
        <span className="ic-mono text-[10.5px] uppercase tracking-wider text-ink-mute">{label}</span>
        <span className="text-[10.5px] text-ink-mute">· {lines} стр.</span>
        <span className="flex-1" />
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-mute transition-colors hover:bg-overlay hover:text-ink"
        >
          <Icon name={copied ? "check" : "copy"} size={11} />
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <pre className="ic-scroll max-h-[420px] overflow-auto px-3 py-2.5">
        <code className="font-mono text-[12px] leading-[1.6] text-ink-soft">{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Block parser
 * ------------------------------------------------------------------ */

export const Markdown = memo(function Markdown({ text, dense }: { text: string; dense?: boolean }) {
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <div className={dense ? "text-[12.5px] leading-[1.62]" : "text-[13.5px] leading-[1.68]"}>
      <MarkdownBlocks blocks={blocks} />
    </div>
  );
});

type Block =
  | { k: "p"; v: string }
  | { k: "h"; lvl: number; v: string }
  | { k: "code"; lang: string; v: string }
  | { k: "ul"; items: string[] }
  | { k: "ol"; items: string[] }
  | { k: "quote"; v: string }
  | { k: "hr" }
  | { k: "table"; head: string[]; rows: string[][] };

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const lang = fence[2] || "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      out.push({ k: "code", lang, v: body.join("\n") });
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ k: "h", lvl: h[1].length, v: h[2].trim() });
      i++;
      continue;
    }

    // rule
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      out.push({ k: "hr" });
      i++;
      continue;
    }

    // table
    if (line.includes("|") && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1] ?? "")) {
      const cells = (r: string) =>
        r
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push({ k: "table", head, rows });
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push({ k: "quote", v: body.join("\n") });
      continue;
    }

    // lists
    const bullet = /^\s*[-*•]\s+/;
    const ordered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (isOrdered && ordered.test(l)) items.push(l.replace(ordered, ""));
        else if (!isOrdered && bullet.test(l)) items.push(l.replace(bullet, ""));
        else if (l.trim() && /^\s{2,}\S/.test(l) && items.length) {
          // continuation line
          items[items.length - 1] += " " + l.trim();
        } else break;
        i++;
      }
      out.push({ k: isOrdered ? "ol" : "ul", items });
      continue;
    }

    // paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*([#>]|[-*•]\s|\d+[.)]\s|(`{3,}|~{3,}))/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push({ k: "p", v: para.join(" ") });
    else i++;
  }

  return out;
}

const H_STYLE: Record<number, string> = {
  1: "text-[16px] font-semibold tracking-tight text-ink mt-3.5 mb-1.5",
  2: "text-[14.5px] font-semibold tracking-tight text-ink mt-3 mb-1",
  3: "text-[13.5px] font-semibold text-ink mt-2.5 mb-1",
  4: "text-[13px] font-semibold text-ink-soft mt-2 mb-0.5",
  5: "text-[12.5px] font-semibold text-ink-soft mt-2 mb-0.5",
  6: "text-[12px] font-semibold text-ink-mute mt-2 mb-0.5 uppercase tracking-wide"
};

export function MarkdownBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, idx) => {
        const key = `b${idx}`;
        switch (b.k) {
          case "h":
            return (
              <div key={key} className={H_STYLE[b.lvl]}>
                {renderInline(b.v, key)}
              </div>
            );
          case "p":
            return (
              <p key={key} className="my-1.5 whitespace-pre-wrap">
                {renderInline(b.v, key)}
              </p>
            );
          case "code":
            return <CodeBlock key={key} lang={b.lang} code={b.v} />;
          case "ul":
            return (
              <ul key={key} className="my-1.5 space-y-1 pl-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                    <span className="min-w-0 flex-1">{renderInline(it, `${key}-${j}`)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="my-1.5 space-y-1 pl-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="mt-[1px] grid h-[17px] w-[17px] shrink-0 place-items-center rounded-md bg-accent/12 text-[10.5px] font-semibold tabular text-accent">
                      {j + 1}
                    </span>
                    <span className="min-w-0 flex-1">{renderInline(it, `${key}-${j}`)}</span>
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="my-2 border-l-2 border-accent/50 bg-accent/6 py-1.5 pl-3 pr-2 text-ink-soft"
              >
                {renderInline(b.v, key)}
              </blockquote>
            );
          case "hr":
            return <hr key={key} className="my-3 border-line" />;
          case "table":
            return (
              <div key={key} className="ic-scroll my-2 overflow-x-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-raised/70">
                      {b.head.map((h, j) => (
                        <th key={j} className="border-b border-line px-2.5 py-1.5 text-left font-semibold text-ink-soft">
                          {renderInline(h, `${key}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-b border-line/60 last:border-0">
                        {r.map((c, k) => (
                          <td key={k} className="px-2.5 py-1.5 align-top text-ink-soft">
                            {renderInline(c, `${key}-r${j}-${k}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

export { parse as parseMarkdown };
export type { Block as MarkdownBlock, Inline };
