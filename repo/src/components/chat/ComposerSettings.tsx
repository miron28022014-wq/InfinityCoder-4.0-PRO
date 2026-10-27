/**
 * Настройки в панели ввода текста (Composer).
 * 
 * Быстрый доступ к:
 * - Разрешениям инструментов
 * - Плагинам
 * - Мощности контекста
 * - Режиму работы
 */

import { useState, useRef, useEffect } from "react";
import { Icon, type IconName } from "../../icons";
import { useStore } from "../../hooks/useStore";
import { patchSettings } from "../../store";
import { cn } from "../../lib/utils";

interface ComposerSettingsProps {
  onClose?: () => void;
}

type SettingsTab = "permissions" | "plugins" | "context" | "mode";

export function ComposerSettings({ onClose }: ComposerSettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("permissions");
  const settings = useStore(s => s.settings);
  const panelRef = useRef<HTMLDivElement>(null);

  // Закрытие по клику вне панели
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const tabs: Array<{ id: SettingsTab; label: string; icon: IconName }> = [
    { id: "permissions", label: "Разрешения", icon: "shield" },
    { id: "plugins", label: "Плагины", icon: "puzzle" },
    { id: "context", label: "Контекст", icon: "cpu" },
    { id: "mode", label: "Режим", icon: "settings" }
  ];

  return (
    <div 
      ref={panelRef}
      className="absolute bottom-full right-0 mb-2 w-80 rounded-xl border border-line bg-overlay shadow-pop ic-animate-scale-in"
    >
      {/* Заголовок */}
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[12px] font-semibold text-ink">Настройки агента</span>
        <button 
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-md text-ink-mute hover:bg-raised hover:text-ink"
        >
          <Icon name="x" size={12} />
        </button>
      </div>

      {/* Табы */}
      <div className="flex border-b border-line">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
              activeTab === tab.id 
                ? "text-accent border-b-2 border-accent" 
                : "text-ink-mute hover:text-ink-soft"
            )}
          >
            <Icon name={tab.icon} size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Содержимое */}
      <div className="max-h-64 overflow-y-auto p-3">
        {activeTab === "permissions" && <PermissionsTab />}
        {activeTab === "plugins" && <PluginsTab />}
        {activeTab === "context" && <ContextTab />}
        {activeTab === "mode" && <ModeTab />}
      </div>
    </div>
  );
}

// === РАЗРЕШЕНИЯ ===
function PermissionsTab() {
  const settings = useStore(s => s.settings);

  const permissions = [
    { id: "readFile", label: "Чтение файлов", icon: "file" as IconName },
    { id: "writeFile", label: "Запись файлов", icon: "edit" as IconName },
    { id: "runCommand", label: "Выполнение команд", icon: "terminal" as IconName },
    { id: "gitOperations", label: "Git операции", icon: "gitBranch" as IconName },
    { id: "webSearch", label: "Поиск в интернете", icon: "search" as IconName },
    { id: "installDeps", label: "Установка пакетов", icon: "download" as IconName }
  ];

  return (
    <div className="space-y-2">
      {permissions.map(perm => (
        <div key={perm.id} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name={perm.icon} size={13} className="text-ink-mute" />
            <span className="text-[11.5px] text-ink-soft">{perm.label}</span>
          </div>
          <select
            value={(settings as any)[`perm_${perm.id}`] || "ask"}
            onChange={(e) => patchSettings({ [`perm_${perm.id}`]: e.target.value } as any)}
            className="rounded-md border border-line bg-sunken px-1.5 py-0.5 text-[10.5px] text-ink"
          >
            <option value="ask">Спрашивать</option>
            <option value="allow">Разрешить</option>
            <option value="deny">Запретить</option>
          </select>
        </div>
      ))}
    </div>
  );
}

