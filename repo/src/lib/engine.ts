/**
 * Agent runtime.
 *
 * One ReAct loop drives the lead agent and every swarm worker — only the system
 * prompt, the tool allowlist and the activity label differ. Results are merged
 * into a single RunResult so the UI can render one transcript and one swarm board.
 */
import { complete, publish } from "./activity";
import { api } from "./ipc";
import { complete as llmComplete, type LLMTarget } from "./llm";
import type { Transport } from "./ecosystem-llm";
import type { EcosystemClient, EcoGrantScope } from "./ecosystem";
import { parseToolCalls, stripCalls, visiblePrefix } from "./parse";
import { execTool, toolSpec, toolRisk } from "./tools";
import { assignProfiles, getAgent } from "./agents";
import {
  buildSystemPrompt,
  COMPACT_PROMPT,
  DECOMPOSE_PROMPT,
  PLANNER_PROMPT,
  SYNTHESIZE_PROMPT,
  VERIFY_PROMPT
} from "./prompts";
import { EFFORT_PRESETS } from "./settings";
import type {
  AgentProfile,
  LedgerEntry,
  Msg,
  OpenFile,
  PendingQuestion,
  Settings,
  SwarmPlan,
  SwarmWorker,
  ToolCall,
  Usage,
  WorkerStatus
} from "../types";

const MAX_TOOL_RESULT = 24_000;
const MAX_HISTORY = 24;

export interface EngineDeps {
  getSettings: () => Settings;
  getRoot: () => string;
  getOpenFile: () => OpenFile | null;
  onQuestion: (q: PendingQuestion | null) => void;
  onTouched: (paths: string[]) => void;
  onWorkers: (w: SwarmWorker[]) => void;
  onUsage: (u: Usage) => void;
  /** Streams human-visible assistant text (tool payloads already masked). */
  onTextDelta: (text: string) => void;
  /**
   * Транспорт генерации. Возвращает transport — агент работает через
   * Infinity Ecosystem (AI Runtime, ключи и режим — на сервере).
   * null — локальный провайдер из настроек.
   */
  getTransport?: () => Transport | null;
  /** Клиент экосистемы: поиск по другим приложениям и общая память. */
  getEco?: () => EcosystemClient | null;
  /** Разрешение инструмента по общим грантам Tool Runtime. */
  getGrant?: (tool: string) => EcoGrantScope | null;
}

export interface RunResult {
  text: string;
  turns: number;
  toolCalls: number;
  usage: Usage;
  plan: string[];
  workers: SwarmWorker[];
}

const emptyUsage = (): Usage => ({ prompt: 0, completion: 0, total: 0 });

const addUsage = (a: Usage, b: Usage): Usage => ({
  prompt: a.prompt + b.prompt,
  completion: a.completion + b.completion,
  total: a.total + b.total
});

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "\n…[обрезано]" : s);

