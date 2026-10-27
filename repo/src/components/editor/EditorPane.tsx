import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import { Btn, Empty, Kbd, Spinner } from "../ui";
import { useStore, shallow } from "../../hooks/useStore";
import { createEditor, parseLocation, type EditorHandle } from "../../lib/editor";
import {
  clearReveal,
  closeTab,
  fileIconFor,
  isDirty,
  openFile,
  revealLocation,
  saveFile,
  setActiveTab,
  toggleLeft,
  updateEditorContent
} from "../../store";

export function EditorPane() {
  const tabs = useStore(s => s.tabs, shallow);
  const activePath = useStore(s => s.activePath);
  const root = useStore(s => s.root);
  const collapsed = useStore(s => s.leftCollapsed);
  const saving = useStore(s => s.saving);
  const theme = useStore(s => s.settings.theme);
  const [gotoOpen, setGotoOpen] = useState(false);

  const active = tabs.find(t => t.path === activePath) ?? null;
  const dirty = active ? isDirty(active) : false;

  if (collapsed) {
    return (
      <section className="flex h-full w-11 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-2">
        <Btn icon="panelLeft" tip="Открыть проводник" onClick={toggleLeft} />
      </section>
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-canvas">
      {/* tabs */}
      <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-surface">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map(t => {
            const on = t.path === activePath;
            const d = isDirty(t);
            return (
              <div
                key={t.path}
                onClick={() => setActiveTab(t.path)}
                onAuxClick={e => {
                  if (e.button === 1) closeTab(t.path);
                }}
                role="tab"
                aria-selected={on}
                title={t.path}
                className="group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-2.5 text-[12px] transition-colors duration-150"
                style={{
                  background: on ? "rgb(var(--ic-canvas))" : "transparent",
                  color: on ? "rgb(var(--ic-ink))" : "rgb(var(--ic-ink-mute))"
                }}
              >
                {on && (
                  <span
                    className="absolute inset-x-0 top-0 h-[2px]"
                    style={{ background: "var(--ic-grad)", transformOrigin: "left" }}
                  />
                )}
                <Icon name={fileIconFor(t.path) as never} size={12.5} className="shrink-0" />
                <span className="max-w-[150px] truncate">{t.path.split(/[\\/]/).pop()}</span>
                {d ? (
                  <span
                    onClick={e => {
                      e.stopPropagation();
                      void saveFile(t.path);
                    }}
                    className="ml-0.5 h-[7px] w-[7px] shrink-0 rounded-full transition-transform hover:scale-125"
                    style={{ background: "rgb(var(--ic-accent))" }}
                    title="Сохранить"
                  />
                ) : (
                  <span
                    onClick={e => {
                      e.stopPropagation();
                      closeTab(t.path);
                    }}
                    className="ml-0.5 hidden h-4 w-4 shrink-0 place-items-center rounded text-ink-mute transition-colors hover:bg-raised hover:text-ink group-hover:grid"
                  >
                    <Icon name="x" size={10} />
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 border-l border-line px-1.5">
          <Btn
            size="sm"
            icon="search"
            tip="Быстрый переход  Ctrl+P"
            onClick={() => setGotoOpen(true)}
            disabled={!tabs.length}
          />
          <Btn
            size="sm"
            variant={dirty ? "primary" : "ghost"}
            icon="save"
            tip="Сохранить  Ctrl+S"
            onClick={() => void saveFile()}
            disabled={!dirty}
            loading={saving}
          />
        </div>
      </div>

      {active ? (
        <>
          <Breadcrumbs path={active.path} />
          <CodeEditorHost path={active.path} theme={theme} />
        </>
      ) : (
        <EditorEmpty hasProject={!!root} onOpenFile={p => void openFile(p)} />
      )}

      {gotoOpen && <GotoDialog onClose={() => setGotoOpen(false)} />}
    </section>
  );
}

/* ================================================================== *
 * Editor host — owns the CodeMirror instance
 * ================================================================== */

function CodeEditorHost({ path, theme }: { path: string; theme: "dark" | "light" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [ready, setReady] = useState(false);
  const content = useStore(s => s.tabs.find(t => t.path === path)?.content ?? "");
  const reveal = useStore(s => s.reveal);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setReady(false);
    const handle = createEditor({
      parent: host,
      doc: "",
      path,
      theme,
      onChange: value => updateEditorContent(path, value),
      onSave: () => void saveFile(path)
    });
    handleRef.current = handle;
    setReady(true);
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
    // The instance is rebuilt only when the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    handleRef.current?.setTheme(theme);
  }, [theme]);

  // Push external edits (the agent rewriting the open file) into the view.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !ready) return;
    if (handle.getDoc() !== content) handle.setDoc(content);
  }, [content, ready]);

  useEffect(() => {
    if (!reveal || reveal.path !== path || !ready) return;
    handleRef.current?.revealLine(reveal.line);
    clearReveal(reveal.id);
  }, [reveal, path, ready]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="absolute inset-0 overflow-hidden" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}

function Breadcrumbs({ path }: { path: string }) {
  const parts = path.replace(/\\/g, "/").split("/");
  const file = parts.pop() ?? path;
  const root = useStore(s => s.root);
  const dirParts = parts.slice(root.replace(/\\/g, "/").split("/").length - 1);

  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-hidden border-b border-line bg-surface px-2.5 text-[11px]">
      {dirParts.map((p, i) => (
        <span key={i} className="flex shrink-0 items-center gap-0.5">
          {i > 0 && <Icon name="chevronRight" size={10} className="text-ink-mute" />}
          <span className="text-ink-mute">{p}</span>
        </span>
      ))}
      <Icon name="chevronRight" size={10} className="shrink-0 text-ink-mute" />
      <span className="truncate text-ink-soft">{file}</span>
    </div>
  );
}

function EditorEmpty({ hasProject, onOpenFile }: { hasProject: boolean; onOpenFile: (p: string) => void }) {
  const recent = useStore(s => s.tabs, shallow);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-8">
      {recent.length > 0 ? (
        <div className="w-full min-w-0 max-w-md">
          <p className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-mute">
            Недавние файлы
          </p>
          <div className="space-y-1">
            {recent.map(t => (
              <button key={t.path} onClick={() => onOpenFile(t.path)} className="ic-list-row h-8">
                <Icon name={fileIconFor(t.path) as never} size={12} className="text-ink-mute" />
                <span className="truncate">{t.path.split(/[\\/]/).pop()}</span>
                <span className="ml-auto truncate text-[10.5px] text-ink-mute">{t.path}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Empty
          icon="fileCode"
          title={hasProject ? "Выберите файл слева" : "Откройте проект"}
          hint={
            hasProject
              ? "Или попросите агента что-то изменить — он откроет нужные файлы сам."
              : "Агент работает с реальной файловой системой. Выберите папку проекта, чтобы начать."
          }
        />
      )}
    </div>
  );
}

/* ================================================================== *
 * Goto dialog
 * ================================================================== */

function GotoDialog({ onClose }: { onClose: () => void }) {
  const tabs = useStore(s => s.tabs, shallow);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const needle = q.toLowerCase();
    const all = [...tabs].sort((a, b) => b.path.length - a.path.length);
    return (needle ? all.filter(t => t.path.toLowerCase().includes(needle)) : all).slice(0, 30);
  }, [tabs, q]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const jump = (target: string) => {
    const { path, line } = parseLocation(target);
    void revealLocation(path, line);
    onClose();
  };

  return (
    <div className="ic-overlay flex items-start justify-center p-6 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="ic-modal w-full max-w-lg overflow-hidden rounded-xl3 border border-line-strong bg-surface"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Icon name="search" size={14} className="text-ink-mute" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-mute"
            value={q}
            onChange={e => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={e => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel(s => Math.min(list.length - 1, s + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel(s => Math.max(0, s - 1));
              }
              if (e.key === "Enter" && list[sel]) jump(list[sel].path);
            }}
            placeholder="Перейти к файлу…"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="ic-scroll max-h-72 p-1">
          {list.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-ink-mute">Ничего не найдено</p>
          ) : (
            list.map((t, i) => (
              <button
                key={t.path}
                onMouseEnter={() => setSel(i)}
                onClick={() => jump(t.path)}
                className="ic-list-row h-8"
                data-selected={i === sel}
              >
                <Icon name={fileIconFor(t.path) as never} size={12} className="text-ink-mute" />
                <span className="truncate">{t.path.split(/[\\/]/).pop()}</span>
                <span className="ml-auto truncate text-[10.5px] text-ink-mute">{t.path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
