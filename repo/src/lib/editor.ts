/**
 * CodeMirror 6 setup.
 *
 * Monaco pulls ~5 MB of JavaScript and needs a multi-gigabyte heap just to
 * bundle, which makes `npm run tauri:build` fragile on ordinary machines.
 * CodeMirror 6 is ~300 KB, builds in seconds and is themed from the same
 * tokens as the rest of the shell, so the editor reads as part of the app
 * instead of a bolted-on widget.
 */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion
} from "@codemirror/autocomplete";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap, search } from "@codemirror/search";
import { lintKeymap, lintGutter } from "@codemirror/lint";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";

import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";

/* ================================================================== *
 * Language resolution
 * ================================================================== */

const cache = new Map<string, () => Extension>();

function loader(load: () => Extension): () => Extension {
  let ext: Extension | undefined;
  return () => (ext ??= load());
}

export function languageExtension(path: string): () => Extension {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";

  const key = /^(dockerfile|makefile|readme|license|gitignore|editorconfig)/.test(lower)
    ? lower
    : ext;
  const hit = cache.get(key);
  if (hit) return hit;

  const pick = (): (() => Extension) => {
    switch (key) {
      case "ts":
      case "tsx":
      case "js":
      case "jsx":
      case "mjs":
      case "cjs":
        return loader(() => javascript({ jsx: key === "tsx" || key === "jsx", typescript: key === "ts" || key === "tsx" }));
      case "json":
      case "jsonc":
      case "webmanifest":
        return loader(() => json());
      case "css":
      case "scss":
      case "less":
        return loader(() => css());
      case "html":
      case "htm":
      case "vue":
      case "svelte":
        return loader(() => html());
      case "xml":
      case "svg":
        return loader(() => xml());
      case "py":
      case "pyi":
        return loader(() => python());
      case "rs":
        return loader(() => rust());
      case "go":
        return loader(() => go());
      case "java":
        return loader(() => java());
      case "php":
        return loader(() => php());
      case "c":
      case "h":
        return loader(() => cpp());
      case "cpp":
      case "cc":
      case "hpp":
      case "cxx":
        return loader(() => cpp());
      case "sql":
        return loader(() => sql());
      case "yaml":
      case "yml":
        return loader(() => yaml());
      case "md":
      case "markdown":
        return loader(() => markdown());
      case "toml":
      case "ini":
      case "cfg":
      case "env":
        return loader(() => yamlFrontMatterAware());
      default:
        return () => [];
    }
  };

  const fn = pick();
  cache.set(key, fn);
  return fn;
}

/** TOML/INI are close enough to YAML for highlighting purposes. */
function yamlFrontMatterAware(): Extension {
  return yaml();
}

/* ================================================================== *
 * Theme
 * ================================================================== */

