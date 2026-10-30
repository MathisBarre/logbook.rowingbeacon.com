import type { SqlValue } from "../types";

/**
 * Long to wide (plan 2.9, `series`): rows `(x, series, y)` become one
 * category per distinct x and one series per distinct series value.
 * Categories and series keep the order of their first appearance (the
 * query's ORDER BY); duplicate `(x, series)` pairs are summed; a missing
 * pair is null (no bar), not 0.
 */

export interface WideSeries {
  /** Stable key of the series ("" for a null series value). */
  key: string;
  raw: SqlValue;
  values: (number | null)[];
}

interface WideData {
  categories: SqlValue[];
  series: WideSeries[];
}

export const seriesKey = (value: SqlValue): string =>
  value === null ? "" : typeof value === "number" ? `n:${value}` : `s:${value}`;

const categoryKey = seriesKey;

export const toNumberOrNull = (value: SqlValue): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
};

const add = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : a + b;

export const pivotLong = (
  rows: SqlValue[][],
  xIndex: number,
  seriesIndex: number,
  yIndex: number
): WideData => {
  const categories: SqlValue[] = [];
  const categoryAt = new Map<string, number>();
  const series: WideSeries[] = [];
  const seriesAt = new Map<string, WideSeries>();

  const cells: { c: number; s: WideSeries; v: number | null }[] = [];
  for (const row of rows) {
    const x = row[xIndex] ?? null;
    const ck = categoryKey(x);
    let c = categoryAt.get(ck);
    if (c === undefined) {
      c = categories.length;
      categories.push(x);
      categoryAt.set(ck, c);
    }
    const raw = row[seriesIndex] ?? null;
    const sk = seriesKey(raw);
    let s = seriesAt.get(sk);
    if (!s) {
      s = { key: sk, raw, values: [] };
      series.push(s);
      seriesAt.set(sk, s);
    }
    cells.push({ c, s, v: toNumberOrNull(row[yIndex] ?? null) });
  }
  for (const s of series) {
    s.values = categories.map(() => null);
  }
  for (const { c, s, v } of cells) {
    s.values[c] = add(s.values[c], v);
  }
  return { categories, series };
};

/**
 * One series per y column: one category per distinct x (first
 * appearance), duplicate x values summed.
 */
export const wideFromColumns = (
  rows: SqlValue[][],
  xIndex: number,
  yIndices: { key: string; index: number }[]
): WideData => {
  const categories: SqlValue[] = [];
  const categoryAt = new Map<string, number>();
  const series: WideSeries[] = yIndices.map(({ key }) => ({
    key,
    raw: key,
    values: [],
  }));
  for (const row of rows) {
    const x = row[xIndex] ?? null;
    const ck = categoryKey(x);
    let c = categoryAt.get(ck);
    if (c === undefined) {
      c = categories.length;
      categories.push(x);
      categoryAt.set(ck, c);
      for (const s of series) s.values.push(null);
    }
    yIndices.forEach(({ index }, i) => {
      const s = series[i];
      s.values[c] = add(s.values[c], toNumberOrNull(row[index] ?? null));
    });
  }
  return { categories, series };
};

/**
 * Running total of a series. A null inside the series adds nothing; nulls
 * before the first and after the last value stay null (no line yet, or
 * future weeks of the current season).
 */
export const cumulate = (values: (number | null)[]): (number | null)[] => {
  const first = values.findIndex((v) => v !== null);
  let last = -1;
  values.forEach((v, i) => {
    if (v !== null) last = i;
  });
  let total = 0;
  return values.map((value, i) => {
    if (first === -1 || i < first || i > last) return null;
    total += value ?? 0;
    return total;
  });
};
