import { describe, expect, it } from "vitest";
import {
  colorForColumn,
  colorSeriesByEntity,
  compareBoatClass,
  foldSeries,
  OTHER_KEY,
  orderSeries,
} from "./foldSeries";
import { CHART_THEMES, STATUS } from "./palette";
import { seriesKey, WideSeries } from "./pivot";

const series = (raw: string | null, total: number): WideSeries => ({
  key: seriesKey(raw),
  raw,
  values: [total / 2, total / 2],
});
const light = CHART_THEMES.light;

describe("foldSeries", () => {
  it("keeps 8 series as they are", () => {
    const list = Array.from({ length: 8 }, (_, i) => series(`s${i}`, i));
    expect(foldSeries(list)).toEqual({ kept: list, other: null });
  });

  it("folds the 9th series and beyond into Autres (sum)", () => {
    const list = Array.from({ length: 11 }, (_, i) => series(`s${i}`, i + 1));
    const { kept, other } = foldSeries(list);
    expect(kept).toHaveLength(8);
    // The three smallest (1, 2, 3) are folded.
    expect(kept.map((s) => s.raw)).toEqual([
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
      "s9",
      "s10",
    ]);
    expect(other?.key).toBe(OTHER_KEY);
    expect(other?.values).toEqual([3, 3]);
  });

  it("keeps null when every folded value is null", () => {
    const list = Array.from({ length: 9 }, (_, i) => ({
      key: `k${i}`,
      raw: `k${i}`,
      values: i === 0 ? [null, null] : [i, i],
    }));
    expect(foldSeries(list).other?.values).toEqual([null, null]);
  });
});

describe("colours follow the entity", () => {
  it("gives a gender the same colour whatever else is shown", () => {
    const all = colorSeriesByEntity(
      [series("male", 5), series("female", 3), series("other", 1)],
      "gender",
      light
    );
    const onlyMen = colorSeriesByEntity([series("male", 5)], "gender", light);
    expect(onlyMen.get(seriesKey("male"))).toBe(all.get(seriesKey("male")));
    expect(all.get(seriesKey("female"))).toBe(light.categorical[0]);
    expect(all.get(seriesKey("male"))).toBe(light.categorical[1]);
  });

  it("does not depend on row order or rank", () => {
    const a = colorSeriesByEntity(
      [series("4x", 9), series("1x", 1), series("2x", 5)],
      "boat_class",
      light
    );
    const b = colorSeriesByEntity(
      [series("1x", 90), series("2x", 1), series("4x", 3)],
      "boat_class",
      light
    );
    for (const key of ["1x", "2x", "4x"]) {
      expect(a.get(seriesKey(key))).toBe(b.get(seriesKey(key)));
    }
    expect(a.get(seriesKey("1x"))).toBe(light.categorical[0]);
  });

  it("uses `dimension` for the category column", () => {
    const colors = colorSeriesByEntity([series("male", 1)], "category", light, {
      dimension: "gender",
    });
    expect(colors.get(seriesKey("male"))).toBe(light.categorical[1]);
  });

  it("greys out Autres, unknown and null apart; status for severities", () => {
    const colors = colorSeriesByEntity(
      [
        series("unknown", 1),
        { key: OTHER_KEY, raw: null, values: [1], isOther: true },
        series(null, 1),
        series("x", 1),
      ],
      "whatever",
      light
    );
    expect(colors.get(seriesKey("unknown"))).toBe(light.unknown);
    expect(colors.get(OTHER_KEY)).toBe(light.other);
    expect(light.unknown).not.toBe(light.other);
    expect(colors.get(seriesKey(null))).toBe(light.unknown);
    expect(colors.get(seriesKey("x"))).toBe(light.categorical[0]);
    const severity = colorSeriesByEntity(
      [series("unusable", 1), series("usable", 1)],
      "severity",
      light
    );
    expect(severity.get(seriesKey("unusable"))).toBe(STATUS.critical);
    expect(severity.get(seriesKey("usable"))).toBe(STATUS.warning);
    expect(colorForColumn("limited", 0, light)).toBe(STATUS.serious);
    expect(colorForColumn("outings", 9, light)).toBe(light.categorical[7]);
  });

  it("gives Senior, the largest age group, the first slot", () => {
    const colors = colorSeriesByEntity(
      [series("J16", 1), series("Senior", 5), series("J10", 1)],
      "age_category",
      light
    );
    expect(colors.get(seriesKey("Senior"))).toBe(light.categorical[0]);
    expect(colors.get(seriesKey("J16"))).toBe(light.categorical[2]);
    expect(colors.get(seriesKey("J10"))).toBe(light.categorical[6]);
  });
});

describe("entity order", () => {
  it("orders boat classes by seats, rigging and cox", () => {
    expect(
      ["8+", "4+", "2x", "4x", "1x", "2-", "4x+", "?"].sort(compareBoatClass)
    ).toEqual(["1x", "2x", "2-", "4x", "4x+", "4+", "8+", "?"]);
  });

  it("orders known codes by their fixed order, null last", () => {
    const ordered = orderSeries(
      [series(null, 1), series("adult", 1), series("youth", 1)],
      "age_group"
    );
    expect(ordered.map((s) => s.raw)).toEqual(["youth", "adult", null]);
  });
});
