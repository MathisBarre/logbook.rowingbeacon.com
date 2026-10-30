import { describe, expect, it } from "vitest";
import { canSeeReport, dashboardAudience, queryVisibility } from "./canSee";

describe("canSeeReport", () => {
  it.each([
    ["public", false, false, true],
    ["nominative", false, false, false],
    ["nominative", false, true, true],
    ["nominative", true, false, true],
    ["admin", false, true, false],
    ["admin", true, false, true],
  ] as const)(
    "%s report, unlocked %s, public rankings %s → %s",
    (visibility, isUnlocked, publicRankings, expected) => {
      expect(canSeeReport({ visibility }, { isUnlocked, publicRankings })).toBe(
        expected
      );
    }
  );
});

describe("queryVisibility", () => {
  const ranking = {
    id: "outings-per-rower",
    sql: "SELECT display_name, COUNT(*) AS n\nFROM v_outings GROUP BY 1",
    visibility: "nominative" as const,
  };
  const overview = {
    id: "season-overview",
    sql: "SELECT 1",
    visibility: "public" as const,
  };

  it("keeps the visibility of the report it was saved from, SQL unchanged", () => {
    expect(
      queryVisibility(
        {
          sql: "SELECT display_name, COUNT(*) AS n FROM v_outings GROUP BY 1",
          basedOnReportId: ranking.id,
        },
        ranking
      )
    ).toBe("nominative");
    expect(
      queryVisibility(
        { sql: "  SELECT 1 ", basedOnReportId: overview.id },
        overview
      )
    ).toBe("public");
  });

  it("is for officials once the SQL was edited", () => {
    expect(
      queryVisibility(
        {
          sql: "SELECT 1, (SELECT display_name FROM v_rowers)",
          basedOnReportId: overview.id,
        },
        overview
      )
    ).toBe("admin");
  });

  it("is for officials for Explorer, AI and Claude queries, or a removed report", () => {
    expect(
      queryVisibility({ sql: "SELECT 1", basedOnReportId: null }, null)
    ).toBe("admin");
    expect(
      queryVisibility({ sql: "SELECT 1", basedOnReportId: "gone" }, undefined)
    ).toBe("admin");
    // A report given for another id does not count.
    expect(
      queryVisibility({ sql: "SELECT 1", basedOnReportId: "other" }, overview)
    ).toBe("admin");
  });
});

describe("dashboardAudience", () => {
  it.each([
    ["public", false, "everyone"],
    ["nominative", false, "officials"],
    ["nominative", true, "everyone"],
    ["admin", true, "officials"],
  ] as const)(
    "%s, public rankings %s → %s",
    (visibility, rankings, expected) => {
      expect(dashboardAudience(visibility, rankings)).toBe(expected);
    }
  );
});
