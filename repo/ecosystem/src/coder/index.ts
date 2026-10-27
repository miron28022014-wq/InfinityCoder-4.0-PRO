/**
 * InfinityCoder — модуль AI IDE в составе общего ядра.
 */

export { CoderService, DEFAULT_SETTINGS, type CoderProject, type CoderSettings, type CoderSession, type CoderMessage, type CoderRun, type CoderStep, type CoderTab } from './service.js';
export { CoderAgent, parseToolCall, buildSystemPrompt, type CoderAgentEvent, type AgentEventSink } from './agent.js';
export { registerCoderRoutes } from './routes.js';
export { registerCoderTools, CODER_TOOL_NAMES, isCommandAllowed } from './tools.js';
export { withRunContext, currentRunContext, type RunContext } from './context.js';
export {
  safeJoin,
  assertInsideRoot,
  listTree,
  readProjectFile,
  writeProjectFile,
  searchProjectFiles,
  diffText,
  formatUnifiedDiff,
  runCommand,
  tokenizeCommand,
  isForbiddenCommand,
  DEFAULT_IGNORE,
  type DiffLine,
  type DiffResult,
  type SearchMatch,
  type TreeEntry,
  type CommandResult,
} from './workspace.js';
