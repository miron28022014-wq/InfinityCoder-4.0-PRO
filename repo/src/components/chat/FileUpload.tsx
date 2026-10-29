/**
 * Компонент загрузки файлов в чат без сохранения в файловую систему.
 * 
 * Файлы хранятся в памяти и отправляются как контекст к сообщению.
 */

import { useState, useCallback, useRef } from "react";
import { Icon } from "../../icons";
import { cn } from "../../lib/utils";

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string | ArrayBuffer;
  preview?: string;
}

interface FileUploadProps {
  onFilesUploaded: (files: UploadedFile[]) => void;
  maxFiles?: number;
  maxSize?: number; // в MB
  acceptedTypes?: string[];
  disabled?: boolean;
}

const DEFAULT_MAX_SIZE = 10; // 10 MB
const DEFAULT_ACCEPTED = [
  "text/*",
  "application/json",
  "application/javascript",
  "application/typescript",
  "image/*",
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".css", ".html", ".xml", ".yaml", ".yml", ".toml"
];

export function FileUpload({
  onFilesUploaded,
  maxFiles = 5,
  maxSize = DEFAULT_MAX_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED,
  disabled = false
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, maxFiles);
    const uploaded: UploadedFile[] = [];

    setUploading(true);

    for (const file of fileArray) {
      // Проверка размера
      if (file.size > maxSize * 1024 * 1024) {
        console.warn(`Файл ${file.name} превышает лимит ${maxSize}MB`);
        continue;
      }

      // Проверка типа
      const isAccepted = acceptedTypes.some(type => {
        if (type.startsWith(".")) return file.name.endsWith(type);
        if (type.endsWith("/*")) return file.type.startsWith(type.slice(0, -1));
        return file.type === type;
      });

      if (!isAccepted && file.type !== "") {
        console.warn(`Файл ${file.name} имеет неподдерживаемый тип`);
        continue;
      }

      try {
        const content = await readFile(file);
        const uploadedFile: UploadedFile = {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          content,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
        };
        uploaded.push(uploadedFile);
      } catch (err) {
        console.error(`Ошибка чтения файла ${file.name}:`, err);
      }
    }

    setUploading(false);

    if (uploaded.length > 0) {
      onFilesUploaded(uploaded);
    }
  }, [maxFiles, maxSize, acceptedTypes, onFilesUploaded]);

  const readFile = (file: File): Promise<string | ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result!);
      reader.onerror = reject;

      // Для текстовых файлов читаем как текст, для бинарных как ArrayBuffer
      if (file.type.startsWith("text/") || file.type === "application/json" || 
          file.name.match(/\.(ts|tsx|js|jsx|json|md|txt|py|rs|go|java|c|cpp|h|css|html|xml|yaml|yml|toml)$/)) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFiles(files);
    }
  }, [disabled, processFiles]);

  const handleClick = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
    // Сброс input для возможности повторной загрузки того же файла
    e.target.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptedTypes.join(",")}
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled}
      />

      <button
        type="button"
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={disabled || uploading}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-[11px] transition-all",
          isDragOver 
            ? "border-accent bg-accent/10 text-accent" 
            : "border-line text-ink-mute hover:border-line-strong hover:text-ink-soft",
          disabled && "opacity-50 cursor-not-allowed",
          uploading && "opacity-70"
        )}
        title="Прикрепить файлы (не сохраняются в проект)"
      >
        <Icon name={uploading ? "spinner" : "paperclip"} size={13} className={uploading ? "animate-spin" : ""} />
        <span>{uploading ? "Загрузка..." : "Файлы"}</span>
      </button>
    </>
  );
}

// Компонент отображения загруженных файлов
export function UploadedFilesList({
  files,
  onRemove
}: {
  files: UploadedFile[];
  onRemove: (id: string) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {files.map(file => (
        <div
          key={file.id}
          className="group flex items-center gap-1.5 rounded-lg border border-line bg-raised/50 py-1 pl-2 pr-1 text-[11px]"
        >
          <Icon 
            name={file.type.startsWith("image/") ? "image" : "file"} 
            size={12} 
            className="text-ink-mute" 
          />
          <span className="max-w-[120px] truncate text-ink-soft">{file.name}</span>
          <span className="text-ink-mute">({formatSize(file.size)})</span>
          <button
            onClick={() => onRemove(file.id)}
            className="grid h-4 w-4 place-items-center rounded text-ink-mute opacity-0 transition-opacity hover:bg-danger/20 hover:text-danger group-hover:opacity-100"
            aria-label={`Удалить ${file.name}`}
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Хук для управления загруженными файлами
export function useFileUpload() {
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const addFiles = useCallback((newFiles: UploadedFile[]) => {
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file?.preview) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const clearFiles = useCallback(() => {
    setFiles(prev => {
      prev.forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      return [];
    });
  }, []);

  const getContextText = useCallback(() => {
    return files
      .map(f => {
        if (typeof f.content === "string") {
          return `--- Файл: ${f.name} ---
${f.content}
--- Конец файла ---`;
        }
        return `--- Файл: ${f.name} (бинарный, ${formatSize(f.size)}) ---`;
      })
      .join("\n\n");
  }, [files]);

  return {
    files,
    addFiles,
    removeFile,
    clearFiles,
    getContextText,
    hasFiles: files.length > 0
  };
}
