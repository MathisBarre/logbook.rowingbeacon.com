import { describe, expect, it } from "vitest";
import {
  chartFitsResult,
  fittingChartTypes,
  referencedColumns,
} from "./chartFits";
import type { ResultColumn } from "../types";

const cols = (...names: string[]): ResultColumn[] =>
  names.map((name) => ({ name, declType: null }));

describe("chartFitsResult", () => {
  it("accepts a spec whose columns all exist", () => {
    expect(
      chartFitsResult(
        {
          type: "bar",
          x: "month",
          y: ["outings"],
          series: "boat_class",
          orientation: "vertical",
          stacked: true,
          sort: "none",
        },
        cols("month", "boat_class", "outings")
      )
    ).toBe(true);
    expect(chartFitsResult({ type: "table" }, cols())).toBe(true);
  });

  it("rejects a spec that references a missing column", () => {
    expect(
      chartFitsResult({ type: "pie", label: "name", value: "n" }, cols("name"))
    ).toBe(false);
    expect(
      chartFitsResult(
        { type: "kpi", items: [{ value: "a", compare: "a_prev" }] },
        cols("a")
      )
    ).toBe(false);
    expect(
      chartFitsResult({ type: "table", columns: ["a", "b"] }, cols("a"))
    ).toBe(false);
    expect(
      chartFitsResult(
        { type: "calendar", date: "date", value: "v" },
        cols("day", "v")
      )
    ).toBe(false);
    expect(
      chartFitsResult(
        { type: "heatmap", x: "x", y: "y", value: "v" },
        cols("x", "v")
      )
    ).toBe(false);
  });

  it("lists referenced columns", () => {
    expect(
      referencedColumns({
        type: "line",
        x: "w",
        y: ["a", "b"],
        cumulative: false,
      })
    ).toEqual(["w", "a", "b"]);
  });
});

describe("fittingChartTypes", () => {
  it("offers only the table without numbers", () => {
    expect(fittingChartTypes(cols("a", "b"), [["x", "y"]])).toEqual(["table"]);
  });

  it("offers the calendar only with a date column", () => {
    const withDate = fittingChartTypes(cols("date", "n"), [["2025-08-01", 3]]);
    expect(withDate).toContain("calendar");
    const without = fittingChartTypes(cols("name", "n"), [["a", 3]]);
    expect(without).not.toContain("calendar");
    expect(without).not.toContain("heatmap");
    expect(fittingChartTypes(cols("a", "b", "n"), [["x", "y", 1]])).toContain(
      "heatmap"
    );
  });
});
