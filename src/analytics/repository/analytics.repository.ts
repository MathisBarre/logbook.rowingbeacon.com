import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { SqlClient } from "../../_common/database/sqlClient";
import { getDatabase } from "../../_common/database/database";
import { enqueueWrite } from "../../_common/database/writeQueue";
import { ChartSpec, ParamDefs, SPEC_VERSION } from "../chartSpec";
import type {
  DashboardItem,
  DashboardItemSize,
  DashboardItemSource,
  ParamDef,
  ParamValue,
  QueryOrigin,
  QueryStatus,
  SavedQuery,
} from "../types";

/**
 * Saved queries and dashboard items (migration 11, plan 2.5). The only
 * analytics module that touches the club database through plugin-sql.
 * Functions take a SqlClient: write them through `writeAnalytics` (the
 * write queue, ADR 0003) and read them through `readAnalytics`. JSON
 * columns are validated with zod on read; an invalid row is skipped with a
 * console warning.
 */

/** Runs a read on the app database. */
export const readAnalytics = async <T>(
  read: (db: SqlClient) => Promise<T>
): Promise<T> => read((await getDatabase()).db);

/** Queues a write; resolves with false when it failed (toast shown). */
export const writeAnalytics = (
  label: string,
  write: (db: SqlClient) => Promise<unknown>
): Promise<boolean> => enqueueWrite(`analytics ${label}`, write);

const nowIso = () => new Date().toISOString();

const ParamValues = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// ─── Queries ────────────────────────────────────────────────────────────

interface QueryRow {
  id: string;
  title: string;
  description: string | null;
  sql: string;
  params: string;
  chart: string | null;
  origin: QueryOrigin;
  status: QueryStatus;
  based_on_report_id: string | null;
  spec_version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** Migration 12; absent on a database that missed it. */
  client?: string | null;
}

const toQuery = (row: QueryRow): SavedQuery | null => {
  const params = ParamDefs.safeParse(parseJson(row.params));
  const chartJson = parseJson(row.chart);
  const chart = chartJson === null ? null : ChartSpec.safeParse(chartJson);
  if (!params.success || (chart !== null && !chart.success)) {
    console.warn(
      `⚠️ Skipped analytics query ${row.id}: invalid params or chart`
    );
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sql: row.sql,
    params: params.data,
    chart: chart === null ? null : chart.data,
    origin: row.origin,
    status: row.status,
    basedOnReportId: row.based_on_report_id,
    specVersion: row.spec_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    client: row.client ?? null,
  };
};

const isQuery = (query: SavedQuery | null): query is SavedQuery =>
  query !== null;

/** Saved (or proposed) queries that are not archived, last changed first. */
export const listQueries = async (
  db: SqlClient,
  {
    status = "saved",
    archived = false,
  }: {
    status?: QueryStatus;
    /** True: the archived ones instead ("Archivées" in the Explorer). */
    archived?: boolean;
  } = {}
): Promise<SavedQuery[]> => {
  const rows = await db.select<QueryRow[]>(
    archived
      ? "SELECT * FROM analytics_query WHERE status = $1 AND archived_at IS NOT NULL ORDER BY archived_at DESC, title"
      : "SELECT * FROM analytics_query WHERE status = $1 AND archived_at IS NULL ORDER BY updated_at DESC, title",
    [status]
  );
  return rows.map(toQuery).filter(isQuery);
};

/** A query by id, archived or not; null when missing or unreadable. */
export const getQuery = async (
  db: SqlClient,
  id: string
): Promise<SavedQuery | null> => {
  const rows = await db.select<QueryRow[]>(
    "SELECT * FROM analytics_query WHERE id = $1",
    [id]
  );
  return rows[0] ? toQuery(rows[0]) : null;
};

export interface SaveQueryInput {
  /** Absent: a new query. */
  id?: string;
  title: string;
  description?: string | null;
  sql: string;
  params: ParamDef[];
  chart: ChartSpec | null;
  /** Kept from the first save. */
  origin?: QueryOrigin;
  status?: QueryStatus;
  basedOnReportId?: string | null;
}

/** Creates or updates a query; resolves with what is stored. */
export const saveQuery = async (
  db: SqlClient,
  query: SaveQueryInput
): Promise<SavedQuery> => {
  const id = query.id ?? uuidv4();
  const now = nowIso();
  await db.execute(
    `INSERT INTO analytics_query
       (id, title, description, sql, params, chart, origin, status, based_on_report_id, spec_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       sql = excluded.sql,
       params = excluded.params,
       chart = excluded.chart,
       status = excluded.status,
       based_on_report_id = excluded.based_on_report_id,
       spec_version = excluded.spec_version,
       updated_at = excluded.updated_at`,
    [
      id,
      query.title,
      query.description ?? null,
      query.sql,
      JSON.stringify(query.params),
      query.chart === null ? null : JSON.stringify(query.chart),
      query.origin ?? "user",
      query.status ?? "saved",
      query.basedOnReportId ?? null,
      SPEC_VERSION,
      now,
    ]
  );
  const saved = await getQuery(db, id);
  if (!saved) {
    throw new Error(`Analytics query ${id} could not be read back`);
  }
  return saved;
};

