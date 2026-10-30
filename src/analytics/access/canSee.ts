import type { ReportDefinition, ReportVisibility } from "../types";

/**
 * Whether a report may run and show (plan 1.6): public reports always;
 * nominative ones (names) once unlocked or when the club allows public
 * rankings; admin ones only once unlocked. Decided before the query runs.
 */
export const canSeeReport = (
  report: Pick<ReportDefinition, "visibility">,
  access: { isUnlocked: boolean; publicRankings: boolean }
): boolean => {
  switch (report.visibility) {
    case "public":
      return true;
    case "nominative":
      return access.isUnlocked || access.publicRankings;
    case "admin":
      return access.isUnlocked;
  }
};

const normalisedSql = (sql: string) => sql.replace(/\s+/g, " ").trim();

/**
 * Visibility of a saved query on the dashboard (ADR 0008: a nominative
 * result is locked, not filtered afterwards). The engine always runs in
 * nominative mode, so a query may show names whatever its origin. A query
 * saved from a report ("Enregistrer comme requête", "Voir la requête SQL")
 * keeps that report's visibility as long as its SQL is the report's. Any
 * other query (edited, written in the Explorer, from the AI or an MCP client) is
 * for officials only.
 */
export const queryVisibility = (
  query: { sql: string; basedOnReportId: string | null },
  basedOn:
    | Pick<ReportDefinition, "id" | "sql" | "visibility">
    | null
    | undefined
): ReportVisibility =>
  basedOn &&
  query.basedOnReportId === basedOn.id &&
  normalisedSql(query.sql) === normalisedSql(basedOn.sql)
    ? basedOn.visibility
    : "admin";

/**
 * Who sees a pinned card at the boathouse, without the password: everyone,
 * or officials only (the card stays locked).
 */
export const dashboardAudience = (
  visibility: ReportVisibility,
  publicRankings: boolean
): "everyone" | "officials" =>
  canSeeReport({ visibility }, { isUnlocked: false, publicRankings })
    ? "everyone"
    : "officials";
