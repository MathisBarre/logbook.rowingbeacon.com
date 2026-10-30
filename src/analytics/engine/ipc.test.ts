import { describe, expect, it } from "vitest";
import { z } from "zod";
import fixtures from "./ipc-fixtures.json";
import {
  AI_ERROR_CODES,
  AI_PROVIDERS,
  AiAskRequest,
  AiAskResponse,
  AiErrorPayload,
  AiKeyTest,
  ANALYTICS_COMMANDS,
  InboxProposal,
  KeyStatus,
  McpInfo,
} from "./ipc";
import {
  ANALYTICS_ERROR_CODES,
  AnalyticsErrorPayload,
  EngineObjects,
  QueryResult,
  RunQueryRequest,
} from "../types";

/*
 * Zod mirrors of the IPC types. Each is typed `z.ZodType<T>`, so tsc fails
 * when a mirror drifts from ipc.ts / types.ts; the fixtures are then
 * parsed with them (`.strict()`: no unknown field). The Rust test
 * `ipc::tests` deserialises and re-serialises the same file.
 */

const ParamValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const SqlValue = z.union([z.string(), z.number(), z.null()]);

const RunQueryRequestZ: z.ZodType<RunQueryRequest> = z
  .object({
    requestId: z.string().uuid(),
    sql: z.string(),
    params: z.record(ParamValue),
    maxRows: z.number().int(),
    timeoutMs: z.number().int(),
    privacy: z.enum(["nominative", "pseudonymised"]),
    now: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    useCache: z.boolean(),
  })
  .strict();

const QueryResultZ: z.ZodType<QueryResult> = z
  .object({
    columns: z.array(
      z.object({ name: z.string(), declType: z.string().nullable() }).strict()
    ),
    rows: z.array(z.array(SqlValue)),
    truncated: z.boolean(),
    elapsedMs: z.number(),
    ignoredColumns: z.array(z.string()),
    cached: z.boolean(),
  })
  .strict();

const EngineObjectsZ: z.ZodType<EngineObjects> = z
  .object({
    views: z.array(z.string()),
    tables: z.array(z.string()),
    missingViews: z.array(z.string()),
  })
  .strict();

const AnalyticsErrorPayloadZ: z.ZodType<AnalyticsErrorPayload> = z
  .object({
    code: z.enum(ANALYTICS_ERROR_CODES),
    message: z.string(),
    offset: z.number().int().nullable().optional(),
    object: z.string().nullable().optional(),
  })
  .strict();

const AiErrorCodeZ = z.enum(AI_ERROR_CODES);

const AiErrorPayloadZ: z.ZodType<AiErrorPayload> = z
  .object({
    code: AiErrorCodeZ,
    message: z.string(),
    retryAfterSeconds: z.number().nullable().optional(),
  })
  .strict();

const AiAskRequestZ: z.ZodType<AiAskRequest> = z
  .object({
    requestId: z.string().uuid(),
    provider: z.enum(AI_PROVIDERS),
    model: z.string().min(1),
    effort: z.enum(["low", "medium", "high"]),
    system: z.array(
      z.object({ text: z.string(), cache: z.boolean() }).strict()
    ),
    messages: z.array(
      z
        .object({ role: z.enum(["user", "assistant"]), content: z.string() })
        .strict()
    ),
    outputSchema: z.record(z.unknown()),
    maxTokens: z.number().int(),
  })
  .strict();

const AiAskResponseZ: z.ZodType<AiAskResponse> = z
  .object({
    text: z.string(),
    stopReason: z.string(),
    model: z.string(),
    usage: z
      .object({
        inputTokens: z.number().int(),
        outputTokens: z.number().int(),
        cacheReadInputTokens: z.number().int(),
        cacheCreationInputTokens: z.number().int(),
      })
      .strict(),
  })
  .strict();

const KeyStatusZ: z.ZodType<KeyStatus> = z
  .object({
    stored: z.boolean(),
    storage: z.enum(["keychain", "file"]).nullable(),
    baseUrl: z.string().url().optional(),
    hasKey: z.boolean().optional(),
    hint: z.string().max(4).optional(),
  })
  .strict();

const AiKeyTestZ: z.ZodType<AiKeyTest> = z
  .object({ ok: z.boolean(), code: AiErrorCodeZ.nullable().optional() })
  .strict();

const McpInfoZ: z.ZodType<McpInfo> = z
  .object({
    exePath: z.string(),
    args: z.array(z.string()),
    dbPath: z.string(),
    inboxDir: z.string(),
    claudeDesktopConfigPath: z.string().nullable(),
    platform: z.enum(["windows", "macos", "linux"]),
    isAppImage: z.boolean(),
  })
  .strict();

/** Any JSON value; required (z.unknown() would make the key optional). */
const JsonValueZ = z.union([
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.unknown()),
  z.record(z.unknown()),
]);

const InboxProposalZ: z.ZodType<InboxProposal> = z
  .object({
    id: z.string().uuid(),
    createdAt: z.string().nullable(),
    client: z.string().nullable(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    sql: z.string().nullable(),
    params: JsonValueZ,
    chart: JsonValueZ,
    error: z.string().nullable(),
  })
  .strict();

const MIRRORS: Record<keyof typeof fixtures, z.ZodTypeAny> = {
  RunQueryRequest: RunQueryRequestZ,
  QueryResult: QueryResultZ,
  EngineObjects: EngineObjectsZ,
  AnalyticsErrorPayload: AnalyticsErrorPayloadZ,
  AiErrorPayload: AiErrorPayloadZ,
  AiAskRequest: AiAskRequestZ,
  AiAskResponse: AiAskResponseZ,
  KeyStatus: KeyStatusZ,
  AiKeyTest: AiKeyTestZ,
  McpInfo: McpInfoZ,
  InboxProposal: InboxProposalZ,
};

describe("ipc-fixtures.json", () => {
  it.each(Object.entries(fixtures))(
    "every %s example matches the TypeScript type",
    (name, examples) => {
      const mirror = MIRRORS[name as keyof typeof fixtures];
      expect(examples.length).toBeGreaterThan(0);
      for (const example of examples) {
        expect(mirror.safeParse(example).error).toBeUndefined();
      }
    }
  );

  it("has one error example per engine error code", () => {
    expect(
      fixtures.AnalyticsErrorPayload.map((error) => error.code).sort()
    ).toEqual([...ANALYTICS_ERROR_CODES].sort());
  });

  it("names the 12 commands of plan 2.2 (and the machine info, MCP last call)", () => {
    expect(Object.values(ANALYTICS_COMMANDS)).toHaveLength(13);
    for (const command of Object.values(ANALYTICS_COMMANDS)) {
      expect(command).toMatch(/^analytics_[a-z_]+$/);
    }
  });
});