/** Archives a query and removes it from every dashboard. */
export const archiveQuery = async (db: SqlClient, id: string) => {
  await db.execute("DELETE FROM analytics_dashboard_item WHERE query_id = $1", [
    id,
  ]);
  const now = nowIso();
  await db.execute(
    "UPDATE analytics_query SET archived_at = $1, updated_at = $1 WHERE id = $2",
    [now, id]
  );
};

/** Brings an archived query back to the list (its pins stay removed). */
export const unarchiveQuery = async (db: SqlClient, id: string) => {
  await db.execute(
    "UPDATE analytics_query SET archived_at = NULL, updated_at = $1 WHERE id = $2",
    [nowIso(), id]
  );
};

/** Deletes a query (a refused proposal) and its dashboard items. */
export const deleteQuery = async (db: SqlClient, id: string) => {
  await db.execute("DELETE FROM analytics_dashboard_item WHERE query_id = $1", [
    id,
  ]);
  await db.execute("DELETE FROM analytics_query WHERE id = $1", [id]);
};

export interface ProposalInput {
  /** The inbox file id (uuid): importing the same file twice is a no-op. */
  id: string;
  title: string;
  description: string | null;
  sql: string;
  params: ParamDef[];
  chart: ChartSpec | null;
  createdAt?: string | null;
  /** MCP `clientInfo.name` of the proposing client, when it gave one. */
  client?: string | null;
}

/**
 * Ids of the refused MCP proposals (newest last), so that an inbox
 * file whose removal failed, or a poll that read it just before
 * "Refuser", never brings it back (review C, 4). Bounded: an id only
 * matters while its file can still be in the inbox folder.
 */
export const REFUSED_PROPOSALS_SETTING = "analytics.mcp.refusedProposals";
export const MAX_REFUSED_PROPOSALS = 200;

const readRefusedProposals = async (db: SqlClient): Promise<string[]> => {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM setting WHERE key = $1",
    [REFUSED_PROPOSALS_SETTING]
  );
  if (rows.length === 0) return [];
  try {
    const ids: unknown = JSON.parse(rows[0].value);
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};

/** Refuses a proposal: remembers its id, then deletes it. */
export const refuseProposal = async (db: SqlClient, id: string) => {
  const key = id.toLowerCase();
  const ids = [
    ...(await readRefusedProposals(db)).filter((other) => other !== key),
    key,
  ].slice(-MAX_REFUSED_PROPOSALS);
  await db.execute(
    "INSERT INTO setting (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [REFUSED_PROPOSALS_SETTING, JSON.stringify(ids)]
  );
  await deleteQuery(db, id);
};

/**
 * Stores an MCP proposal (any local AI assistant); idempotent by id. Resolves with
 * "refused" (and writes nothing) for a proposal refused before.
 */
export const insertProposal = async (
  db: SqlClient,
  proposal: ProposalInput
): Promise<"stored" | "refused"> => {
  if ((await readRefusedProposals(db)).includes(proposal.id.toLowerCase())) {
    return "refused";
  }
  const now = nowIso();
  await db.execute(
    `INSERT OR IGNORE INTO analytics_query
       (id, title, description, sql, params, chart, origin, status, spec_version, created_at, updated_at, client)
     VALUES ($1, $2, $3, $4, $5, $6, 'mcp', 'proposed', $7, $8, $9, $10)`,
    [
      proposal.id,
      proposal.title,
      proposal.description,
      proposal.sql,
      JSON.stringify(proposal.params),
      proposal.chart === null ? null : JSON.stringify(proposal.chart),
      SPEC_VERSION,
      proposal.createdAt ?? now,
      now,
      proposal.client ?? null,
    ]
  );
  return "stored";
};

/** Turns a proposal into a saved query. */
export const acceptProposal = async (db: SqlClient, id: string) => {
  await db.execute(
    "UPDATE analytics_query SET status = 'saved', updated_at = $1 WHERE id = $2 AND status = 'proposed'",
    [nowIso(), id]
  );
};

// ─── Dashboard ──────────────────────────────────────────────────────────

export const MAIN_DASHBOARD = "main";

interface DashboardItemRow {
  id: string;
  dashboard_id: string;
  position: number;
  source_kind: "report" | "query";
  report_id: string | null;
  query_id: string | null;
  size: DashboardItemSize;
  param_values: string;
  chart_override: string | null;
  created_at: string;
  updated_at: string;
}

