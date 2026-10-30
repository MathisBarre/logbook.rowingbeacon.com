import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsTestDb,
  createAnalyticsTestDb,
} from "../testing/analyticsTestDb";
import { getReportAvailability } from "./availability";
import { getReport, getReports } from "./catalog";
import { getAnnualReportSections } from "./annual";
import { MODULE_IDS } from "../../_common/business/modules.rules";
import type { EngineObjects } from "../types";

const ALL_MODULES = [...MODULE_IDS];

let withDamages: EngineObjects;
let withoutDamages: EngineObjects;
const dbs: AnalyticsTestDb[] = [];

beforeAll(async () => {
  const a = await createAnalyticsTestDb();
  const b = await createAnalyticsTestDb({ withoutDamages: true });
  dbs.push(a, b);
  withDamages = await a.engine().objects();
  withoutDamages = await b.engine().objects();
});
afterAll(async () => {
  for (const db of dbs) await db.cleanup();
});

const availableIds = (objects: EngineObjects, modules: string[]) =>
  getReports()
    .filter(
      (report) =>
        getReportAvailability(report, { objects, enabledModules: modules })
          .available
    )
    .map((report) => report.id);

describe("getReportAvailability", () => {
  it("offers every core report on a club without modules", () => {
    const ids = availableIds(withoutDamages, []);
    expect(ids).toHaveLength(25);
    for (const id of [
      "km-challenge",
      "outing-types",
      "guests",
      "damages-per-boat",
    ]) {
      expect(ids).not.toContain(id);
    }
  });

  it("names the module to turn on", () => {
    expect(
      getReportAvailability(getReport("km-challenge")!, {
        objects: withoutDamages,
        enabledModules: [],
      })
    ).toEqual({ available: false, reason: "module", module: "distances" });
    expect(
      getReportAvailability(getReport("km-challenge")!, {
        objects: withoutDamages,
        enabledModules: ["distances"],
      })
    ).toEqual({ available: true });
  });

  it("offers the damages report once the damages module is on", () => {
    expect(
      getReportAvailability(getReport("damages-per-boat")!, {
        objects: withDamages,
        enabledModules: ALL_MODULES.filter((module) => module !== "damages"),
      })
    ).toEqual({ available: false, reason: "module", module: "damages" });
    expect(
      getReportAvailability(getReport("damages-per-boat")!, {
        objects: withDamages,
        enabledModules: ALL_MODULES,
      })
    ).toEqual({ available: true });
    expect(availableIds(withDamages, ALL_MODULES)).toHaveLength(29);
  });

  it("explains a module id this version does not know", () => {
    expect(
      getReportAvailability(
        { requires: { modules: ["weather"], tables: [] } },
        { objects: withDamages, enabledModules: [...ALL_MODULES, "weather"] }
      )
    ).toEqual({ available: false, reason: "module", module: "weather" });
  });

  it("names a missing table", () => {
    expect(withoutDamages.tables).not.toContain("boat_damage");
    expect(withDamages.tables).toContain("boat_damage");
    expect(
      getReportAvailability(
        { requires: { tables: ["outing", "boat_damage"] } },
        { objects: withoutDamages, enabledModules: [] }
      )
    ).toEqual({ available: false, reason: "table", table: "boat_damage" });
  });

  it("finds every table the catalogue needs in a migrated database", () => {
    for (const report of getReports()) {
      for (const table of report.requires.tables) {
        if (table !== "boat_damage") {
          expect(withoutDamages.tables, `${report.id} ${table}`).toContain(
            table
          );
        }
      }
    }
  });
});

describe("getAnnualReportSections", () => {
  it("drops the sections whose module is off and sets the season", () => {
    const sections = getAnnualReportSections(2025, {
      objects: withoutDamages,
      enabledModules: [],
    });
    expect(sections.map((s) => s.section.reportId)).toEqual([
      "season-overview",
      "yoy-monthly",
      "yoy-monthly",
      "active-members-demographics",
      "fleet-by-class",
      "boat-usage-ranking",
      "routes-usage",
      "incidents-per-boat",
      "retention-cohorts",
      "safety-summary",
    ]);
    expect(sections[1].paramValues).toEqual({
      season: 2025,
      metric: "outings",
    });
    expect(sections[2].paramValues).toEqual({
      season: 2025,
      metric: "active_rowers",
    });
    // Retention covers the whole history: no season parameter.
    expect(
      sections.find((s) => s.section.reportId === "retention-cohorts")
        ?.paramValues
    ).toEqual({});
  });

  it("adds outing types when the module is on", () => {
    const ids = getAnnualReportSections(2025, {
      objects: withDamages,
      enabledModules: ALL_MODULES,
    }).map((s) => s.section.reportId);
    expect(ids).toContain("outing-types");
    expect(ids).toContain("damages-per-boat");
  });
});
