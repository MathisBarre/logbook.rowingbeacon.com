import { autoChart } from "../charts/autoChart";
import { chartFitsResult } from "../charts/chartFits";
import type { ChartSpec } from "../chartSpec";
import { AnalyticsError, offsetToLineColumn } from "../engine/errors";
import type { AiAskResponse, AiMessage } from "../engine/ipc";
import type { AnalyticsErrorCode, ParamDef, QueryResult } from "../types";
import { AiError } from "./aiClient";
import type { AiResponse } from "./aiSchema";
import { AiAnswer, parseAiText, toDraft } from "./aiResponse";
import { parseLooseJsonAnswer } from "./copyPrompt";

/**
 * One question to the AI, until the app holds a query that runs (plan
 * 2.11 steps 4-6). The SQL of every answer goes through the read-only
 * engine; when it fails with an error the model can fix, the loop sends
 * the engine's error message back (error text only, quoted values
 * redacted: never data), at most
 * `maxRepairs` times. Nothing is saved here.
 */

/** Engine errors a corrected query can fix. */
export const REPAIRABLE_CODES: ReadonlySet<AnalyticsErrorCode> = new Set([
  "syntax",
  "denied",
  "not_read_only",
  "multiple_statements",
  "missing_param",
  "invalid_param",
]);

const MAX_REPAIRS = 2;

interface AiLoopDeps {
  /** Sends the conversation; rejects with an AiError. */
  ask: (messages: AiMessage[]) => Promise<AiAskResponse>;
  /** Runs the SQL with its parameters' default values. */
  run: (sql: string, params: ParamDef[]) => Promise<QueryResult>;
  /** Called when the loop moves to the next step (for the status line). */
  onPhase?: (phase: AiPhase) => void;
  /**
   * The server may ignore the schema (an OpenAI-compatible server in JSON
   * mode): an answer that fails the strict check is read leniently, like
   * a paste, before it counts as unreadable.
   */
  lenient?: boolean;
}

export type AiPhase = "asking" | "running" | "repairing";

interface AiUsageEntry {
  usage: AiAskResponse["usage"];
  model: string;
}

interface OutcomeBase {
  /** The conversation so far, ending with the model's last answer. */
  messages: AiMessage[];
  usages: AiUsageEntry[];
}

export type AiOutcome =
  | (OutcomeBase & {
      kind: "answer";
      answer: AiAnswer & { sql: string };
      /** The chart to show: the model's, or one guessed from the result. */
      chart: ChartSpec;
      result: QueryResult;
      /** True when a repair turn was needed. */
      repaired: boolean;
      model: string;
    })
  | (OutcomeBase & {
      kind: "clarification";
      answer: AiAnswer;
      question: string;
    })
  | (OutcomeBase & {
      kind: "error";
      error: AiError | AnalyticsError;
      /** The last engine error when the repairs ran out. */
      repairFailed: boolean;
      /**
       * The model's last answer when its query failed in the engine, so
       * the user can open it in the editor and fix it (review #20).
       */
      failedAnswer?: AiAnswer & { sql: string };
    });

/** Longest engine message sent back to the model. */
const MAX_REPAIR_MESSAGE_CHARS = 500;

/**
 * The engine message without its quoted literals. SQLite quotes values
 * in some messages, and the run is nominative: `json_extract('{}',
 * display_name)` fails with `bad JSON path: 'Anouk Abgrall'` (review A,
 * M3). Every single-quoted literal becomes `'?'`, an unterminated one
 * too; double-quoted tokens (`near "FROM"`) come from the SQL the model
 * wrote and stay, as do identifiers.
 */
export const redactEngineMessage = (message: string) => {
  const redacted = message.replace(
    /'(?:[^']|'')*('|$)/g,
    (_literal, end: string) => (end ? "'?'" : "'?")
  );
  return redacted.length > MAX_REPAIR_MESSAGE_CHARS
    ? `${redacted.slice(0, MAX_REPAIR_MESSAGE_CHARS)}…`
    : redacted;
};

