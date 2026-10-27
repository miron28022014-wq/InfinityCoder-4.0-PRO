import type { AskPolicy, Effort, EffortPreset, Settings } from "../types";

export const RELAY_BASE_URL = "https://api.relaymodels.com";
export const LOCAL_HOST = "127.0.0.1";

export const CLOUD_MODELS = [
  "gpt-6-astra",
  "claude-opus-5-5",
  "gpt-5.1-codex",
  "qwen3-coder-480b"
] as const;

export const DEFAULT_SETTINGS: Settings = {
  mode: "agent",
  effort: "medium",
  ask: "smart",
  planFirst: true,
  autoRecall: true,
  verifyResult: true,
  swarmSize: 3,
  parallelSwarm: true,
  // No key ships with the app on purpose — the user pastes their own in Settings.
  provider: "cloud",
  baseUrl: RELAY_BASE_URL,
  apiKey: "",
  model: "gpt-6-astra",
  localModel: "qwen-coder",
  localPort: 8080,
  theme: "dark",
  sidebarTab: "files",
  sidebarWidth: 268,
  chatWidth: 440,
  showActivity: true,
  reduceMotion: false,
  activeAgent: "lead",
  autoRoute: true,
  // Автономность включена по умолчанию: агент работает до результата.
  autonomous: true,
  autonomousNudges: 2,
  // Infinity Ecosystem: по умолчанию выключено — IDE полностью работоспособен
  // автономно, экосистема подключается по адресу Core API.
  ecosystemUrl: "",
  ecosystemUse: false,
  ecosystemAutoConnect: true,
  ecosystemModelId: "",
  ecosystemScope: "local",
  ecosystemSync: true,
  ecosystemShareMemory: true
};

const KEY = "infinitycoder.settings.v3";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Guard against corrupt/legacy shapes reaching the runtime.
    merged.swarmSize = Math.min(6, Math.max(2, Number(merged.swarmSize) || 3));
    merged.sidebarWidth = Math.min(520, Math.max(200, Number(merged.sidebarWidth) || 268));
    merged.chatWidth = Math.min(820, Math.max(340, Number(merged.chatWidth) || 440));
    if (!merged.baseUrl) merged.baseUrl = RELAY_BASE_URL;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — settings simply stay in memory */
  }
}

export const EFFORT_PRESETS: Record<Effort, EffortPreset> = {
  low: {
    temperature: 0.05,
    maxTurns: 8,
    verifyPasses: 0,
    recallTopK: 3,
    label: "Низкий",
    hint: "Быстро и дёшево: 1–2 шага, без самопроверки"
  },
  medium: {
    temperature: 0.15,
    maxTurns: 16,
    verifyPasses: 1,
    recallTopK: 5,
    label: "Средний",
    hint: "Баланс: до 8 шагов, одна проверка результата"
  },
  high: {
    temperature: 0.22,
    maxTurns: 28,
    verifyPasses: 1,
    recallTopK: 8,
    label: "Высокий",
    hint: "Глубокая работа с проектом и рефлексией"
  },
  ultra: {
    temperature: 0.3,
    maxTurns: 48,
    verifyPasses: 2,
    recallTopK: 10,
    label: "Ультра",
    hint: "Максимум: долгие цепочки, swarm 6, двойная проверка"
  }
};

export const ASK_LABELS: Record<AskPolicy, string> = {
  never: "Без вопросов",
  smart: "Спрашивать о рисках",
  always: "Спрашивать всегда"
};

export const ASK_HINTS: Record<AskPolicy, string> = {
  never: "Агент работает автономно. Опасные операции он всё равно логирует в панель активности.",
  smart: "Подтверждение только перед удалением, коммитом и командами вне проекта.",
  always: "Каждое действие агента требует подтверждения."
};

export const EFFORT_ORDER: Effort[] = ["low", "medium", "high", "ultra"];