function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  const candidates = [fence?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    const s = c.trim();
    const start = s.search(/[[{]/);
    if (start < 0) continue;
    // Walk to the matching close so prose after the JSON does not break parsing.
    const open = s[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === open) depth++;
      else if (s[i] === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

export class AgentEngine {
  /** Сколько раз агент был подтолкнут продолжить работу в текущем заходе. */
  private nudges = 0;

  private abort = new AbortController();
  private questionCounter = 0;
  private usage: Usage = emptyUsage();

  constructor(private deps: EngineDeps) {}

  cancel() {
    this.abort.abort();
  }

  reset() {
    this.abort.abort();
    this.abort = new AbortController();
    this.usage = emptyUsage();
  }

  get signal() {
    return this.abort.signal;
  }

  private get target(): LLMTarget {
    const s = this.deps.getSettings();
    return {
      baseUrl: s.baseUrl,
      apiKey: s.provider === "cloud" ? s.apiKey || undefined : undefined,
      model: s.provider === "cloud" ? s.model : s.localModel,
      local: s.provider === "local"
    };
  }

  /* ---------------------------------------------------------------- *
   * Streaming with call-aware masking
   * ---------------------------------------------------------------- */
  /**
   * Streams a completion. The caller's `sink` receives **only** human-visible
   * text: tool payloads are masked out incrementally, so a half-written JSON
   * block never reaches the transcript.
   */
  private async stream(
    messages: Msg[],
    temperature: number,
    sink?: (visibleDelta: string) => void,
    maxTokens?: number
  ) {
    let raw = "";
    let emitted = "";

    const onDelta = (d: string) => {
      raw += d;
      if (!sink) return;
      const vis = visiblePrefix(raw);
      if (vis.startsWith(emitted)) {
        const add = vis.slice(emitted.length);
        if (add) {
          emitted = vis;
          sink(add);
        }
      } else if (vis.length <= emitted.length) {
        emitted = vis;
      } else {
        emitted = vis;
        sink(vis);
      }
    };

    // Экосистема (AI Runtime) или локальный провайдер из настроек.
    const transport = this.deps.getTransport?.() ?? null;
    const res = transport
      ? await transport.complete(messages, {
          temperature,
          maxTokens,
          signal: this.abort.signal,
          onDelta
        })
      : await llmComplete(messages, this.target, {
          temperature,
          maxTokens,
          signal: this.abort.signal,
          onDelta
        });

    // Если транспорт не прислал дельты, берём итоговый текст.
    if (!raw && res.text) raw = res.text;

    this.usage = addUsage(this.usage, res.usage);
    this.deps.onUsage(this.usage);
    // Flush anything the masking held back on the final chunk.
    if (sink) {
      const vis = visiblePrefix(raw);
      if (vis !== emitted) sink(vis.startsWith(emitted) ? vis.slice(emitted.length) : vis);
    }
    return { raw, visible: visiblePrefix(raw), usage: res.usage, reasoning: res.reasoning };
  }

  /* ---------------------------------------------------------------- *
   * Approval gate
   * ---------------------------------------------------------------- */
  private needsApproval(tool: string): boolean {
    const grant = this.deps.getGrant?.(tool) ?? null;
    // Общий грант экосистемы: deny — не спрашиваем (инструмент запрещён),
    // allow — не спрашиваем (пользователь разрешил заранее).
    if (grant === "allow") return false;
    const settings = this.deps.getSettings();
    let ask = settings.ask;
    // Автономный режим: подтверждаем только разрушительные операции.
    if (settings.autonomous && ask === "always") ask = "smart";
    if (ask === "never") return false;
    if (ask === "always") return true;
    const risk = toolRisk(tool);
    // "smart" — only irreversible or out-of-band operations.
    return risk === "destructive";
  }

  /** Инструмент запрещён общим грантом экосистемы. */
  private isDenied(tool: string): boolean {
    return (this.deps.getGrant?.(tool) ?? null) === "deny";
  }

  private askUser(question: string, detail: string, call: ToolCall): Promise<boolean> {
    const q: PendingQuestion = { id: ++this.questionCounter, question, detail, risk: toolRisk(call.tool), call };
    this.deps.onQuestion(q);
    return new Promise<boolean>(resolve => {
      const handler = (e: Event) => {
        const d = (e as CustomEvent).detail as { id: number; answer: boolean | null };
        if (d.id !== q.id) return;
        window.removeEventListener("infinitycoder:answer", handler);
        this.abort.signal.removeEventListener("abort", onAbort);
        this.deps.onQuestion(null);
        resolve(d.answer === true);
      };
      const onAbort = () => {
        window.removeEventListener("infinitycoder:answer", handler);
        resolve(false);
      };
      window.addEventListener("infinitycoder:answer", handler);
      this.abort.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /* ---------------------------------------------------------------- *
   * ReAct loop
   * ---------------------------------------------------------------- */
  private async runLoop(
    history: Msg[],
    system: string,
    profile: AgentProfile,
    opts: {
      agentId: string;
      maxTurns: number;
      streamToChat?: boolean;
      scope?: string[];
      onWorkerTick?: (patch: Partial<SwarmWorker>) => void;
      worker?: SwarmWorker;
    }
  ): Promise<{ text: string; turns: number; toolCalls: number; touched: string[] }> {
    const settings = this.deps.getSettings();
    const root = this.deps.getRoot();
    let lastText = "";
    let turns = 0;
    let toolCalls = 0;
    const touched: string[] = [];
    let recallRounds = 0;
    this.nudges = 0;

    for (let turn = 0; turn < opts.maxTurns; turn++) {
      if (this.abort.signal.aborted) break;
      turns++;

      const thinkEv = publish({
        kind: "thinking",
        label: profile.name,
        detail: `ход ${turn + 1}/${opts.maxTurns}`,
        agentId: opts.agentId,
        turn
      });
      opts.onWorkerTick?.({ current: `размышляет · ход ${turn + 1}` });

      const compact: Msg[] = history.length > MAX_HISTORY
        ? [history[0], { role: "user", content: "…(сокращённая история)…" }, ...history.slice(-MAX_HISTORY)]
        : history;

      let raw = "";
      try {
        const r = await this.stream(
          [{ role: "system", content: system }, ...compact],
          profile.temperature,
          opts.streamToChat ? this.deps.onTextDelta : undefined
        );
        raw = r.raw;
      } catch (e) {
        complete(thinkEv.id, "error");
        throw e;
      }
      complete(thinkEv.id, "ok");

      history.push({ role: "assistant", content: raw });
      const visible = stripCalls(raw);
      if (visible) lastText = visible;

      const calls = parseToolCalls(raw);
      if (calls.length) {
        for (const c of calls) {
          if (this.abort.signal.aborted) break;
          toolCalls++;
          const call: ToolCall = { tool: c.tool, args: c.args, raw: c.raw, malformed: c.broken };
          opts.onWorkerTick?.({ current: `${c.tool}`, toolCalls });

          if (c.broken) {
            const ev = publish({
              kind: "error",
              label: "Некорректный вызов",
              detail: `Не удалось разобрать аргументы ${c.tool}`,
              agentId: opts.agentId,
              tool: call,
              turn
            });
            history.push({
              role: "tool",
              name: c.tool,
              content: `ERROR: не удалось разобрать JSON аргументов инструмента ${c.tool}. Повтори вызов с валидным JSON.`
            });
            complete(ev.id, "error");
            continue;
          }

          if (!toolSpec(c.tool)) {
            const ev = publish({
              kind: "error",
              label: `Нет инструмента ${c.tool}`,
              agentId: opts.agentId,
              tool: call,
              turn
            });
            history.push({
              role: "tool",
              name: c.tool,
              content: `ERROR: инструмента "${c.tool}" не существует. Доступные: ${[...new Set(["read_file", "write_file", "edit_file", "search_files", "run_command", "memory_search", "memory_write"])].join(", ")} и другие из списка в системном промпте.`
            });
            complete(ev.id, "error");
            continue;
          }

          if (this.isDenied(c.tool)) {
            const ev = publish({
              kind: "error",
              label: "Запрещено экосистемой",
              detail: c.tool,
              agentId: opts.agentId,
              tool: call,
              turn
            });
            history.push({
              role: "tool",
              name: c.tool,
              content: "ERROR: инструмент запрещён политикой Infinity Ecosystem (грант deny). Найди другой способ выполнить задачу."
            });
            complete(ev.id, "error");
            continue;
          }

          if (this.needsApproval(c.tool)) {
            const approved = await this.askUser(
              `Разрешить «${c.tool}»?`,
              previewArgs(c.args),
              call
            );
            if (!approved) {
              const ev = publish({
                kind: "error",
                label: "Отклонено пользователем",
                agentId: opts.agentId,
                tool: call,
                turn
              });
              history.push({
                role: "tool",
                name: c.tool,
                content: "ERROR: пользователь запретил эту операцию. Найди другой способ выполнить задачу."
              });
              complete(ev.id, "error");
              continue;
            }
          }

          const ev = publish({
            kind: toolRisk(c.tool) === "safe" ? "tool" : "tool",
            label: toolSpec(c.tool)!.summary,
            detail: previewArgs(c.args),
            agentId: opts.agentId,
            tool: call,
            turn
          });
          const outcome = await execTool(call, {
            root,
            agentId: opts.agentId,
            allow: profile.allow,
            signal: this.abort.signal,
            eco: this.deps.getEco?.() ?? null,
            shareMemory: this.deps.getSettings().ecosystemShareMemory
          });
          complete(ev.id, outcome.ok ? "ok" : "error", outcome);
          if (outcome.touched?.length) {
            touched.push(...outcome.touched);
            this.deps.onTouched(outcome.touched);
          }
          if (outcome.ok) {
            opts.onWorkerTick?.({
              touched: Array.from(new Set([...(opts.worker?.touched ?? []), ...(outcome.touched ?? [])]))
            });
          }

          const payload =
            typeof outcome.data === "string" ? outcome.data : JSON.stringify(outcome.data, null, 1);
          history.push({
            role: "tool",
            name: c.tool,
            content: `${c.tool} RESULT (${outcome.ok ? "ok" : "error"}):\n${clip(payload, MAX_TOOL_RESULT)}`
          });
        }
        continue;
      }

      /* ---- auto-recall: feed unknown identifiers back once ---- */
      if (settings.autoRecall && recallRounds < 1 && turn < opts.maxTurns - 1 && !this.abort.signal.aborted) {
        const source = lastText + " " + (history.find(m => m.role === "user")?.content ?? "");
        const terms = keyTerms(source);
        const hits: LedgerEntry[] = [];
        for (const term of terms.slice(0, 3)) {
          const found = await api.memorySearch(root, term, 3).catch(() => []);
          hits.push(...found);
        }
        const uniq = Array.from(new Map(hits.map(h => [h.key, h])).values());

        // Общая память экосистемы: факты, записанные в других приложениях.
        const eco = this.deps.getEco?.() ?? null;
        if (eco) {
          const remote = await eco.memories(40).catch(() => []);
          const query = terms.slice(0, 4).join(" ").toLowerCase();
          const relevant = remote.filter(m => {
            const hay = `${m.content} ${m.source.title ?? ""}`.toLowerCase();
            return terms.slice(0, 4).some(t => hay.includes(t.toLowerCase()));
          });
          if (relevant.length) {
            const ev = publish({
              kind: "memory",
              label: "Факты из экосистемы",
              detail: relevant.slice(0, 4).map(m => m.content.slice(0, 80)).join(" · "),
              agentId: opts.agentId,
              turn
            });
            history.push({
              role: "tool",
              name: "auto_recall",
              content:
                "AUTO_RECALL — факты из общей памяти Infinity Ecosystem:\n" +
                relevant
                  .slice(0, 5)
                  .map(m => `- [${m.source.type}${m.source.title ? `: ${m.source.title}` : ""}] ${m.content}`)
                  .join("\n") +
                (query ? "" : "")
            });
            complete(ev.id, "ok");
            continue;
          }
        }
        if (uniq.length) {
          recallRounds++;
          const ev = publish({
            kind: "memory",
            label: "Авто-подсказка из памяти",
            detail: uniq.slice(0, 5).map(e => e.key).join(", "),
            agentId: opts.agentId,
            turn
          });
          history.push({
            role: "tool",
            name: "auto_recall",
            content:
              "AUTO_RECALL — релевантные записи памяти проекта, которых не было в контексте:\n" +
              uniq.slice(0, 5).map(e => `- [${e.kind ?? "note"}] ${e.key} (${e.file_path}): ${e.description}`).join("\n")
          });
          complete(ev.id, "ok");
          continue;
        }
      }
      /* ---- автономность: не бросаем задачу на полпути ---- */
      if (this.shouldContinue(lastText, toolCalls, turn, opts.maxTurns)) {
        this.nudges++;
        const ev = publish({
          kind: "thinking",
          label: "Автономный режим: продолжаю",
          detail: `задача не завершена, попытка ${this.nudges} из ${settings.autonomousNudges}`,
          agentId: opts.agentId,
          turn
        });
        history.push({
          role: "user",
          content:
            "ПРОДОЛЖАЙ. Ты остановился, но задача не доведена до конца: " +
            "либо план не выполнен, либо остались незакрытые пункты. " +
            "Действуй инструментами (прочитай, измени, запусти, проверь) и не останавливайся, " +
            "пока не будет выполнена вся задача. В конце дай краткий итог по выполненным пунктам."
        });
        complete(ev.id, "ok");
        continue;
      }
      break;
    }
    return { text: lastText, turns, toolCalls, touched };
  }

  /**
   * Решение «продолжать ли работу». Срабатывает, если агент закончил ход
   * финальным текстом, но задача выглядит незакрытой:
   *   • в плане есть шаги, а инструменты не использовались;
   *   • в тексте есть явные маркеры незавершённости.
   */
  private shouldContinue(text: string, toolCalls: number, turn: number, maxTurns: number): boolean {
    const settings = this.deps.getSettings();
    if (!settings.autonomous) return false;
    if (this.abort.signal.aborted) return false;
    if (turn >= maxTurns - 1) return false;
    if (this.nudges >= Math.max(0, settings.autonomousNudges)) return false;

    // Ни одного действия инструментами — агент только рассуждал.
    if (toolCalls === 0) return true;

    const t = text.toLowerCase();
    const markers = [
      "не смог",
      "не удалось",
      "не выполнено",
      "незаверш",
      "не законч",
      "осталось",
      "осталось сделать",
      "далее нужно",
      "далее следует",
      "продолжу",
      "продолжить",
      "требуется ещё",
      "нужно ещё",
      "todo",
      "часть работы"
    ];
    return markers.some(m => t.includes(m));
  }

  /* ---------------------------------------------------------------- *
   * Planning / decomposition
   * ---------------------------------------------------------------- */
  private async plan(task: string): Promise<string[]> {
    const ev = publish({ kind: "plan", label: "Архитектор строит план", agentId: "planner" });
    try {
      const memory = await api.memorySearch(this.deps.getRoot(), task, 6).catch(() => []);
      const r = await this.stream(
        [
          { role: "system", content: PLANNER_PROMPT },
          {
            role: "user",
            content: `ЗАДАЧА:\n${clip(task, 4000)}\n\nПАМЯТЬ ПРОЕКТА:\n${memory.map(m => `- ${m.key}: ${m.description}`).join("\n").slice(0, 4000)}\n\nПРОЕКТ: ${this.deps.getRoot()}`
          }
        ],
        0.1
      );
      const parsed = extractJson(r.raw) as SwarmPlan | null;
      const steps = parsed?.steps?.filter(s => typeof s === "string").slice(0, 8) ?? [];
      complete(ev.id, "ok");
      return steps.length ? steps : fallbackSteps(r.visible);
    } catch {
      complete(ev.id, "error");
      return [];
    }
  }

  private async decompose(task: string, plan: string[], size: number): Promise<string[]> {
    const ev = publish({ kind: "plan", label: `Декомпозиция на ${size} подзадач`, agentId: "lead" });
    try {
      const r = await this.stream(
        [
          { role: "system", content: DECOMPOSE_PROMPT },
          {
            role: "user",
            content: `ЗАДАЧА:\n${clip(task, 3000)}\n\nПЛАН:\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n").slice(0, 3000)}\n\nНужно ровно ${size} независимых подзадач.`
          }
        ],
        0.2
      );
      const parsed = extractJson(r.raw);
      let tasks: string[] = [];
      if (Array.isArray(parsed)) {
        tasks = parsed.filter(x => typeof x === "string").map(x => x.trim()).filter(Boolean);
      } else if (Array.isArray((parsed as any)?.tasks)) {
        tasks = ((parsed as any).tasks as any[]).filter(x => typeof x === "string");
      }
      complete(ev.id, "ok");
      if (tasks.length) return tasks.slice(0, size);
      return plan.length
        ? plan.slice(0, size)
        : Array.from({ length: size }, (_, i) => `Часть ${i + 1}: ${clip(task, 120)}`);
    } catch {
      complete(ev.id, "error");
      return plan.slice(0, size);
    }
  }

  /* ---------------------------------------------------------------- *
   * Public entry point
   * ---------------------------------------------------------------- */
  async run(task: string, history: Msg[]): Promise<RunResult> {
    const settings = this.deps.getSettings();
    const root = this.deps.getRoot();
    if (!root) throw new Error("Сначала откройте проект");

    this.usage = emptyUsage();
    const plan = settings.planFirst || settings.mode === "swarm" ? await this.plan(task) : [];

    if (settings.mode === "swarm") {
      return this.runSwarm(task, plan);
    }
    return this.runSolo(task, plan, history);
  }

  private async runSolo(task: string, plan: string[], history: Msg[]): Promise<RunResult> {
    const settings = this.deps.getSettings();
    const profile = settings.autoRoute ? getAgent(settings.activeAgent) : getAgent("lead");
    const root = this.deps.getRoot();
    const preset = EFFORT_PRESETS[profile.effort];

    const memory = settings.autoRecall
      ? await api.memorySearch(root, task, preset.recallTopK).catch(() => [])
      : [];

    const system = buildSystemPrompt({
      settings,
      profile,
      root,
      openFile: this.deps.getOpenFile(),
      memory,
      extra: plan.length
        ? `ПЛАН (согласован архитектором, следуй ему по шагам, но адаптируй если reality разойдётся):\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
        : undefined
    });

    const loopHistory: Msg[] = [...history, { role: "user", content: task }];
    const res = await this.runLoop(loopHistory, system, profile, {
      agentId: "main",
      maxTurns: preset.maxTurns,
      streamToChat: true
    });

    let text = res.text;
    text = await this.verify(task, text, settings);
    return {
      text,
      turns: res.turns,
      toolCalls: res.toolCalls,
      usage: this.usage,
      plan,
      workers: []
    };
  }

  private async runSwarm(task: string, plan: string[]): Promise<RunResult> {
    const settings = this.deps.getSettings();
    const root = this.deps.getRoot();
    const size = Math.min(6, Math.max(2, settings.swarmSize));
    const subtasks = await this.decompose(task, plan, size);

    const profiles = assignProfiles(subtasks);

    let workers: SwarmWorker[] = subtasks.map((subtask, i) => ({
      id: `w${i + 1}`,
      index: i,
      profile: profiles[i],
      subtask,
      status: "pending" as WorkerStatus,
      turns: 0,
      toolCalls: 0,
      touched: []
    }));

    const push = (next: SwarmWorker[]) => {
      workers = next;
      this.deps.onWorkers(workers);
    };
    push(workers);

    const runOne = async (w: SwarmWorker) => {
      const profile = w.profile;
      const preset = EFFORT_PRESETS[profile.effort];
      const memory = await api.memorySearch(root, `${task} ${w.subtask}`, 5).catch(() => []);
      const system = buildSystemPrompt({
        settings,
        profile,
        root,
        openFile: null,
        memory,
        extra: [
          `ОБЩАЯ ЗАДАЧА: ${clip(task, 2000)}`,
          plan.length ? `ПЛАН РОЯ:\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
          `ТВОЯ ПОДЗАДАЧА (выполни её полностью, инструментами, и только её):\n${w.subtask}`,
          "Другие воркеры работают параллельно. Не трогай файлы за пределами своей подзадачи."
        ]
          .filter(Boolean)
          .join("\n\n")
      });

      const h: Msg[] = [{ role: "user", content: w.subtask }];
      const res = await this.runLoop(h, system, profile, {
        agentId: w.id,
        maxTurns: Math.max(8, Math.floor(preset.maxTurns * 0.7)),
        onWorkerTick: patch =>
          push(workers.map(x => (x.id === w.id ? { ...x, status: "running", ...patch } : x)))
      });
      return res;
    };

    const results = new Map<string, { text: string; turns: number; toolCalls: number; touched: string[] }>();

    const finish = (w: SwarmWorker, status: WorkerStatus, patch: Partial<SwarmWorker>) =>
      push(workers.map(x => (x.id === w.id ? { ...x, status, finishedAt: Date.now(), ...patch } : x)));

    if (settings.parallelSwarm) {
      await Promise.all(
        workers.map(async w => {
          push(workers.map(x => (x.id === w.id ? { ...x, status: "running", startedAt: Date.now() } : x)));
          const ev = publish({
            kind: "swarm_spawn",
            label: `${w.profile.name} #${w.index + 1}`,
            detail: w.subtask,
            agentId: w.id
          });
          try {
            const res = await runOne(w);
            results.set(w.id, res);
            complete(ev.id, "ok");
            finish(w, "ok", {
              output: res.text,
              turns: res.turns,
              toolCalls: res.toolCalls,
              touched: Array.from(new Set(res.touched))
            });
          } catch (e) {
            if (this.abort.signal.aborted) {
              finish(w, "error", { error: "Отменено" });
              return;
            }
            complete(ev.id, "error");
            finish(w, "error", { error: String(e) });
          }
        })
      );
    } else {
      for (const w of workers) {
        if (this.abort.signal.aborted) break;
        push(workers.map(x => (x.id === w.id ? { ...x, status: "running", startedAt: Date.now() } : x)));
        const ev = publish({
          kind: "swarm_spawn",
          label: `${w.profile.name} #${w.index + 1}`,
          detail: w.subtask,
          agentId: w.id
        });
        try {
          const res = await runOne(w);
          results.set(w.id, res);
          complete(ev.id, "ok");
          finish(w, "ok", {
            output: res.text,
            turns: res.turns,
            toolCalls: res.toolCalls,
            touched: Array.from(new Set(res.touched))
          });
        } catch (e) {
          complete(ev.id, "error");
          finish(w, "error", { error: String(e) });
        }
      }
    }

    /* ---- synthesis ---- */
    const ev = publish({ kind: "swarm_merge", label: "Сведение отчётов роя", agentId: "main" });
    const digest = workers
      .map(w => {
        const r = results.get(w.id);
        return `### ВОРКЕР ${w.index + 1} · ${w.profile.name} — ${w.status === "ok" ? "выполнил" : w.status === "error" ? "ОШИБКА" : "не начал"}\nЗАДАЧА: ${w.subtask}\nФАЙЛЫ: ${w.touched.join(", ") || "—"}\nОТЧЁТ:\n${(r?.text ?? w.error ?? "нет отчёта").slice(0, 3500)}`;
      })
      .join("\n\n");

    let text = "";
    try {
      const r = await this.stream(
        [
          { role: "system", content: SYNTHESIZE_PROMPT },
          { role: "user", content: `ЗАДАЧА:\n${clip(task, 3000)}\n\nОТЧЁТЫ ВОРКЕРОВ:\n${digest.slice(0, 60_000)}` }
        ],
        0.15,
        this.deps.onTextDelta
      );
      text = r.raw;
    } catch {
      text = workers.map(w => `— ${w.profile.name}: ${w.output ?? w.error ?? "нет отчёта"}`).join("\n");
    }
    complete(ev.id, "ok");

    /* ---- conflicts between workers ---- */
    const claimed = new Map<string, string[]>();
    for (const w of workers) for (const f of w.touched) claimed.set(f, [...(claimed.get(f) ?? []), w.id]);
    const conflicts = [...claimed.entries()].filter(([, ids]) => ids.length > 1);
    if (conflicts.length && !this.abort.signal.aborted) {
      const ev2 = publish({
        kind: "error",
        label: "Конфликт параллельных правок",
        detail: conflicts.map(([f, ids]) => `${f}: ${ids.join(", ")}`).join("; "),
        agentId: "main"
      });
      complete(ev2.id, "error");
      text += `\n\n⚠️ Внимание: несколько воркеров изменяли одни и те же файлы (${conflicts
        .map(([f]) => f)
        .join(", ")}). Проверь результат перед использованием.`;
    }

    text = await this.verify(task, text, this.deps.getSettings());

    return {
      text: stripCalls(text),
      turns: workers.reduce((a, w) => a + w.turns, 0),
      toolCalls: workers.reduce((a, w) => a + w.toolCalls, 0),
      usage: this.usage,
      plan,
      workers
    };
  }

  /* ---------------------------------------------------------------- *
   * Verification
   * ---------------------------------------------------------------- */
  private async verify(task: string, text: string, settings: Settings): Promise<string> {
    const preset = EFFORT_PRESETS[settings.effort];
    if (!settings.verifyResult || preset.verifyPasses < 1 || !text.trim()) return text;
    if (this.abort.signal.aborted) return text;

    for (let pass = 0; pass < preset.verifyPasses; pass++) {
      const ev = publish({ kind: "verify", label: "Проверка результата", agentId: "verifier" });
      let passed = true;
      try {
        const r = await this.stream(
          [
            { role: "system", content: VERIFY_PROMPT },
            { role: "user", content: `ЗАДАЧА:\n${clip(task, 1500)}\n\nОТЧЁТ АГЕНТА:\n${clip(text, 4000)}` }
          ],
          0.05
        );
        passed = !/FAIL/i.test(r.raw);
      } catch {
        passed = true;
      }
      complete(ev.id, passed ? "ok" : "error");
      if (passed) break;
      if (this.abort.signal.aborted) break;

      // Self-repair pass.
      const fixer = getAgent("implementer");
      const repairEv = publish({ kind: "verify", label: "Исправление замечаний", agentId: "fixer" });
      try {
        const system = buildSystemPrompt({
          settings,
          profile: fixer,
          root: this.deps.getRoot(),
          openFile: this.deps.getOpenFile(),
          memory: []
        });
        const res = await this.runLoop(
          [
            {
              role: "user",
              content: `Проверка нашла, что предыдущий результат не решает задачу.\n\nЗАДАЧА:\n${clip(task, 2000)}\n\nПРЕДЫДУЩИЙ ОТЧЁТ:\n${clip(text, 3000)}\n\nДоделай работу реальными инструментами, затем кратко опиши итог.`
            }
          ],
          system,
          fixer,
          { agentId: "fixer", maxTurns: 16, streamToChat: true }
        );
        complete(repairEv.id, "ok");
        if (res.text) text = res.text;
      } catch {
        complete(repairEv.id, "error");
      }
    }
    return text;
  }

  /** Compacts a long transcript so context does not silently blow up. */
  async compact(history: Msg[]): Promise<Msg[]> {
    if (history.length <= MAX_HISTORY) return history;
    const ev = publish({ kind: "thinking", label: "Сжатие контекста", agentId: "main" });
    try {
      const r = await this.stream(
        [
          { role: "system", content: COMPACT_PROMPT },
          { role: "user", content: history.map(m => `${m.role}: ${m.content}`).join("\n\n").slice(0, 40_000) }
        ],
        0.2
      );
      complete(ev.id, "ok");
      return [
        history[0],
        { role: "user", content: `СЖАТЫЙ КОНТЕКСТ РАНЕЕШЕГО ДИАЛОГА:\n${r.raw}` },
        ...history.slice(-6)
      ];
    } catch {
      complete(ev.id, "error");
      return [history[0], ...history.slice(-MAX_HISTORY)];
    }
  }
}

/* -------------------------------------------------------------------- */

function previewArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    let s = typeof v === "string" ? v : JSON.stringify(v);
    if (s === undefined) continue;
    s = s.replace(/\s+/g, " ").trim();
    parts.push(`${k}=${s.length > 120 ? s.slice(0, 120) + "…" : s}`);
    if (parts.length >= 4) break;
  }
  return parts.join("  ");
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "не", "и", "в", "на", "с",
  "что", "как", "для", "это", "the", "src", "app", "file", "файл", "код", "code", "http",
  "https", "com", "www", "null", "true", "false", "const", "let", "var", "function", "class",
  "return", "import", "export", "interface", "type", "async", "await"
]);

/** Candidate identifiers worth a memory lookup. */
export function keyTerms(text: string): string[] {
  const out: string[] = [];
  const re = /\b[A-Za-z_$][A-Za-z0-9_$-]{3,}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const w = m[0];
    if (STOP_WORDS.has(w.toLowerCase())) continue;
    if (/^\d+$/.test(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 24) break;
  }
  return out;
}

function fallbackSteps(text: string): string[] {
  return text
    .split("\n")
    .map(l => l.replace(/^\s*(?:\d+[).:-]|[-*•])\s*/, "").trim())
    .filter(l => l.length > 6 && l.length < 200)
    .slice(0, 7);
}
