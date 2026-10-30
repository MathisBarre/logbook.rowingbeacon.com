import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "../../../_common/i18n/config";
import type { CalendarSpec, HeatmapSpec, KpiSpec } from "../../chartSpec";
import type { QueryResult } from "../../types";
import type { ChartContext } from "../model";
import { CHART_THEMES } from "../palette";
import { CalendarChart, buildCalendarModel } from "./CalendarChart";
import { Heatmap, buildHeatmapModel, cellFill } from "./Heatmap";
import { KpiTiles, buildKpiTiles } from "./KpiTiles";

const result = (names: string[], rows: QueryResult["rows"]): QueryResult => ({
  columns: names.map((name) => ({ name, declType: null })),
  rows,
  truncated: false,
  elapsedMs: 1,
  ignoredColumns: [],
  cached: false,
});

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

const n = (text: string) => text.replace(/[\u202f\u00a0]/g, " ");

describe("Heatmap", () => {
  const spec: HeatmapSpec = {
    type: "heatmap",
    x: "hour",
    y: "weekday",
    value: "avg_per_week",
  };

  it.each([
    ["empty", []],
    [
      "nulls",
      [
        [null, null, null],
        [1, null, 2],
      ],
    ],
    ["one row", [[1, 18, 4.5]]],
  ] as const)("renders a %s result without crashing", (_, rows) => {
    const html = renderToStaticMarkup(
      <Heatmap
        spec={spec}
        result={result(
          ["weekday", "hour", "avg_per_week"],
          rows.map((r) => [...r])
        )}
        ctx={ctx}
        width={480}
        height={300}
      />
    );
    expect(html).toContain("<svg");
    expect(html).toContain("data-chart-root");
  });

  it("completes hours and weekdays, labels cells and the scale", () => {
    const res = result(
      ["weekday", "hour", "avg_per_week"],
      [
        [1, 8, 2],
        [7, 12, 10],
        [3, 10, 0],
      ]
    );
    const model = buildHeatmapModel(spec, res, ctx);
    expect(model.xs.map((x) => x.raw)).toEqual([8, 9, 10, 11, 12]);
    expect(model.ys.map((y) => y.raw)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(model.values[2][2]).toBe(0);
    expect(model.values[1][0]).toBeNull();
    const html = n(
      renderToStaticMarkup(
        <Heatmap spec={spec} result={res} ctx={ctx} width={600} height={300} />
      )
    );
    expect(html).toContain("lundi");
    expect(html).toContain("12 h");
    // The scale starts at zero and names the measure; missing = "Aucune".
    expect(html).toContain("Moyenne par semaine :");
    expect(html).toContain("Aucune");
    expect(html).toContain("Plus (10)");
    expect(html).not.toContain("Moins (2)");
  });

  it("names every column when a few named columns fit", () => {
    // The annual report's retention: "Arrivée", "+1 saison", "+2 saisons".
    const res = result(
      ["cohort", "seasons_after", "retention_pct"],
      [
        [2023, "Arrivée", 100],
        [2023, "+1 saison", 85],
        [2023, "+2 saisons", 80],
        [2024, "Arrivée", 100],
        [2024, "+1 saison", 94],
        [2025, "Arrivée", 100],
      ]
    );
    const html = renderToStaticMarkup(
      <Heatmap
        spec={{
          type: "heatmap",
          x: "seasons_after",
          y: "cohort",
          value: "retention_pct",
        }}
        result={res}
        ctx={ctx}
        width={700}
        height={300}
      />
    );
    expect(html).toContain(">Arrivée<");
    expect(html).toContain(">+1 saison<");
    expect(html).toContain(">+2 saisons<");
  });

  it("colours from zero, so a high value is never the lightest", () => {
    const res = result(
      ["weekday", "hour", "avg_per_week"],
      [
        [1, 8, 80],
        [1, 9, 100],
      ]
    );
    const model = buildHeatmapModel(spec, res, ctx);
    expect(cellFill(80, model, ctx.theme)).toBe(ctx.theme.sequential[5]);
    expect(cellFill(null, model, ctx.theme)).toBeNull();
  });

  it("goes diverging when values go both ways", () => {
    const res = result(
      ["weekday", "hour", "avg_per_week"],
      [
        [1, 8, -4],
        [1, 9, 4],
        [1, 10, 0],
      ]
    );
    const model = buildHeatmapModel(spec, res, ctx);
    expect(model.diverging).toBe(true);
    expect(cellFill(-4, model, ctx.theme)).toBe(ctx.theme.negative[6]);
    expect(cellFill(4, model, ctx.theme)).toBe(ctx.theme.sequential[6]);
    expect(cellFill(0, model, ctx.theme)).toBe(ctx.theme.zero);
  });

  it("orders boat classes like the bars", () => {
    const model = buildHeatmapModel(
      { type: "heatmap", x: "month", y: "boat_class", value: "outings" },
      result(
        ["boat_class", "month", "outings"],
        [
          ["8+", 1, 1],
          ["2x", 1, 1],
          ["1x", 1, 1],
          ["4+", 1, 1],
        ]
      ),
      ctx
    );
    expect(model.ys.map((y) => y.raw)).toEqual(["1x", "2x", "4+", "8+"]);
  });

  it("orders season months from the season start", () => {
    const model = buildHeatmapModel(
      { type: "heatmap", x: "month", y: "boat_name", value: "outings" },
      result(
        ["boat_name", "month", "outings"],
        [
          ["A", 1, 2],
          ["A", 8, 3],
        ]
      ),
      ctx
    );
    expect(model.xs.map((x) => x.raw)).toEqual([
      8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("caps very large results and says so", () => {
    const rows: QueryResult["rows"] = [];
    for (let y = 0; y < 250; y++) rows.push([`B${y}`, "x", y + 1]);
    const model = buildHeatmapModel(
      { type: "heatmap", x: "k", y: "boat_name", value: "n" },
      result(["boat_name", "k", "n"], rows),
      ctx
    );
    expect(model.ys).toHaveLength(200);
    expect(model.capped).toEqual({ shown: 200, total: 250 });
  });
});

describe("CalendarChart", () => {
  const spec: CalendarSpec = {
    type: "calendar",
    date: "date",
    value: "participations",
  };

  it.each([
    ["empty", []],
    [
      "nulls",
      [
        [null, null],
        ["2025-09-01", null],
      ],
    ],
    ["one row", [["2025-09-01", 4]]],
  ] as const)("renders a %s result without crashing", (_, rows) => {
    const html = renderToStaticMarkup(
      <CalendarChart
        spec={spec}
        result={result(
          ["date", "participations"],
          rows.map((r) => [...r])
        )}
        ctx={ctx}
        width={700}
        height={200}
        today="2026-10-29"
      />
    );
    expect(html).toContain("<svg");
  });

  it("spans the season, Monday first, and stops at today", () => {
    const model = buildCalendarModel(
      spec,
      result(["date", "participations"], [["2025-09-01", 4]]),
      ctx,
      "2025-10-15"
    );
    expect(model).not.toBeNull();
    if (!model) return;
    // 2025-08-01 is a Friday: the first column starts on Monday 28 July.
    expect(model.firstDay - model.firstMonday).toBe(4);
    expect(model.lastDay - model.firstDay).toBe(75);
    expect(model.weeks).toBe(12);
    const html = renderToStaticMarkup(
      <CalendarChart
        spec={spec}
        result={result(["date", "participations"], [["2025-09-01", 4]])}
        ctx={ctx}
        width={700}
        height={200}
        today="2025-10-15"
      />
    );
    expect(html).toContain("août");
    expect(html).toContain("septembre");
    expect(html).toContain("lun.");
  });

  it("without a season, spans the dates of the result", () => {
    const model = buildCalendarModel(
      spec,
      result(
        ["date", "participations"],
        [
          ["2024-01-03", 1],
          ["2024-01-10", 2],
        ]
      ),
      { ...ctx, params: {} },
      "2026-10-29"
    );
    expect(model?.weeks).toBe(2);
    expect(
      buildCalendarModel(spec, result(["date", "participations"], []), {
        ...ctx,
        params: {},
      })
    ).toBeNull();
  });
});

describe("KpiTiles", () => {
  const spec: KpiSpec = {
    type: "kpi",
    items: [
      { value: "outings", compare: "outings_prev", higherIsBetter: true },
      { value: "km", compare: "km_prev", format: "km", hideWhenNull: true },
      {
        value: "coached_pct",
        compare: "coached_pct_prev",
        format: "percent",
        higherIsBetter: true,
      },
      { value: "hours", compare: "hours_prev", higherIsBetter: false },
    ],
  };

  it.each([
    ["empty", []],
    ["nulls", [[null, null, null, null, null, null, null, null]]],
  ] as const)("renders a %s result without crashing", (_, rows) => {
    const html = renderToStaticMarkup(
      <KpiTiles
        spec={spec}
        result={result(
          [
            "outings",
            "outings_prev",
            "km",
            "km_prev",
            "coached_pct",
            "coached_pct_prev",
            "hours",
            "hours_prev",
          ],
          rows.map((r) => [...r])
        )}
        ctx={ctx}
      />
    );
    expect(html).not.toContain("km");
  });

  it("shows trends in words with the previous value", () => {
    const res = result(
      [
        "outings",
        "outings_prev",
        "km",
        "km_prev",
        "coached_pct",
        "coached_pct_prev",
        "hours",
        "hours_prev",
      ],
      [[3412, 3100, null, 10, 34, 34, 120, 100]]
    );
    const tiles = buildKpiTiles(spec, res, ctx);
    expect(tiles.map((t) => t.key)).toEqual([
      "outings-0",
      "coached_pct-2",
      "hours-3",
    ]);
    expect(tiles[0].compare).toMatchObject({ trend: "up", tone: "good" });
    expect(n(tiles[0].compare?.change ?? "")).toBe("+10 %");
    expect(tiles[1].compare).toMatchObject({
      trend: "flat",
      change: null,
      tone: "neutral",
    });
    expect(tiles[2].compare).toMatchObject({ trend: "up", tone: "bad" });
    const html = n(
      renderToStaticMarkup(<KpiTiles spec={spec} result={res} ctx={ctx} />)
    );
    expect(html).toContain("3 412");
    expect(html).toContain("En hausse");
    expect(html).toContain("contre 3 100 la saison précédente");
    expect(html).toContain("Sorties encadrées");
    expect(html).not.toContain("Sorties encadrées (%)");
  });

  it("gives a percentage's change in points, with a true minus", () => {
    const res = result(
      [
        "outings",
        "outings_prev",
        "km",
        "km_prev",
        "coached_pct",
        "coached_pct_prev",
        "hours",
        "hours_prev",
      ],
      [[90, 100, 5120.5, 4890, 37, 34, 120, 100]]
    );
    const tiles = buildKpiTiles(spec, res, ctx);
    expect(n(tiles[0].compare?.change ?? "")).toBe("\u221210 %");
    // One precision for a value and its comparison.
    expect(n(tiles[1].value)).toBe("5 121 km");
    expect(n(tiles[1].compare?.previous ?? "")).toBe("4 890 km");
    expect(tiles[1].unit).toBe("km");
    expect(n(tiles[1].number)).toBe("5 121");
    expect(n(tiles[2].compare?.change ?? "")).toBe("+3 pts");
  });
});
