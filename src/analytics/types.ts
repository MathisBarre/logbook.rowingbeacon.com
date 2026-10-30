import type { ChartSpec, ParamDef } from "./chartSpec";

/**
 * Shared analytics contract (plan 2.6). Frozen: the Rust mirror lives in
 * src-tauri/crates/rb-analytics/src/ipc.rs and both sides are checked
 * against engine/ipc-fixtures.json.
 */

export type { ChartSpec, ParamDef } from "./chartSpec";

export type PrivacyMode = "nominative" | "pseudonymised";
export type SqlValue = string | number | null;
export type ParamValue = string | number | boolean | null;

export interface ResultColumn {
  name: string;
  declType: string | null;
}
export interface QueryResult {
  columns: ResultColumn[];
  rows: SqlValue[][];
  truncated: boolean;
  elapsedMs: number;
  /** Base columns read as NULL by the engine: "rower.email", … */
  ignoredColumns: string[];
  cached: boolean;
}
export interface RunQueryRequest {
  /** uuid v4 */
  requestId: string;
  sql: string;
  params: Record<string, ParamValue>;
  maxRows: number;
  timeoutMs: number;
  privacy: PrivacyMode;
  /** Local wall-clock time, getDateTimeWithoutTimezone(new Date()). */
  now: string;
  useCache: boolean;
}
export interface EngineObjects {
  views: string[];
  tables: string[];
  missingViews: string[];
}

export type AnalyticsErrorCode =
  | "syntax"
  | "denied"
  | "not_read_only"
  | "multiple_statements"
  | "timeout"
  | "cancelled"
  | "too_large"
  | "missing_param"
  | "invalid_param"
  | "busy"
  | "desktop_only"
  | "internal";

export const ANALYTICS_ERROR_CODES = [
  "syntax",
  "denied",
  "not_read_only",
  "multiple_statements",
  "timeout",
  "cancelled",
  "too_large",
  "missing_param",
  "invalid_param",
  "busy",
  "desktop_only",
  "internal",
] as const satisfies readonly AnalyticsErrorCode[];

export interface AnalyticsErrorPayload {
  code: AnalyticsErrorCode;
  message: string;
  offset?: number | null;
  object?: string | null;
}

export type QueryOrigin = "user" | "ai" | "mcp" | "report";
export type QueryStatus = "saved" | "proposed";
export interface SavedQuery {
  id: string;
  title: string;
  description: string | null;
  sql: string;
  params: ParamDef[];
  chart: ChartSpec | null;
  origin: QueryOrigin;
  status: QueryStatus;
  basedOnReportId: string | null;
  specVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** MCP `clientInfo.name` of a proposal ("claude-ai", "codex"…). */
  client?: string | null;
}
export type DashboardItemSize = "third" | "half" | "full";
export type DashboardItemSource =
  | { kind: "report"; reportId: string }
  | { kind: "query"; queryId: string };
export interface DashboardItem {
  id: string;
  dashboardId: string;
  position: number;
  source: DashboardItemSource;
  size: DashboardItemSize;
  paramValues: Record<string, ParamValue>;
  chartOverride: ChartSpec | null;
  createdAt: string;
  updatedAt: string;
}

/** Catalogue themes, in display order (review D 24). */
export type ReportCategory =
  | "overview"
  | "fleet"
  | "people"
  | "retention"
  | "attendance"
  | "safety"
  | "maintenance";
export const REPORT_CATEGORIES = [
  "overview",
  "fleet",
  "people",
  "retention",
  "attendance",
  "safety",
  "maintenance",
] as const satisfies readonly ReportCategory[];
export type ReportVisibility = "public" | "nominative" | "admin";
export type ReportCost = "light" | "medium" | "heavy";

/** Coverage hint of a report (plan 2.8). */
type CoverageColumn =
  | "gender"
  | "birth_date"
  | "age_category"
  | "distance"
  | "is_coached"
  | "has_start_time";
export interface CoverageCheck {
  column: CoverageColumn;
  /** Returns one row { known, total } for the selected season. */
  sql: string;
}

export interface ReportDefinition {
  id: string;
  category: ReportCategory;
  visibility: ReportVisibility;
  cost: ReportCost;
  requires: { tables: string[]; modules?: string[] };
  params: ParamDef[];
  chart: ChartSpec;
  sql: string;
  coverage?: CoverageCheck;
  /** English, for AI assistants over MCP. */
  mcpDescription: string;
  /** Keys under analytics.reports.notes (appendix D.5). */
  notes?: string[];
}
export type ReportAvailability =
  | { available: true }
  | { available: false; reason: "module"; module: string }
  | { available: false; reason: "table"; table: string };

/**
 * A query handed to the Explorer ("Voir la requête SQL", AI answer):
 * stored by `useAnalyticsHubStore.openInExplorer` and read once by the
 * Explorer with `takePendingDraft`.
 */
export interface ExplorerDraft {
  title: string;
  sql: string;
  params: ParamDef[];
  chart?: ChartSpec | null;
  basedOnReportId?: string | null;
  /** Values to prefill (for example the report's current parameters). */
  paramValues?: Record<string, ParamValue>;
  /**
   * The saved query this draft comes from ("Ouvrir" on a dashboard card).
   * The Explorer then opens that query itself, unless it was archived.
   */
  queryId?: string | null;
}

/** An answer of the AI assistant handed to the Explorer (WP7 → WP6). */
export interface AiDraft {
  title: string;
  sql: string;
  params: ParamDef[];
  chart: ChartSpec;
  explanation: string;
  assumptions: string[];
}
