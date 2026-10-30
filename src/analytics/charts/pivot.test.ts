import { describe, expect, it } from "vitest";
import { cumulate, pivotLong, wideFromColumns } from "./pivot";

describe("pivotLong", () => {
  it("turns (x, series, y) rows into one series per value", () => {
    const wide = pivotLong(
      [
        [8, "1x", 10],
        [8, "2x", 4],
        [9, "1x", 12],
        [9, "8+", 2],
        [9, "1x", 3],
        [10, null, 1],
      ],
      0,
      1,
      2
    );
    expect(wide.categories).toEqual([8, 9, 10]);
    expect(wide.series.map((s) => s.raw)).toEqual(["1x", "2x", "8+", null]);
    expect(wide.series[0].values).toEqual([10, 15, null]);
    expect(wide.series[1].values).toEqual([4, null, null]);
    expect(wide.series[2].values).toEqual([null, 2, null]);
    expect(wide.series[3].values).toEqual([null, null, 1]);
  });

  it("keeps numbers and strings with the same text apart", () => {
    const wide = pivotLong(
      [
        [1, 1, 5],
        [1, "1", 6],
      ],
      0,
      1,
      2
    );
    expect(wide.series).toHaveLength(2);
  });

  it("handles an empty result", () => {
    expect(pivotLong([], 0, 1, 2)).toEqual({ categories: [], series: [] });
  });
});

describe("wideFromColumns", () => {
  it("sums duplicate categories and keeps the query order", () => {
    const wide = wideFromColumns(
      [
        ["b", 1, null],
        ["a", 2, 5],
        ["b", 3, 1],
      ],
      0,
      [
        { key: "v", index: 1 },
        { key: "w", index: 2 },
      ]
    );
    expect(wide.categories).toEqual(["b", "a"]);
    expect(wide.series[0].values).toEqual([4, 2]);
    expect(wide.series[1].values).toEqual([1, 5]);
  });
});

describe("cumulate", () => {
  it("adds up, skips inner gaps and keeps trailing nulls", () => {
    expect(cumulate([1, null, 2, 3, null, null])).toEqual([
      1,
      1,
      3,
      6,
      null,
      null,
    ]);
    expect(cumulate([null, 2, 2])).toEqual([null, 2, 4]);
    expect(cumulate([null, null])).toEqual([null, null]);
  });
});
