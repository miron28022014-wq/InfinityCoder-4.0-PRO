import { Logo, Icon } from "../../icons";
import { Btn, StatusDot, Kbd } from "../ui";
import { useStore, shallow, formatBytes } from "../../hooks/useStore";
import {
  openFolder,
  openSettings,
  patchSettings,
  refreshDirs,
  refreshGit,
  saveAll,
  setTheme,
  toggleLeft,
  togglePalette,
  toggleRight
} from "../../store";

export function TitleBar() {
  const projectName = useStore(s => s.projectName);
  const root = useStore(s => s.root);
  const status = useStore(s => s.providerStatus);
  const message = useStore(s => s.providerMessage);
  const settings = useStore(s => s.settings, shallow);
  const git = useStore(s => s.git);
  const leftCollapsed = useStore(s => s.leftCollapsed);
  const dirtyTabs = useStore(s => s.tabs.filter(t => t.content !== t.saved).length);
  const eco = useStore(s => s.eco);
  const running = useStore(s => s.isRunning);

  const ecoDot: "ready" | "error" | "checking" | "offline" =
    eco.status === "online" ? "ready" : eco.status === "connecting" ? "checking" : eco.status === "error" ? "error" : "offline";
  const ecoShort =
    eco.status === "online"
      ? eco.account?.email ?? "экосистема"
      : eco.status === "connecting"
        ? "подключение…"
        : eco.status === "error"
          ? "нет связи"
          : "экосистема";

  return (
    <header className="relative z-30 flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-2.5">
      <div className="flex items-center gap-2">
        <Logo size={22} />
        <span className="ic-grad-text text-[14px] font-bold tracking-tight">InfinityCoder</span>
        <span className="ic-badge" style={{ height: 18, fontSize: 9.5 }}>
          4.0
        </span>
      </div>

      <div className="mx-1 h-4 w-px bg-line" />

      {/* статус экосистемы */}
      <button
        onClick={() => patchSettings({ sidebarTab: "ecosystem" })}
        className="flex items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2.5 py-1 text-[11px] text-ink-soft transition-all duration-200 hover:border-line-strong hover:bg-raised"
        title="Экосистема"
      >
        <StatusDot status={ecoDot} size={7} />
        <span className="max-w-[120px] truncate">{ecoShort}</span>
      </button>

      {/* проект */}
      {root && (
        <button
          onClick={() => void openFolder()}
          className="flex items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2.5 py-1 text-[11px] text-ink-soft transition-all duration-200 hover:border-line-strong hover:bg-raised"
          title={root}
        >
          <Icon name="folder" size={12} />
          <span className="max-w-[140px] truncate">{projectName}</span>
          {dirtyTabs > 0 && (
            <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
              {dirtyTabs}
            </span>
          )}
        </button>
      )}

      {/* git статус */}
      {git && (
        <button
          onClick={() => void refreshGit()}
          className="flex items-center gap-1 rounded-full border border-line bg-raised/60 px-2 py-1 text-[11px] text-ink-soft transition-all duration-200 hover:border-line-strong hover:bg-raised"
          title={`Ветка: ${git.branch}`}
        >
          <Icon name="gitBranch" size={11} />
          <span className="max-w-[80px] truncate">{git.branch}</span>
          {git.changed > 0 && (
            <span className="text-ink-mute">+{git.changed}</span>
          )}
        </button>
      )}

      <div className="flex-1" />

      {/* статус провайдера */}
      <button
        onClick={() => openSettings(true)}
        className="flex items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2.5 py-1 text-[11px] text-ink-soft transition-all duration-200 hover:border-line-strong hover:bg-raised"
        title={message || "Модель"}
      >
        <StatusDot status={status} size={7} pulse={running} />
        <span className="max-w-[100px] truncate">
          {settings.ecosystemModelId || settings.model || "модель"}
        </span>
      </button>

      {/* действия */}
      <div className="flex items-center gap-1">
        <Btn
          icon="save"
          tip="Сохранить все"
          tipSide="bottom"
          onClick={() => void saveAll()}
          disabled={dirtyTabs === 0}
        />
        <Btn
          icon="refresh"
          tip="Обновить"
          tipSide="bottom"
          onClick={() => {
            void refreshDirs();
            void refreshGit();
          }}
        />
        <Btn
          icon={settings.theme === "dark" ? "sun" : "moon"}
          tip={settings.theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          tipSide="bottom"
          onClick={() => setTheme(settings.theme === "dark" ? "light" : "dark")}
        />
        <Btn
          icon="search"
          tip="Поиск (Ctrl+K)"
          tipSide="bottom"
          onClick={() => togglePalette(true)}
        />
        <Btn
          icon="settings"
          tip="Настройки"
          tipSide="bottom"
          onClick={() => openSettings(true)}
        />
      </div>
    </header>
  );
}

export function StatusBar() {
  const info = useStore(s => s.info);
  const running = useStore(s => s.isRunning);
  const settings = useStore(s => s.settings, shallow);
  const tokens = useStore(s => s.tokens);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface px-3 text-[10.5px] text-ink-mute">
      <span className="flex items-center gap-1">
        <StatusDot status={running ? "checking" : "ready"} size={6} />
        {running ? "Агент работает" : "Готов"}
      </span>

      {info && (
        <>
          <span className="h-3 w-px bg-line" />
          <span>{info.files} файлов</span>
          <span>{info.memories} записей</span>
          {info.size > 0 && <span>{formatBytes(info.size)}</span>}
        </>
      )}

      <div className="flex-1" />

      {tokens > 0 && (
        <span className="flex items-center gap-1">
          <Icon name="cpu" size={10} />
          {tokens.toLocaleString()} токенов
        </span>
      )}

      <span className="flex items-center gap-1">
        <Icon name="bot" size={10} />
        {settings.mode === "swarm" ? "Рой" : "Агент"} · {settings.effort}
      </span>

      {settings.autonomous && (
        <span className="flex items-center gap-1 text-accent">
          <Icon name="zap" size={10} />
          Автономный
        </span>
      )}
    </footer>
  );
}
