import { describe, expect, it } from "vitest";
import {
  ChartSpec,
  ParamDef,
  parseChartSpec,
  parseParamDefs,
} from "./chartSpec";
import appendixC from "./testing/appendixC.specs.json";

const reports = Object.entries(
  appendixC as Record<string, { chart: unknown; params: unknown }>
);

describe("ChartSpec", () => {
  it("covers the 29 prebuilt reports of appendix C", () => {
    expect(reports).toHaveLength(29);
  });

  it.each(reports)("parses the chart and params of %s", (_id, report) => {
    expect(ChartSpec.safeParse(report.chart).error).toBeUndefined();
    expect(ParamDef.array().safeParse(report.params).error).toBeUndefined();
  });

  it("applies defaults", () => {
    expect(parseChartSpec({ type: "bar", x: "month", y: ["outings"] })).toEqual(
      {
        type: "bar",
        x: "month",
        y: ["outings"],
        orientation: "vertical",
        stacked: false,
        sort: "none",
      }
    );
    expect(parseChartSpec('{"type":"line","x":"week","y":["n"]}')).toEqual({
      type: "line",
      x: "week",
      y: ["n"],
      cumulative: false,
    });
    expect(parseParamDefs('[{"name":"season","type":"season"}]')).toEqual([
      { name: "season", type: "season", required: false, default: null },
    ]);
  });

  it.each([
    ["unknown type", { type: "radar", x: "a", y: ["b"] }],
    [
      "9 y columns",
      { type: "bar", x: "a", y: ["b", "c", "d", "e", "f", "g", "h", "i", "j"] },
    ],
    ["series with 2 y", { type: "bar", x: "a", y: ["b", "c"], series: "s" }],
    [
      "line series with 2 y",
      { type: "line", x: "a", y: ["b", "c"], series: "s" },
    ],
    ["bad column name", { type: "pie", label: "a b", value: "c" }],
    ["column injection", { type: "table", columns: ["a; DROP TABLE x"] }],
    ["empty kpi", { type: "kpi", items: [] }],
    ["bar limit 0", { type: "bar", x: "a", y: ["b"], limit: 0 }],
    [
      "label key outside analytics",
      { type: "table", labelKeys: { a: "admin.password" } },
    ],
  ])("rejects %s", (_label, spec) => {
    expect(ChartSpec.safeParse(spec).success).toBe(false);
    expect(parseChartSpec(spec)).toBeNull();
  });

  it("returns null for invalid JSON text", () => {
    expect(parseChartSpec("{")).toBeNull();
    expect(parseParamDefs("not json")).toBeNull();
  });
});

describe("ParamDef", () => {
  it.each([
    { name: "Season", type: "season" },
    { name: "1x", type: "integer" },
    { name: "season", type: "year" },
    { name: "a", type: "text", labelKey: "analytics.columns.a" },
  ])("rejects %o", (def) => {
    expect(ParamDef.safeParse(def).success).toBe(false);
  });
});
