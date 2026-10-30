import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import { seedAnalyticsClub } from "./testing/seedAnalyticsClub";
import { runReport } from "./testing/runReport";
import { getReports } from "./catalog";

/**
 * Performance budget of the prebuilt reports (plan 2.14) on a club of
 * about 100,000 outings: light and medium reports under 1.5 s, heavy ones
 * (whole history) under 6 s. A boat cannot be out twice at once, so the
 * club gets more outings from more seasons rather than more per day. Slow to seed, so it only runs with
 * ANALYTICS_PERF=1:
 *
 *   ANALYTICS_PERF=1 pnpm exec vitest --run src/analytics/reports/perf.test.ts
 */

const NOW = "2026-06-20T09:47";
const enabled = process.env.ANALYTICS_PERF === "1";
const LIMIT_MS = { light: 1500, medium: 1500, heavy: 6000 } as const;

describe.runIf(enabled)("report performance on 100k outings", () => {
  let testDb: AnalyticsTestDb;

  beforeAll(async () => {
    testDb = await createAnalyticsTestDb();
    const summary = seedAnalyticsClub(testDb.path, {
      // Six seasons: a long efa2 history, about 115k outings.
      outingsPerDay: 250,
      from: "2020-08-01",
      now: NOW,
    });
    console.info(
      `perf club: ${summary.outings} outings, ${summary.crew} crew rows`
    );
  }, 600_000);
  afterAll(async () => {
    await testDb?.cleanup();
  });

  it.each(getReports().map((report) => [report.id, report.cost] as const))(
    "%s (%s) stays within budget",
    async (id, cost) => {
      const engine = testDb.engine();
      const started = performance.now();
      const { rows } = await runReport(engine, id, {}, { now: NOW });
      const elapsed = performance.now() - started;
      console.info(`${id}: ${rows.length} rows in ${Math.round(elapsed)} ms`);
      expect(elapsed).toBeLessThan(LIMIT_MS[cost]);
    },
    30_000
  );
});
