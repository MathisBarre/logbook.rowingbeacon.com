import type { SqlClient } from "../../_common/database/sqlClient";
import { saveSetting } from "../../_common/database/repositories/club.repository";
import {
  DashboardItemInput,
  listDashboardItems,
  MAIN_DASHBOARD,
  replaceDashboard,
  saveDashboardItem,
} from "../repository/analytics.repository";
import { DEFAULT_DASHBOARD, getReport } from "../reports/catalog";
import { ANALYTICS_SETTINGS } from "../store/analyticsSettings.store";
import type { ReportDefinition } from "../types";

/**
 * The default dashboard (plan 1.3): written once, on the first visit, in
 * one write-queue job together with the `analytics.dashboard.initialised`
 * flag; "Rétablir le tableau de bord par défaut" writes it again. Reports
 * that are unknown or unavailable (module off, data missing) are skipped.
 */

type DefaultItem = Omit<DashboardItemInput, "id" | "dashboardId" | "position">;

export const defaultDashboardItems = (
  isAvailable: (report: ReportDefinition) => boolean
): DefaultItem[] =>
  DEFAULT_DASHBOARD.flatMap((entry) => {
    const report = getReport(entry.reportId);
    if (!report || !isAvailable(report)) return [];
    return [
      {
        source: { kind: "report" as const, reportId: entry.reportId },
        size: entry.size,
        paramValues: { ...entry.paramValues },
        chartOverride: null,
      },
    ];
  });

const markInitialised = (db: SqlClient) =>
  saveSetting(db, ANALYTICS_SETTINGS.dashboardInitialised, true);

/**
 * First visit. Items pinned before the dashboard was ever shown (from
 * Rapports) are kept, and the default items not already there are added
 * after them.
 */
const writeInitialDashboard = async (db: SqlClient, items: DefaultItem[]) => {
  const existing = await listDashboardItems(db, MAIN_DASHBOARD);
  const pinned = new Set(
    existing.flatMap((item) =>
      item.source.kind === "report" ? [item.source.reportId] : []
    )
  );
  for (const item of items) {
    if (item.source.kind === "report" && pinned.has(item.source.reportId)) {
      continue;
    }
    await saveDashboardItem(db, { ...item, dashboardId: MAIN_DASHBOARD });
  }
  await markInitialised(db);
};

/** "Rétablir le tableau de bord par défaut": saved queries are kept. */
export const writeDefaultDashboard = async (
  db: SqlClient,
  items: DefaultItem[]
) => {
  await replaceDashboard(db, MAIN_DASHBOARD, items);
  await markInitialised(db);
};

let initialising: Promise<boolean> | null = null;

/**
 * Writes the default dashboard unless the flag says it was already done.
 * Concurrent calls (two mounts) share one job. Resolves with true when it
 * wrote; the caller then marks the settings store.
 */
export const initialiseDashboardOnce = (options: {
  isInitialised: () => boolean;
  /** Resolves with the availability check, once the engine answered. */
  availability: () => Promise<(report: ReportDefinition) => boolean>;
  write: (
    label: string,
    write: (db: SqlClient) => Promise<unknown>
  ) => Promise<boolean>;
  onInitialised: () => void;
}): Promise<boolean> => {
  if (options.isInitialised()) return Promise.resolve(false);
  initialising ??= (async () => {
    try {
      const isAvailable = await options.availability();
      if (options.isInitialised()) return false;
      const items = defaultDashboardItems(isAvailable);
      const ok = await options.write("default dashboard", (db) =>
        writeInitialDashboard(db, items)
      );
      if (ok) options.onInitialised();
      return ok;
    } finally {
      initialising = null;
    }
  })();
  return initialising;
};
