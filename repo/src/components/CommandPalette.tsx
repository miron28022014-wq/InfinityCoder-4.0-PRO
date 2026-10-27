import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../icons";
import { Kbd } from "./ui";
import { useStore, shallow } from "../hooks/useStore";
import { api } from "../lib/ipc";
import {
  clearChat,
  memory,
  openFile,
  openFolder,
  openSettings,
  patchSettings,
  refreshDirs,
  saveAll,
  setTheme,
  getState,
  stop,
  toggleLeft,
  toggleRight,
  togglePalette
} from "../store";
import { AGENTS } from "../lib/agents";
import { EFFORT_ORDER, EFFORT_PRESETS } from "../lib/settings";
import type { SidebarTab } from "../types";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: string;
  keys?: string[];
  run: () => void;
}

export function CommandPalette() {
  const open = useStore(s => s.paletteOpen);
  const root = useStore(s => s.root);
  const running = useStore(s => s.isRunning);
  const settings = useStore(s => s.settings, shallow);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [files, setFiles] = useState<Array<{ path: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      if (root) {
        setLoading(true);
        apiListFiles()
          .then(files => {
            setFiles(files);
            setLoading(false);
          })
          .catch(() => {
            setFiles([]);
            setLoading(false);
          });
      } else {
        setFiles([]);
      }
    }
  }, [open, root]);

  const commands = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      {
        id: "open-project",
        label: root ? "Сменить проект" : "Открыть проект",
        icon: "folder",
        group: "Проект",
        run: () => void openFolder()
      },
      { 
        id: "refresh", 
        label: "Обновить дерево файлов", 
        icon: "refresh", 
        group: "Проект", 
        run: () => void refreshDirs() 
      },
      { 
        id: "reindex", 
        label: "Переиндексировать память проекта", 
        icon: "memory", 
        group: "Проект", 
        run: () => void memory.reindex() 
      },
      { 
        id: "save-all", 
        label: "Сохранить все файлы", 
        icon: "save", 
        group: "Файл", 
        keys: ["Ctrl", "S"],
        run: () => void saveAll() 
      },
      {
        id: "toggle-left",
        label: "Переключить левую панель",
        icon: "panelLeft",
        group: "Вид",
        run: () => toggleLeft()
      },
      {
        id: "toggle-right",
        label: "Переключить правую панель",
        icon: "panelRight",
        group: "Вид",
        run: () => toggleRight()
      },
      {
        id: "open-settings",
        label: "Открыть настройки",
        icon: "settings",
        group: "Вид",
        keys: ["Ctrl", ","],
        run: () => openSettings(true)
      },
      {
        id: "clear-chat",
        label: "Очистить чат",
        icon: "trash",
        group: "Чат",
        run: () => clearChat()
      }
    ];

    // Add file commands if project is open
    if (root && files.length > 0) {
      const fileCommands: Cmd[] = files.slice(0, 10).map(file => ({
        id: `file-${file.path}`,
        label: file.name,
        hint: file.path,
        icon: "file",
        group: "Файлы",
        run: () => void openFile(file.path)
      }));
      base.push(...fileCommands);
    }

    // Add agent commands
    const agentCommands: Cmd[] = AGENTS.map(agent => ({
      id: `agent-${agent.id}`,
      label: `Переключить на ${agent.name}`,
      hint: agent.role,
      icon: "bot",
      group: "Агенты",
      run: () => patchSettings({ agent: agent.id })
    }));
    base.push(...agentCommands);

    // Add theme commands
    base.push(
      {
        id: "theme-dark",
        label: "Тёмная тема",
        icon: "moon",
        group: "Тема",
        run: () => setTheme("dark")
      },
      {
        id: "theme-light",
        label: "Светлая тема",
        icon: "sun",
        group: "Тема",
        run: () => setTheme("light")
      }
    );

    // Add effort commands
    const effortCommands: Cmd[] = EFFORT_ORDER.map(effort => ({
      id: `effort-${effort}`,
      label: `Уровень: ${EFFORT_PRESETS[effort].label}`,
      hint: EFFORT_PRESETS[effort].description,
      icon: "gauge",
      group: "Уровень",
      run: () => patchSettings({ effort })
    }));
    base.push(...effortCommands);

    return base;
  }, [root, files, settings.agent, settings.effort, settings.theme]);

  const filtered = useMemo(() => {
    if (!q.trim()) return commands;
    const query = q.toLowerCase();
    return commands.filter(
      cmd =>
        cmd.label.toLowerCase().includes(query) ||
        cmd.hint?.toLowerCase().includes(query) ||
        cmd.group.toLowerCase().includes(query)
    );
  }, [commands, q]);

  const groups = useMemo(() => {
    const map = new Map<string, Cmd[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.group) || [];
      list.push(cmd);
      map.set(cmd.group, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel(s => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel(s => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[sel];
        if (cmd) {
          cmd.run();
          togglePalette(false);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        togglePalette(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, sel]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [sel]);

  if (!open) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => togglePalette(false)}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div 
        className="relative w-full max-w-lg ic-animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="ic-panel overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Icon name="search" size={16} className="text-ink-mute" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Введите команду или найдите файл..."
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-mute"
              autoFocus
            />
            <Kbd>ESC</Kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1">
            {loading ? (
              <div className="px-3 py-8 text-center text-[12px] text-ink-mute">
                Загрузка файлов...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-ink-mute">
                Ничего не найдено
              </div>
            ) : (
              groups.map(([group, cmds]) => (
                <div key={group} className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                    {group}
                  </div>
                  {cmds.map((cmd, i) => {
                    const globalIndex = filtered.indexOf(cmd);
                    const selected = globalIndex === sel;
                    return (
                      <button
                        key={cmd.id}
                        data-selected={selected}
                        onClick={() => {
                          cmd.run();
                          togglePalette(false);
                        }}
                        onMouseEnter={() => setSel(globalIndex)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                          selected ? "bg-accent/10 text-accent" : "text-ink hover:bg-raised"
                        }`}
                      >
                        <Icon name={cmd.icon} size={14} className="shrink-0" />
                        <span className="flex-1 truncate text-[12.5px]">{cmd.label}</span>
                        {cmd.hint && (
                          <span className="max-w-[200px] truncate text-[11px] text-ink-mute">
                            {cmd.hint}
                          </span>
                        )}
                        {cmd.keys && (
                          <span className="flex gap-0.5">
                            {cmd.keys.map(k => (
                              <Kbd key={k}>{k}</Kbd>
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[10.5px] text-ink-mute">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              навигация
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd>
              выбрать
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd>
              закрыть
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

async function apiListFiles(): Promise<Array<{ path: string; name: string }>> {
  try {
    const result = await api.listFiles();
    return result.map((path: string) => ({
      path,
      name: path.split(/[\/]/).pop() || path
    }));
  } catch {
    return [];
  }
}
