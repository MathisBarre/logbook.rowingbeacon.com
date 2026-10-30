import { afterEach, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
  insertTestBoat,
  insertTestOuting,
  insertTestRower,
} from "../testing/analyticsTestDb";
import { parseBlocks, planViews, renderViewSql, VIEW_BLOCKS } from "./views";
import { getObject } from "./dictionary";
import type { RunQueryRequest } from "../types";

const NOW = "2026-06-20T09:47";

const request = (
  sql: string,
  params: RunQueryRequest["params"] = {}
): RunQueryRequest => ({
  requestId: "00000000-0000-4000-8000-000000000000",
  sql,
  params,
  maxRows: 5000,
  timeoutMs: 10_000,
  privacy: "nominative",
  now: NOW,
  useCache: false,
});

let testDb: AnalyticsTestDb | null = null;
afterEach(async () => {
  await testDb?.cleanup();
  testDb = null;
});

describe("parseBlocks", () => {
  it("reads the 11 views of views.sql in order with their requirements", () => {
    expect(VIEW_BLOCKS.map((block) => block.name)).toEqual([
      "v_settings",
      "v_boats",
      "v_rowers",
      "v_routes",
      "v_outing_types",
      "v_outings",
      "v_outing_rowers",
      "v_seasons",
      "v_days",
      "v_incidents",
      "v_damages",
    ]);
    expect(VIEW_BLOCKS[0].requires).toEqual([]);
    expect(VIEW_BLOCKS.find((b) => b.name === "v_damages")?.requires).toEqual([
      "boat_damage",
      "boat",
    ]);
    for (const block of VIEW_BLOCKS) {
      expect(block.sql).toMatch(/^CREATE TEMP VIEW /);
      expect(block.sql.endsWith(";")).toBe(true);
    }
  });

  it("parses report blocks and ignores the other marker", () => {
    const text = [
      "-- header",
      "-- @report a-b",
      "SELECT 1;",
      "",
      "-- @view v requires=x",
      "CREATE TEMP VIEW v AS SELECT 1;",
      "-- @report c",
      "SELECT 2",
      "FROM t;",
    ].join("\n");
    expect(parseBlocks(text, "@report")).toEqual([
      {
        name: "a-b",
        requires: [],
        sql: "SELECT 1;\n\n-- @view v requires=x\nCREATE TEMP VIEW v AS SELECT 1;",
      },
      { name: "c", requires: [], sql: "SELECT 2\nFROM t;" },
    ]);
  });
});

describe("renderViewSql", () => {
  it("substitutes validated values", () => {
    const sql = renderViewSql(VIEW_BLOCKS[0], {
      seasonStartMonth: 9,
      now: NOW,
    });
    expect(sql).not.toContain("{{");
    expect(sql).toContain("9 AS season_start_month");
    expect(sql).toContain(`'${NOW}' AS now`);
  });

  it.each([
    { seasonStartMonth: 0, now: NOW },
    { seasonStartMonth: 13, now: NOW },
    { seasonStartMonth: 8.5, now: NOW },
    { seasonStartMonth: 8, now: "2026-06-20 09:47" },
    { seasonStartMonth: 8, now: "2026-06-20T09:47'; DROP TABLE outing; --" },
  ])("rejects %o", (values) => {
    expect(() => renderViewSql(VIEW_BLOCKS[0], values)).toThrow();
  });
});

const viewColumns = async (db: AnalyticsTestDb, view: string) => {
  const result = await db
    .engine()
    .run(request(`SELECT * FROM ${view} LIMIT 1`));
  return result.columns.map((column) => column.name);
};

describe("views on the migrated schema", () => {
  it("creates every view but v_damages without boat_damage, on a read-only connection", async () => {
    testDb = await createAnalyticsTestDb({ withoutDamages: true });
    const objects = await testDb.engine().objects();
    expect(objects.missingViews).toEqual(["v_damages"]);
    expect(objects.views).toHaveLength(10);

    for (const view of objects.views) {
      const columns = await viewColumns(testDb, view);
      expect(columns, view).toEqual(
        getObject(view)?.columns.map((column) => column.name)
      );
    }
  });

  it("creates v_damages with the damages table", async () => {
    testDb = await createAnalyticsTestDb();
    const objects = await testDb.engine().objects();
    expect(objects.missingViews).toEqual([]);
    expect(await viewColumns(testDb, "v_damages")).toEqual(
      getObject("v_damages")?.columns.map((column) => column.name)
    );
  });

  it("plans views from the existing tables only", () => {
    const plan = planViews(["outing"], { seasonStartMonth: 8, now: NOW });
    expect(plan.created).toEqual(["v_settings", "v_seasons", "v_days"]);
    expect(plan.missing).toContain("v_outings");
  });

  it.each([
    // [start month, date, season, season_week]
    [8, "2025-07-31T10:00", 2024, 53],
    [8, "2025-08-01T10:00", 2025, 1],
    [1, "2025-07-31T10:00", 2025, 31],
    [1, "2025-08-01T10:00", 2025, 31],
    [9, "2025-07-31T10:00", 2024, 48],
    [9, "2025-08-01T10:00", 2024, 48],
  ])(
    "start month %i: %s is season %i, week %i",
    async (month, start, season, week) => {
      testDb = await createAnalyticsTestDb();
      await insertTestBoat(testDb.db, {
        id: "b1",
        name: "Albatros",
        seats: 1,
        rigging: "scull",
      });
      await insertTestRower(testDb.db, { id: "r1", firstName: "Ana" });
      await insertTestOuting(testDb.db, {
        id: "o1",
        boatId: "b1",
        start,
        end: start.replace("10:00", "11:30"),
        crew: ["r1"],
      });
      const result = await testDb
        .engine({ seasonStartMonth: month })
        .run(
          request(
            "SELECT season, season_week, boat_class, duration_min FROM v_outings"
          )
        );
      expect(result.rows).toEqual([[season, week, "1x", 90]]);
      const crew = await testDb
        .engine({ seasonStartMonth: month })
        .run(request("SELECT season, rower_code FROM v_outing_rowers"));
      expect(crew.rows).toEqual([[season, "R-R1"]]);
    }
  );

  it("reads the season start month from the settings", async () => {
    testDb = await createAnalyticsTestDb();
    await testDb.db.execute(
      "INSERT INTO setting (key, value) VALUES ('analytics.seasonStartMonth', '9')"
    );
    const result = await testDb
      .engine()
      .run(
        request("SELECT season_start_month, current_season FROM v_settings")
      );
    expect(result.rows).toEqual([[9, 2025]]);
  });
});
