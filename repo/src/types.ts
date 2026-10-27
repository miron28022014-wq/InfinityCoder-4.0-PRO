/** Shared domain types for the InfinityCoder agent runtime. */

export type Role = "system" | "user" | "assistant" | "tool";

export interface Msg {
  role: Role;
  content: string;
  /** Tool name this message answers (tool role only). */
  name?: string;
}

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

export type ToolName =
  // file system
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "move_file"
  | "create_dir"
  | "list_dir"
  | "search_files"
  | "file_stat"
  // process
  | "run_command"
  // project memory (Ledger)
  | "memory_search"
  | "memory_write"
  | "memory_list"
  | "memory_forget"
  // version control
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_commit"
  // network
  | "web_fetch"
  | "web_search"
  // Infinity Ecosystem
  | "ecosystem_search"
  | "ecosystem_remember"
  | "ecosystem_object";

export type ToolRisk = "safe" | "write" | "exec" | "destructive";

export interface ToolSpec {
  name: ToolName;
  /** One-line human description shown in the UI. */
  summary: string;
  /** Instruction block injected into the system prompt. */
  usage: string;
  risk: ToolRisk;
  /** JSON Schema of the args object. */
  schema: {
    [key: string]: {
      type: string;
      description: string;
      required?: boolean;
      default?: string | number;
      enum?: string[];
    };
  };
  /** Icon key from the shared icon set. */
  icon: string;
}

export interface ToolCall {
  tool: ToolName | string;
  args: Record<string, unknown>;
  /** Raw text of the call, kept for the transcript. */
  raw?: string;
  /** Set when the call came from an unparseable fragment. */
  malformed?: boolean;
}

export interface ToolOutcome {
  ok: boolean;
  /** Human-facing one-liner ("Прочитал src/App.tsx"). */
  label: string;
  /** Model-facing payload (already truncated). */
  data: unknown;
  /** Short preview for the tool card body. */
  preview?: string;
  /** Wall time in ms. */
  ms?: number;
  /** Paths touched — used to refresh the explorer/editor. */
  touched?: string[];
  requiresApproval?: boolean;
  denied?: boolean;
}

/* ------------------------------------------------------------------ *
 * Activity / run telemetry
 * ------------------------------------------------------------------ */

export type ActivityKind =
  | "thinking"
  | "plan"
  | "tool"
  | "memory"
  | "swarm_spawn"
  | "swarm_merge"
  | "verify"
  | "error"
  | "done";

export type ActivityStatus = "running" | "ok" | "error";

export interface ActivityEvent {
  id: number;
  kind: ActivityKind;
  /** Short human label shown in the timeline. */
  label: string;
  /** Full detail (command text, file path, error). */
  detail?: string;
  agentId: string;
  status: ActivityStatus;
  ts: number;
  /** Populated for tool events. */
  tool?: ToolCall;
  result?: ToolOutcome;
  turn?: number;
}

export interface Usage {
  prompt: number;
  completion: number;
  total: number;
}

export interface AgentRunStats {
  turns: number;
  toolCalls: number;
  startedAt: number;
  finishedAt?: number;
  usage: Usage;
  cost: number;
  model: string;
}

/* ------------------------------------------------------------------ *
 * Agents & swarm
 * ------------------------------------------------------------------ */

export type AgentRole = "lead" | "planner" | "implementer" | "reviewer" | "tester" | "researcher";

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  /** Appended to the base system prompt. */
  directive: string;
  icon: string;
  /** CSS rgb triple used for the worker card accent. */
  tint: string;
  /** Tools this profile is allowed to touch. Empty = all. */
  allow: ToolName[];
  /** Effort used for this agent. */
  effort: Effort;
  temperature: number;
  maxTurns: number;
}

export type WorkerStatus = "pending" | "running" | "ok" | "error";

export interface SwarmWorker {
  id: string;
  index: number;
  profile: AgentProfile;
  subtask: string;
  status: WorkerStatus;
  /** Current action line. */
  current?: string;
  output?: string;
  startedAt?: number;
  finishedAt?: number;
  turns: number;
  toolCalls: number;
  touched: string[];
  error?: string;
}

export interface SwarmPlan {
  goal: string;
  steps: string[];
  workers: { subtask: string; profile: AgentProfile; scope: string[] }[];
}

export interface PendingQuestion {
  id: number;
  question: string;
  detail?: string;
  risk: ToolRisk;
  call?: ToolCall;
}

/* ------------------------------------------------------------------ *
 * Session / messages
 * ------------------------------------------------------------------ */

export type MessageRole = "user" | "assistant";

