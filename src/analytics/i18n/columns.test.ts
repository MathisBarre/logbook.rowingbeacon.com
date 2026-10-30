import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import { analyticsResources } from "./index";
import { VIEW_BLOCKS } from "../schema/views";
import { getReports } from "../reports/catalog";
import { getDictionary } from "../schema/dictionary";
import type { ParamValue, RunQueryRequest } from "../types";

const columnKeys = new Set(Object.keys(analyticsResources["fr-FR"].columns));

const request = (
  sql: string,
  params: Record<string, ParamValue> = {}
): RunQueryRequest => ({
  requestId: "00000000-0000-4000-8000-000000000001",
  sql,
  params,
  maxRows: 1,
  timeoutMs: 10_000,
  privacy: "nominative",
  now: "2026-06-20T09:47",
  useCache: false,
});

let testDb: AnalyticsTestDb;
beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
});
afterAll(async () => {
  await testDb.cleanup();
});

describe("analytics.columns labels", () => {
  it.each(VIEW_BLOCKS.map((block) => block.name))(
    "labels every column of %s",
    async (view) => {
      const result = await testDb
        .engine()
        .run(request(`SELECT * FROM ${view}`));
      for (const column of result.columns) {
        expect(columnKeys.has(column.name), `${view}.${column.name}`).toBe(
          true
        );
      }
    }
  );

  it.each(getReports().map((report) => [report.id, report] as const))(
    "labels every column of the report %s",
    async (_id, report) => {
      const params = Object.fromEntries(
        report.params.map((param) => [
          param.name,
          param.type === "season" ? 2025 : param.default,
        ])
      );
      const result = await testDb.engine().run(request(report.sql, params));
      expect(result.columns.length).toBeGreaterThan(0);
      for (const column of result.columns) {
        expect(columnKeys.has(column.name), `${report.id}.${column.name}`).toBe(
          true
        );
      }
    }
  );

  it("labels every dictionary column in French", () => {
    const missing = getDictionary()
      .objects.flatMap((object) =>
        object.columns.map((column) => `${object.name}.${column.name}`)
      )
      .filter((name) => !columnKeys.has(name.split(".")[1]));
    expect(missing).toEqual([]);
  });
});
