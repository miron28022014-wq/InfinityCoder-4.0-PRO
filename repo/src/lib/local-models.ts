/**
 * Каталог локальных моделей для InfinityCoder.
 * 
 * Поддерживаемые форматы:
 * - GGUF (через llama.cpp)
 * - ONNX
 * - Safetensors
 * 
 * Источники:
 * - Hugging Face
 * - Ollama
 * - LM Studio
 * - LocalAI
 */

export interface LocalModel {
  id: string;
  name: string;
  displayName: string;
  description: string;
  size: string; // примерный размер в GB
  parameters: string; // количество параметров
  contextSize: number; // максимальный контекст
  quantization: string[]; // доступные квантизации
  capabilities: ("code" | "chat" | "instruct" | "fill" | "embed")[];
  recommended?: boolean;
  url?: string; // ссылка для скачивания
  provider: "llama.cpp" | "ollama" | "onnx" | "generic";
}

export const LOCAL_MODELS: LocalModel[] = [
  // === КОДОВЫЕ МОДЕЛИ ===
  {
    id: "deepseek-coder-6.7b",
    name: "deepseek-coder-6.7b-instruct",
    displayName: "DeepSeek Coder 6.7B",
    description: "Специализированная модель для кода. Отличное качество генерации и понимания кода.",
    size: "3.8 GB",
    parameters: "6.7B",
    contextSize: 16384,
    quantization: ["Q4_K_M", "Q5_K_M", "Q8_0"],
    capabilities: ["code", "instruct", "fill"],
    recommended: true,
    url: "https://huggingface.co/TheBloke/deepseek-coder-6.7b-instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "deepseek-coder-1.3b",
    name: "deepseek-coder-1.3b-instruct",
    displayName: "DeepSeek Coder 1.3B",
    description: "Лёгкая версия для быстрых задач. Подходит для слабых машин.",
    size: "0.8 GB",
    parameters: "1.3B",
    contextSize: 8192,
    quantization: ["Q4_K_M", "Q8_0"],
    capabilities: ["code", "instruct"],
    url: "https://huggingface.co/TheBloke/deepseek-coder-1.3b-instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "codellama-7b",
    name: "codellama-7b-instruct",
    displayName: "CodeLlama 7B",
    description: "Meta CodeLlama для задач программирования. Хороший баланс скорости и качества.",
    size: "4.1 GB",
    parameters: "7B",
    contextSize: 16384,
    quantization: ["Q4_K_M", "Q5_K_M", "Q8_0"],
    capabilities: ["code", "instruct", "fill"],
    url: "https://huggingface.co/TheBloke/CodeLlama-7B-Instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "codellama-13b",
    name: "codellama-13b-instruct",
    displayName: "CodeLlama 13B",
    description: "Улучшенная версия CodeLlama с большим контекстом.",
    size: "7.9 GB",
    parameters: "13B",
    contextSize: 16384,
    quantization: ["Q4_K_M", "Q5_K_M"],
    capabilities: ["code", "instruct"],
    url: "https://huggingface.co/TheBloke/CodeLlama-13B-Instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "codegemma-7b",
    name: "codegemma-7b-it",
    displayName: "CodeGemma 7B",
    description: "Google CodeGemma. Отличная для автодополнения и генерации кода.",
    size: "4.5 GB",
    parameters: "7B",
    contextSize: 8192,
    quantization: ["Q4_K_M", "Q8_0"],
    capabilities: ["code", "instruct", "fill"],
    recommended: true,
    url: "https://huggingface.co/google/codegemma-7b-it-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "starcoder2-7b",
    name: "starcoder2-7b",
    displayName: "StarCoder2 7B",
    description: "Модель от BigCode. Специализирована на множестве языков программирования.",
    size: "4.0 GB",
    parameters: "7B",
    contextSize: 16384,
    quantization: ["Q4_K_M", "Q8_0"],
    capabilities: ["code", "fill"],
    url: "https://huggingface.co/bigcode/starcoder2-7b-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "qwen2.5-coder-7b",
    name: "qwen2.5-coder-7b-instruct",
    displayName: "Qwen 2.5 Coder 7B",
    description: "Alibaba Qwen Coder. Сильная модель для кода с поддержкой многих языков.",
    size: "4.5 GB",
    parameters: "7B",
    contextSize: 32768,
    quantization: ["Q4_K_M", "Q5_K_M", "Q8_0"],
    capabilities: ["code", "instruct", "fill"],
    recommended: true,
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "qwen2.5-coder-1.5b",
    name: "qwen2.5-coder-1.5b-instruct",
    displayName: "Qwen 2.5 Coder 1.5B",
    description: "Компактная версия Qwen Coder для быстрых задач.",
    size: "1.0 GB",
    parameters: "1.5B",
    contextSize: 32768,
    quantization: ["Q4_K_M", "Q8_0"],
    capabilities: ["code", "instruct"],
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
    provider: "llama.cpp"
  },

  // === УНИВЕРСАЛЬНЫЕ МОДЕЛИ ===
  {
    id: "llama3.1-8b",
    name: "llama-3.1-8b-instruct",
    displayName: "Llama 3.1 8B",
    description: "Meta Llama 3.1. Универсальная модель с отличным пониманием инструкций.",
    size: "4.9 GB",
    parameters: "8B",
    contextSize: 131072,
    quantization: ["Q4_K_M", "Q5_K_M", "Q8_0"],
    capabilities: ["chat", "instruct"],
    recommended: true,
    url: "https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "llama3.2-3b",
    name: "llama-3.2-3b-instruct",
    displayName: "Llama 3.2 3B",
    description: "Компактная Llama 3.2 для устройств с ограниченными ресурсами.",
    size: "2.0 GB",
    parameters: "3B",
    contextSize: 131072,
    quantization: ["Q4_K_M", "Q8_0"],
    capabilities: ["chat", "instruct"],
    url: "https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "mistral-7b",
    name: "mistral-7b-instruct-v0.3",
    displayName: "Mistral 7B v0.3",
    description: "Mistral AI. Быстрая и качественная универсальная модель.",
    size: "4.1 GB",
    parameters: "7B",
    contextSize: 32768,
    quantization: ["Q4_K_M", "Q5_K_M", "Q8_0"],
    capabilities: ["chat", "instruct"],
    url: "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "phi-3-mini",
    name: "phi-3-mini-4k-instruct",
    displayName: "Phi-3 Mini",
    description: "Microsoft Phi-3. Маленькая но мощная модель для своего размера.",
    size: "2.3 GB",
    parameters: "3.8B",
    contextSize: 4096,
    quantization: ["Q4_K_M", "Q8_0"],
    capabilities: ["chat", "instruct", "code"],
    recommended: true,
    url: "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf",
    provider: "llama.cpp"
  },
  {
    id: "gemma-2-9b",
    name: "gemma-2-9b-it",
    displayName: "Gemma 2 9B",
    description: "Google Gemma 2. Улучшенная универсальная модель.",
    size: "5.8 GB",
    parameters: "9B",
    contextSize: 8192,
    quantization: ["Q4_K_M", "Q5_K_M"],
    capabilities: ["chat", "instruct"],
    url: "https://huggingface.co/google/gemma-2-9b-it-GGUF",
    provider: "llama.cpp"
  },

  // === БОЛЬШИЕ МОДЕЛИ ===
  {
    id: "deepseek-coder-33b",
    name: "deepseek-coder-33b-instruct",
    displayName: "DeepSeek Coder 33B",
    description: "Большая версия DeepSeek Coder. Максимальное качество для сложных задач.",
    size: "19.8 GB",
    parameters: "33B",
    contextSize: 16384,
    quantization: ["Q4_K_M", "Q5_K_M"],
    capabilities: ["code", "instruct"],
    url: "https://huggingface.co/TheBloke/deepseek-coder-33b-instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "codellama-34b",
    name: "codellama-34b-instruct",
    displayName: "CodeLlama 34B",
    description: "Максимальная версия CodeLlama для сложных проектов.",
    size: "20.2 GB",
    parameters: "34B",
    contextSize: 16384,
    quantization: ["Q4_K_M"],
    capabilities: ["code", "instruct"],
    url: "https://huggingface.co/TheBloke/CodeLlama-34B-Instruct-GGUF",
    provider: "llama.cpp"
  },
  {
    id: "qwen2.5-coder-32b",
    name: "qwen2.5-coder-32b-instruct",
    displayName: "Qwen 2.5 Coder 32B",
    description: "Топовая кодовая модель Qwen для профессиональной разработки.",
    size: "19.9 GB",
    parameters: "32B",
    contextSize: 32768,
    quantization: ["Q4_K_M", "Q5_K_M"],
    capabilities: ["code", "instruct"],
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
    provider: "llama.cpp"
  },

  // === OLLAMA МОДЕЛИ ===
  {
    id: "ollama-codellama",
    name: "codellama",
    displayName: "Ollama CodeLlama",
    description: "CodeLlama через Ollama. Простой запуск одной командой.",
    size: "3.8 GB",
    parameters: "7B",
    contextSize: 16384,
    quantization: ["Q4_0"],
    capabilities: ["code", "instruct"],
    provider: "ollama"
  },
  {
    id: "ollama-deepseek-coder",
    name: "deepseek-coder",
    displayName: "Ollama DeepSeek Coder",
    description: "DeepSeek Coder через Ollama.",
    size: "3.8 GB",
    parameters: "6.7B",
    contextSize: 16384,
    quantization: ["Q4_0"],
    capabilities: ["code", "instruct"],
    provider: "ollama"
  },
  {
    id: "ollama-codellama-13b",
    name: "codellama:13b",
    displayName: "Ollama CodeLlama 13B",
    description: "CodeLlama 13B через Ollama.",
    size: "7.4 GB",
    parameters: "13B",
    contextSize: 16384,
    quantization: ["Q4_0"],
    capabilities: ["code", "instruct"],
    provider: "ollama"
  }
];

