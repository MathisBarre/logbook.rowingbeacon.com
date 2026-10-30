import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../_common/i18n/config";
import type { BarSpec } from "../chartSpec";
import type { QueryResult } from "../types";
import { chartTypeFits } from "./chartFits";
import {
  columnDecimals,
  formatValue,
  labelWithUnit,
  monthTick,
  withMinus,
} from "./format";
import { competitionRanks, rowsThatFit } from "./kinds/BarChart";
import { balancedBasis } from "./kinds/KpiTiles";
import { buildCartesianModel, type ChartContext } from "./model";
import { CHART_THEMES, contrast, inkOn } from "./palette";
import { linearScale, stepDecimals } from "./scale";
import { wrapText } from "./text";

const n = (text: string) => text.replace(/[\u202f\u00a0]/g, " ");

let ctx: ChartContext;
beforeAll(async () => {
  await i18n.changeLanguage("fr-FR");
  ctx = {
    t: i18n.getFixedT("fr-FR"),
    locale: "fr-FR",
    seasonStartMonth: 8,
    params: { season: 2025 },
    theme: CHART_THEMES.light,
  };
});

describe("linearScale", () => {
  it("overshoots the data as little as possible", () => {
    const scale = linearScale(0, 265, 0, 300, { maxTicks: 4 });
    expect(scale.max).toBe(300);
    expect(scale.ticks[0]).toBe(0);
  });

  it("keeps integer ticks for counts", () => {
    const scale = linearScale(0, 3, 0, 300, { maxTicks: 6, integer: true });
    expect(scale.ticks.every(Number.isInteger)).toBe(true);
    expect(scale.step).toBeGreaterThanOrEqual(1);
  });

  it("gives tick labels the decimals of their step", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.25)).toBe(2);
  });
});

describe("number formats", () => {
  it("prints a true minus sign", () => {
    expect(withMinus("-12")).toBe("−12");
    expect(withMinus("12")).toBe("12");
  });

  it("gives a whole column the same decimals", () => {
    expect(columnDecimals([1, 2, 3])).toBe(0);
    expect(columnDecimals([1.25, 12.5])).toBe(1);
    expect(columnDecimals([0.25, 1.5])).toBe(2);
    expect(columnDecimals([1250.5, 3])).toBe(0);
  });

  it("prints years without grouping", () => {
    const t = i18n.getFixedT("fr-FR");
    expect(
      formatValue("build_year", 2014, {
        locale: "fr-FR",
        seasonStartMonth: 8,
        t,
      })
    ).toBe("2014");
  });

  it("prints durations in months with their word", () => {
    const t = i18n.getFixedT("fr-FR");
    const ctx = { locale: "fr-FR", seasonStartMonth: 8, t };
    expect(n(formatValue("months", 6, ctx))).toBe("6 mois");
    const en = {
      locale: "en-US",
      seasonStartMonth: 8,
      t: i18n.getFixedT("en-US"),
    };
    expect(n(formatValue("months", 1, en))).toBe("1 month");
    expect(n(formatValue("months", 12, en))).toBe("12 months");
  });

  it("translates status, kind and code columns", () => {
    const t = i18n.getFixedT("fr-FR");
    const ctx = { locale: "fr-FR", seasonStartMonth: 8, t };
    for (const column of ["status", "kind", "code"]) {
      const key = Object.keys(
        (i18n.getResource(
          "fr-FR",
          "translation",
          `analytics.codes.${column}`
        ) ?? {}) as Record<string, string>
      )[0];
      if (!key) continue;
      expect(formatValue(column, key, ctx)).toBe(
        t(`analytics.codes.${column}.${key}`)
      );
    }
  });

  it("prints month ticks with the year only when asked", () => {
    expect(n(monthTick(2026, 1, "fr-FR", true))).toBe("janv. 2026");
    expect(monthTick(2025, 9, "fr-FR", false)).toBe("sept.");
  });

  it("adds a unit only when the label lacks it", () => {
    expect(labelWithUnit("Distance", "km")).toBe("Distance (km)");
    expect(labelWithUnit("Km (saison)", "km")).toBe("Km (saison)");
    expect(labelWithUnit("Heures", "h")).toBe("Heures");
    expect(labelWithUnit("Sorties", null)).toBe("Sorties");
  });
});

