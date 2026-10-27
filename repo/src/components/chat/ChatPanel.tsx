import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import { Btn, StatusDot } from "../ui";
import { MessageItem, ActivityStream } from "./MessageItem";
import { Composer } from "./Composer";
import { useStore, shallowArray } from "../../hooks/useStore";
import {
  clearChat,
  openSettings,
  patchSettings,
  respond,
  revealLocation,
  togglePalette,
  toggleRight
} from "../../store";
import { Skeleton, ChatMessageSkeleton } from "../ui/Skeleton";

export function ChatPanel() {
  const messages = useStore(s => s.messages, shallowArray);
  const streaming = useStore(s => s.streaming);
  const running = useStore(s => s.isRunning);
  const activity = useStore(s => s.activity, shallowArray);
  const question = useStore(s => s.question);
  const showActivity = useStore(s => s.settings.showActivity);
  const root = useStore(s => s.root);
  const providerStatus = useStore(s => s.providerStatus);
  const providerMessage = useStore(s => s.providerMessage);
  const collapsed = useStore(s => s.rightCollapsed);
  const autonomous = useStore(s => s.settings.autonomous);
  const settings = useStore(s => s.settings);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Follow the stream only while the user is already at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinned.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, streaming.length, activity.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      pinned.current = atBottom;
      setShowScrollButton(!atBottom && el.scrollHeight > el.clientHeight);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    pinned.current = true;
    setShowScrollButton(false);
  };

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-l border-line bg-surface py-2">
        <Btn icon="panelRight" tip="Открыть панель агента" tipSide="left" onClick={toggleRight} />
        <span className="ic-grad-text select-none text-[10px] font-bold [writing-mode:vertical-lr]">
          Агент
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      {/* Header */}
      <div className="ic-chat-head">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent">
            <Icon name="infinity" size={15} />
          </div>
          <div>
            <div className="text-[12.5px] font-semibold text-ink">Агент</div>
            <div className="flex items-center gap-1 text-[10.5px] text-ink-mute">
              <StatusDot 
                status={providerStatus} 
                size={6} 
                pulse={running}
              />
              {providerMessage || "Нет API-ключа"}
            </div>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Btn
              icon="trash"
              tip="Очистить чат"
              tipSide="bottom"
              onClick={clearChat}
            />
          )}
          <Btn
            icon="settings"
            tip="Настройки агента"
            tipSide="bottom"
            onClick={() => openSettings(true)}
          />
          <Btn
            icon="panelRight"
            tip="Скрыть панель"
            tipSide="bottom"
            onClick={toggleRight}
          />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="ic-chat-body relative">
        {messages.length === 0 && !running ? (
          <EmptyState 
            hasProject={!!root}
            onOpenSettings={() => openSettings(true)}
          />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageItem 
                key={msg.id} 
                message={msg} 
                isLast={i === messages.length - 1}
              />
            ))}
            {streaming.length > 0 && (
              <div className="ic-msg">
                <div className="ic-msg__avatar bg-accent/10 text-accent">
                  <Icon name="infinity" size={13} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="ic-msg__who">Агент</div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-ink whitespace-pre-wrap">
                    {streaming}
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent/60" />
                  </div>
                </div>
              </div>
            )}
            {running && activity.length > 0 && showActivity && (
              <ActivityStream items={activity} />
            )}
          </>
        )}

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 grid h-8 w-8 place-items-center rounded-full border border-line bg-overlay shadow-pop transition-all hover:scale-105"
            aria-label="Прокрутить вниз"
          >
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-line p-3">
        <Composer />

        {/* Status bar */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-ink-mute">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Icon name="bot" size={10} />
              {settings.mode === "swarm" ? "Рой" : "Агент"}
            </span>
            <span>·</span>
            <span>{settings.effort}</span>
            {settings.autonomous && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1 text-accent">
                  <Icon name="zap" size={10} />
                  Автономный
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Kbd>Enter</Kbd>
            <span>отправить</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function EmptyState({ 
  hasProject, 
  onOpenSettings 
}: { 
  hasProject: boolean; 
  onOpenSettings: () => void;
}) {
  const suggestions = [
    { icon: "search", text: "Изучи структуру проекта и объясни архитектуру" },
    { icon: "checkCircle", text: "Найди и исправь ошибки сборки" },
    { icon: "test", text: "Добавь тесты для самого важного модуля" },
    { icon: "shield", text: "Проведи ревью изменений и перечисли риски" },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">
        <Icon name="infinity" size={24} />
      </div>
      <div>
        <h3 className="text-[14px] font-semibold text-ink">Чем займёмся?</h3>
        <p className="mt-1 text-[12px] text-ink-mute">
          Опишите задачу словами — агент сам составит план, внесёт правки и проверит результат.
        </p>
      </div>

      {!hasProject && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          Сначала откройте проект — агенту нужна папка с файлами
        </div>
      )}

      <div className="w-full max-w-sm space-y-1.5">
        {suggestions.map((s, i) => (
          <button
            key={i}
            className="flex w-full items-center gap-2 rounded-lg border border-line bg-raised/50 px-3 py-2 text-left text-[11.5px] text-ink-soft transition-all hover:border-accent/40 hover:bg-raised"
            onClick={() => {
              // TODO: Send suggestion to composer
            }}
          >
            <Icon name={s.icon} size={13} className="text-accent" />
            {s.text}
          </button>
        ))}
      </div>

      <button
        onClick={onOpenSettings}
        className="text-[11px] text-ink-mute underline-offset-2 hover:text-ink hover:underline"
      >
        Настроить модель и провайдера
      </button>
    </div>
  );
}
