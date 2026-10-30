import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChartSpec, ParamDefs } from "../chartSpec";
import { createRequest } from "../engine/queue";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
  insertTestBoat,
  insertTestOuting,
  insertTestRower,
} from "../testing/analyticsTestDb";
import { EXAMPLE_QUERIES } from "./examples";
import frExplorer from "../i18n/fr-FR/explorer.json";

let testDb: AnalyticsTestDb;

beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
  await insertTestBoat(testDb.db, {
    id: "b1",
    name: "Lune",
    seats: 2,
    rigging: "scull",
  });
  await insertTestRower(testDb.db, { id: "r1", firstName: "Ada" });
  await insertTestRower(testDb.db, { id: "r2", firstName: "Bob" });
  await insertTestOuting(testDb.db, {
    id: "o1",
    boatId: "b1",
    start: "2025-09-06T09:00",
    end: "2025-09-06T10:30",
    crew: ["r1", "r2"],
    distanceM: 8000,
  });
  // A boat never taken out (boatsNotUsed) and a late return (lateReturns).
  await insertTestBoat(testDb.db, {
    id: "b2",
    name: "Soleil",
    seats: 1,
    rigging: "scull",
  });
  await testDb.db.execute(
    "UPDATE outing SET estimated_end_date_time = '2025-09-06T10:00' WHERE id = 'o1'"
  );
});
afterAll(async () => {
  await testDb.cleanup();
});

describe("example queries", () => {
  it.each(EXAMPLE_QUERIES.map((example) => [example.id, example] as const))(
    "%s runs and its chart fits its columns",
    async (_id, example) => {
      expect(ParamDefs.safeParse(example.params).success).toBe(true);
      expect(ChartSpec.safeParse(example.chart).success).toBe(true);
      const result = await testDb.engine().run(
        createRequest({
          sql: example.sql,
          params: { season: 2025 },
          now: "2026-06-20T09:47",
        })
      );
      expect(result.rows.length).toBeGreaterThan(0);
      const columns = result.columns.map((column) => column.name);
      const spec = example.chart;
      const referenced =
        spec.type === "bar" || spec.type === "line" || spec.type === "area"
          ? [spec.x, ...spec.y]
          : spec.type === "pie"
            ? [spec.label, spec.value]
            : spec.type === "heatmap"
              ? [spec.x, spec.y, spec.value]
              : [];
      for (const column of referenced) {
        expect(columns).toContain(column);
      }
    }
  );

  it("has a French title and description for every example", () => {
    const { items, descriptions } = (
      frExplorer as {
        examples: {
          items: Record<string, string>;
          descriptions: Record<string, string>;
        };
      }
    ).examples;
    for (const example of EXAMPLE_QUERIES) {
      expect(items[example.id]).toBeTruthy();
      expect(descriptions[example.id]).toBeTruthy();
    }
  });

  it("teaches more than GROUP BY: a join, HAVING and a date ranking", () => {
    const sql = EXAMPLE_QUERIES.map((example) => example.sql).join("\n");
    expect(sql).toContain("LEFT JOIN");
    expect(sql).toContain("HAVING");
    expect(sql).toContain("return_delay_min > 15");
  });
});
