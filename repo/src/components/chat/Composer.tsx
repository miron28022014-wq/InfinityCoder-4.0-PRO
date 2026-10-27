/**
 * Composer — панель ввода текста с улучшенным UI.
 * 
 * Новые возможности:
 * - Загрузка файлов без сохранения в ФС
 * - Быстрые настройки (разрешения, плагины, контекст)
 * - Улучшенный дизайн
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Icon } from "../../icons";
import { useStore } from "../../hooks/useStore";
import { send, patchSettings } from "../../store";
import { FileUpload, UploadedFilesList, useFileUpload } from "./FileUpload";
import { ComposerSettings } from "./ComposerSettings";
import { cn } from "../../lib/utils";

export function Composer() {
  const [value, setValue] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const running = useStore(s => s.isRunning);
  const settings = useStore(s => s.settings);

  const {
    files,
    addFiles,
    removeFile,
    clearFiles,
    getContextText,
    hasFiles
  } = useFileUpload();

  // Автоматический ресайз textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }, [value]);

  // Горячие клавиши
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showSettings) {
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettings]);

  const handleSubmit = useCallback(async () => {
    const text = value.trim();
    if (!text && !hasFiles) return;

    // Формируем сообщение с контекстом файлов
    let fullMessage = text;
    if (hasFiles) {
      const fileContext = getContextText();
      fullMessage = fileContext ? `${fileContext}

${text}` : text;
    }

    setValue("");
    clearFiles();

    // Сброс высоты textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await send(fullMessage);
  }, [value, hasFiles, getContextText, clearFiles]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = (value.trim().length > 0 || hasFiles) && !running;

  return (
    <div className="relative">
      {/* Загруженные файлы */}
      <UploadedFilesList files={files} onRemove={removeFile} />

      {/* Основной композер */}
      <div 
        className={cn(
          "ic-composer relative",
          isFocused && "focused"
        )}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyPress={handleKeyPress}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Опишите задачу... (Enter — отправить, Shift+Enter — новая строка)"
          className="w-full resize-none bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-ink placeholder:text-ink-mute focus:outline-none"
          rows={1}
          disabled={running}
        />

        {/* Панель инструментов */}
        <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
          {/* Загрузка файлов */}
          <FileUpload 
            onFilesUploaded={addFiles}
            disabled={running}
          />

          {/* Разделитель */}
          <div className="mx-1 h-4 w-px bg-line" />

          {/* Быстрые настройки */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors",
                showSettings 
                  ? "bg-accent/10 text-accent" 
                  : "text-ink-mute hover:bg-raised hover:text-ink-soft"
              )}
              title="Настройки агента"
            >
              <Icon name="settings" size={13} />
              <span className="hidden sm:inline">Настройки</span>
            </button>

            {showSettings && (
              <ComposerSettings onClose={() => setShowSettings(false)} />
            )}
          </div>

          {/* Текущий режим */}
          <div className="flex items-center gap-1.5 text-[10px] text-ink-mute">
            <span className={cn(
              "rounded-full px-1.5 py-0.5",
              settings.mode === "swarm" ? "bg-violet/10 text-violet" : "bg-accent/10 text-accent"
            )}>
              {settings.mode === "swarm" ? "Рой" : "Агент"}
            </span>
            <span className="capitalize">{settings.effort}</span>
          </div>

          <div className="flex-1" />

          {/* Счетчик символов */}
          {value.length > 0 && (
            <span className="text-[10px] text-ink-mute">
              {value.length}
            </span>
          )}

          {/* Кнопка отправки */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-lg transition-all",
              canSubmit
                ? "bg-accent text-white hover:bg-accent/90 active:scale-95"
                : "bg-raised text-ink-mute cursor-not-allowed"
            )}
            title="Отправить (Enter)"
          >
            <Icon 
              name={running ? "spinner" : "arrowUp"} 
              size={14} 
              className={running ? "animate-spin" : ""} 
            />
          </button>
        </div>
      </div>

      {/* Подсказки */}
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-mute">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-0.5">
            <kbd className="rounded border border-line bg-raised px-1">Enter</kbd>
            отправить
          </span>
          <span className="flex items-center gap-0.5">
            <kbd className="rounded border border-line bg-raised px-1">Shift+Enter</kbd>
            новая строка
          </span>
        </div>
        {settings.autonomous && (
          <span className="flex items-center gap-1 text-accent">
            <Icon name="zap" size={10} />
            Автономный режим
          </span>
        )}
      </div>
    </div>
  );
}
