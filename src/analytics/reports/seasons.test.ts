import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import { seedAnalyticsClub, SeedSummary } from "./testing/seedAnalyticsClub";
import { Row, runReport } from "./testing/runReport";
import { getReports } from "./catalog";
import { currentSeason } from "../params/season";
import type { ParamValue } from "../types";

/**
 * Every report on a realistic seeded club (testing/seedAnalyticsClub.ts),
 * with seasons starting in January, August and September: no error, and
 * results that agree with each other (the same outings counted by
 * different reports give the same totals).
 */

const NOW = "2026-06-20T09:47";

let testDb: AnalyticsTestDb;
let summary: SeedSummary;

beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
  summary = seedAnalyticsClub(testDb.path, { outingsPerDay: 4, now: NOW });
}, 60_000);
afterAll(async () => {
  await testDb.cleanup();
});

const sum = (rows: Row[], column: string) =>
  rows.reduce((total, row) => total + Number(row[column] ?? 0), 0);

it("seeds a club with three seasons of outings", () => {
  expect(summary.outings).toBeGreaterThan(2500);
  expect(summary.crew).toBeGreaterThan(summary.outings);
});

describe.each([1, 8, 9])("season starting in month %i", (month) => {
  const current = currentSeason(NOW, month);
  const past = current - 1;

  const run = async (
    id: string,
    values: Record<string, ParamValue> = {}
  ): Promise<Row[]> =>
    (
      await runReport(testDb.engine({ seasonStartMonth: month }), id, values, {
        now: NOW,
        seasonStartMonth: month,
      })
    ).rows;

  it.each(getReports().map((report) => report.id))(
    "runs %s on the current and the previous season",
    async (id) => {
      const current = await run(id);
      const previous = await run(id, { season: past });
      // Every report has data on this club, except the two lists that
      // may legitimately be empty (every boat is used, nobody left).
      if (id !== "inactive-rowers" && id !== "underused-boats") {
        expect(current.length + previous.length, id).toBeGreaterThan(0);
      }
    }
  );

  it("counts the same outings in every outing report", async () => {
    const [overview] = await run("season-overview", { season: past });
    const outings = overview.outings as number;
    expect(outings).toBeGreaterThan(0);
    expect(overview.is_partial).toBe(0);
    expect(
      sum(
        await run("yoy-monthly", { season: past, metric: "outings" }),
        "value"
      )
    ).toBe(outings);
    const types = await run("outing-types", { season: past });
    expect(sum(types, "outings")).toBe(outings);
    // The fleet reports count rowing boats only: no launch outings.
    const motorboat = Number(
      types.find((row) => row.outing_type_code === "motorboat")?.outings ?? 0
    );
    expect(motorboat).toBeGreaterThan(0);
    expect(
      sum(await run("fleet-class-monthly", { season: past }), "outings")
    ).toBe(outings - motorboat);
    expect(
      sum(await run("boat-class-week-heatmap", { season: past }), "outings")
    ).toBe(outings - motorboat);
    const cumulative = await run("yoy-cumulative", { season: past });
    expect(cumulative).toHaveLength(53);
    expect(cumulative[52].outings_cumulative).toBe(outings);
    const values = cumulative.map((row) => Number(row.outings_cumulative));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    // A finished season is compared with the whole previous season.
    const [before] = await run("season-overview", { season: past - 1 });
    expect(overview.outings_prev).toBe(before.outings);
    expect(
      sum(
        await run("yoy-monthly", { season: past, metric: "outings" }),
        "value_prev"
      )
    ).toBe(before.outings);
  });

  it("counts the same participations and rowers everywhere", async () => {
    const [overview] = await run("season-overview", { season: past });
    const perRower = await run("outings-per-rower", { season: past });
    expect(perRower).toHaveLength(overview.active_rowers as number);
    const participations = sum(perRower, "outings");
    expect(
      sum(
        await run("yoy-monthly", { season: past, metric: "participations" }),
        "value"
      )
    ).toBe(participations);
    expect(
      sum(await run("activity-calendar", { season: past }), "participations")
    ).toBe(participations);
    for (const dimension of ["age_category", "gender", "boat_class"]) {
      expect(
        sum(
          await run("workload-by-category", {
            season: past,
            dimension,
            measure: "participations",
          }),
          "value"
        ),
        dimension
      ).toBe(participations);
    }
    const members = perRower.filter((row) => row.rower_status === "member");
    expect(sum(await run("rower-frequency", { season: past }), "rowers")).toBe(
      members.length
    );
    expect(
      sum(
        await run("active-members-demographics", { season: past }),
        "active_rowers"
      )
    ).toBe(members.length);
  });

  it("counts the same active rowers per month", async () => {
    const monthly = await run("active-rowers-monthly", { season: past });
    const byStatus = await run("workload-by-category", {
      season: past,
      dimension: "rower_status",
      measure: "rowers",
    });
    const yoy = await run("yoy-monthly", {
      season: past,
      metric: "active_rowers",
    });
    expect(monthly.length).toBeGreaterThan(0);
    for (const row of monthly) {
      const active = Number(row.returning_rowers) + Number(row.new_rowers);
      expect(
        sum(
          byStatus.filter((other) => other.month === row.month),
          "value"
        ),
        String(row.month)
      ).toBe(active);
      const monthNumber = Number(String(row.month).slice(5, 7));
      expect(
        yoy.find((other) => other.month === monthNumber)?.value,
        String(row.month)
      ).toBe(active);
    }
  });

  it("gives a calendar day for every day of a finished season", async () => {
    const rows = await run("activity-calendar", { season: past });
    expect([365, 366]).toContain(rows.length);
    const current = await run("activity-calendar");
    expect(current[current.length - 1].date).toBe(NOW.slice(0, 10));
  });

  it("keeps rates, ranks and filters within bounds", async () => {
    const heat = await run("attendance-heatmap", { season: past });
    expect(heat.length).toBeGreaterThan(0);
    for (const row of heat) {
      expect(row.weekday).toBeGreaterThanOrEqual(1);
      expect(row.weekday).toBeLessThanOrEqual(7);
      expect(row.hour).toBeGreaterThanOrEqual(0);
      expect(row.hour).toBeLessThanOrEqual(23);
      expect(Number(row.avg_per_week)).toBeGreaterThan(0);
    }

    const cohorts = await run("retention-cohorts");
    expect(cohorts.length).toBeGreaterThan(0);
    for (const row of cohorts) {
      if (row.seasons_after === 0) expect(row.retention_pct).toBe(100);
      expect(Number(row.retention_pct)).toBeLessThanOrEqual(100);
      expect(Number(row.still_active)).toBeLessThanOrEqual(
        Number(row.cohort_size)
      );
    }

    const survival = await run("new-rower-survival");
    expect(survival.length).toBeGreaterThan(0);
    for (const row of survival) {
      expect([1, 2, 3, 6, 9, 12, 18, 24]).toContain(row.months);
      expect(Number(row.survival_pct)).toBeGreaterThanOrEqual(0);
      expect(Number(row.survival_pct)).toBeLessThanOrEqual(100);
    }

    const ranking = await run("boat-usage-ranking", { season: past });
    const outings = ranking.map((row) => Number(row.outings));
    expect(outings).toEqual([...outings].sort((a, b) => b - a));

    const underused = await run("underused-boats", {
      days: 90,
      max_outings: 3,
    });
    for (const row of underused) {
      expect(Number(row.outings_period)).toBeLessThanOrEqual(3);
    }

    const km = await run("km-challenge", { season: past });
    expect(km.length).toBeGreaterThan(0);
    expect(km.length).toBeLessThanOrEqual(100);
    const kms = km.map((row) => Number(row.km));
    expect(kms).toEqual([...kms].sort((a, b) => b - a));

    const fleet = await run("fleet-by-class", { season: past });
    for (const row of fleet) {
      expect(Number(row.saturated_days)).toBeGreaterThanOrEqual(0);
      expect(Number(row.outings_per_boat)).toBeCloseTo(
        Number(row.outings) / Number(row.fleet_size),
        1
      );
    }

    const incidents = await run("incidents-per-boat", { season: past });
    expect(incidents.length).toBeGreaterThan(0);
    for (const row of incidents) {
      expect(Number(row.incidents_per_100_outings)).toBeCloseTo(
        (100 * Number(row.incidents)) / Number(row.outings),
        1
      );
    }

    const guests = await run("guests", { season: past });
    for (const row of guests) {
      expect(Number(row.guest_share_pct)).toBeGreaterThanOrEqual(0);
      expect(Number(row.guest_share_pct)).toBeLessThanOrEqual(100);
    }

    const inactive = await run("inactive-rowers", {
      days: 45,
      min_outings: 2,
    });
    for (const row of inactive) {
      expect(Number(row.days_since_last)).toBeGreaterThanOrEqual(45);
      expect(Number(row.outings_year_before)).toBeGreaterThanOrEqual(2);
    }
  });

  it("agrees between the safety list and the monthly summary", async () => {
    const issues = await run("safety-issues", {
      season: past,
      tolerance_min: 15,
    });
    const monthly = await run("safety-summary", {
      season: past,
      tolerance_min: 15,
    });
    const count = (issue: string) =>
      issues.filter((row) => row.issue === issue).length;
    if (issues.length < 1000) {
      // not_closed and late_return are exclusive and checked first.
      expect(count("not_closed")).toBe(sum(monthly, "not_closed"));
      expect(count("late_return")).toBe(sum(monthly, "late_returns"));
      expect(count("no_estimated_end")).toBeLessThanOrEqual(
        sum(monthly, "no_estimated_end")
      );
    }
    expect(sum(monthly, "late_returns")).toBeGreaterThan(0);
  });
});

describe("empty club", () => {
  let empty: AnalyticsTestDb;
  beforeAll(async () => {
    empty = await createAnalyticsTestDb();
  });
  afterAll(async () => {
    await empty.cleanup();
  });

  /** Columns that label rows (months, days, buckets) rather than measure. */
  const LABELS = new Set([
    "month",
    "week_start",
    "date",
    "outings_bucket",
    "months",
    "cutoff_date",
    "is_partial",
  ]);

  it.each(getReports().map((report) => report.id))(
    "runs %s without data and shows nothing but zeros",
    async (id) => {
      for (const month of [1, 8, 9]) {
        const { rows } = await runReport(
          empty.engine({ seasonStartMonth: month }),
          id,
          {},
          { now: NOW, seasonStartMonth: month }
        );
        for (const row of rows) {
          for (const [column, value] of Object.entries(row)) {
            if (!LABELS.has(column)) {
              expect(
                value === null || value === 0,
                `${id}.${column} = ${String(value)}`
              ).toBe(true);
            }
          }
        }
      }
    }
  );
});
