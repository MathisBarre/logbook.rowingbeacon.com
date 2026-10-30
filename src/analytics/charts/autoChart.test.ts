import { describe, expect, it } from "vitest";
import { autoChart } from "./autoChart";
import type { ResultColumn, SqlValue } from "../types";
import { ChartSpec } from "../chartSpec";

const cols = (...names: string[]): ResultColumn[] =>
  names.map((name) => ({ name, declType: null }));
const valid = (spec: ChartSpec) =>
  expect(ChartSpec.safeParse(spec).success).toBe(true);

describe("autoChart", () => {
  it("falls back to the table without rows or numbers", () => {
    expect(autoChart(cols("a"), [])).toEqual({ type: "table" });
    expect(autoChart(cols("name", "email"), [["a", "b"]])).toEqual({
      type: "table",
    });
  });

  it("makes KPI tiles of one row of numbers and pairs _prev columns", () => {
    const spec = autoChart(cols("outings", "outings_prev", "km"), [
      [10, 8, 3.5],
    ]);
    valid(spec);
    expect(spec).toEqual({
      type: "kpi",
      items: [{ value: "outings", compare: "outings_prev" }, { value: "km" }],
    });
  });

  it("draws bars by category, horizontal when there are many", () => {
    const few = autoChart(cols("boat_class", "outings"), [
      ["1x", 3],
      ["2x", 4],
    ]);
    valid(few);
    expect(few).toMatchObject({
      type: "bar",
      x: "boat_class",
      y: ["outings"],
      orientation: "vertical",
    });
    const rows: SqlValue[][] = Array.from({ length: 40 }, (_, i) => [
      `Bateau ${i}`,
      i,
    ]);
    const many = autoChart(cols("boat_name", "outings"), rows);
    valid(many);
    expect(many).toMatchObject({
      type: "bar",
      orientation: "horizontal",
      limit: 30,
    });
  });

  it("lays 7 named categories out horizontally, weekdays vertically", () => {
    const names = [
      "Albatros",
      "Bréhat",
      "Mistral",
      "Zéphyr",
      "Alizé",
      "Isère",
      "Saône",
    ];
    const boats = autoChart(
      cols("boat_name", "outings"),
      names.map((name, i) => [name, i + 1])
    );
    expect(boats).toMatchObject({ type: "bar", orientation: "horizontal" });
    const days = autoChart(
      cols("weekday", "outings"),
      [1, 2, 3, 4, 5, 6, 7].map((d) => [d, d])
    );
    expect(days).toMatchObject({ type: "bar", orientation: "vertical" });
  });

  it("draws a line over dates, months and seasons", () => {
    const spec = autoChart(cols("week_start", "outings", "km"), [
      ["2025-08-04", 3, 10],
      ["2025-08-11", 4, 12],
      ["2025-08-18", 5, 9],
    ]);
    valid(spec);
    expect(spec).toEqual({
      type: "line",
      x: "week_start",
      y: ["outings", "km"],
      cumulative: false,
    });
    const months = autoChart(cols("month", "outings"), [
      [8, 1],
      [9, 2],
      [10, 3],
    ]);
    expect(months).toMatchObject({ type: "line", x: "month" });
  });

  it("stacks a second category with few values, else draws a heatmap", () => {
    const stacked = autoChart(cols("month", "gender", "rowers"), [
      [8, "female", 3],
      [8, "male", 4],
      [9, "female", 2],
    ]);
    valid(stacked);
    expect(stacked).toMatchObject({
      type: "bar",
      x: "month",
      series: "gender",
      stacked: true,
    });
    const rows: SqlValue[][] = [];
    for (let b = 0; b < 12; b++)
      for (let m = 1; m <= 12; m++) rows.push([`B${b}`, m, b + m]);
    const heat = autoChart(cols("boat_name", "month", "outings"), rows);
    valid(heat);
    expect(heat).toEqual({
      type: "heatmap",
      x: "boat_name",
      y: "month",
      value: "outings",
    });
  });

  it("keeps at most 8 values", () => {
    const names = ["label", ...Array.from({ length: 10 }, (_, i) => `v${i}`)];
    const spec = autoChart(cols(...names), [
      ["a", ...Array.from({ length: 10 }, () => 1)],
      ["b", ...Array.from({ length: 10 }, () => 2)],
    ]);
    valid(spec);
    expect(spec.type === "bar" && spec.y.length).toBe(8);
  });
});