const toItem = (row: DashboardItemRow): DashboardItem | null => {
  const paramValues = ParamValues.safeParse(parseJson(row.param_values));
  const chartJson = parseJson(row.chart_override);
  const chart = chartJson === null ? null : ChartSpec.safeParse(chartJson);
  const source: DashboardItemSource | null =
    row.source_kind === "report" && row.report_id
      ? { kind: "report", reportId: row.report_id }
      : row.source_kind === "query" && row.query_id
        ? { kind: "query", queryId: row.query_id }
        : null;
  if (!paramValues.success || !source) {
    console.warn(`⚠️ Skipped dashboard item ${row.id}: invalid row`);
    return null;
  }
  return {
    id: row.id,
    dashboardId: row.dashboard_id,
    position: row.position,
    source,
    size: row.size,
    paramValues: paramValues.data,
    // An unreadable override falls back to the report's chart.
    chartOverride: chart?.success ? chart.data : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const isItem = (item: DashboardItem | null): item is DashboardItem =>
  item !== null;

/** Items of a dashboard in order; items of archived queries are left out. */
export const listDashboardItems = async (
  db: SqlClient,
  dashboardId: string = MAIN_DASHBOARD
): Promise<DashboardItem[]> => {
  const rows = await db.select<DashboardItemRow[]>(
    `SELECT i.* FROM analytics_dashboard_item i
     LEFT JOIN analytics_query q ON q.id = i.query_id
     WHERE i.dashboard_id = $1
       AND (i.source_kind = 'report' OR (q.id IS NOT NULL AND q.archived_at IS NULL))
     ORDER BY i.position, i.created_at`,
    [dashboardId]
  );
  return rows.map(toItem).filter(isItem);
};

export interface DashboardItemInput {
  /** Absent: a new item, added at the end. */
  id?: string;
  dashboardId?: string;
  position?: number;
  source: DashboardItemSource;
  size: DashboardItemSize;
  paramValues: Record<string, ParamValue>;
  chartOverride: ChartSpec | null;
}

const nextPosition = async (db: SqlClient, dashboardId: string) => {
  const rows = await db.select<{ next: number | null }[]>(
    "SELECT MAX(position) + 1 AS next FROM analytics_dashboard_item WHERE dashboard_id = $1",
    [dashboardId]
  );
  return rows[0]?.next ?? 0;
};

/** Creates or updates an item; resolves with its id. */
export const saveDashboardItem = async (
  db: SqlClient,
  item: DashboardItemInput
): Promise<string> => {
  const id = item.id ?? uuidv4();
  const dashboardId = item.dashboardId ?? MAIN_DASHBOARD;
  const existing = await db.select<{ position: number }[]>(
    "SELECT position FROM analytics_dashboard_item WHERE id = $1",
    [id]
  );
  const position =
    item.position ??
    existing[0]?.position ??
    (await nextPosition(db, dashboardId));
  const now = nowIso();
  await db.execute(
    `INSERT INTO analytics_dashboard_item
       (id, dashboard_id, position, source_kind, report_id, query_id, size, param_values, chart_override, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (id) DO UPDATE SET
       position = excluded.position,
       source_kind = excluded.source_kind,
       report_id = excluded.report_id,
       query_id = excluded.query_id,
       size = excluded.size,
       param_values = excluded.param_values,
       chart_override = excluded.chart_override,
       updated_at = excluded.updated_at`,
    [
      id,
      dashboardId,
      position,
      item.source.kind,
      item.source.kind === "report" ? item.source.reportId : null,
      item.source.kind === "query" ? item.source.queryId : null,
      item.size,
      JSON.stringify(item.paramValues),
      item.chartOverride === null ? null : JSON.stringify(item.chartOverride),
      now,
    ]
  );
  return id;
};

/** Swaps an item with its neighbour; no-op at the ends. */
export const moveDashboardItem = async (
  db: SqlClient,
  id: string,
  direction: "up" | "down"
) => {
  const rows = await db.select<{ id: string; dashboard_id: string }[]>(
    "SELECT id, dashboard_id FROM analytics_dashboard_item WHERE id = $1",
    [id]
  );
  if (!rows[0]) return;
  const ordered = await db.select<{ id: string }[]>(
    "SELECT id FROM analytics_dashboard_item WHERE dashboard_id = $1 ORDER BY position, created_at",
    [rows[0].dashboard_id]
  );
  const ids = ordered.map((row) => row.id);
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  const now = nowIso();
  for (const [position, itemId] of ids.entries()) {
    await db.execute(
      "UPDATE analytics_dashboard_item SET position = $1, updated_at = $2 WHERE id = $3 AND position <> $1",
      [position, now, itemId]
    );
  }
};

export const deleteDashboardItem = async (db: SqlClient, id: string) => {
  await db.execute("DELETE FROM analytics_dashboard_item WHERE id = $1", [id]);
};

/**
 * Replaces every item of a dashboard (default dashboard, reset). One
 * sequence without a transaction (plugin-sql pools connections);
 * running it twice gives the same result.
 */
export const replaceDashboard = async (
  db: SqlClient,
  dashboardId: string,
  items: Omit<DashboardItemInput, "id" | "dashboardId" | "position">[]
) => {
  await db.execute(
    "DELETE FROM analytics_dashboard_item WHERE dashboard_id = $1",
    [dashboardId]
  );
  for (const [position, item] of items.entries()) {
    await saveDashboardItem(db, { ...item, dashboardId, position });
  }
};
