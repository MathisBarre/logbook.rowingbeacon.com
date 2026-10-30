import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import {
  FIXTURE_BOATS,
  FIXTURE_NOW,
  FIXTURE_OUTINGS,
  FIXTURE_ROWERS,
  FIXTURE_ROUTES,
  insertFixtureClub,
} from "./testing/fixtureClub";
import { Row, runCoverage, runReport } from "./testing/runReport";
import { getReport, getReports } from "./catalog";
import { coverageFromResult } from "./coverage";
import type { ParamValue } from "../types";

/**
 * Exact results of the prebuilt reports on the hand-built fixture club
 * (testing/fixtureClub.ts). Every expected value below was worked out by
 * hand from the fixture, not copied from a run.
 */

let testDb: AnalyticsTestDb;

beforeAll(async () => {
  testDb = await createAnalyticsTestDb();
  await insertFixtureClub(testDb.db, { withDamages: true });
});
afterAll(async () => {
  await testDb.cleanup();
});

const run = async (
  id: string,
  values: Record<string, ParamValue> = {},
  seasonStartMonth = 8
): Promise<Row[]> =>
  (
    await runReport(testDb.engine({ seasonStartMonth }), id, values, {
      now: FIXTURE_NOW,
      seasonStartMonth,
    })
  ).rows;

const pick = (rows: Row[], ...columns: string[]) =>
  rows.map((row) => columns.map((column) => row[column]));

describe("season-overview", () => {
  it("compares the season so far with the same period last season", async () => {
    expect(await run("season-overview", { season: 2025 })).toEqual([
      {
        // 19 outings: S11 (excluded boat) is left out, motorboat outings
        // count (fleet activity).
        outings: 19,
        // 2024-08-01 → 2025-03-15: P01-P05 and P08.
        outings_prev: 6,
        // Ten rowers: motorboat crews, the excluded rower and excluded
        // boat do not count; the guest and the coach do.
        active_rowers: 10,
        active_rowers_prev: 7,
        km: 122,
        km_prev: 37,
        // 970 minutes: multi-day outings, the 00:00 efa2 outing and the
        // ongoing ones are left out.
        hours: 16.2,
        hours_prev: 8,
        // 5 coached out of 14 outings where coaching is known.
        coached_pct: 36,
        coached_pct_prev: 40,
        is_partial: 1,
        cutoff_date: "2026-03-16",
      },
    ]);
  });

  it("compares a finished season with the whole previous one", async () => {
    const [row] = await run("season-overview", { season: 2024 });
    expect(row).toMatchObject({
      outings: 8,
      outings_prev: 0,
      active_rowers: 7,
      active_rowers_prev: 0,
      is_partial: 0,
      cutoff_date: "2025-08-01",
    });
  });

  it.each([
    // August: season 2025 = 2025-08-01 → today.
    [8, 2025, 19],
    // September: S01, S02 and S18 (2 August) belong to season 2024.
    [9, 2025, 16],
    // January: season 2026 = 2026-01-01 → today: S09, S15, S10, S12,
    // S20, S17, S19, S13, S14.
    [1, 2026, 9],
  ])(
    "follows a season starting in month %i",
    async (month, season, outings) => {
      const [row] = await run("season-overview", { season }, month);
      expect(row.outings).toBe(outings);
    }
  );
});