export interface ToolCallRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  status: "running" | "ok" | "error" | "denied";
  output?: string;
  ms?: number;
  agentId: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  ts: number;
  agentId?: string;
  toolCalls?: ToolCallRecord[];
  activity?: ActivityEvent[];
  stats?: AgentRunStats;
  error?: string;
  /** Set when the assistant reply was produced by a swarm. */
  swarm?: { workers: SwarmWorker[]; plan: string[] };
}

export interface OpenFile {
  path: string;
  content: string;
  /** Content on disk at the time of load. */
  saved: string;
  language: string;
}

export interface FsItem {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  modified?: number;
}

export interface LedgerEntry {
  key: string;
  description: string;
  file_path: string;
  kind?: string;
  tags?: string;
  updated_at?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  changed: number;
  untracked: number;
  clean: boolean;
  is_repo: boolean;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export type Effort = "low" | "medium" | "high" | "ultra";
export type AskPolicy = "never" | "smart" | "always";
export type Mode = "agent" | "swarm";
export type ProviderKind = "local" | "cloud";
export type SidebarTab = "files" | "agents" | "memory" | "ecosystem";

export interface EffortPreset {
  temperature: number;
  maxTurns: number;
  verifyPasses: number;
  recallTopK: number;
  label: string;
  hint: string;
}

export interface Settings {
  /* engine */
  mode: Mode;
  effort: Effort;
  ask: AskPolicy;
  planFirst: boolean;
  autoRecall: boolean;
  verifyResult: boolean;
  /* swarm */
  swarmSize: number;
  parallelSwarm: boolean;
  /* provider */
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  localModel: string;
  localPort: number;
  /* ui */
  theme: "dark" | "light";
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  chatWidth: number;
  showActivity: boolean;
  reduceMotion: boolean;
  /* agent */
  activeAgent: string;
  autoRoute: boolean;
  /* autonomy — агент доводит задачу сам, без лишних вопросов */
  /** Автономный режим: меньше подтверждений, работа продолжается до результата. */
  autonomous: boolean;
  /** Сколько раз агент может быть подтолкнут продолжить, если остановился раньше. */
  autonomousNudges: number;
  /* infinity ecosystem */
  /** Адрес Core API. Пусто — IDE работает автономно. */
  ecosystemUrl: string;
  /** Включено ли использование экосистемы (модель, гранты, память, поиск). */
  ecosystemUse: boolean;
  /** Подключаться автоматически при запуске. */
  ecosystemAutoConnect: boolean;
  /** Модель экосистемы, через которую идёт генерация. */
  ecosystemModelId: string;
  /** Режим маршрутизатора: local блокирует облако на сервере. */
  ecosystemScope: "local" | "cloud";
  /** Синхронизировать журнал изменений экосистемы. */
  ecosystemSync: boolean;
  /** Отправлять факты из памяти проекта в общую память экосистемы. */
  ecosystemShareMemory: boolean;
}

/* ------------------------------------------------------------------ *
 * Infinity Ecosystem
 * ------------------------------------------------------------------ */

export type EcoStatus = "off" | "connecting" | "online" | "error";

/** Запись общей памяти экосистемы. */
export interface EcoMemory {
  id: string;
  content: string;
  source: { type: string; objectId?: string; title?: string; snippet?: string };
  importance: number;
  updatedAt: string;
}

export interface EcoAccount {
  id: string;
  email: string;
  displayName: string;
}

export interface EcoToolGrant {
  tool: string;
  scope: "ask" | "allow" | "deny";
}

/** Состояние связи с экосистемой. */
export interface EcoState {
  status: EcoStatus;
  message: string;
  url: string;
  account: EcoAccount | null;
  models: { id: string; displayName: string; providerId: string; scope: "local" | "cloud" }[];
  providers: { id: string; name: string; scope: "local" | "cloud"; enabled: boolean; isDefault: boolean }[];
  grants: EcoToolGrant[];
  /** Курсор журнала изменений Sync. */
  syncCursor: number;
  pendingChanges: number;
  lastSync: number | null;
  /** Диагностика ядра: провайдеры, модели, индекс поиска. */
  diagnostics: {
    providers: number;
    enabled: number;
    models: number;
    local: number;
    cloud: number;
    indexed: number;
    stale: number;
  } | null;
  /** Ошибка последней операции. */
  error: string | null;
  /** Общая память экосистемы (последние записи). */
  memories: EcoMemory[];
}

export interface Toast {
  id: number;
  kind: "info" | "ok" | "warn" | "error";
  text: string;
  detail?: string;
}
