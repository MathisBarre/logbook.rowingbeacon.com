import type { ChartSpec } from "../chartSpec";
import type { QueryResult, SqlValue } from "../types";

/**
 * Example results for every chart kind, shaped like the prebuilt reports
 * (appendix C): used by the chart kit's tests and by the screenshot
 * studio's "analytics-chart-kit" gallery scene (WP8). Values are
 * deterministic.
 */

/** @public Also used by the screenshot studio's chart gallery. */
export interface ChartFixture {
  id: string;
  spec: ChartSpec;
  result: QueryResult;
  params: Record<string, SqlValue>;
}

const result = (names: string[], rows: SqlValue[][]): QueryResult => ({
  columns: names.map((name) => ({ name, declType: null })),
  rows,
  truncated: false,
  elapsedMs: 12,
  ignoredColumns: [],
  cached: false,
});

/** Small deterministic generator (mulberry32). */
const random = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SEASON_MONTHS = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];
const MONTH_SHAPE = [
  0.9, 1, 0.8, 0.45, 0.3, 0.25, 0.35, 0.6, 0.85, 1, 1.1, 0.95,
];

const BOATS = [
  "Aiguillon",
  "Belle-Île",
  "Cormoran",
  "Dauphin",
  "Erdre",
  "Fleur de Loire",
  "Goéland",
  "Héron",
  "Ile de Nantes",
  "Jade",
  "Kerlouan",
  "Loire",
  "Mouette",
  "Noroît",
  "Ouessant",
  "Pen Bron",
  "Quiberon",
  "Rance",
  "Sèvre",
  "Trentemoult",
  "Ultramarine",
  "Vilaine",
  "Wagram",
  "Yeu",
  "Zéphyr",
];

const r1 = random(7);

