/**
 * IPC contract with the Tauri app (plan 2.2 and appendix E.4). Frozen: the
 * Rust mirror is src-tauri/crates/rb-analytics/src/ipc.rs, and both sides
 * are checked against ipc-fixtures.json.
 *
 * Tauri turns the camelCase argument names below into the snake_case
 * parameters of the Rust commands: invoke(ANALYTICS_COMMANDS.cancelQuery,
 * { requestId }) reaches `analytics_cancel_query(request_id)`.
 *
 * | Command                  | Arguments                     | Resolves with      |
 * |--------------------------|-------------------------------|--------------------|
 * | analytics_run_query      | { request: RunQueryRequest, database } | QueryResult |
 * | analytics_cancel_query   | { requestId: string }         | void               |
 * | analytics_list_objects   | { database }                  | EngineObjects      |
 * | analytics_ai_key_status  | { provider }                  | KeyStatus          |
 * | analytics_ai_set_key     | { provider, key, baseUrl? }   | KeyStatus          |
 * | analytics_ai_delete_key  | { provider }                  | KeyStatus          |
 * | analytics_ai_test_key    | { provider, model: string }   | AiKeyTest          |
 * | analytics_ai_ask         | { request: AiAskRequest }     | AiAskResponse      |
 * | analytics_mcp_info       | —                             | McpInfo            |
 * | analytics_mcp_last_call  | —                             | McpLastCall | null |
 * | analytics_machine_info   | —                             | MachineInfo        |
 * | analytics_inbox_list     | —                             | InboxProposal[]    |
 * | analytics_inbox_remove   | { id: string }                | void               |
 *
 * `database` is the file the app opened, "main.db" or "demo.db" (demo mode,
 * ADR 0009): Rust reads that file, and rejects any other name with
 * `invalid_param`. Left out, it means "main.db".
 *
 * `provider` (AiProvider) may be left out of the analytics_ai_* commands:
 * Rust then means "anthropic", as before providers existed (ADR 0008).
 *
 * Every command rejects with an error envelope `{ code, message, … }`:
 * AnalyticsErrorPayload for the engine commands, AiErrorPayload for the
 * analytics_ai_* commands (told apart by the command that failed).
 */

export const ANALYTICS_COMMANDS = {
  runQuery: "analytics_run_query",
  cancelQuery: "analytics_cancel_query",
  listObjects: "analytics_list_objects",
  aiKeyStatus: "analytics_ai_key_status",
  aiSetKey: "analytics_ai_set_key",
  aiDeleteKey: "analytics_ai_delete_key",
  aiTestKey: "analytics_ai_test_key",
  aiAsk: "analytics_ai_ask",
  mcpInfo: "analytics_mcp_info",
  mcpLastCall: "analytics_mcp_last_call",
  machineInfo: "analytics_machine_info",
  inboxList: "analytics_inbox_list",
  inboxRemove: "analytics_inbox_remove",
} as const;

/**
 * Who answers the assistant (ADR 0008, "AI providers"): Anthropic and
 * OpenAI at their fixed addresses, or a server of the club's choice that
 * speaks OpenAI's Chat Completions (Mistral, OpenRouter, Ollama…).
 */
export const AI_PROVIDERS = [
  "anthropic",
  "openai",
  "openai_compatible",
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const DEFAULT_AI_PROVIDER: AiProvider = "anthropic";

/** Anthropic's allowlist (Rust `ai::models`). */
export const AI_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;
/** An Anthropic model. */
export type AiModel = (typeof AI_MODELS)[number];
export const DEFAULT_AI_MODEL: AiModel = "claude-opus-5-5";

/** OpenAI's allowlist (Rust `ai::models::OPENAI_MODELS`), most capable first. */
export const OPENAI_MODELS = [
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-luna",
] as const;
export type OpenAiModel = (typeof OPENAI_MODELS)[number];
export const DEFAULT_OPENAI_MODEL: OpenAiModel = "gpt-6.1-sol";
export type AiEffort = "low" | "medium" | "high";

export type AiErrorCode =
  | "no_key"
  | "invalid_key"
  | "forbidden"
  | "rate_limited"
  | "overloaded"
  | "bad_request"
  | "network"
  | "timeout"
  | "refusal"
  | "truncated"
  | "too_large"
  | "model_not_allowed"
  | "model_not_found";
export const AI_ERROR_CODES = [
  "no_key",
  "invalid_key",
  "forbidden",
  "rate_limited",
  "overloaded",
  "bad_request",
  "network",
  "timeout",
  "refusal",
  "truncated",
  "too_large",
  "model_not_allowed",
  "model_not_found",
] as const satisfies readonly AiErrorCode[];
export interface AiErrorPayload {
  code: AiErrorCode;
  message: string;
  retryAfterSeconds?: number | null;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}
export interface AiSystemBlock {
  text: string;
  cache: boolean;
}
export interface AiAskRequest {
  /** uuid v4, for logs only */
  requestId: string;
  provider: AiProvider;
  /** AiModel, OpenAiModel, or the compatible server's model name. */
  model: string;
  /** "medium" */
  effort: AiEffort;
  system: AiSystemBlock[];
  /** Starts and ends with "user", alternating. */
  messages: AiMessage[];
  /** AI_RESPONSE_JSON_SCHEMA */
  outputSchema: Record<string, unknown>;
  /** 16000 (`AI_MAX_TOKENS`); Rust rejects > 16000 */
  maxTokens: number;
}
/**
 * Tokens of one answer, Anthropic's way for every provider: `inputTokens`
 * is the uncached input (Rust takes the cached part out of OpenAI's count).
 */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}
export interface AiAskResponse {
  text: string;
  stopReason: string;
  model: string;
  usage: AiUsage;
}

export type KeyStorage = "keychain" | "file";
export interface KeyStatus {
  stored: boolean;
  storage: KeyStorage | null;
  /** openai_compatible: the server address saved with the key. */
  baseUrl?: string;
  /** openai_compatible: a key goes with the address (local servers need none). */
  hasKey?: boolean;
  /** The last 4 characters of the stored key ("AbCd"), never more. */
  hint?: string;
}
export interface AiKeyTest {
  ok: boolean;
  code?: AiErrorCode | null;
}

export type McpPlatform = "windows" | "macos" | "linux";
export interface McpInfo {
  /** $APPIMAGE when set, else current_exe() */
  exePath: string;
  /** ["--mcp"] */
  args: string[];
  dbPath: string;
  inboxDir: string;
  /** null on Linux */
  claudeDesktopConfigPath: string | null;
  platform: McpPlatform;
  isAppImage: boolean;
}

/** The last tools/call the MCP server received on this computer. */
export interface McpLastCall {
  /** MCP clientInfo.name, e.g. "claude-ai". */
  client: string | null;
  /** Local time "YYYY-MM-DDTHH:mm". */
  at: string;
}

export interface InboxProposal {
  /** File name without .json (uuid). */
  id: string;
  createdAt: string | null;
  /** MCP clientInfo.name, e.g. "claude-ai". */
  client: string | null;
  title: string | null;
  description: string | null;
  sql: string | null;
  /** Validated with ParamDef[] by WP6. */
  params: unknown;
  /** Validated with ChartSpec by WP6. */
  chart: unknown;
  /** Non-null: unreadable file, shown as such. */
  error: string | null;
}