// Группировка по категориям
export const MODEL_CATEGORIES = {
  code: LOCAL_MODELS.filter(m => m.capabilities.includes("code")),
  chat: LOCAL_MODELS.filter(m => m.capabilities.includes("chat")),
  light: LOCAL_MODELS.filter(m => parseFloat(m.parameters) < 5),
  heavy: LOCAL_MODELS.filter(m => parseFloat(m.parameters) >= 30),
  recommended: LOCAL_MODELS.filter(m => m.recommended)
};

// Помощники для выбора модели
export function getModelsByProvider(provider: string): LocalModel[] {
  return LOCAL_MODELS.filter(m => m.provider === provider);
}

export function getModelsByCapability(capability: string): LocalModel[] {
  return LOCAL_MODELS.filter(m => m.capabilities.includes(capability as any));
}

export function getRecommendedModels(): LocalModel[] {
  return LOCAL_MODELS.filter(m => m.recommended);
}

export function findModelById(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find(m => m.id === id);
}

// Оценка требований к VRAM
export function estimateVRAM(model: LocalModel, quantization: string): string {
  const sizes: Record<string, number> = {
    "Q4_K_M": 0.6,
    "Q4_0": 0.55,
    "Q5_K_M": 0.7,
    "Q5_0": 0.65,
    "Q8_0": 1.0
  };
  const multiplier = sizes[quantization] || 0.6;
  const baseGB = parseFloat(model.size);
  return `${(baseGB * multiplier).toFixed(1)} GB VRAM`;
}
