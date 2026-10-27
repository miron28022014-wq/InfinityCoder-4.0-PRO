import { useEffect, useCallback } from "react";
import { TitleBar, StatusBar } from "./components/shell/TitleBar";
import { ActivityRail } from "./components/shell/ActivityRail";
import { StartScreen } from "./components/shell/StartScreen";
import { Explorer, useResizer } from "./components/explorer/Explorer";
import { EditorPane } from "./components/editor/EditorPane";
import { ChatPanel } from "./components/chat/ChatPanel";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { Toasts } from "./components/Toasts";
import { useStore } from "./hooks/useStore";
import {
  boot,
  getState,
  openSettings,
  patchSettings,
  saveAll,
  stop,
  togglePalette
} from "./store";

export default function App() {
  const sidebarWidth = useStore(s => s.settings.sidebarWidth);
  const chatWidth = useStore(s => s.settings.chatWidth);
  const running = useStore(s => s.isRunning);
  const question = useStore(s => s.question);
  const root = useStore(s => s.root);

  useEffect(() => {
    document.documentElement.dataset.theme = getState().settings.theme;
    void boot();
  }, []);

  const left = useResizer(sidebarWidth, v => patchSettings({ sidebarWidth: v }), {
    min: 210,
    max: 520
  });
  const right = useResizer(chatWidth, v => patchSettings({ chatWidth: v }), {
    min: 340,
    max: 820,
    invert: true
  });

  /* ---------------- global shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (mod && (k === "k" || k === "p")) {
        e.preventDefault();
        togglePalette(k === "p" ? true : undefined);
        return;
      }
      if (mod && k === "s") {
        e.preventDefault();
        void saveAll();
        return;
      }
      if (mod && k === "o") {
        e.preventDefault();
        void import("./store").then(m => m.openFolder());
        return;
      }
      if (mod && k === ",") {
        e.preventDefault();
        openSettings(true);
        return;
      }
      if (e.key === "Escape") {
        if (getState().paletteOpen) return togglePalette(false);
        if (getState().settingsOpen) return openSettings(false);
        if (getState().question) return stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------- prevent unload with running agent ---------------- */
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Агент ещё работает. Уйти?";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  const handleQuestionDismiss = useCallback(() => {
    stop();
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityRail />
        <div
          className="relative flex min-w-0 flex-1 flex-col border-r border-line"
          style={{ width: left.width }}
        >
          {root ? <Explorer /> : <StartScreen />}
          <div
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-accent/30"
            onMouseDown={left.start}
            role="separator"
            aria-orientation="vertical"
            aria-label="Изменить ширину панели"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorPane />
        </div>
        <div
          className="relative flex min-w-0 flex-col border-l border-line"
          style={{ width: right.width }}
        >
          <ChatPanel />
          <div
            className="absolute left-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-accent/30"
            onMouseDown={right.start}
            role="separator"
            aria-orientation="vertical"
            aria-label="Изменить ширину чата"
          />
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <SettingsDialog />
      <Toasts />
      {question && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="ic-panel max-w-md p-4 ic-animate-scale-in">
            <h3 className="mb-2 text-[14px] font-semibold">Требуется подтверждение</h3>
            <p className="mb-4 text-[12.5px] text-ink-soft">{question.text}</p>
            <div className="flex justify-end gap-2">
              <button
                className="ic-btn ic-btn--outline"
                onClick={handleQuestionDismiss}
              >
                Отмена
              </button>
              <button
                className="ic-btn ic-btn--primary"
                onClick={() => {
                  question.resolve(true);
                  stop();
                }}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
