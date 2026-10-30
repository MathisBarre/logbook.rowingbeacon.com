import type { ChartSpec, ParamDef } from "../chartSpec";

/**
 * Example queries offered to beginners in the Explorer ("Premiers pas"
 * card and "Exemples" menu). Titles are
 * `analytics.explorer.examples.items.<id>`, one-line descriptions (what
 * the query teaches) `analytics.explorer.examples.descriptions.<id>`.
 * Each one runs on every club database (examples.test.ts) and most use
 * the hub's season. They go from a plain GROUP BY to a join, a condition
 * on a measure and a date ranking.
 */

export interface ExampleQuery {
  id: string;
  sql: string;
  params: ParamDef[];
  chart: ChartSpec;
}

const SEASON: ParamDef = {
  name: "season",
  type: "season",
  required: true,
  default: "current",
};

export const EXAMPLE_QUERIES: ExampleQuery[] = [
  {
    id: "outingsByMonth",
    sql: `SELECT start_month_key AS month, COUNT(*) AS outings
FROM v_outings
WHERE season = :season AND counts_in_stats = 1
GROUP BY start_month_key
ORDER BY start_month_key`,
    params: [SEASON],
    chart: {
      type: "bar",
      x: "month",
      y: ["outings"],
      orientation: "vertical",
      stacked: false,
      sort: "none",
    },
  },
  {
    id: "topBoats",
    sql: `SELECT boat_name, COUNT(*) AS outings, ROUND(SUM(distance_km), 1) AS km
FROM v_outings
WHERE season = :season AND counts_in_stats = 1
GROUP BY boat_id, boat_name
ORDER BY outings DESC
LIMIT 10`,
    params: [SEASON],
    chart: {
      type: "bar",
      x: "boat_name",
      y: ["outings"],
      orientation: "horizontal",
      stacked: false,
      sort: "none",
    },
  },
  {
    id: "boatClasses",
    sql: `SELECT COALESCE(boat_class, '?') AS boat_class, COUNT(*) AS outings
FROM v_outings
WHERE season = :season AND counts_in_stats = 1
GROUP BY 1
ORDER BY outings DESC`,
    params: [SEASON],
    chart: { type: "pie", label: "boat_class", value: "outings" },
  },
  {
    id: "attendance",
    sql: `SELECT start_weekday AS weekday, start_hour AS hour, COUNT(*) AS outings
FROM v_outings
WHERE season = :season AND has_start_time = 1 AND counts_in_stats = 1
GROUP BY start_weekday, start_hour
ORDER BY start_weekday, start_hour`,
    params: [SEASON],
    chart: { type: "heatmap", x: "hour", y: "weekday", value: "outings" },
  },
  {
    id: "rowersByCategory",
    sql: `SELECT COALESCE(age_category, 'unknown') AS age_category,
  COUNT(DISTINCT rower_id) AS rowers
FROM v_outing_rowers
WHERE season = :season AND is_rowing = 1 AND counts_in_stats = 1
GROUP BY 1
ORDER BY rowers DESC`,
    params: [SEASON],
    chart: {
      type: "bar",
      x: "age_category",
      y: ["rowers"],
      orientation: "vertical",
      stacked: false,
      sort: "none",
    },
  },
  {
    id: "kmPerRower",
    sql: `SELECT COALESCE(NULLIF(display_name, ''), rower_code) AS rower,
  COUNT(*) AS outings,
  ROUND(SUM(distance_km), 1) AS km
FROM v_outing_rowers
WHERE season = :season AND is_rowing = 1 AND counts_in_stats = 1
GROUP BY rower_id
ORDER BY km DESC, outings DESC
LIMIT 20`,
    params: [SEASON],
    chart: { type: "table" },
  },
  {
    id: "seasons",
    sql: `SELECT season, COUNT(*) AS outings, COUNT(DISTINCT boat_id) AS boats
FROM v_outings
WHERE counts_in_stats = 1
GROUP BY season
ORDER BY season`,
    params: [],
    chart: {
      type: "line",
      x: "season",
      y: ["outings"],
      cumulative: false,
    },
  },
  {
    id: "boatsNotUsed",
    sql: `SELECT b.boat_name, b.boat_class
FROM v_boats b
LEFT JOIN v_outings o
  ON o.boat_id = b.boat_id AND o.season = :season AND o.counts_in_stats = 1
WHERE b.is_archived = 0 AND b.exclude_from_stats = 0
GROUP BY b.boat_id, b.boat_name, b.boat_class
HAVING COUNT(o.outing_id) = 0
ORDER BY b.boat_name`,
    params: [SEASON],
    chart: { type: "table" },
  },
  {
    id: "lateReturns",
    sql: `SELECT start_month_key AS month, COUNT(*) AS outings
FROM v_outings
WHERE season = :season AND is_rowing = 1 AND counts_in_stats = 1
  AND return_delay_min > 15
GROUP BY start_month_key
ORDER BY start_month_key`,
    params: [SEASON],
    chart: {
      type: "bar",
      x: "month",
      y: ["outings"],
      orientation: "vertical",
      stacked: false,
      sort: "none",
    },
  },
  {
    id: "busiestDays",
    sql: `SELECT start_date AS day, COUNT(*) AS outings
FROM v_outings
WHERE season = :season AND counts_in_stats = 1
GROUP BY start_date
ORDER BY outings DESC
LIMIT 10`,
    params: [SEASON],
    chart: { type: "table" },
  },
];
