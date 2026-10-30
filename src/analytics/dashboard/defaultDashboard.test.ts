import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../../_common/database/migrations";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";
import type { SqlClient } from "../../_common/database/sqlClient";
import {
  listDashboardItems,
  saveDashboardItem,
  saveQuery,
} from "../repository/analytics.repository";
import { DEFAULT_DASHBOARD, getReport } from "../reports/catalog";
import { ANALYTICS_SETTINGS } from "../store/analyticsSettings.store";
import type { DashboardItem } from "../types";
import {
  defaultDashboardItems,
  initialiseDashboardOnce,
  writeDefaultDashboard,
} from "./defaultDashboard";

let db: ReturnType<typeof createTestSqlClient>;
beforeEach(async () => {
  db = createTestSqlClient();
  const log = console.log;
  console.log = () => undefined;
  await applyMigrations(db);
  console.log = log;
});
afterEach(async () => {
  await db.close();
});

const ids = (items: DashboardItem[]) =>
  items.map((item) =>
    item.source.kind === "report" ? item.source.reportId : "query"
  );

const flag = async () => {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM setting WHERE key = $1",
    [ANALYTICS_SETTINGS.dashboardInitialised]
  );
  return rows[0] ? (JSON.parse(rows[0].value) as unknown) : undefined;
};

/** Runs initialiseDashboardOnce against the test database. */
const firstVisit = (
  state: { initialised: boolean },
  isAvailable: (id: string) => boolean = () => true
) => {
  let writes = 0;
  const promise = initialiseDashboardOnce({
    isInitialised: () => state.initialised,
    availability: () => Promise.resolve((report) => isAvailable(report.id)),
    write: async (_label, write: (db: SqlClient) => Promise<unknown>) => {
      writes++;
      await write(db);
      return true;
    },
    onInitialised: () => {
      state.initialised = true;
    },
  });
  return { promise, writes: () => writes };
};

describe("default dashboard", () => {
  it("lists the six reports of plan 1.3 in order", () => {
    expect(DEFAULT_DASHBOARD.map((entry) => entry.reportId)).toEqual([
      "season-overview",
      "yoy-monthly",
      "attendance-heatmap",
      "boat-usage-ranking",
      "active-rowers-monthly",
      "fleet-class-monthly",
    ]);
    for (const entry of DEFAULT_DASHBOARD) {
      // Heavy reports never go on the default dashboard (plan 2.14).
      expect(getReport(entry.reportId)?.cost).not.toBe("heavy");
    }
  });

  it("writes the six items once on the first visit, with the flag", async () => {
    const state = { initialised: false };
    const first = firstVisit(state);
    expect(await first.promise).toBe(true);
    expect(first.writes()).toBe(1);
    const items = await listDashboardItems(db);
    expect(ids(items)).toEqual(DEFAULT_DASHBOARD.map((e) => e.reportId));
    expect(items.map((item) => item.size)).toEqual(
      DEFAULT_DASHBOARD.map((e) => e.size)
    );
    expect(items[1].paramValues).toEqual(DEFAULT_DASHBOARD[1].paramValues);
    expect(state.initialised).toBe(true);
    expect(await flag()).toBe(true);

    // Second visit: nothing is written again, even after a removal.
    await db.execute("DELETE FROM analytics_dashboard_item");
    const second = firstVisit(state);
    expect(await second.promise).toBe(false);
    expect(second.writes()).toBe(0);
    expect(await listDashboardItems(db)).toEqual([]);
  });

  it("shares one job between two mounts", async () => {
    const state = { initialised: false };
    const a = firstVisit(state);
    const b = firstVisit(state);
    await Promise.all([a.promise, b.promise]);
    expect(a.writes() + b.writes()).toBe(1);
    expect(await listDashboardItems(db)).toHaveLength(DEFAULT_DASHBOARD.length);
  });

  it("skips unavailable reports", async () => {
    const state = { initialised: false };
    await firstVisit(
      state,
      (id) => id !== "attendance-heatmap" && id !== "fleet-class-monthly"
    ).promise;
    expect(ids(await listDashboardItems(db))).toEqual([
      "season-overview",
      "yoy-monthly",
      "boat-usage-ranking",
      "active-rowers-monthly",
    ]);
  });

  it("keeps what was pinned before the first visit", async () => {
    await saveDashboardItem(db, {
      source: { kind: "report", reportId: "km-challenge" },
      size: "half",
      paramValues: {},
      chartOverride: null,
    });
    await saveDashboardItem(db, {
      source: { kind: "report", reportId: "boat-usage-ranking" },
      size: "full",
      paramValues: {},
      chartOverride: null,
    });
    await firstVisit({ initialised: false }).promise;
    const items = await listDashboardItems(db);
    expect(ids(items)).toEqual([
      "km-challenge",
      "boat-usage-ranking",
      "season-overview",
      "yoy-monthly",
      "attendance-heatmap",
      "active-rowers-monthly",
      "fleet-class-monthly",
    ]);
    expect(items[1].size).toBe("full");
  });

  it("reset restores the default items and keeps saved queries", async () => {
    const query = await saveQuery(db, {
      title: "Mes sorties",
      sql: "SELECT 1 AS one",
      params: [],
      chart: null,
    });
    await saveDashboardItem(db, {
      source: { kind: "query", queryId: query.id },
      size: "third",
      paramValues: {},
      chartOverride: null,
    });
    await writeDefaultDashboard(
      db,
      defaultDashboardItems(() => true)
    );
    expect(ids(await listDashboardItems(db))).toEqual(
      DEFAULT_DASHBOARD.map((e) => e.reportId)
    );
    const queries = await db.select<{ id: string }[]>(
      "SELECT id FROM analytics_query"
    );
    expect(queries).toEqual([{ id: query.id }]);
    expect(await flag()).toBe(true);
  });

  it("leaves out reports the catalogue does not know", () => {
    const items = defaultDashboardItems(
      (report) => report.id !== "season-overview"
    );
    expect(items).toHaveLength(DEFAULT_DASHBOARD.length - 1);
    expect(items.every((item) => item.chartOverride === null)).toBe(true);
  });
});
