import { createRequire } from "node:module";
import type {
  EngineObjects,
  ParamValue,
  QueryResult,
  RunQueryRequest,
  SqlValue,
} from "../types";
import type { AnalyticsEngine } from "./engine";
import { AnalyticsError } from "./errors";
import { checkSql } from "./sqlGuard";
import { planViews } from "../schema/views";
import { getDictionary } from "../schema/dictionary";

/**
 * TEST-ONLY engine over node:sqlite (Node 22), never imported by app code
 * (an ESLint rule forbids it outside *.test.ts and testing/ folders).
 *
 * Like the Rust engine it opens the database read-only for each query,
 * creates the TEMP views of views.sql (skipping those whose tables are
 * missing), turns on `query_only`, runs the single-statement guard, binds
 * named parameters and steps to `maxRows + 1`. It has no authorizer, no
 * timeout and no cancel (node:sqlite has none): privacy and limits are
 * tested in Rust.
 */

interface NodeColumn {
  name: string;
  type: string | null;
}
interface NodeStatement {
  columns(): NodeColumn[];
  iterate(params: Record<string, unknown>): Iterable<unknown[]>;
  all(params?: Record<string, unknown>): unknown[];
  setReturnArrays(enabled: boolean): void;
  setReadBigInts(enabled: boolean): void;
}
interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

const require = createRequire(import.meta.url);

const openReadOnly = (path: string): NodeDatabase => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { DatabaseSync } = require("node:sqlite");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return new DatabaseSync(path, { readOnly: true }) as NodeDatabase;
};

const MAX_TEXT = 1000;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const toSqlValue = (value: unknown): SqlValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    return value > SAFE || value < -SAFE ? value.toString() : Number(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  }
  if (value instanceof Uint8Array) {
    return `[blob ${value.length} octets]`;
  }
  return JSON.stringify(value);
};

const bindValue = (name: string, value: ParamValue | undefined): unknown => {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AnalyticsError({
        code: "invalid_param",
        message: `Invalid value for ${name}`,
        object: name,
      });
    }
    return Number.isInteger(value) ? BigInt(value) : value;
  }
  if (typeof value === "string") return value;
  throw new AnalyticsError({
    code: "invalid_param",
    message: `Invalid value for ${name}`,
    object: name,
  });
};

const mapSqliteError = (error: unknown, sql: string): AnalyticsError => {
  if (error instanceof AnalyticsError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/syntax error|incomplete input|unrecognized token/i.test(message)) {
    return new AnalyticsError({ code: "syntax", message }, { sql });
  }
  if (/readonly|read-only|query_only/i.test(message)) {
    return new AnalyticsError({ code: "not_read_only", message }, { sql });
  }
  return new AnalyticsError({ code: "internal", message }, { sql });
};

const readSeasonStartMonth = (db: NodeDatabase): number => {
  try {
    const rows = db
      .prepare(
        "SELECT value FROM setting WHERE key = 'analytics.seasonStartMonth'"
      )
      .all() as { value: string }[];
    const value: unknown = rows[0] ? JSON.parse(rows[0].value) : 8;
    return typeof value === "number" && Number.isInteger(value)
      ? Math.min(12, Math.max(1, value))
      : 8;
  } catch {
    return 8;
  }
};

const listTables = (db: NodeDatabase): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);

export interface NodeEngineOptions {
  /** Overrides the `analytics.seasonStartMonth` setting of the database. */
  seasonStartMonth?: number;
  /** `now` used by `objects()` (requests carry their own). */
  now?: string;
}

export interface NodeEngine extends AnalyticsEngine {
  /** Every request received, for assertions. */
  calls: RunQueryRequest[];
}

export const createNodeEngine = (
  dbPath: string,
  options: NodeEngineOptions = {}
): NodeEngine => {
  const calls: RunQueryRequest[] = [];

  const prepareConnection = (now: string) => {
    const db = openReadOnly(dbPath);
    const seasonStartMonth =
      options.seasonStartMonth ?? readSeasonStartMonth(db);
    const tables = listTables(db);
    const plan = planViews(tables, { seasonStartMonth, now });
    for (const statement of plan.statements) {
      db.exec(statement.sql);
    }
    db.exec("PRAGMA query_only = ON;");
    return { db, plan, tables };
  };

  return {
    calls,

    run(request) {
      calls.push(request);
      const started = performance.now();
      const checked = checkSql(request.sql);
      if (!checked.ok) {
        return Promise.reject(
          new AnalyticsError(checked.error, {
            sql: request.sql,
            timeoutMs: request.timeoutMs,
          })
        );
      }

      let db: NodeDatabase | null = null;
      try {
        db = prepareConnection(request.now).db;
        const statement = db.prepare(checked.sql);
        statement.setReturnArrays(true);
        statement.setReadBigInts(true);

        const params: Record<string, unknown> = {};
        for (const name of checked.paramNames) {
          params[name] = bindValue(name, request.params[name]);
        }

        const columns = statement.columns().map((column) => ({
          name: column.name,
          declType: column.type ?? null,
        }));
        const rows: SqlValue[][] = [];
        let truncated = false;
        for (const row of statement.iterate(params)) {
          if (rows.length === request.maxRows) {
            truncated = true;
            break;
          }
          rows.push(row.map(toSqlValue));
        }

        return Promise.resolve({
          columns,
          rows,
          truncated,
          elapsedMs: Math.round(performance.now() - started),
          ignoredColumns: [],
          cached: false,
        } satisfies QueryResult);
      } catch (error) {
        return Promise.reject(mapSqliteError(error, request.sql));
      } finally {
        db?.close();
      }
    },

    cancel() {
      return Promise.resolve();
    },

    objects(): Promise<EngineObjects> {
      const { db, plan, tables } = prepareConnection(
        options.now ?? "2026-01-01T12:00"
      );
      db.close();
      const existing = new Set(tables);
      return Promise.resolve({
        views: plan.created,
        tables: getDictionary()
          .objects.filter(
            (object) => object.kind === "table" && existing.has(object.name)
          )
          .map((object) => object.name),
        missingViews: plan.missing,
      });
    },
  };
};