describe("yoy-monthly", () => {
  it("lists the twelve months from the season start, with last season", async () => {
    expect(
      pick(
        await run("yoy-monthly", { season: 2025, metric: "outings" }),
        "month",
        "value",
        "value_prev"
      )
    ).toEqual([
      [8, 3, 1],
      [9, 2, 1],
      [10, 2, 1],
      [11, 1, null],
      [12, 2, null],
      [1, 2, 1],
      [2, 3, null],
      [3, 4, 2],
      [4, null, null],
      [5, null, 1],
      [6, null, 1],
      [7, null, null],
    ]);
  });

  it("starts in September when the season does", async () => {
    const rows = await run(
      "yoy-monthly",
      { season: 2025, metric: "active_rowers" },
      9
    );
    expect(rows.map((row) => row.month)).toEqual([
      9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    // September 2025: S03 (5 rowers) and S04 (2 rowers).
    // September 2024: P02 (Alice).
    expect(rows[0]).toEqual({ month: 9, value: 7, value_prev: 1 });
  });

  it("compares the month in progress up to the same day last season", async () => {
    // On 5 March 2026, March 2025 counts P08 (1 March), not P05 (8 March).
    const { rows } = await runReport(
      testDb.engine(),
      "yoy-monthly",
      { season: 2025, metric: "outings" },
      { now: "2026-03-05T12:00", seasonStartMonth: 8 }
    );
    expect(rows.find((row) => row.month === 3)?.value_prev).toBe(1);
    // Earlier and later months of last season stay whole.
    expect(rows.find((row) => row.month === 6)?.value_prev).toBe(1);
  });
});

describe("yoy-cumulative", () => {
  it("adds outings week after week and stops today", async () => {
    const rows = await run("yoy-cumulative", { season: 2025 });
    expect(rows).toHaveLength(53);
    expect(rows[0]).toEqual({
      week_start: "2025-08-01",
      outings_cumulative: 3,
      outings_cumulative_prev: 1,
    });
    // Today (2026-03-15) is in week 33.
    expect(rows[32].outings_cumulative).toBe(19);
    expect(rows[33].outings_cumulative).toBeNull();
    expect(rows[52].outings_cumulative_prev).toBe(8);
    const current = rows
      .map((row) => row.outings_cumulative)
      .filter((value): value is number => typeof value === "number");
    expect(current).toEqual([...current].sort((a, b) => a - b));
  });
});

describe("boat-usage-ranking", () => {
  it("ranks every active boat, including unused ones", async () => {
    expect(
      pick(
        await run("boat-usage-ranking", { season: 2025 }),
        "boat_name",
        "boat_class",
        "outings",
        "days_used",
        "hours",
        "km",
        "last_outing_date",
        "days_since_last"
      )
    ).toEqual([
      ["Aigle", "1x", 8, 8, 4.5, 66, "2026-03-05", 10],
      ["Bison", "2x", 5, 5, 5.2, 29, "2026-03-15", 0],
      ["Zodiac", null, 3, 3, 4, 3, "2026-03-07", 8],
      ["Castor", "4+", 2, 2, 2, 24, "2026-03-14", 1],
      ["Dauphin", "1x", 1, 1, 0.5, null, "2025-08-02", 225],
    ]);
  });

  it("filters on a boat class", async () => {
    const rows = await run("boat-usage-ranking", {
      season: 2025,
      boat_class: "1x",
    });
    expect(rows.map((row) => row.boat_name)).toEqual(["Aigle", "Dauphin"]);
  });
});

describe("underused-boats", () => {
  it("lists boats used at most N times, next to their class average", async () => {
    // Since 2025-09-16: Aigle 7, Bison 3, Castor 1, Dauphin 0, Zodiac 3.
    expect(await run("underused-boats", { days: 180, max_outings: 1 })).toEqual(
      [
        {
          boat_name: "Dauphin",
          boat_class: "1x",
          build_year: 1998,
          outings_period: 0,
          last_outing_date: "2025-08-02",
          days_since_last: 225,
          class_avg_outings: 3.5,
        },
        {
          boat_name: "Castor",
          boat_class: "4+",
          build_year: 2005,
          outings_period: 1,
          last_outing_date: "2026-03-14",
          days_since_last: 1,
          class_avg_outings: 1,
        },
      ]
    );
  });
});

describe("fleet-by-class", () => {
  it("measures use, concurrency and saturated days per class", async () => {
    expect(
      pick(
        await run("fleet-by-class", { season: 2025 }),
        "boat_class",
        "fleet_size",
        "outings",
        "outings_per_boat",
        "km",
        "max_concurrent",
        "saturated_days"
      )
    ).toEqual([
      // Most saturated first: the class to buy comes first.
      // Faucon is excluded: Bison is the only 2x, saturated each day it
      // went out and came back (not on the ongoing S14).
      ["2x", 1, 5, 5, 29, 1, 4],
      // Aigle and Dauphin were both out on 2 August 2025 at 9:15.
      ["1x", 2, 9, 4.5, 66, 2, 1],
      ["4+", 1, 2, 2, 24, 1, 1],
      // Zodiac, without rigging (a launch), is not part of the fleet.
    ]);
  });
});

describe("fleet-class-monthly and boat-class-week-heatmap", () => {
  it("leave launch outings out and name a boat without rigging", async () => {
    for (const id of ["fleet-class-monthly", "boat-class-week-heatmap"]) {
      const rows = await run(id, { season: 2025 });
      const classes = new Set(rows.map((row) => row.boat_class));
      expect(classes.has("?"), id).toBe(false);
      // Zodiac's two motorboat outings (S10, S19) are left out; its one
      // other outing is counted under "unknown" ("Non renseigné").
      expect(
        rows
          .filter((row) => row.boat_class === "unknown")
          .reduce((total, row) => total + Number(row.outings), 0),
        id
      ).toBe(1);
    }
  });
});

describe("attendance-heatmap", () => {
  // 2025-08-01 (Friday) → 2026-03-15: 33 Fridays, Saturdays and Sundays,
  // 32 of the other weekdays.
  it("averages participations per week by weekday and hour", async () => {
    expect(
      pick(
        await run("attendance-heatmap", {
          season: 2025,
          metric: "participations",
        }),
        "weekday",
        "hour",
        "total",
        "avg_per_week"
      )
    ).toEqual([
      [2, 18, 1, 0],
      [3, 12, 2, 0.1],
      [4, 18, 1, 0],
      // The 00:00 efa2 outing (S09) has no start time.
      [6, 9, 17, 0.5],
      [6, 10, 5, 0.2],
      [6, 22, 1, 0],
      [7, 10, 2, 0.1],
    ]);
  });

  it("can count outings instead", async () => {
    const rows = await run("attendance-heatmap", {
      season: 2025,
      metric: "outings",
    });
    expect(pick(rows, "weekday", "hour", "total")).toEqual([
      [2, 18, 1],
      [3, 12, 1],
      [4, 18, 1],
      [6, 9, 7],
      [6, 10, 3],
      [6, 22, 1],
      [7, 10, 1],
    ]);
  });
});

describe("active-rowers-monthly", () => {
  it("splits active rowers into returning and new ones", async () => {
    expect(
      pick(
        await run("active-rowers-monthly", { season: 2025 }),
        "month",
        "returning_rowers",
        "new_rowers"
      )
    ).toEqual([
      // Chloé is new; Alice, Bruno and Félix rowed last season.
      ["2025-08", 3, 1],
      // David and Hugo are new.
      ["2025-09", 5, 2],
      ["2025-10", 2, 0],
      // Jules (guest) is new.
      ["2025-11", 1, 1],
      ["2025-12", 3, 0],
      ["2026-01", 3, 0],
      // Only Alice's ergometer session: Zodiac is a motorboat, Faucon and
      // Karim are excluded.
      ["2026-02", 1, 0],
      ["2026-03", 7, 0],
    ]);
  });
});

describe("retention-cohorts", () => {
  it("follows each joining season", async () => {
    expect(await run("retention-cohorts")).toEqual([
      // Alice, Bruno, Emma, Félix, Gaëlle and Inès; Léa is a coach
      // ("other"), Karim is excluded.
      {
        cohort: 2024,
        seasons_after: 0,
        cohort_size: 6,
        still_active: 6,
        retention_pct: 100,
      },
      // Inès stopped.
      {
        cohort: 2024,
        seasons_after: 1,
        cohort_size: 6,
        still_active: 5,
        retention_pct: 83,
      },
      // Chloé, David and Hugo.
      {
        cohort: 2025,
        seasons_after: 0,
        cohort_size: 3,
        still_active: 3,
        retention_pct: 100,
      },
    ]);
  });

  it("uses the season start month for cohorts", async () => {
    const rows = await run("retention-cohorts", {}, 1);
    // Calendar years: Alice, Bruno, Emma, Gaëlle and Inès first rowed in
    // 2024 (P01-P03); Chloé, David, Félix and Hugo in 2025.
    expect(
      pick(rows, "cohort", "seasons_after", "cohort_size", "retention_pct")
    ).toEqual([
      [2024, 0, 5, 100],
      [2024, 1, 5, 100],
      [2024, 2, 5, 80],
      [2025, 0, 4, 100],
      [2025, 1, 4, 100],
    ]);
  });
});

describe("new-rower-survival", () => {
  it("measures how long new members keep rowing", async () => {
    // History starts on 2024-08-03: members first seen after 2024-10-02
    // are new (Chloé, David, Emma, Félix, Gaëlle, Hugo, Inès).
    expect(await run("new-rower-survival")).toEqual([
      { months: 1, new_rowers: 7, still_rowing: 7, survival_pct: 100 },
      { months: 2, new_rowers: 7, still_rowing: 7, survival_pct: 100 },
      { months: 3, new_rowers: 7, still_rowing: 7, survival_pct: 100 },
      { months: 6, new_rowers: 7, still_rowing: 7, survival_pct: 100 },
      // Only Emma, Félix, Gaëlle and Inès joined 9 months ago; Inès
      // stopped in June 2025.
      { months: 9, new_rowers: 4, still_rowing: 3, survival_pct: 75 },
      // Félix last rowed in January 2026, 10 months after his start.
      { months: 12, new_rowers: 4, still_rowing: 2, survival_pct: 50 },
    ]);
  });
});

describe("inactive-rowers", () => {
  it("lists regular members who stopped coming", async () => {
    expect(await run("inactive-rowers", { days: 45, min_outings: 5 })).toEqual([
      {
        rower_label: "Inès Garcia",
        age_category: "Senior",
        last_outing_date: "2025-06-14",
        days_since_last: 274,
        outings_year_before: 5,
      },
    ]);
    expect(await run("inactive-rowers", { days: 300, min_outings: 5 })).toEqual(
      []
    );
  });
});

describe("coaching-balance", () => {
  it("ranks members from the least to the most coached", async () => {
    expect(
      pick(
        await run("coaching-balance", { season: 2025, min_outings: 3 }),
        "rower_label",
        "outings",
        "coached_outings",
        "unknown_outings",
        "coached_pct",
        "last_coached_date"
      )
    ).toEqual([
      ["Chloé Durand", 3, 1, 0, 33, "2025-09-06"],
      ["Bruno Petit", 5, 3, 0, 60, "2026-03-14"],
      ["Hugo Michel", 4, 2, 1, 67, "2026-03-14"],
      ["Gaëlle Laurent", 3, 2, 0, 67, "2026-03-14"],
      // The ergometer session has no coaching information.
      ["Alice Martin", 5, 3, 1, 75, "2026-03-14"],
      ["Emma Moreau", 3, 2, 1, 100, "2025-12-10"],
    ]);
  });

  it("filters on an age category", async () => {
    const rows = await run("coaching-balance", {
      season: 2025,
      min_outings: 1,
      age_category: "J12",
    });
    expect(pick(rows, "rower_label", "coached_pct")).toEqual([
      ["David Leroy", 50],
    ]);
  });
});

describe("km-challenge", () => {
  it("ranks kilometers on the water", async () => {
    const rows = await run("km-challenge", { season: 2025 });
    expect(pick(rows.slice(0, 7), "rower_label", "km", "outings")).toEqual([
      ["Bruno Petit", 78, 5],
      // The ergometer session (5 km) does not count.
      ["Alice Martin", 40, 4],
      ["Hugo Michel", 29, 3],
      ["Léa Fournier", 24, 2],
      ["Gaëlle Laurent", 22, 3],
      ["Emma Moreau", 19, 2],
      ["Chloé Durand", 12, 2],
    ]);
    expect(rows.find((row) => row.rower_label === "Bruno Petit")).toEqual({
      rower_label: "Bruno Petit",
      km: 78,
      outings: 5,
      km_per_outing: 15.6,
    });
    expect(rows.map((row) => row.rower_label).sort()).toEqual(
      [
        "Alice Martin",
        "Bruno Petit",
        "Chloé Durand",
        "David Leroy",
        "Emma Moreau",
        "Félix Simon",
        "Gaëlle Laurent",
        "Hugo Michel",
        "Jules Bernard",
        "Léa Fournier",
      ].sort()
    );
  });

  it("filters on gender and age category", async () => {
    const women = await run("km-challenge", {
      season: 2025,
      gender: "female",
    });
    expect(pick(women, "rower_label", "km")).toEqual([
      ["Alice Martin", 40],
      ["Léa Fournier", 24],
      ["Emma Moreau", 19],
      ["Chloé Durand", 12],
    ]);
    const j14 = await run("km-challenge", {
      season: 2025,
      age_category: "J14",
    });
    expect(pick(j14, "rower_label", "km")).toEqual([["Chloé Durand", 12]]);
  });
});

describe("active-members-demographics", () => {
  it("counts active members by age group and gender", async () => {
    expect(await run("active-members-demographics", { season: 2025 })).toEqual([
      // Alice and Emma (no birth date, Senior category).
      {
        age_group: "adult",
        gender: "female",
        active_rowers: 2,
        outings: 8,
        km: 64,
      },
      {
        age_group: "adult",
        gender: "male",
        active_rowers: 2,
        outings: 9,
        km: 107,
      },
      // Gaëlle: gender not recorded.
      {
        age_group: "adult",
        gender: "unknown",
        active_rowers: 1,
        outings: 3,
        km: 22,
      },
      // Félix: neither birth date nor category.
      {
        age_group: "unknown",
        gender: "male",
        active_rowers: 1,
        outings: 2,
        km: 3,
      },
      {
        age_group: "youth",
        gender: "female",
        active_rowers: 1,
        outings: 3,
        km: 12,
      },
      {
        age_group: "youth",
        gender: "male",
        active_rowers: 1,
        outings: 2,
        km: 6,
      },
    ]);
  });
});

describe("rower-frequency and guests", () => {
  it("buckets members by number of outings", async () => {
    expect(
      pick(
        await run("rower-frequency", { season: 2025 }),
        "outings_bucket",
        "rowers"
      )
    ).toEqual([
      ["1", 0],
      ["2–5", 8],
      ["6–10", 0],
      ["11–20", 0],
      ["21–50", 0],
      ["51–100", 0],
      ["101+", 0],
    ]);
  });

  it("measures the guests' share", async () => {
    const rows = await run("guests", { season: 2025 });
    expect(rows.find((row) => row.month === "2025-11")).toEqual({
      month: "2025-11",
      guest_participations: 1,
      distinct_guests: 1,
      guest_share_pct: 50,
    });
    expect(
      rows
        .filter((row) => row.month !== "2025-11")
        .every((row) => row.guest_participations === 0)
    ).toBe(true);
  });
});

describe("routes and outing types", () => {
  it("ranks the routes, without outings that have none", async () => {
    expect(await run("routes-usage", { season: 2025 })).toEqual([
      { route_name: "Boucle courte", outings: 3, km: 18, boats: 2 },
      { route_name: "Grande boucle", outings: 2, km: 24, boats: 1 },
      { route_name: "Balade libre", outings: 1, km: null, boats: 1 },
    ]);
  });

  it("counts outings per type", async () => {
    const rows = await run("outing-types", { season: 2025 });
    expect(
      Object.fromEntries(rows.map((row) => [row.outing_type_code, row.outings]))
    ).toEqual({
      normal: 11,
      training: 3,
      motorboat: 2,
      instruction: 1,
      tour: 1,
      ergometer: 1,
    });
    expect(rows[0]).toEqual({
      outing_type_code: "normal",
      outings: 11,
      km: 41,
      hours: 8.7,
    });
  });
});

describe("safety", () => {
  it("lists one outing per issue code, most serious first", async () => {
    expect(
      pick(
        await run("safety-issues", { season: 2025, tolerance_min: 15 }),
        "issue",
        "start_at",
        "boat_name",
        "return_delay_min"
      )
    ).toEqual([
      ["not_closed", "2026-03-14T09:00", "Castor", null],
      ["youth_not_coached", "2026-03-15T10:00", "Bison", null],
      ["youth_not_coached", "2025-08-02T09:00", "Aigle", 0],
      ["late_return", "2025-12-10T12:00", "Bison", 25],
      ["no_estimated_end", "2026-01-10T00:00", "Aigle", null],
      ["no_estimated_end", "2025-10-07T18:00", "Aigle", null],
    ]);
  });

  it("keeps one kind of issue when asked", async () => {
    const rows = await run("safety-issues", {
      season: 2025,
      tolerance_min: 15,
      issue: "no_estimated_end",
    });
    expect(rows.map((row) => row.start_at)).toEqual([
      "2026-01-10T00:00",
      "2025-10-07T18:00",
    ]);
  });

  it("applies the late tolerance", async () => {
    const rows = await run("safety-issues", {
      season: 2025,
      tolerance_min: 30,
    });
    expect(rows.some((row) => row.issue === "late_return")).toBe(false);
  });

  it("summarises issues per month", async () => {
    expect(
      pick(
        await run("safety-summary", { season: 2025, tolerance_min: 15 }),
        "month",
        "late_returns",
        "no_estimated_end",
        "not_closed"
      )
    ).toEqual([
      ["2025-08", 0, 0, 0],
      ["2025-09", 0, 0, 0],
      ["2025-10", 0, 1, 0],
      ["2025-11", 0, 0, 0],
      ["2025-12", 1, 0, 0],
      ["2026-01", 0, 1, 0],
      ["2026-02", 0, 0, 0],
      ["2026-03", 0, 0, 1],
    ]);
  });
});

describe("equipment", () => {
  it("counts incidents per boat, per 100 outings", async () => {
    expect(await run("incidents-per-boat", { season: 2025 })).toEqual([
      {
        boat_name: "Aigle",
        incidents: 2,
        last_incident_date: "2026-02-21",
        outings: 8,
        incidents_per_100_outings: 25,
      },
      {
        boat_name: "Castor",
        incidents: 1,
        last_incident_date: "2025-09-06",
        outings: 2,
        incidents_per_100_outings: 50,
      },
    ]);
  });

  it("counts damage per boat and severity", async () => {
    expect(await run("damages-per-boat", { season: 2025 })).toEqual([
      {
        boat_name: "Aigle",
        unusable: 1,
        limited: 1,
        usable: 0,
        open_damages: 1,
        avg_days_to_fix: 9,
        repair_cost: 150.5,
      },
      {
        boat_name: "Castor",
        unusable: 0,
        limited: 0,
        usable: 1,
        open_damages: 0,
        avg_days_to_fix: 2,
        repair_cost: 20,
      },
    ]);
  });

  it("follows kilometers per boat this season and in total", async () => {
    const rows = await run("boat-km", { season: 2025 });
    expect(rows.map((row) => row.boat_name)).toEqual([
      "Aigle",
      "Bison",
      "Castor",
      // Excluded from statistics, but it wears out too.
      "Faucon",
      "Zodiac",
      "Dauphin",
    ]);
    expect(rows[0]).toEqual({
      boat_name: "Aigle",
      boat_class: "1x",
      build_year: 2015,
      km_season: 66,
      hours_season: 4.5,
      outings_season: 8,
      km_total: 77,
      hours_total: 7,
      incidents_season: 2,
      incidents_total: 2,
    });
    expect(rows[1]).toMatchObject({
      boat_name: "Bison",
      km_total: 55,
      incidents_season: 0,
      incidents_total: 1,
    });
  });
});

describe("activity-calendar", () => {
  it("has one row per day of the season up to today", async () => {
    const rows = await run("activity-calendar", { season: 2025 });
    // 2025-08-01 → 2026-03-15.
    expect(rows).toHaveLength(227);
    expect(rows[0].date).toBe("2025-08-01");
    expect(rows[rows.length - 1].date).toBe("2026-03-15");
    expect(rows.find((row) => row.date === "2025-08-02")).toEqual({
      date: "2025-08-02",
      participations: 4,
      outings: 3,
    });
    // Motorboat outing only.
    expect(rows.find((row) => row.date === "2026-02-07")).toMatchObject({
      participations: 0,
    });
  });

  it("filters on one boat", async () => {
    const rows = await run("activity-calendar", {
      season: 2025,
      boat_id: "boat-castor",
    });
    expect(
      rows.filter((row) => row.participations !== 0).map((row) => row.date)
    ).toEqual(["2025-09-06", "2026-03-14"]);
  });
});

// ---------------------------------------------------------------------------
// workload-by-category against an independent model of the fixture.

const minutes = (text: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (!match) throw new Error(text);
  const [, y, mo, d, h, mi] = match.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60_000;
};

const boatClass = (boatId: string): string | null => {
  const config = FIXTURE_BOATS.find((boat) => boat.id === boatId)?.config;
  if (!config) return null;
  const rig = config.rigging === "scull" ? "x" : config.coxed ? "" : "-";
  return `${config.seats}${rig}${config.coxed ? "+" : ""}`;
};

const participations = (from: string, to: string) =>
  FIXTURE_OUTINGS.filter(
    (o) =>
      o.start >= from &&
      o.start < to &&
      (o.type ?? "normal") !== "motorboat" &&
      !FIXTURE_BOATS.find((boat) => boat.id === o.boatId)?.excludeFromStats
  ).flatMap((o) => {
    const multiDay =
      o.end !== null && o.end.slice(0, 10) !== o.start.slice(0, 10);
    const duration =
      o.end === null || o.end < o.start
        ? null
        : minutes(o.end) - minutes(o.start);
    const route = FIXTURE_ROUTES.find((r) => r.id === o.routeId);
    const distance = o.distanceM ?? route?.distanceM ?? null;
    return o.crew
      .map((id) => FIXTURE_ROWERS.find((r) => r.id === id))
      .filter((r) => r !== undefined && !r.excludeFromStats)
      .map((r) => ({
        month: o.start.slice(0, 7),
        rowerId: r!.id,
        minutes:
          !multiDay && duration !== null && duration > 0 ? duration : null,
        distance,
        dimensions: Object.fromEntries([
          ["age_category", r!.ageCategory ?? "unknown"],
          ["seriousness", r!.seriousness ?? "unknown"],
          ["gender", r!.gender ?? "unknown"],
          ["rower_status", r!.status],
          ["boat_class", boatClass(o.boatId) ?? "unknown"],
          ["outing_type", o.type ?? "normal"],
        ]),
      }));
  });

const round = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

const expectedWorkload = (dimension: string, measure: string) => {
  const groups = new Map<string, ReturnType<typeof participations>>();
  for (const p of participations("2025-08-01", "2026-08-01")) {
    const key = `${p.month}|${p.dimensions[dimension]}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, items]) => {
      const [month, category] = key.split("|");
      const sum = (values: (number | null)[]) => {
        const known = values.filter((v): v is number => v !== null);
        return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
      };
      let value: number | null;
      if (measure === "hours") {
        const total = sum(items.map((p) => p.minutes));
        value = total === null ? null : round(total / 60, 1);
      } else if (measure === "km") {
        const total = sum(items.map((p) => p.distance));
        value = total === null ? null : round(total / 1000, 0);
      } else if (measure === "rowers") {
        value = new Set(items.map((p) => p.rowerId)).size;
      } else {
        value = items.length;
      }
      return { month, category, value };
    });
};

describe("workload-by-category", () => {
  const dimensions = getReport("workload-by-category")!
    .params.find((param) => param.name === "dimension")!
    .options!.map((option) => option.value);
  const measures = getReport("workload-by-category")!
    .params.find((param) => param.name === "measure")!
    .options!.map((option) => option.value);

  it("has the dimensions and measures of the plan", () => {
    expect(dimensions).toEqual([
      "age_category",
      "seriousness",
      "gender",
      "rower_status",
      "boat_class",
      "outing_type",
    ]);
    expect(measures).toEqual(["participations", "hours", "km", "rowers"]);
  });

  it.each(
    dimensions.flatMap((dimension) =>
      measures.map((measure) => [dimension, measure] as const)
    )
  )("groups by %s and measures %s", async (dimension, measure) => {
    const rows = await run("workload-by-category", {
      season: 2025,
      dimension,
      measure,
    });
    expect(rows).toEqual(expectedWorkload(dimension, measure));
  });

  it("keeps one hand-checked value", async () => {
    const rows = await run("workload-by-category", {
      season: 2025,
      dimension: "age_category",
      measure: "participations",
    });
    // September 2025: S03 (Alice, Bruno, Emma, Hugo, Léa) and S04 (Chloé
    // J14, David J12).
    expect(rows.filter((row) => row.month === "2025-09")).toEqual([
      { month: "2025-09", category: "J12", value: 1 },
      { month: "2025-09", category: "J14", value: 1 },
      { month: "2025-09", category: "Senior", value: 5 },
    ]);
  });
});

describe("coverage checks", () => {
  it.each([
    // Distance known for 13 of the 19 outings.
    ["season-overview", 68],
    // Coaching known for 14 of the 17 rowing outings.
    ["coaching-balance", 82],
    // Gender known for 7 of the 8 active members.
    ["active-members-demographics", 87],
    // Start time known for 16 of the 17 rowing outings.
    ["attendance-heatmap", 94],
  ])("computes the share of known values for %s", async (id, pct) => {
    const result = await runCoverage(testDb.engine(), id, 2025, FIXTURE_NOW);
    expect(result && coverageFromResult(result)).toEqual({ pct });
  });

  it("runs every coverage query", async () => {
    for (const report of getReports().filter((r) => r.coverage)) {
      const result = await runCoverage(
        testDb.engine(),
        report.id,
        2025,
        FIXTURE_NOW
      );
      expect(
        result?.columns.map((c) => c.name),
        report.id
      ).toEqual(["known", "total"]);
    }
  });
});
