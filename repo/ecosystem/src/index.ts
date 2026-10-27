/**
 * Public API пакета @infinity/core.
 */

export { createCore, type Core, type CoreConfig } from './core.js';
export { Db, type Row } from './db/db.js';
export { migrate, SCHEMA_VERSION } from './db/migrate.js';
export { newId, isInfinityId, parseId, compareIds, type InfinityId, type IdType } from './ids.js';
export {
  AppError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError,
  ConflictError, PathTraversalError, LocalModeBlockedError, UpstreamError, RateLimitError,
} from './errors.js';
export { AuthService, type User } from './services/auth.js';
export { DataService, type StoredObject } from './services/data.js';
export { SearchService, type SearchHit, type SearchScope } from './services/search.js';
export { AiRuntime, type ProviderRecord, type ModelRecord, type Scope } from './services/ai-runtime.js';
export { MemoryService, type MemoryRecord, type MemorySource } from './services/memory.js';
export { ToolRuntime, type ToolDefinition, type ToolScope } from './services/tool-runtime.js';
export { SecretStore } from './services/crypto.js';
export { Router, createRouterServer, bearerToken, type RequestContext } from './http/router.js';
export { registerBuiltinTools } from './tools/builtin.js';
export { OpenAICompatibleProvider } from './services/ai/providers/openai-compatible.js';
export { LlamaCppProvider } from './services/ai/providers/llama-cpp.js';
export type { ChatProvider, ChatRequest, ChatChunk } from './services/ai/provider.js';

// InfinityCoder — AI IDE (приложение №12 экосистемы).
export {
  CoderService, CoderAgent, registerCoderRoutes, registerCoderTools,
  CODER_TOOL_NAMES, parseToolCall, buildSystemPrompt,
  type CoderProject, type CoderSettings, type CoderSession, type CoderMessage,
  type CoderRun, type CoderStep, type CoderTab, type CoderAgentEvent,
} from './coder/index.js';
