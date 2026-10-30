import { createRequest, runQuery } from "../engine/queue";
import type { QueryResult, ReportDefinition } from "../types";

/**
 * Data coverage hints (plan 2.8): some reports depend on a field that
 * clubs often leave empty (gender, distance, coaching…). The report's
 * `coverage.sql` returns one row `{ known, total }` for the season; the
 * report view shows `analytics.reports.coverage.<column>` with the share
 * when it is below COVERAGE_HINT_BELOW_PCT.
 */

const COVERAGE_HINT_BELOW_PCT = 90;

/** Share of known values in a coverage result, null when nothing counts. */
export const coverageFromResult = (
  result: Pick<QueryResult, "columns" | "rows">
): { pct: number } | null => {
  const knownIndex = result.columns.findIndex(
    (column) => column.name === "known"
  );
  const totalIndex = result.columns.findIndex(
    (column) => column.name === "total"
  );
  const row = result.rows[0];
  if (!row || knownIndex === -1 || totalIndex === -1) {
    return null;
  }
  const known = Number(row[knownIndex] ?? 0);
  const total = Number(row[totalIndex] ?? 0);
  if (!Number.isFinite(known) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  // Floor, so that 100 % only shows when every value is known.
  const pct = Math.floor((100 * Math.min(Math.max(known, 0), total)) / total);
  return { pct };
};

/** Whether the hint is worth showing. */
export const shouldShowCoverage = (
  coverage: { pct: number } | null
): coverage is { pct: number } =>
  coverage !== null && coverage.pct < COVERAGE_HINT_BELOW_PCT;

/** i18n key of the hint, with `{{pct}}`; null without a coverage check. */
export const coverageMessageKey = (
  report: Pick<ReportDefinition, "coverage">
): string | null =>
  report.coverage
    ? `analytics.reports.coverage.${report.coverage.column}`
    : null;

/**
 * Share of known values for the report's coverage column in a season.
 * Null when the report has no coverage check or the season has no data.
 * Runs through the query queue (normal priority, after the report itself).
 */
export const getCoverage = async (
  report: ReportDefinition,
  season: number,
  options: { signal?: AbortSignal; now?: string } = {}
): Promise<{ pct: number } | null> => {
  if (!report.coverage) {
    return null;
  }
  const result = await runQuery(
    createRequest({
      sql: report.coverage.sql,
      params: { season },
      maxRows: 1,
      timeoutMs: 10_000,
      now: options.now,
    }),
    { signal: options.signal }
  );
  return coverageFromResult(result);
};