describe("text and layout helpers", () => {
  it("wraps long labels on two lines at most", () => {
    const lines = wrapText(
      "Une catégorie au nom vraiment très long pour un axe",
      80,
      12
    );
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("ranks ties alike (competition ranking)", () => {
    expect(competitionRanks([9, 7, 7, 5, 3, 1])).toEqual([1, 2, 2, 4, 5, 6]);
  });

  it("fits at least one row in a short card", () => {
    expect(rowsThatFit(40, 100)).toBe(1);
    expect(rowsThatFit(400, 40)).toBeGreaterThan(5);
  });

  it("balances wrapped KPI tiles as 3 + 2", () => {
    expect(balancedBasis(5, 1200)).toBe("10.5rem");
    expect(balancedBasis(5, 760)).toMatch(/^calc\(33\.3333% - /);
    expect(balancedBasis(4, 560)).toMatch(/^calc\(50\.0000% - /);
    expect(balancedBasis(3)).toBe("10.5rem");
  });

  it("picks the ink with the better contrast on a fill", () => {
    const theme = CHART_THEMES.light;
    for (const fill of ["#cde2fb", "#3987e5", "#0d366b", "#f7d04a"]) {
      expect(contrast(inkOn(fill), fill)).toBeGreaterThanOrEqual(4.5);
    }
    expect(theme.other).not.toBe(theme.unknown);
  });
});

describe("cartesian model", () => {
  const result = (rows: (string | number | null)[][]): QueryResult =>
    ({
      columns: [
        { name: "month_key", declType: null },
        { name: "outings", declType: null },
        { name: "outings_prev", declType: null },
      ],
      rows,
    }) as unknown as QueryResult;

  const spec: BarSpec = {
    type: "bar",
    x: "month_key",
    y: ["outings", "outings_prev"],
    orientation: "vertical",
    stacked: false,
    sort: "none",
  };

  it("mutes the previous season and names both seasons", () => {
    const model = buildCartesianModel(
      spec,
      result([
        ["2025-09", 12, 10],
        ["2025-10", 15, 11],
      ]),
      ctx
    );
    const prev = model.series.find((s) => s.key === "outings_prev");
    const current = model.series.find((s) => s.key === "outings");
    expect(prev?.muted).toBe(true);
    expect(prev?.color).toBe(ctx.theme.other);
    expect(current?.label).toMatch(/2025/);
    expect(prev?.label).toMatch(/2024/);
    expect(model.integer).toBe(true);
  });

  it("captions a season pair with the measure, never a season", () => {
    const model = buildCartesianModel(
      {
        ...spec,
        labelKeys: { outings: "analytics.reports.labels.selectedSeason" },
      },
      result([["2025-09", 12, 10]]),
      ctx
    );
    expect(model.measure).toBe("Sorties");
  });

  it("captions a generic value pair with nothing", () => {
    const generic = {
      columns: [
        { name: "month_key", declType: null },
        { name: "value", declType: null },
        { name: "value_prev", declType: null },
      ],
      rows: [["2025-09", 3, 2]],
    } as unknown as QueryResult;
    const model = buildCartesianModel(
      { ...spec, y: ["value", "value_prev"] },
      generic,
      ctx
    );
    expect(model.measure).toBeNull();
  });
});

describe("chartTypeFits", () => {
  it("says why a type does not fit", () => {
    const fits = chartTypeFits(
      [
        { name: "boat_class", declType: null },
        { name: "outings", declType: null },
      ],
      [
        ["1x", 3],
        ["2x", 4],
      ]
    );
    expect(fits.bar).toBeNull();
    expect(fits.calendar).toBe("calendarNeedsDate");
  });
});
