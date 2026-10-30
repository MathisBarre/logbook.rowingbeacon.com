import type { ChartSpec } from "../chartSpec";
import type { ResultColumn, SqlValue } from "../types";
import { analyseColumns, ColumnInfo } from "./columns";
import { xKindOf } from "./model";
import { MAX_SERIES } from "./palette";

/**
 * Chart guessed from a result (plan 2.11), for AI answers whose chart does
 * not fit and for pasted SQL:
 *
 * - no numeric column → table;
 * - one row of numbers → KPI tiles (a `<name>_prev` column becomes the
 *   comparison of `<name>`);
 * - x = the first category column (text, date, or a number named like a
 *   month, hour, season…), y = the numeric measures (at most 8);
 * - two category columns and one measure → stacked bars by series when
 *   the second has at most 8 values, else a heatmap;
 * - dates, weeks, months and seasons on x → a line; otherwise bars,
 *   horizontal for 7 or more named categories or long labels.
 */

const TIME_NAMES =
  /(^|_)(date|day|week|week_start|month|month_key|season|year|at)$/;

const isTimeLike = (column: ColumnInfo) =>
  column.kind === "date" ||
  column.kind === "datetime" ||
  TIME_NAMES.test(column.name.toLowerCase());

const kpiChart = (measures: ColumnInfo[]): ChartSpec => {
  const names = new Set(measures.map((c) => c.name));
  const items = measures
    .filter(
      (c) => !(c.name.endsWith("_prev") && names.has(c.name.slice(0, -5)))
    )
    .slice(0, 6)
    .map((c) => {
      const compare = `${c.name}_prev`;
      return names.has(compare)
        ? { value: c.name, compare }
        : { value: c.name };
    });
  return { type: "kpi", items };
};

const longestLabel = (rows: SqlValue[][], index: number) =>
  rows
    .slice(0, 200)
    .reduce((max, row) => Math.max(max, String(row[index] ?? "").length), 0);

export const autoChart = (
  columns: ResultColumn[],
  rows: SqlValue[][]
): ChartSpec => {
  if (columns.length === 0 || rows.length === 0) return { type: "table" };
  const info = analyseColumns(columns, rows);
  const numbers = info.filter((c) => c.kind === "number");
  if (numbers.length === 0) return { type: "table" };

  const measures = numbers.filter((c) => !c.isDimension);
  const categories = info.filter(
    (c) => c.kind === "text" || c.kind === "date" || c.kind === "datetime"
  );

  if (rows.length === 1 && categories.length === 0) {
    return kpiChart(measures.length > 0 ? measures : numbers);
  }

  // The first category column, in the query's column order.
  const x =
    info.find((c) => c.isDimension && c.kind !== "empty") ??
    categories[0] ??
    null;
  const ys = measures.filter((c) => c.name !== x?.name);
  if (!x || ys.length === 0) {
    return rows.length === 1
      ? kpiChart(measures.length > 0 ? measures : numbers)
      : { type: "table" };
  }

  const second = info.find(
    (c) => c.isDimension && c.name !== x.name && c.kind !== "empty"
  );
  if (second && ys.length === 1 && rows.length > 1) {
    if (second.distinct <= MAX_SERIES) {
      return {
        type: "bar",
        x: x.name,
        y: [ys[0].name],
        series: second.name,
        stacked: true,
        orientation: "vertical",
        sort: "none",
      };
    }
    return { type: "heatmap", x: x.name, y: second.name, value: ys[0].name };
  }

  const y = ys.slice(0, MAX_SERIES).map((c) => c.name);
  if (isTimeLike(x) && x.distinct > 2) {
    return { type: "line", x: x.name, y, cumulative: false };
  }
  // Names read best down a list: horizontal from 7 categories, or with
  // long labels. Ordered x (weekdays, hours, numbers) stays vertical.
  const ordered =
    x.kind === "number" ||
    xKindOf(
      { type: "table" },
      x.name,
      rows.slice(0, 50).map((row) => row[x.index] ?? null)
    ) !== "nominal";
  const horizontal = ordered
    ? x.distinct > 12 && longestLabel(rows, x.index) > 14
    : x.distinct >= 7 || longestLabel(rows, x.index) > 14;
  return {
    type: "bar",
    x: x.name,
    y,
    orientation: horizontal ? "horizontal" : "vertical",
    stacked: false,
    sort: "none",
    ...(horizontal && x.distinct > 30 ? { limit: 30 } : {}),
  };
};
