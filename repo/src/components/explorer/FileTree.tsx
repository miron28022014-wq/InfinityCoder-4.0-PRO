import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../icons";
import { Btn, Spinner } from "../ui";
import { useStore, shallow } from "../../hooks/useStore";
import {
  collapseAll,
  createFile,
  createFolder,
  deletePath,
  fileIconFor,
  openFile,
  refreshDirs,
  revealPath,
  renamePath,
  toggleDir
} from "../../store";
import type { FsItem } from "../../types";

export function FileTreePanel() {
  const root = useStore(s => s.root);
  const dirCache = useStore(s => s.dirCache);
  const expanded = useStore(s => s.expanded, shallow);
  const activePath = useStore(s => s.activePath);
  const loading = useStore(s => s.loadingDirs, shallow);
  const fileQuery = useStore(s => s.fileQuery);
  const fileHits = useStore(s => s.fileHits, shallow);
  const searching = useStore(s => s.searching);

  if (!root) return null;

  if (fileQuery.trim().length >= 2) {
    return (
      <div className="flex h-full flex-col">
        <SearchSummary query={fileQuery} count={fileHits.length} searching={searching} />
        <div className="ic-scroll flex-1 px-1.5 py-1.5">
          {fileHits.length === 0 && !searching ? (
            <p className="px-2 py-6 text-center text-[12px] text-ink-mute">Ничего не найдено</p>
          ) : (
            fileHits.map((h, i) => (
              <button
                key={`${h.path}:${h.line}:${i}`}
                onClick={() => void openFile(h.path)}
                className="ic-list-row h-auto items-start py-1.5"
              >
                <Icon name="search" size={11} className="mt-1 shrink-0 text-ink-mute" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[11.5px] text-ink-soft">
                    {h.path.split(/[\\/]/).pop()}
                    <span className="text-ink-mute">:{h.line}</span>
                  </span>
                  <span className="block truncate text-[11px] text-ink-mute">{h.text}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  const items = dirCache[root] ?? [];
  return (
    <div className="flex h-full flex-col">
      {loading.includes(root) && !items.length ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="ic-scroll flex-1 px-1.5 py-1.5">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-ink-mute">Папка пуста</p>
          ) : (
            items.map(item => (
              <TreeNode
                key={item.path}
                item={item}
                depth={0}
                root={root}
                expanded={expanded}
                dirCache={dirCache}
                activePath={activePath}
                loading={loading}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SearchSummary({
  query,
  count,
  searching
}: {
  query: string;
  count: number;
  searching: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-ink-mute">
      {searching ? <Spinner size={11} /> : <Icon name="search" size={11} />}
      {searching ? "Ищу…" : `${count} совпадений · «${query}»`}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Node
 * ------------------------------------------------------------------ */

function TreeNode({
  item,
  depth,
  root,
  expanded,
  dirCache,
  activePath,
  loading
}: {
  item: FsItem;
  depth: number;
  root: string;
  expanded: string[];
  dirCache: Record<string, FsItem[]>;
  activePath: string | null;
  loading: string[];
}) {
  const isOpen = expanded.includes(item.path);
  const children = dirCache[item.path];
  const isLoading = loading.includes(item.path);
  const selected = activePath === item.path;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const click = () => {
    if (item.is_dir) void toggleDir(item.path);
    else void openFile(item.path);
  };

  return (
    <div ref={ref} className="relative">
      <div
        role="treeitem"
        aria-expanded={item.is_dir ? isOpen : undefined}
        aria-selected={selected}
        tabIndex={0}
        onClick={click}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            click();
          }
        }}
        onContextMenu={e => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className="ic-list-row group"
        data-selected={selected}
        style={{ paddingLeft: 6 + depth * 13 }}
      >
        {item.is_dir ? (
          <>
            <Icon
              name="chevronRight"
              size={12}
              className="shrink-0 text-ink-mute transition-transform duration-200"
              style={{ transform: isOpen ? "rotate(90deg)" : undefined }}
            />
            <Icon
              name={isOpen ? "folderOpen" : "folder"}
              size={13}
              className="shrink-0"
              style={{ color: isOpen ? "rgb(var(--ic-accent))" : "rgb(var(--ic-ink-mute))" }}
            />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <Icon
              name={fileIconFor(item) as IconName}
              size={13}
              className="shrink-0 text-ink-mute"
            />
          </>
        )}

        <span
          className={`min-w-0 flex-1 truncate ${selected ? "text-ink" : ""}`}
          title={item.path}
        >
          {item.name}
        </span>

        {isLoading && <Spinner size={10} />}
        {!isLoading && !item.is_dir && item.size !== undefined && item.size > 0 && (
          <span className="shrink-0 text-[10px] tabular text-ink-mute opacity-0 transition-opacity group-hover:opacity-100">
            {item.size > 1024 ? `${Math.round(item.size / 1024)}К` : `${item.size}`}
          </span>
        )}
      </div>

      {isOpen && (
        <div role="group">
          {!children ? (
            <div className="flex items-center gap-2 py-1" style={{ paddingLeft: 26 + depth * 13 }}>
              <Spinner size={10} />
            </div>
          ) : children.length === 0 ? (
            <div
              className="py-0.5 text-[11px] text-ink-mute"
              style={{ paddingLeft: 26 + depth * 13 }}
            >
              пусто
            </div>
          ) : (
            children.map(child => (
              <TreeNode
                key={child.path}
                item={child}
                depth={depth + 1}
                root={root}
                expanded={expanded}
                dirCache={dirCache}
                activePath={activePath}
                loading={loading}
              />
            ))
          )}
        </div>
      )}

      {menu && (
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          item={item}
          onReveal={() => void revealPath(item.path)}
          onRefresh={() => void refreshDirs()}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Context menu
 * ------------------------------------------------------------------ */

export function ContextMenu({
  at,
  onClose,
  item,
  onReveal,
  onRefresh
}: {
  at: { x: number; y: number };
  onClose: () => void;
  item?: FsItem;
  onReveal?: () => void;
  onRefresh?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [value, setValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming || creating) inputRef.current?.select();
  }, [renaming, creating]);

  // Flip the menu when it would overflow the viewport.
  const x = Math.min(at.x, window.innerWidth - 208);
  const y = Math.min(at.y, window.innerHeight - 300);

  const submit = async () => {
    const v = value.trim();
    if (item && renaming && v && v !== item.name) {
      const parent = item.path.slice(0, Math.max(item.path.lastIndexOf("/"), item.path.lastIndexOf("\\")));
      await renamePath(item.path, parent ? `${parent}/${v}` : v);
    }
    if (item && creating) {
      const parent = item.is_dir ? item.path : item.path.slice(0, Math.max(item.path.lastIndexOf("/"), item.path.lastIndexOf("\\")));
      const base = parent ? `${parent}/${v}` : v;
      if (creating === "file") await createFile(base, "");
      else await createFolder(base);
    }
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div
        className="ic-anim-pop fixed z-50 w-52 overflow-hidden rounded-xl2 border border-line-strong bg-overlay p-1 shadow-pop"
        style={{ left: x, top: y }}
      >
        {renaming || creating ? (
          <div className="p-1">
            <input
              ref={inputRef}
              className="ic-input"
              value={value}
              placeholder={renaming ? "Новое имя" : creating === "file" ? "путь/к/файлу.ts" : "путь/к/папке"}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") onClose();
              }}
              autoFocus
            />
            <div className="mt-1.5 flex gap-1">
              <Btn size="sm" variant="primary" className="flex-1" onClick={submit} disabled={!value.trim()}>
                Создать
              </Btn>
              <Btn size="sm" variant="outline" onClick={onClose}>
                Отмена
              </Btn>
            </div>
          </div>
        ) : confirmDelete ? (
          <div className="p-1.5">
            <p className="text-[12px] leading-relaxed text-ink">
              Удалить <span className="ic-mono">{item!.name}</span>?
              {item!.is_dir && " Вместе со всем содержимым."}
            </p>
            <div className="mt-2 flex gap-1">
              <Btn
                size="sm"
                variant="danger"
                className="flex-1"
                onClick={() => {
                  void deletePath(item!.path);
                  onClose();
                }}
              >
                Удалить
              </Btn>
              <Btn size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                Отмена
              </Btn>
            </div>
          </div>
        ) : (
          <>
            {!item && (
              <>
                <MenuItem icon="file" label="Новый файл" onClick={() => { setCreating("file"); setValue(""); }} />
                <MenuItem icon="folder" label="Новая папка" onClick={() => { setCreating("folder"); setValue(""); }} />
                <Sep />
              </>
            )}
            {item && !item.is_dir && (
              <MenuItem icon="eye" label="Открыть" onClick={() => { void openFile(item.path); onClose(); }} />
            )}
            {item && onReveal && (
              <MenuItem
                icon="target"
                label="Показать в дереве"
                onClick={() => {
                  onReveal();
                  onClose();
                }}
              />
            )}
            {item && (
              <>
                <MenuItem icon="edit" label="Переименовать" onClick={() => { setRenaming(true); setValue(item.name); }} />
                {item.is_dir && (
                  <>
                    <MenuItem icon="file" label="Новый файл здесь" onClick={() => { setCreating("file"); setValue(""); }} />
                    <MenuItem icon="folder" label="Новая папка здесь" onClick={() => { setCreating("folder"); setValue(""); }} />
                  </>
                )}
                <Sep />
                <MenuItem
                  icon="trash"
                  label="Удалить"
                  danger
                  onClick={() => setConfirmDelete(true)}
                />
              </>
            )}
            {onRefresh && (
              <>
                <Sep />
                <MenuItem
                  icon="refresh"
                  label="Обновить"
                  onClick={() => {
                    onRefresh();
                    onClose();
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="ic-list-row h-7"
      style={danger ? { color: "rgb(var(--ic-danger))" } : undefined}
    >
      <Icon name={icon} size={12} />
      {label}
    </button>
  );
}

const Sep = () => <div className="my-1 h-px bg-line" />;

/* ------------------------------------------------------------------ *
 * Header controls used by the explorer shell
 * ------------------------------------------------------------------ */

export function ExplorerActions() {
  const root = useStore(s => s.root);
  const [busy, setBusy] = useState(false);
  const collapsedCount = useStore(s => s.expanded.length);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!root) return null;
  return (
    <div className="flex items-center gap-0.5">
      {busy && <Spinner size={12} />}
      <Btn
        size="sm"
        icon="file"
        tip="Новый файл"
        onClick={() =>
          void run(async () => {
            const name = window.prompt("Путь нового файла", "src/new-file.ts");
            if (name) await createFile(name, "");
          })
        }
      />
      <Btn
        size="sm"
        icon="folder"
        tip="Новая папка"
        onClick={() =>
          void run(async () => {
            const name = window.prompt("Путь новой папки", "src/new-folder");
            if (name) await createFolder(name);
          })
        }
      />
      <Btn size="sm" icon="refresh" tip="Обновить  F5" onClick={() => void run(refreshDirs)} />
      {collapsedCount > 0 && (
        <Btn
          size="sm"
          icon="unlink"
          tip="Свернуть всё"
          onClick={() => void run(async () => collapseAll())}
        />
      )}
    </div>
  );
}

