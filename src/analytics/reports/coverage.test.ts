import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import { setEngineForTests } from "../engine/engine";
import { resetQueueForTests } from "../engine/queue";
import { FIXTURE_NOW, insertFixtureClub } from "./testing/fixtureClub";
import { getReport } from "./catalog";
import {
  coverageFromResult,
  coverageMessageKey,
  getCoverage,
  shouldShowCoverage,
} from "./coverage";
import type { QueryResult, SqlValue } from "../types";

const result = (known: SqlValue, total: SqlValue): QueryResult => ({
  columns: [
    { name: "known", declType: null },
    { name: "total", declType: null },
  ],
  rows: [[known, total]],
  truncated: false,
  elapsedMs: 0,
  ignoredColumns: [],
  cached: false,
});

describe("coverageFromResult", () => {
  it("rounds the share down", () => {
    expect(coverageFromResult(result(7, 8))).toEqual({ pct: 87 });
    expect(coverageFromResult(result(999, 1000))).toEqual({ pct: 99 });
    expect(coverageFromResult(result(5, 5))).toEqual({ pct: 100 });
    expect(coverageFromResult(result(null, 4))).toEqual({ pct: 0 });
  });

  it("is null without data or with an unexpected result", () => {
    expect(coverageFromResult(result(0, 0))).toBeNull();
    expect(coverageFromResult(result(null, null))).toBeNull();
    expect(coverageFromResult({ columns: [], rows: [] })).toBeNull();
  });

  it("shows the hint below 90 %", () => {
    expect(shouldShowCoverage({ pct: 89 })).toBe(true);
    expect(shouldShowCoverage({ pct: 90 })).toBe(false);
    expect(shouldShowCoverage(null)).toBe(false);
  });

  it("gives the message key of the column", () => {
    expect(coverageMessageKey(getReport("active-members-demographics")!)).toBe(
      "analytics.reports.coverage.gender"
    );
    expect(coverageMessageKey(getReport("guests")!)).toBeNull();
  });
});

describe("getCoverage", () => {
  let testDb: AnalyticsTestDb;
  beforeAll(async () => {
    testDb = await createAnalyticsTestDb();
    await insertFixtureClub(testDb.db);
  });
  afterEach(() => {
    setEngineForTests(null);
    resetQueueForTests();
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  it("runs the coverage query through the queue for the season", async () => {
    const engine = testDb.engine();
    setEngineForTests(engine);
    await expect(
      getCoverage(getReport("km-challenge")!, 2025, { now: FIXTURE_NOW })
    ).resolves.toEqual({ pct: 75 });
    expect(engine.calls[0].params).toEqual({ season: 2025 });
    expect(engine.calls[0].maxRows).toBe(1);
    // No outing in 2019.
    await expect(
      getCoverage(getReport("km-challenge")!, 2019, { now: FIXTURE_NOW })
    ).resolves.toBeNull();
  });

  it("does not query for a report without coverage check", async () => {
    const engine = testDb.engine();
    setEngineForTests(engine);
    await expect(getCoverage(getReport("guests")!, 2025)).resolves.toBeNull();
    expect(engine.calls).toHaveLength(0);
  });
});