const editorBase = EditorView.theme({
  "&": {
    height: "100%",
    color: "rgb(var(--ic-ink-soft))",
    backgroundColor: "rgb(var(--ic-canvas))",
    fontSize: "13px"
  },
  ".cm-content": {
    caretColor: "rgb(var(--ic-accent))",
    padding: "12px 0 32px 0",
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
    lineHeight: "1.6"
  },
  ".cm-scroller": {
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
    lineHeight: "1.6",
    overflow: "auto"
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "rgb(var(--ic-accent))", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgb(var(--ic-accent) / 0.22) !important"
  },
  ".cm-activeLine": { backgroundColor: "rgb(var(--ic-raised) / 0.42)" },
  ".cm-activeLineGutter": {
    backgroundColor: "rgb(var(--ic-raised) / 0.55)",
    color: "rgb(var(--ic-ink))"
  },
  ".cm-gutters": {
    backgroundColor: "rgb(var(--ic-canvas))",
    color: "rgb(var(--ic-ink-mute))",
    border: "none",
    borderRight: "1px solid rgb(var(--ic-line))"
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 10px", minWidth: "38px" },
  ".cm-foldPlaceholder": {
    backgroundColor: "rgb(var(--ic-accent) / 0.16)",
    border: "none",
    color: "rgb(var(--ic-accent))",
    borderRadius: "4px",
    padding: "0 6px",
    margin: "0 2px"
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgb(var(--ic-accent) / 0.22)",
    outline: "1px solid rgb(var(--ic-accent) / 0.45)",
    borderRadius: "2px"
  },
  ".cm-nonmatchingBracket": { color: "rgb(var(--ic-danger))" },
  ".cm-tooltip": {
    backgroundColor: "rgb(var(--ic-overlay))",
    border: "1px solid rgb(var(--ic-line-strong))",
    borderRadius: "10px",
    boxShadow: "var(--ic-shadow-pop)",
    color: "rgb(var(--ic-ink))"
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "3px 8px",
    borderRadius: "6px"
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "rgb(var(--ic-accent))",
    color: "#fff"
  },
  ".cm-panels": {
    backgroundColor: "rgb(var(--ic-surface))",
    color: "rgb(var(--ic-ink-soft))",
    borderTop: "1px solid rgb(var(--ic-line))"
  },
  ".cm-panel input, .cm-panel button": {
    backgroundColor: "rgb(var(--ic-sunken))",
    border: "1px solid rgb(var(--ic-line))",
    borderRadius: "6px",
    color: "rgb(var(--ic-ink))",
    padding: "2px 6px"
  },
  ".cm-searchMatch": {
    backgroundColor: "rgb(var(--ic-warn) / 0.28)",
    outline: "1px solid rgb(var(--ic-warn) / 0.5)"
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgb(var(--ic-warn) / 0.55)" },
  ".cm-placeholder": { color: "rgb(var(--ic-ink-mute))" },
  ".cm-lintRange-error": {
    backgroundImage:
      "none",
    borderBottom: "2px wavy rgb(var(--ic-danger) / 0.7)"
  }
});

const syntaxTheme = EditorView.theme(
  {
    ".tok-keyword, .ͼb": { color: "rgb(var(--ic-violet))" },
    ".tok-string, .ͼc": { color: "rgb(143 214 154)" },
    ".tok-number, .ͼd": { color: "rgb(245 176 76)" },
    ".tok-comment, .ͼe": { color: "rgb(var(--ic-ink-mute))", fontStyle: "italic" },
    ".tok-typeName, .ͼf": { color: "rgb(var(--ic-accent))" },
    ".tok-variableName, .ͼg": { color: "rgb(var(--ic-ink-soft))" },
    ".tok-propertyName, .ͼh": { color: "rgb(var(--ic-info))" },
    ".ͼi": { color: "rgb(var(--ic-ink))" },
    ".ͼj": { color: "rgb(255 138 172)" }
  },
  { dark: true }
);

const syntaxThemeLight = EditorView.theme(
  {
    ".ͼb": { color: "#7C3AED" },
    ".ͼc": { color: "#15803D" },
    ".ͼd": { color: "#B45309" },
    ".ͼe": { color: "#8A93A5", fontStyle: "italic" },
    ".ͼf": { color: "#4C6EF5" },
    ".ͼg": { color: "#31384A" },
    ".ͼh": { color: "#0C7B9E" },
    ".ͼi": { color: "#181C26" },
    ".ͼj": { color: "#BE185D" }
  },
  { dark: false }
);

/* ================================================================== *
 * Factories
 * ================================================================== */

export interface EditorHandle {
  view: EditorView;
  setDoc: (value: string) => void;
  getDoc: () => string;
  setTheme: (theme: "dark" | "light") => void;
  setLanguage: (path: string) => void;
  focus: () => void;
  revealLine: (line: number) => void;
  insertAtEnd: (text: string) => void;
  destroy: () => void;
}

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  path: string;
  theme: "dark" | "light";
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}): EditorHandle {
  const { parent, doc, path, theme, onChange, onSave } = opts;
  const themeSlot = new Compartment();
  const languageSlot = new Compartment();

  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        onSave();
        return true;
      }
    }
  ]);

  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      lintGutter(),
      autocompletion({ activateOnTyping: true, icons: false }),
      indentUnit.of("  "),
      EditorView.lineWrapping,
      themeSlot.of(theme === "dark" ? [syntaxTheme] : [syntaxThemeLight]),
      editorBase,
      saveKeymap,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        { key: "Mod-/", run: startCompletion }
      ]),
      languageSlot.of(languageExtension(path)()),
      EditorView.updateListener.of(u => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
      EditorView.editable.of(!opts.readOnly)
    ]
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: value => {
      if (value === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) }
      });
    },
    setTheme: mode => {
      view.dispatch({ effects: themeSlot.reconfigure(mode === "dark" ? [syntaxTheme] : [syntaxThemeLight]) });
    },
    setLanguage: (nextPath: string) => {
      view.dispatch({ effects: languageSlot.reconfigure(languageExtension(nextPath)()) });
    },
    focus: () => view.focus(),
    revealLine: line => {
      const n = Math.max(0, Math.min(line - 1, view.state.doc.lines - 1));
      const pos = view.state.doc.line(n + 1).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
    insertAtEnd: text => {
      const len = view.state.doc.length;
      view.dispatch({ changes: { from: len, insert: text } });
      view.focus();
    },
    destroy: () => view.destroy()
  };
}

/** Resolve a `file:line` jump (used by the activity feed "open" action). */
export function parseLocation(value: string): { path: string; line?: number } {
  const m = /^(.*?):(\d+)$/.exec(value);
  return m ? { path: m[1], line: Number(m[2]) } : { path: value };
}
