/**
 * Tool-call parsing.
 *
 * The model is a raw chat-completions model, so it can wrap calls in several
 * shapes. The original build only matched one literal tag and silently dropped
 * everything else. This parser is tolerant by design and — crucially — it also
 * works *incrementally*, so the streaming view can show prose without ever
 * leaking half a JSON payload into the chat.
 */

const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;

/** Strip zero-width characters that models love to inject into tags. */
export function normalizeCalls(text: string): string {
  return text.replace(INVISIBLE, "");
}

/** Find the index just past a balanced `{...}` starting at `from`, or -1. */
function matchBrace(src: string, from: number): number {
  let depth = 0;
  let inStr = false;
  let quote = "";
  let esc = false;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface RawCall {
  tool: string;
  args: Record<string, unknown>;
  start: number;
  end: number;
}

/** Coerce the many arg shapes a model produces into a plain object. */
function toCall(obj: any): RawCall | null {
  if (!obj || typeof obj !== "object") return null;
  // {"tool":"x","args":{…}} | {"name":"x","arguments":{…}} | {"function":{…}}
  let tool = obj.tool ?? obj.name ?? obj.tool_name;
  let args = obj.args ?? obj.arguments ?? obj.input ?? obj.parameters;
  if (!tool && obj.function) {
    tool = obj.function.name ?? obj.function.tool;
    args = obj.function.arguments ?? obj.function.args;
  }
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  if (typeof tool !== "string" || !tool.trim()) return null;
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  return { tool: tool.trim(), args, start: -1, end: -1 };
}

/** Locate every tool-call object, whatever wrapper the model used. */
function locate(src: string): RawCall[] {
  const found: RawCall[] = [];
  const taken: Array<[number, number]> = [];

  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);

  // 1) explicit tags: <tool_call>{…}</tool_call>  (also <tool>…</tool>)
  const tagRe = /<\s*(tool_call|tool|function_call)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    const bodyStart = m.index + m[0].indexOf(m[2]);
    const inner = m[2].trim();
    let call: RawCall | null = null;
    if (inner.startsWith("{")) {
      const close = matchBrace(src, bodyStart);
      if (close >= 0) {
        try {
          call = toCall(JSON.parse(src.slice(bodyStart, close + 1)));
        } catch {
          /* not JSON after all */
        }
      }
    }
    if (call) {
      call.start = m.index;
      call.end = m.index + m[0].length;
      found.push(call);
      taken.push([call.start, call.end]);
    }
  }

  // 2) fenced blocks: ```tool_call {…}
  const fenceRe = /```(?:tool_call|tool|json)?\s*\n?([\s\S]{0,20000}?)```/gi;
  while ((m = fenceRe.exec(src))) {
    const body = m[1].trim();
    if (!body.startsWith("{")) continue;
    if (!/["'](tool|name)["']\s*:/.test(body)) continue;
    try {
      const call = toCall(JSON.parse(body));
      if (call) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (!overlaps(start, end)) {
          call.start = start;
          call.end = end;
          found.push(call);
          taken.push([start, end]);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3) bare JSON objects anywhere in the text
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    if (overlaps(i, i + 1)) continue;
    const close = matchBrace(src, i);
    if (close < 0) continue;
    const slice = src.slice(i, close + 1);
    if (slice.length > 60_000) continue;
    if (!/["'](tool|name)["']\s*:/.test(slice)) continue;
    try {
      const call = toCall(JSON.parse(slice));
      if (call) {
        call.start = i;
        call.end = close + 1;
        found.push(call);
        taken.push([call.start, call.end]);
      }
    } catch {
      /* not a tool call */
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

export interface ParsedCall {
  tool: string;
  args: Record<string, unknown>;
  raw: string;
  malformed?: boolean;
  /** Offset in the source text, for streaming. */
  start: number;
  end: number;
  /** True when a payload looked like a call but could not be parsed. */
  broken: boolean;
}

export function parseToolCalls(rawText: string): ParsedCall[] {
  const src = normalizeCalls(rawText);
  const calls = locate(src);
  const out: ParsedCall[] = calls.map(c => ({
    tool: c.tool,
    args: c.args,
    raw: src.slice(c.start, c.end),
    start: c.start,
    end: c.end,
    broken: false
  }));

  // Salvage: a tag that opened but never produced valid JSON.
  const openRe = /<\s*tool_call\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(src))) {
    if (out.some(c => c.start <= m!.index && c.end > m!.index)) continue;
    const closeTag = src.indexOf("</tool_call>", m.index);
    const region = src.slice(m.index, closeTag >= 0 ? closeTag : Math.min(src.length, m.index + 20000));
    const toolM = /["'](?:tool|name)["']\s*:\s*["']([\w.-]+)["']/.exec(region);
    if (toolM) {
      out.push({
        tool: toolM[1],
        args: {},
        raw: region,
        start: m.index,
        end: closeTag >= 0 ? closeTag + "</tool_call>".length : src.length,
        broken: true,
        malformed: true
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Does this fragment look like the head of a tool call, even unfinished? */
function looksLikeCallHead(fragment: string): boolean {
  return /^\{\s*["'](?:tool|name|tool_name)["']\s*:/.test(fragment);
}

/** Join prose around a removed call block without inventing double spaces. */
function joinAroundCall(kept: string, tail: string): string {
  if (kept.length && /\s$/.test(kept)) return kept + tail.replace(/^\s+/, "");
  return kept + tail;
}

/** Final text with every call block removed — what the user actually reads. */
export function stripCalls(rawText: string): string {
  const src = normalizeCalls(rawText);
  const calls = locate(src);
  let out = "";
  let cursor = 0;
  for (const c of calls) {
    out += src.slice(cursor, c.start);
    cursor = c.end;
  }
  out = joinAroundCall(out, src.slice(cursor));
  return out
    .replace(/```(?:tool_call|tool|json)?\s*\n?[\s\S]*?```/gi, "")
    .replace(/<\s*\/?\s*(tool_call|tool|function_call)\s*>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Streaming-safe visible prefix.
 *
 * While tokens are still arriving we must not paint a half-written call into
 * the transcript, and we must not paint prose that is *about* to become a call
 * either — so we cut at the first incomplete block.
 */
export function visiblePrefix(rawText: string): string {
  const src = normalizeCalls(rawText);
  const calls = locate(src);
  let out = "";
  let cursor = 0;
  for (const c of calls) {
    out += src.slice(cursor, c.start);
    cursor = c.end;
  }
  let tail = src.slice(cursor);

  // An unfinished opening tag → hide everything from it on.
  const open = tail.search(/<\s*(tool_call|tool|function_call)\s*>|```(?:tool_call|tool|json)/i);
  if (open >= 0) tail = tail.slice(0, open);

  // A bare JSON payload that has not closed yet.
  const brace = tail.lastIndexOf("{");
  if (brace >= 0 && looksLikeCallHead(tail.slice(brace)) && matchBrace(tail, brace) < 0) {
    tail = tail.slice(0, brace);
  }

  out = joinAroundCall(out, tail);
  return out
    .replace(/```(?:tool_call|tool|json)?\s*\n?[\s\S]*?```$/i, "")
    .replace(/<\s*\/?\s*(tool_call|tool|function_call)\s*>$/i, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}