export const CHART_FIXTURES: ChartFixture[] = [
  {
    id: "season-overview",
    spec: {
      type: "kpi",
      items: [
        {
          value: "outings",
          compare: "outings_prev",
          format: "integer",
          higherIsBetter: true,
        },
        {
          value: "active_rowers",
          compare: "active_rowers_prev",
          format: "integer",
          higherIsBetter: true,
        },
        {
          value: "km",
          compare: "km_prev",
          format: "km",
          higherIsBetter: true,
          hideWhenNull: true,
        },
        {
          value: "hours",
          compare: "hours_prev",
          format: "hours",
          higherIsBetter: true,
        },
        {
          value: "coached_pct",
          compare: "coached_pct_prev",
          format: "percent",
          hideWhenNull: true,
        },
      ],
    },
    result: result(
      [
        "outings",
        "outings_prev",
        "active_rowers",
        "active_rowers_prev",
        "km",
        "km_prev",
        "hours",
        "hours_prev",
        "coached_pct",
        "coached_pct_prev",
      ],
      [[3412, 3120, 214, 221, 41250.5, 39876, 5120.5, 4890, 34, 31]]
    ),
    params: { season: 2025 },
  },
  {
    id: "yoy-monthly",
    spec: {
      type: "bar",
      x: "month",
      y: ["value", "value_prev"],
      orientation: "vertical",
      stacked: false,
      sort: "none",
      labelKeys: {
        value: "analytics.reports.labels.selectedSeason",
        value_prev: "analytics.reports.labels.previousSeason",
      },
    },
    result: result(
      ["month", "value", "value_prev"],
      SEASON_MONTHS.map((month, i) => [
        month,
        i < 9 ? Math.round(420 * MONTH_SHAPE[i] * (0.9 + r1() * 0.2)) : null,
        Math.round(400 * MONTH_SHAPE[i] * (0.9 + r1() * 0.2)),
      ])
    ),
    params: { season: 2025, metric: "outings" },
  },
  {
    id: "fleet-class-monthly",
    spec: {
      type: "bar",
      x: "month",
      y: ["outings"],
      series: "boat_class",
      stacked: true,
      orientation: "vertical",
      sort: "none",
    },
    result: result(
      ["month", "boat_class", "outings"],
      SEASON_MONTHS.flatMap((month, i) =>
        (["1x", "2x", "4x", "4+", "8+"] as const).map((boatClass, j) => [
          month,
          boatClass,
          Math.round(
            [120, 90, 70, 40, 25][j] * MONTH_SHAPE[i] * (0.8 + r1() * 0.4)
          ),
        ])
      )
    ),
    params: { season: 2025 },
  },
  {
    id: "boat-usage-ranking",
    spec: {
      type: "bar",
      x: "boat_name",
      y: ["outings"],
      orientation: "horizontal",
      sort: "desc",
      stacked: false,
      limit: 25,
    },
    result: result(
      ["boat_name", "boat_class", "outings", "km"],
      BOATS.map((name, i) => [
        name,
        ["1x", "2x", "4x", "8+"][i % 4],
        Math.round(260 / (1 + i * 0.18) + r1() * 10),
        Math.round(2600 / (1 + i * 0.2)),
      ])
    ),
    params: { season: 2025 },
  },
  {
    id: "yoy-cumulative",
    spec: {
      type: "line",
      x: "week_start",
      y: ["outings_cumulative", "outings_cumulative_prev"],
      cumulative: false,
    },
    result: (() => {
      let current = 0;
      let previous = 0;
      const rows: SqlValue[][] = [];
      for (let week = 0; week < 52; week++) {
        const start = new Date(Date.UTC(2025, 7, 1 + week * 7));
        const date = start.toISOString().slice(0, 10);
        const shape = MONTH_SHAPE[Math.min(11, Math.floor(week / 4.4))];
        current += Math.round(100 * shape * (0.8 + r1() * 0.4));
        previous += Math.round(95 * shape * (0.8 + r1() * 0.4));
        rows.push([date, week < 38 ? current : null, previous]);
      }
      return result(
        ["week_start", "outings_cumulative", "outings_cumulative_prev"],
        rows
      );
    })(),
    params: { season: 2025 },
  },
  {
    id: "new-rower-survival",
    spec: { type: "area", x: "months", y: ["survival_pct"], cumulative: false },
    result: result(
      ["months", "still_rowing", "survival_pct"],
      Array.from({ length: 13 }, (_, m) => [
        m,
        Math.round(120 * Math.exp(-m / 9)),
        Math.round(100 * Math.exp(-m / 9)),
      ])
    ),
    params: {},
  },
  {
    id: "outing-types",
    spec: { type: "pie", label: "outing_type_code", value: "outings" },
    result: result(
      ["outing_type_code", "outings"],
      [
        ["normal", 1840],
        ["training", 920],
        ["regatta", 160],
        ["instruction", 310],
        ["tour", 70],
      ]
    ),
    params: { season: 2025 },
  },
  {
    id: "attendance-heatmap",
    spec: { type: "heatmap", x: "hour", y: "weekday", value: "avg_per_week" },
    result: result(
      ["weekday", "hour", "participations", "avg_per_week"],
      [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) =>
        Array.from({ length: 14 }, (_, h) => {
          const hour = h + 7;
          const weekend = weekday >= 6;
          const peak = weekend
            ? Math.exp(-((hour - 10) ** 2) / 6)
            : Math.exp(-((hour - 18) ** 2) / 3) +
              0.4 * Math.exp(-((hour - 8) ** 2) / 2);
          const value =
            Math.round(peak * (weekend ? 30 : 18) * 10 * (0.8 + r1() * 0.4)) /
            10;
          return [
            weekday,
            hour,
            Math.round(value * 40),
            value < 0.3 ? 0 : value,
          ];
        })
      )
    ),
    params: { season: 2025 },
  },
  {
    id: "activity-calendar",
    spec: { type: "calendar", date: "date", value: "participations" },
    result: (() => {
      const rows: SqlValue[][] = [];
      for (let d = 0; d < 300; d++) {
        const date = new Date(Date.UTC(2025, 7, 1 + d));
        const weekday = date.getUTCDay();
        const month = date.getUTCMonth();
        const winter = month === 11 || month === 0 || month === 1;
        const base = weekday === 0 || weekday === 6 ? 40 : 15;
        if (r1() < (winter ? 0.5 : 0.15)) continue;
        rows.push([
          date.toISOString().slice(0, 10),
          Math.round(base * (winter ? 0.4 : 1) * (0.5 + r1())),
        ]);
      }
      return result(
        ["date", "outings", "participations"],
        rows.map(([d, p]) => [d, Math.ceil(Number(p) / 3), p])
      );
    })(),
    params: { season: 2025 },
  },
  {
    id: "active-members-demographics",
    spec: {
      type: "bar",
      x: "age_group",
      y: ["active_rowers"],
      series: "gender",
      stacked: true,
      orientation: "vertical",
      sort: "none",
    },
    result: result(
      ["age_group", "gender", "active_rowers"],
      [
        ["youth", "female", 22],
        ["youth", "male", 31],
        ["youth", "unknown", 4],
        ["adult", "female", 64],
        ["adult", "male", 88],
        ["adult", "other", 2],
        ["adult", "unknown", 11],
      ]
    ),
    params: { season: 2025 },
  },
  {
    id: "damages-per-boat",
    spec: {
      type: "bar",
      x: "boat_name",
      y: ["unusable", "limited", "usable"],
      orientation: "horizontal",
      stacked: true,
      sort: "none",
      limit: 25,
    },
    result: result(
      ["boat_name", "unusable", "limited", "usable", "open_damages"],
      BOATS.slice(0, 8).map((name, i) => [
        name,
        i % 3 === 0 ? 1 : 0,
        (i * 7) % 3,
        (i * 5) % 4,
        i % 2,
      ])
    ),
    params: { season: 2025 },
  },
  {
    id: "underused-boats",
    spec: { type: "table" },
    result: result(
      [
        "boat_name",
        "boat_class",
        "outings_period",
        "last_outing_date",
        "days_since_last",
        "is_in_maintenance",
      ],
      BOATS.slice(10, 18).map((name, i) => [
        name,
        ["1x", "2x", "4+"][i % 3],
        i,
        i === 0 ? null : `2025-0${(i % 9) + 1}-1${i}`,
        i === 0 ? null : 30 * i,
        i % 4 === 0 ? 1 : 0,
      ])
    ),
    params: { days: 365, max_outings: 5 },
  },
];
