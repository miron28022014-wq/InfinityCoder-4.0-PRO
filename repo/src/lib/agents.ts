/**
 * Agent profiles.
 *
 * Every agent is a (directive, tool-allowlist, effort) triple. The swarm
 * orchestrator picks a profile per subtask; in single-agent mode the lead can
 * still hand work to a specialist.
 */
import type { AgentProfile, AgentRole, ToolName } from "../types";

const READ_ONLY: ToolName[] = [
  "read_file", "list_dir", "search_files", "file_stat",
  "memory_search", "memory_list", "memory_write", "web_fetch", "web_search",
  "git_status", "git_diff", "git_log",
  // Infinity Ecosystem: поиск по другим приложениям и общая память.
  "ecosystem_search", "ecosystem_remember", "ecosystem_object"
];

const EDITOR: ToolName[] = [
  ...READ_ONLY,
  "write_file", "edit_file", "create_dir", "move_file", "run_command", "memory_forget"
];

export const AGENTS: AgentProfile[] = [
  {
    id: "lead",
    name: "Оркестратор",
    role: "lead",
    icon: "swarm",
    tint: "108 133 255",
    temperature: 0.15,
    maxTurns: 28,
    effort: "high",
    allow: [],
    directive: [
      "Ты — ведущий агент InfinityCoder. Ты сам выполняешь задачу и только при необходимости делегируешь части работы специалистам.",
      "Работай циклом: изучи контекст → вызови инструмент → прочитай результат → реши, что делать дальше.",
      "Одна задача — один законченный результат. Не оставляй работу на середине и не пересказывай план вместо того, чтобы сделать.",
      "Перед началом поищи в памяти проекта (memory_search), чтобы не изобретать уже известное.",
      "Отвечай по-русски, если пользователь пишет по-русски. Код, идентификаторы и комментарии в коде — на языке проекта."
    ].join("\n")
  },
  {
    id: "planner",
    name: "Архитектор",
    role: "planner",
    icon: "layers",
    tint: "178 122 255",
    temperature: 0.1,
    maxTurns: 14,
    effort: "medium",
    allow: READ_ONLY,
    directive: [
      "Ты — архитектор. Ты НИЧЕГО не изменяешь: только читаешь код и память проекта.",
      "Твоя задача — разложить запрос на конкретный план: какие файлы создать, какие изменить, какие команды запустить.",
      "Отвечай строго JSON: {\"goal\":\"...\",\"steps\":[\"...\"],\"files\":[\"src/...\"]}. Без пояснений вне JSON.",
      "Каждый шаг — одно проверяемое действие над конкретным файлом или командой."
    ].join("\n")
  },
  {
    id: "implementer",
    name: "Разработчик",
    role: "implementer",
    icon: "edit",
    tint: "61 214 140",
    temperature: 0.12,
    maxTurns: 34,
    effort: "high",
    allow: EDITOR,
    directive: [
      "Ты — разработчик. Ты пишешь и правишь код.",
      "Перед правкой прочитай целевой файл (read_file) — не редактируй по памяти.",
      "Предпочитай edit_file с точечной заменой, а не полную перезапись файла через write_file.",
      "Создавай только те файлы, которые нужны для задачи. Не добавляй «на будущее».",
      "После каждой правки проверь результат: read_file или run_command (npm test / cargo check / tsc).",
      "Критично: если тест или сборка падает — чини, а не пересказывай ошибку."
    ].join("\n")
  },
  {
    id: "reviewer",
    name: "Ревьюер",
    role: "reviewer",
    icon: "shieldCheck",
    tint: "245 165 36",
    temperature: 0.05,
    maxTurns: 18,
    effort: "high",
    allow: READ_ONLY,
    directive: [
      "Ты — ревьюер. Ты ничего не изменяешь, только находишь проблемы.",
      "Ищи: баги, несовпадение с требованием, отсутствующие обработки ошибок, дублирование, неиспользуемый код.",
      "Для каждой находки укажи: файл, строка (если знаешь), что не так и почему это важно.",
      "Не выдумывай проблемы. Если код корректен — так и скажи прямо."
    ].join("\n")
  },
  {
    id: "tester",
    name: "Тестировщик",
    role: "tester",
    icon: "flask",
    tint: "88 199 235",
    temperature: 0.05,
    maxTurns: 20,
    effort: "medium",
    allow: [...READ_ONLY, "write_file", "run_command"],
    directive: [
      "Ты — тестировщик. Твоя главная сила — терминал (run_command).",
      "Сначала выясни, чем проект проверяется: посмотри package.json / Cargo.toml / pyproject.toml.",
      "Запусти сборку и тесты. Приведи точные команды и их вывод.",
      "Если падает сборка — найди первую реальную ошибку в выводе и опиши её.",
      "Не пиши тесты без запроса; сначала проверь, что уже есть."
    ].join("\n")
  },
  {
    id: "researcher",
    name: "Исследователь",
    role: "researcher",
    icon: "bookOpen",
    tint: "255 138 172",
    temperature: 0.2,
    maxTurns: 16,
    effort: "medium",
    allow: READ_ONLY,
    directive: [
      "Ты — исследователь. Ты собираешь факты, ничего не меняя.",
      "Сначала memory_search по памяти проекта, потом поиск по коду (search_files), потом веб (web_search / web_fetch).",
      "Каждый факт снабжай ссылкой: файл:строка или URL.",
      "Отделяй то, что ты проверил, от того, что предполагаешь."
    ].join("\n")
  }
];

export const AGENT_BY_ID = new Map(AGENTS.map(a => [a.id, a]));

export function getAgent(id: string): AgentProfile {
  return AGENT_BY_ID.get(id) ?? AGENTS[0];
}

export function roleLabel(role: AgentRole): string {
  switch (role) {
    case "lead": return "Ведущий";
    case "planner": return "Архитектор";
    case "implementer": return "Разработчик";
    case "reviewer": return "Ревьюер";
    case "tester": return "Тестировщик";
    case "researcher": return "Исследователь";
  }
}

/** Pick sensible profiles for N decomposed subtasks. */
export function assignProfiles(tasks: string[]): AgentProfile[] {
  return tasks.map(text => {
    const t = text.toLowerCase();
    if (/(тест|\btest\b|testы|провер|сборк|\bbuild\b|lint|\bci\b)/.test(t)) return getAgent("tester");
    if (/(ревью|\breview\b|аудит|безопас|quality|риск|оцен)/.test(t)) return getAgent("reviewer");
    if (/(исслед|\bresearch\b|найди|документ|изучи|документац|интегрируй.*api)/.test(t)) return getAgent("researcher");
    return getAgent("implementer");
  });
}
