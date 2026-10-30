import { describe, expect, it } from "vitest";
import { ParamDef } from "../chartSpec";
import {
  guessParamType,
  paramDefsFromSql,
  resolveParams,
} from "./resolveParams";

const ctx = { now: "2026-06-20T09:47", seasonStartMonth: 8 };
const defs = ParamDef.array().parse([
  { name: "season", type: "season", required: true, default: "current" },
  { name: "boat_class", type: "boat_class" },
  { name: "days", type: "integer", default: 60, min: 7, max: 730 },
  {
    name: "metric",
    type: "choice",
    required: true,
    default: "outings",
    options: [{ value: "outings" }, { value: "km" }],
  },
  { name: "only_members", type: "boolean", default: true },
  { name: "start_date", type: "date" },
]);

describe("resolveParams", () => {
  it("applies defaults and resolves the current season", () => {
    expect(resolveParams(defs, {}, ctx)).toEqual({
      values: {
        season: 2025,
        boat_class: null,
        days: 60,
        metric: "outings",
        only_members: 1,
        start_date: null,
      },
      errors: [],
    });
  });

  it("binds given values", () => {
    const { values, errors } = resolveParams(
      defs,
      {
        season: 2023,
        boat_class: "4x+",
        days: "90",
        metric: "km",
        only_members: false,
        start_date: "2025-09-01",
        unknown: "dropped",
      },
      ctx
    );
    expect(errors).toEqual([]);
    expect(values).toEqual({
      season: 2023,
      boat_class: "4x+",
      days: 90,
      metric: "km",
      only_members: 0,
      start_date: "2025-09-01",
    });
  });

  it("falls back to the default on invalid values and reports them", () => {
    const { values, errors } = resolveParams(
      defs,
      { season: "x", days: 3, metric: "hours", start_date: "01/09/2025" },
      ctx
    );
    expect(values).toMatchObject({
      season: 2025,
      days: 60,
      metric: "outings",
      start_date: null,
    });
    expect(errors).toEqual([
      { name: "season", code: "invalid" },
      { name: "days", code: "range", min: 7, max: 730 },
      { name: "metric", code: "invalid" },
      { name: "start_date", code: "invalid" },
    ]);
  });

  it("reports an empty required value", () => {
    const { values, errors } = resolveParams(defs, { metric: "" }, ctx);
    expect(values.metric).toBeNull();
    expect(errors).toEqual([{ name: "metric", code: "required" }]);
  });

  it("uses the season start month", () => {
    expect(
      resolveParams(
        defs.slice(0, 1),
        {},
        { now: "2026-08-20T09:00", seasonStartMonth: 9 }
      ).values.season
    ).toBe(2025);
    expect(
      resolveParams(
        defs.slice(0, 1),
        {},
        { now: "2026-08-20T09:00", seasonStartMonth: 8 }
      ).values.season
    ).toBe(2026);
  });
});

describe("guessParamType and paramDefsFromSql", () => {
  it.each([
    ["season", "season"],
    ["boat_id", "boat"],
    ["rower_id", "rower"],
    ["route_id", "route"],
    ["start_date", "date"],
    ["depuis", "date"],
    ["until", "date"],
    ["date_debut", "date"],
    ["nb_sorties", "integer"],
    ["top", "integer"],
    ["days", "integer"],
    ["limit", "integer"],
    ["min_outings", "integer"],
    ["boat_class", "boat_class"],
    ["label", "text"],
  ])("%s → %s", (name, type) => {
    expect(guessParamType(name)).toBe(type);
  });

  it("keeps existing definitions and guesses new ones in SQL order", () => {
    const existing = ParamDef.array().parse([
      { name: "days", type: "integer", default: 30 },
    ]);
    expect(
      paramDefsFromSql(
        "SELECT * FROM v_outings WHERE season = :season AND boat_id = :boat_id -- :ignored\n AND x < :days AND y = ':no'",
        existing
      )
    ).toEqual([
      { name: "season", type: "season", required: true, default: "current" },
      { name: "boat_id", type: "boat", required: false, default: null },
      { name: "days", type: "integer", required: false, default: 30 },
    ]);
  });
});
