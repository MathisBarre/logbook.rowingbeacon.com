import type { AnalyticsEngine } from "../../engine/engine";
import { resolveParams } from "../../params/resolveParams";
import type { ParamValue, QueryResult, SqlValue } from "../../types";
import { getReport } from "../catalog";

/** Test helpers: run a prebuilt report and read its rows as objects. */

export type Row = Record<string, SqlValue>;

const toObjects = (result: QueryResult): Row[] =>
  result.rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column, index) => [column.name, row[index]])
    )
  );

let counter = 0;

export const runReport = async (
  engine: AnalyticsEngine,
  id: string,
  values: Record<string, ParamValue> = {},
  options: { now: string; seasonStartMonth?: number; maxRows?: number }
): Promise<{ rows: Row[]; result: QueryResult }> => {
  const report = getReport(id);
  if (!report) {
    throw new Error(`Unknown report ${id}`);
  }
  const resolved = resolveParams(report.params, values, {
    now: options.now,
    seasonStartMonth: options.seasonStartMonth ?? 8,
  });
  if (resolved.errors.length > 0) {
    throw new Error(
      `Invalid parameters for ${id}: ${JSON.stringify(resolved.errors)}`
    );
  }
  counter += 1;
  const result = await engine.run({
    requestId: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    sql: report.sql,
    params: resolved.values,
    maxRows: options.maxRows ?? 5000,
    timeoutMs: 20_000,
    privacy: "nominative",
    now: options.now,
    useCache: false,
  });
  return { rows: toObjects(result), result };
};

/** Same as runReport, for a report's coverage query. */
export const runCoverage = async (
  engine: AnalyticsEngine,
  id: string,
  season: number,
  now: string
): Promise<QueryResult | null> => {
  const report = getReport(id);
  if (!report?.coverage) {
    return null;
  }
  counter += 1;
  return engine.run({
    requestId: `00000000-0000-4000-9000-${String(counter).padStart(12, "0")}`,
    sql: report.coverage.sql,
    params: { season },
    maxRows: 1,
    timeoutMs: 10_000,
    privacy: "nominative",
    now,
    useCache: false,
  });
};