/**
 * The follow-up turn of a failed query (appendix E.1): error text only,
 * values redacted (`redactEngineMessage`).
 */
export const repairMessage = (error: AnalyticsError) => {
  let where = "";
  if (error.offset !== null && error.sql !== null) {
    const { line, column } = offsetToLineColumn(error.sql, error.offset);
    where = ` (line ${line}, column ${column})`;
  }
  const object = error.object ? ` [${error.object}]` : "";
  return `The query failed in the app: ${error.code}: ${redactEngineMessage(error.message)}${where}${object}. Return a corrected complete answer.`;
};

/** The chart to show for a result: the answer's when it fits. */
export const chartForResult = (
  chart: ChartSpec | null,
  result: QueryResult
): ChartSpec =>
  chart && chartFitsResult(chart, result.columns)
    ? chart
    : autoChart(result.columns, result.rows);

const toError = (error: unknown): AiError | AnalyticsError =>
  error instanceof AiError || error instanceof AnalyticsError
    ? error
    : new AiError(
        "internal",
        error instanceof Error ? error.message : String(error)
      );

export const runAiConversation = async (
  start: AiMessage[],
  deps: AiLoopDeps,
  options: { maxRepairs?: number } = {}
): Promise<AiOutcome> => {
  const maxRepairs = options.maxRepairs ?? MAX_REPAIRS;
  const messages = [...start];
  const usages: AiUsageEntry[] = [];
  let repairs = 0;

  for (;;) {
    deps.onPhase?.(repairs === 0 ? "asking" : "repairing");
    let response: AiAskResponse;
    try {
      response = await deps.ask([...messages]);
    } catch (error) {
      return {
        kind: "error",
        error: toError(error),
        repairFailed: false,
        messages,
        usages,
      };
    }
    usages.push({ usage: response.usage, model: response.model });

    const fail = (error: AiError): AiOutcome => ({
      kind: "error",
      error,
      repairFailed: false,
      messages,
      usages,
    });
    if (response.stopReason === "refusal") {
      return fail(new AiError("refusal", "The model declined the request"));
    }
    if (response.stopReason === "max_tokens") {
      return fail(new AiError("truncated", "The answer was cut off"));
    }
    const parsed = parseAiText(response.text);
    const read: AiResponse | null = parsed.ok
      ? parsed.response
      : deps.lenient
        ? parseLooseJsonAnswer(response.text)
        : null;
    if (!read) {
      return fail(
        new AiError(
          "invalid_response",
          `Unreadable answer (${parsed.ok ? "schema" : parsed.reason})`
        )
      );
    }
    messages.push({ role: "assistant", content: response.text });
    const answer = toDraft(read);

    if (answer.clarification && !answer.sql) {
      return {
        kind: "clarification",
        answer,
        question: answer.clarification,
        messages,
        usages,
      };
    }
    if (!answer.sql) {
      return fail(new AiError("invalid_response", "The answer has no SQL"));
    }

    deps.onPhase?.("running");
    try {
      const result = await deps.run(answer.sql, answer.params);
      return {
        kind: "answer",
        answer: { ...answer, sql: answer.sql },
        chart: chartForResult(answer.chart, result),
        result,
        repaired: repairs > 0,
        model: response.model,
        messages,
        usages,
      };
    } catch (error) {
      const failure = toError(error);
      const repairable =
        failure instanceof AnalyticsError && REPAIRABLE_CODES.has(failure.code);
      const failedAnswer = { ...answer, sql: answer.sql };
      if (!repairable) {
        return {
          kind: "error",
          error: failure,
          repairFailed: false,
          failedAnswer,
          messages,
          usages,
        };
      }
      if (repairs >= maxRepairs) {
        return {
          kind: "error",
          error: failure,
          repairFailed: true,
          failedAnswer,
          messages,
          usages,
        };
      }
      repairs += 1;
      messages.push({ role: "user", content: repairMessage(failure) });
    }
  }
};