// === ПЛАГИНЫ ===
function PluginsTab() {
  const plugins = [
    { id: "eslint", name: "ESLint", description: "Проверка кода", enabled: true },
    { id: "prettier", name: "Prettier", description: "Форматирование", enabled: true },
    { id: "typescript", name: "TypeScript", description: "Проверка типов", enabled: true },
    { id: "jest", name: "Jest", description: "Тестирование", enabled: false },
    { id: "docker", name: "Docker", description: "Контейнеры", enabled: false },
    { id: "k8s", name: "Kubernetes", description: "Оркестрация", enabled: false }
  ];

  return (
    <div className="space-y-1.5">
      {plugins.map(plugin => (
        <label 
          key={plugin.id}
          className="flex items-center justify-between rounded-lg border border-line bg-raised/30 px-2.5 py-2 cursor-pointer hover:bg-raised/50"
        >
          <div>
            <div className="text-[11.5px] font-medium text-ink">{plugin.name}</div>
            <div className="text-[10px] text-ink-mute">{plugin.description}</div>
          </div>
          <input
            type="checkbox"
            defaultChecked={plugin.enabled}
            className="h-3.5 w-3.5 rounded border-line text-accent focus:ring-accent"
          />
        </label>
      ))}
    </div>
  );
}

// === КОНТЕКСТ ===
function ContextTab() {
  const settings = useStore(s => s.settings);

  const contextOptions = [
    { id: "minimal", label: "Минимальный", tokens: "2K", description: "Быстро, но мало контекста" },
    { id: "balanced", label: "Сбалансированный", tokens: "8K", description: "Оптимально для большинства задач" },
    { id: "extended", label: "Расширенный", tokens: "16K", description: "Для сложных задач" },
    { id: "maximum", label: "Максимальный", tokens: "32K+", description: "Медленно, но максимум контекста" }
  ];

  return (
    <div className="space-y-1.5">
      {contextOptions.map(opt => (
        <button
          key={opt.id}
          onClick={() => patchSettings({ contextSize: opt.id } as any)}
          className={cn(
            "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
            settings.contextSize === opt.id
              ? "border-accent bg-accent/10"
              : "border-line bg-raised/30 hover:bg-raised/50"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-medium text-ink">{opt.label}</span>
            <span className="text-[10px] text-accent">{opt.tokens}</span>
          </div>
          <div className="text-[10px] text-ink-mute">{opt.description}</div>
        </button>
      ))}

      <div className="mt-3 border-t border-line pt-2">
        <label className="flex items-center justify-between">
          <span className="text-[11px] text-ink-soft">Автоматическое сжатие контекста</span>
          <input
            type="checkbox"
            defaultChecked={true}
            className="h-3.5 w-3.5 rounded border-line text-accent"
          />
        </label>
      </div>
    </div>
  );
}

// === РЕЖИМ ===
function ModeTab() {
  const settings = useStore(s => s.settings);

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] font-medium text-ink-soft">Режим работы</label>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          <button
            onClick={() => patchSettings({ mode: "agent" })}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-[11px] transition-colors",
              settings.mode === "agent"
                ? "border-accent bg-accent/10 text-accent"
                : "border-line text-ink-mute hover:bg-raised"
            )}
          >
            Один агент
          </button>
          <button
            onClick={() => patchSettings({ mode: "swarm" })}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-[11px] transition-colors",
              settings.mode === "swarm"
                ? "border-accent bg-accent/10 text-accent"
                : "border-line text-ink-mute hover:bg-raised"
            )}
          >
            Рой агентов
          </button>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-medium text-ink-soft">Сложность</label>
        <div className="mt-1 grid grid-cols-4 gap-1">
          {["low", "medium", "high", "ultra"].map(level => (
            <button
              key={level}
              onClick={() => patchSettings({ effort: level as any })}
              className={cn(
                "rounded-md border py-1 text-[10px] capitalize transition-colors",
                settings.effort === level
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-ink-mute hover:bg-raised"
              )}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <span className="text-[11px] text-ink-soft">Автономный режим</span>
        <button
          onClick={() => patchSettings({ autonomous: !settings.autonomous })}
          className={cn(
            "ic-switch",
            settings.autonomous && "data-on=true"
          )}
          data-on={settings.autonomous}
          role="switch"
          aria-checked={settings.autonomous}
        />
      </div>
    </div>
  );
}
