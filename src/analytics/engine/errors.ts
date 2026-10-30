import type { TFunction } from "i18next";
import { canRaiseLimits, useMachineStore } from "./activePerformance";
import {
  ANALYTICS_ERROR_CODES,
  AnalyticsErrorCode,
  AnalyticsErrorPayload,
} from "../types";

/**
 * Error of the analytics engine, built from the IPC payload
 * `{ code, message, offset?, object? }` (plan 2.2).
 *
 * - `offset`: position of a syntax error, in UTF-16 code units of `sql`.
 * - `object`: the denied table or column for `denied`, the parameter name
 *   for `missing_param` and `invalid_param`.
 */
export class AnalyticsError extends Error {
  readonly code: AnalyticsErrorCode;
  readonly offset: number | null;
  readonly object: string | null;
  /** The SQL that failed, to turn `offset` into a line and a column. */
  readonly sql: string | null;
  /** Timeout of the request, for the `timeout` message. */
  readonly timeoutMs: number | null;

  constructor(
    payload: AnalyticsErrorPayload,
    context: { sql?: string | null; timeoutMs?: number | null } = {}
  ) {
    super(payload.message);
    this.name = "AnalyticsError";
    this.code = payload.code;
    this.offset = payload.offset ?? null;
    this.object = payload.object ?? null;
    this.sql = context.sql ?? null;
    this.timeoutMs = context.timeoutMs ?? null;
  }

  toPayload(): AnalyticsErrorPayload {
    return {
      code: this.code,
      message: this.message,
      offset: this.offset,
      object: this.object,
    };
  }
}

const isAnalyticsErrorCode = (value: unknown): value is AnalyticsErrorCode =>
  typeof value === "string" &&
  (ANALYTICS_ERROR_CODES as readonly string[]).includes(value);

/**
 * Turns anything thrown by `invoke` or an engine into an AnalyticsError:
 * a payload object, an AnalyticsError, an Error or a string.
 */
export const toAnalyticsError = (
  error: unknown,
  context: { sql?: string | null; timeoutMs?: number | null } = {}
): AnalyticsError => {
  if (error instanceof AnalyticsError) {
    return error;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code, message, offset, object } = error as Record<string, unknown>;
    if (isAnalyticsErrorCode(code)) {
      return new AnalyticsError(
        {
          code,
          message: typeof message === "string" ? message : String(code),
          offset: typeof offset === "number" ? offset : null,
          object: typeof object === "string" ? object : null,
        },
        context
      );
    }
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return new AnalyticsError({ code: "internal", message }, context);
};

/** Key of the message for a code (appendix D.1, `common.errors.*`). */
export const errorMessageKey = (code: AnalyticsErrorCode) =>
  `analytics.common.errors.${code}`;

/** 1-based line and column of a UTF-16 offset in `sql`. */
export const offsetToLineColumn = (
  sql: string,
  offset: number
): { line: number; column: number } => {
  const before = sql.slice(0, Math.max(0, Math.min(offset, sql.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
};

/**
 * The translated message of an error, with line and column when known.
 * A timeout or a too-large result also says which performance profile
 * would allow more, when the machine can take a heavier one than the
 * profile in use.
 */
export const formatAnalyticsError = (
  error: AnalyticsError,
  t: TFunction
): string => {
  const message = baseMessage(error, t);
  if (
    (error.code === "timeout" || error.code === "too_large") &&
    canRaiseLimits()
  ) {
    const recommended = useMachineStore.getState().machine?.recommended;
    if (recommended) {
      return `${message} ${t("analytics.performance.raiseHint", {
        profile: t(`analytics.performance.profiles.${recommended}.name`),
      })}`;
    }
  }
  return message;
};

const baseMessage = (error: AnalyticsError, t: TFunction): string => {
  switch (error.code) {
    case "syntax":
      if (error.offset !== null && error.sql !== null) {
        const { line, column } = offsetToLineColumn(error.sql, error.offset);
        return t(errorMessageKey("syntax"), {
          line,
          column,
          message: error.message,
        });
      }
      return t("analytics.common.errors.syntaxNoPosition", {
        message: error.message,
      });
    case "denied":
      return error.object
        ? t(errorMessageKey("denied"), { object: error.object })
        : t("analytics.common.errors.deniedNoObject");
    case "timeout":
      return t(errorMessageKey("timeout"), {
        seconds: Math.round((error.timeoutMs ?? 10_000) / 1000),
      });
    case "missing_param":
    case "invalid_param":
      return t(errorMessageKey(error.code), {
        name: error.object ?? error.message,
      });
    case "internal":
      return t(errorMessageKey("internal"), { message: error.message });
    default:
      return t(errorMessageKey(error.code));
  }
};
