import type { ResultColumn, SqlValue } from "../types";
import { isDateText, isDateTimeText, resolveFormatByName } from "./format";

/**
 * What each result column holds, from its values (a sample of the rows)
 * and its name: used by autoChart, chartFits and the chart builder.
 */

export type ColumnKind = "number" | "date" | "datetime" | "text" | "empty";

export interface ColumnInfo {
  name: string;
  index: number;
  kind: ColumnKind;
  /**
   * A category rather than a measure: text, dates, and numbers named like
   * months, weekdays, hours, seasons, years, ids or yes/no.
   */
  isDimension: boolean;
  /** Distinct non-null values in the sample. */
  distinct: number;
}

const SAMPLE = 1000;

const DIMENSION_NUMBER_NAMES = new Set([
  "year",
  "week",
  "months",
  "seasons_after",
  "position",
  "seats",
  "rank",
  "seat_position",
  "build_year",
  "birth_year",
  "season_week",
  "start_week",
  "start_year",
  "age_in_year",
]);

const isDimensionName = (name: string): boolean => {
  const lower = name.toLowerCase();
  if (DIMENSION_NUMBER_NAMES.has(lower)) return true;
  if (lower.endsWith("_id") || lower === "id") return true;
  if (lower.endsWith("_year") || lower.endsWith("_index")) return true;
  const format = resolveFormatByName(lower);
  return (
    format === "month" ||
    format === "weekday" ||
    format === "hour" ||
    format === "season" ||
    format === "date" ||
    format === "datetime" ||
    format === "code" ||
    format === "boolean"
  );
};

const kindOf = (values: SqlValue[]): ColumnKind => {
  const present = values.filter((v) => v !== null);
  if (present.length === 0) return "empty";
  if (present.every((v) => typeof v === "number")) return "number";
  if (present.every((v) => isDateText(v))) return "date";
  if (present.every((v) => isDateText(v) || isDateTimeText(v))) {
    return "datetime";
  }
  return "text";
};

export const analyseColumns = (
  columns: ResultColumn[],
  rows: SqlValue[][]
): ColumnInfo[] => {
  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;
  return columns.map((column, index) => {
    const values = sample.map((row) => row[index] ?? null);
    const kind = kindOf(values);
    const distinct = new Set(values.filter((v) => v !== null)).size;
    return {
      name: column.name,
      index,
      kind,
      isDimension:
        kind === "text" ||
        kind === "date" ||
        kind === "datetime" ||
        (kind === "number" && isDimensionName(column.name)) ||
        (kind === "empty" && isDimensionName(column.name)),
      distinct,
    };
  });
};

/** Numeric columns, measures first (a month number can still be a value). */
export const numericColumns = (info: ColumnInfo[]) => [
  ...info.filter((c) => c.kind === "number" && !c.isDimension),
  ...info.filter((c) => c.kind === "number" && c.isDimension),
];

/** Index of the first column called `name` (duplicates: the first). */
export const columnIndex = (columns: ResultColumn[], name: string) =>
  columns.findIndex((c) => c.name === name);

/** True when the result has no row, or only null values. */
export const isEmptyResult = (rows: SqlValue[][]) =>
  rows.length === 0 || rows.every((row) => row.every((v) => v === null));
