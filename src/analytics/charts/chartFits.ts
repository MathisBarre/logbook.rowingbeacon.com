import type { ChartSpec, ChartType } from "../chartSpec";
import type { ResultColumn, SqlValue } from "../types";
import { analyseColumns, ColumnInfo, numericColumns } from "./columns";

/** Every column a spec reads (labels and formats excluded). */
export const referencedColumns = (spec: ChartSpec): string[] => {
  switch (spec.type) {
    case "table":
      return spec.columns ?? [];
    case "kpi":
      return spec.items.flatMap((item) =>
        item.compare ? [item.value, item.compare] : [item.value]
      );
    case "bar":
    case "line":
    case "area":
      return [spec.x, ...spec.y, ...(spec.series ? [spec.series] : [])];
    case "pie":
      return [spec.label, spec.value];
    case "heatmap":
      return [spec.x, spec.y, spec.value];
    case "calendar":
      return [spec.date, spec.value];
  }
};

/**
 * True when every column the spec references exists in the result (plan
 * 2.7); otherwise the view falls back to the table with
 * analytics.charts.mismatch.
 */
export const chartFitsResult = (
  spec: ChartSpec,
  columns: ResultColumn[]
): boolean => {
  const names = new Set(columns.map((c) => c.name));
  return referencedColumns(spec).every((name) => names.has(name));
};

/** Why a chart type cannot show a result (analytics.charts.builder.unfit.*). */
export type UnfitReason =
  | "noNumeric"
  | "kpiOneRow"
  | "pieTooMany"
  | "pieTooFew"
  | "pieNegative"
  | "heatmapNeeds"
  | "lineNeedsOrder"
  | "calendarNeedsDate"
  | "needsCategory";

const TIME_NAME =
  /(^|_)(date|day|week|week_start|month|month_key|season|year|hour|at)$/;

/**
 * For every chart type, null when it can represent the result, else why
 * not: KPI tiles for one row; a pie for 2 to 6 rows of one positive
 * measure; a heatmap for two category columns and a measure; lines and
 * areas for dates or numbers along x; the calendar for a date column.
 */
export const chartTypeFits = (
  columns: ResultColumn[],
  rows: SqlValue[][],
  info: ColumnInfo[] = analyseColumns(columns, rows)
): Record<ChartType, UnfitReason | null> => {
  const numeric = numericColumns(info);
  const measures = info.filter((c) => c.kind === "number" && !c.isDimension);
  const dims = info.filter((c) => c.isDimension && c.kind !== "empty");
  const none = numeric.length === 0 ? ("noNumeric" as const) : null;
  const pie = (): UnfitReason | null => {
    if (none) return none;
    if (columns.length < 2) return "needsCategory";
    if (rows.length > 6) return "pieTooMany";
    if (rows.length < 2) return "pieTooFew";
    const value = measures[0] ?? numeric[0];
    const negative = rows.some((row) => {
      const v = row[value.index];
      return typeof v === "number" && v < 0;
    });
    return negative ? "pieNegative" : null;
  };
  const ordered = info.some(
    (c) =>
      c.kind === "date" ||
      c.kind === "datetime" ||
      (c.kind === "number" &&
        (c.isDimension || TIME_NAME.test(c.name.toLowerCase()))) ||
      (c.kind === "text" && TIME_NAME.test(c.name.toLowerCase()))
  );
  // A numeric x needs a second numeric column for the values.
  const numericX = numeric.length >= 2;
  const line: UnfitReason | null =
    none ??
    (columns.length < 2
      ? "needsCategory"
      : ordered || numericX
        ? null
        : "lineNeedsOrder");
  return {
    table: null,
    kpi: none ?? (rows.length === 1 ? null : "kpiOneRow"),
    bar: none ?? (columns.length >= 2 ? null : "needsCategory"),
    line,
    area: line,
    pie: pie(),
    heatmap:
      none ??
      (dims.length >= 2 && (measures.length >= 1 || numeric.length >= 3)
        ? null
        : "heatmapNeeds"),
    calendar:
      none ??
      (info.some((c) => c.kind === "date") && columns.length >= 2
        ? null
        : "calendarNeedsDate"),
  };
};

/**
 * Chart types that make sense for a result (the builder offers the
 * others disabled, with the reason): a table always; the others need at
 * least one numeric column and the columns their axes need.
 */
export const fittingChartTypes = (
  columns: ResultColumn[],
  rows: SqlValue[][],
  info: ColumnInfo[] = analyseColumns(columns, rows)
): ChartType[] => {
  const fits = chartTypeFits(columns, rows, info);
  return (Object.keys(fits) as ChartType[]).filter((type) => !fits[type]);
};
