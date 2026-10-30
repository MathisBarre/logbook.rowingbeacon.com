import type { TFunction } from "i18next";
import type { BarSpec, ChartSpec, LineSpec, ValueFormat } from "../chartSpec";
import type { ParamValue, QueryResult, SqlValue } from "../types";
import { columnIndex } from "./columns";
import {
  columnDecimals,
  columnLabel,
  dayNumber,
  formatCompact,
  formatValue,
  labelWithUnit,
  monthTick,
  parseLocalDate,
  parseMonthKey,
  resolveFormatByName,
  unitOfFormat,
} from "./format";
import {
  colorForColumn,
  colorSeriesByEntity,
  domainOf,
  FoldedSeries,
  foldSeries,
  orderSeries,
} from "./foldSeries";
import { ChartTheme, statusOfColumn, statusOfValue } from "./palette";
import { cumulate, pivotLong, wideFromColumns } from "./pivot";
import { stepDecimals } from "./scale";
import { currentSeason, formatSeason, localNow } from "../params/season";

/**
 * The data a chart draws, built from a spec and a result: labels and
 * formats resolved, series pivoted, folded, ordered and coloured.
 */

export interface ChartContext {
  t: TFunction;
  locale: string;
  seasonStartMonth: number;
  params: Record<string, ParamValue>;
  theme: ChartTheme;
}

export interface SeriesModel {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** Column whose format the values take. */
  column: string;
  isOther: boolean;
  /** A `<name>_prev` series: drawn muted, under the current one. */
  muted?: boolean;
}

export interface CategoryModel {
  raw: SqlValue;
  /** Full label (tooltip, table). */
  label: string;
  /** Short label (axis). */
  short: string;
  /** Position on a numeric or time axis (number, or day number). */
  pos?: number;
}

/**
 * What the x values are: `time` (dates, spaced by day), `numeric` (plain
 * numbers, spaced by value), `ordinal` (months, weekdays, hours, seasons:
 * evenly spaced, in order) or `nominal` (names: never thinned).
 */
export type XKind = "time" | "numeric" | "ordinal" | "nominal";

export interface CappedInfo {
  shown: number;
  total: number;
  /** The latest values are shown (time axis), else the first ones. */
  which?: "first" | "last";
  /** The spec's own `limit` ("top 25"), not a cap of the chart. */
  limited?: boolean;
}

export interface CartesianModel {
  categories: CategoryModel[];
  series: SeriesModel[];
  /** Values shown are capped (limit or too many categories). */
  capped: CappedInfo | null;
  formatValue: (column: string, value: number | null) => string;
  /** Tick label; `step` (the tick spacing) decides the decimals. */
  formatTick: (value: number, step?: number) => string;
  /** Every value is whole: ticks stay on whole numbers. */
  integer: boolean;
  xKind: XKind;
  /** Label of the x column ("Bateau"). */
  xLabel: string;
  /** Title under a numeric x axis ("Mois après la première sortie"). */
  xTitle: string | null;
  /** Name of the plotted quantity, with its unit ("Distance (km)"). */
  measure: string | null;
}

/** Format of a column: the spec's `formats`, else the name rules. */
export const specFormat = (
  spec: ChartSpec,
  column: string
): ValueFormat | undefined => {
  const explicit = spec.formats?.[column];
  if (explicit) return explicit;
  if (spec.type === "kpi") {
    return spec.items.find(
      (item) => item.value === column || item.compare === column
    )?.format;
  }
  return undefined;
};

/** Resolved format of a column (spec, then name rules). */
export const formatOf = (
  spec: ChartSpec,
  column: string,
  sample: SqlValue[] = []
): string | null => {
  const explicit = specFormat(spec, column);
  if (explicit && explicit !== "auto") return explicit;
  return resolveFormatByName(column, sample);
};

/** Decimals of each column of `result`, computed once (one per column). */
const decimalsByColumn = (result: QueryResult | undefined) => {
  const cache = new Map<string, number | undefined>();
  return (column: string): number | undefined => {
    if (!result) return undefined;
    if (cache.has(column)) return cache.get(column);
    const i = columnIndex(result.columns, column);
    const decimals =
      i === -1
        ? undefined
        : columnDecimals(result.rows.map((r) => r[i] ?? null));
    cache.set(column, decimals);
    return decimals;
  };
};

/**
 * Formatter of a chart's values. With `result`, every number of a column
 * takes the same decimals (one precision per column).
 */
export const makeFormatter = (
  spec: ChartSpec,
  ctx: ChartContext,
  compact = false,
  result?: QueryResult
) => {
  const decimals = decimalsByColumn(result);
  return (column: string, value: SqlValue): string =>
    formatValue(column, value, {
      locale: ctx.locale,
      seasonStartMonth: ctx.seasonStartMonth,
      params: ctx.params,
      format: specFormat(spec, column),
      compact,
      t: ctx.t,
      decimals: decimals(column),
    });
};

export const labelOf = (spec: ChartSpec, ctx: ChartContext, column: string) =>
  columnLabel(column, ctx.t, spec.labels, spec.labelKeys, ctx.params);

/** "Distance (km)": the label of a value column with its unit. */
export const measureLabelOf = (
  spec: ChartSpec,
  ctx: ChartContext,
  column: string
) =>
  labelWithUnit(
    labelOf(spec, ctx, column),
    unitOfFormat(formatOf(spec, column))
  );

/**
 * Axis ticks: compact numbers (1,2 k) with the decimals the tick step
 * needs, percentages and durations in their unit; the unit of km and hours
 * is in the measure caption, the tooltip and the table.
 */
const makeTickFormatter = (
  spec: ChartSpec,
  ctx: ChartContext,
  column: string
) => {
  const format = formatOf(spec, column);
  return (value: number, step = 1): string => {
    const decimals = stepDecimals(step);
    if (format === "percent" || format === "minutes") {
      return formatValue(column, value, {
        locale: ctx.locale,
        seasonStartMonth: ctx.seasonStartMonth,
        format: format,
        compact: true,
        decimals,
        t: ctx.t,
      });
    }
    return formatCompact(value, ctx.locale, decimals);
  };
};

/** Label of a value of a series column; null reads "Non renseigné". */
export const seriesValueLabel = (
  spec: ChartSpec,
  ctx: ChartContext,
  column: string,
  raw: SqlValue
) =>
  raw === null
    ? ctx.t("analytics.codes.unknown")
    : makeFormatter(spec, ctx)(column, raw);

/** Most categories a chart draws before it says "capped". */
const MAX_CATEGORIES = {
  verticalBars: 60,
  horizontalBars: 100,
  points: 2000,
} as const;

const total = (series: SeriesModel[], i: number) =>
  series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);

const ORDINAL_FORMATS = new Set([
  "month",
  "weekday",
  "hour",
  "season",
  "year",
  "week",
]);
const TIME_FORMATS = new Set(["date", "datetime"]);
const NUMERIC_FORMATS = new Set([
  "months",
  "integer",
  "decimal",
  "km",
  "hours",
  "minutes",
  "percent",
]);

/** What the x values of a chart are (see XKind). */
export const xKindOf = (
  spec: ChartSpec,
  column: string,
  values: SqlValue[]
): XKind => {
  const present = values.filter((v) => v !== null);
  const format = formatOf(spec, column, present.slice(0, 50));
  if (present.length === 0) return "nominal";
  if (
    (format === null || TIME_FORMATS.has(format) || format === "week") &&
    present.every((v) => typeof v === "string" && parseLocalDate(v) !== null)
  ) {
    return "time";
  }
  if (format !== null && ORDINAL_FORMATS.has(format)) return "ordinal";
  if (
    (format === null || NUMERIC_FORMATS.has(format)) &&
    present.every((v) => typeof v === "number")
  ) {
    return "numeric";
  }
  return "nominal";
};

/** Columns whose dictionary name says nothing of the measure. */
const GENERIC_MEASURES = new Set(["value", "n", "count"]);

/**
 * Caption of the value axis: the measure's name with its unit, never a
 * season name (callers label `value` "Saison 2025-2026"; the legend or the
 * title already names the season); none when only a generic column name
 * ("Valeur") is left.
 */
const captionOf = (
  spec: ChartSpec,
  ctx: ChartContext,
  column: string
): string | null => {
  const unit = unitOfFormat(formatOf(spec, column));
  const given = labelOf(spec, ctx, column);
  const seasons = seasonPairLabels(ctx);
  const isSeason =
    /\b(19|20)\d{2}\b/.test(given) ||
    /(selected|previous|current)Season/.test(spec.labelKeys?.[column] ?? "") ||
    (!!seasons && (given === seasons.current || given === seasons.previous));
  if (given && given !== column && !isSeason) {
    const named = ctx.t(`analytics.columns.${column}`, { defaultValue: "" });
    if (!(GENERIC_MEASURES.has(column) && given === named)) {
      return labelWithUnit(given, unit);
    }
  }
  if (GENERIC_MEASURES.has(column)) return null;
  const named = ctx.t(`analytics.columns.${column}`, { defaultValue: "" });
  return named ? labelWithUnit(named, unit) : null;
};

/** Labels of a `<name>` / `<name>_prev` pair: the two seasons' names. */
const seasonPairLabels = (ctx: ChartContext) => {
  const given = ctx.params.season;
  const season =
    given === "current"
      ? currentSeason(localNow(), ctx.seasonStartMonth)
      : typeof given === "number"
        ? given
        : typeof given === "string" && /^\d{4}$/.test(given)
          ? Number(given)
          : null;
  if (season === null || !Number.isInteger(season)) return null;
  return {
    current: formatSeason(season, ctx.seasonStartMonth),
    previous: formatSeason(season - 1, ctx.seasonStartMonth),
  };
};

/** Severity order of status series: critical at the baseline. */
const STATUS_RANK = { critical: 0, serious: 1, warning: 2, good: 3 } as const;

export const buildCartesianModel = (
  spec: BarSpec | LineSpec,
  result: QueryResult,
  ctx: ChartContext
): CartesianModel => {
  const format = makeFormatter(spec, ctx, false, result);
  const formatShort = makeFormatter(spec, ctx, true, result);
  const xIndex = columnIndex(result.columns, spec.x);

  let wideSeries: FoldedSeries[];
  let categories: SqlValue[];
  let series: SeriesModel[];

  if (spec.series) {
    const seriesIndex = columnIndex(result.columns, spec.series);
    const yIndex = columnIndex(result.columns, spec.y[0]);
    const wide = pivotLong(result.rows, xIndex, seriesIndex, yIndex);
    categories = wide.categories;
    const { kept, other } = foldSeries(wide.series);
    const domain = domainOf(spec.series, ctx.params);
    wideSeries = [...orderSeries(kept, domain), ...(other ? [other] : [])];
    const colors = colorSeriesByEntity(
      wideSeries,
      spec.series,
      ctx.theme,
      ctx.params
    );
    const seriesColumn = spec.series;
    series = wideSeries.map((s) => ({
      key: s.key,
      label: s.isOther
        ? ctx.t("analytics.charts.others")
        : seriesValueLabel(spec, ctx, seriesColumn, s.raw),
      color: colors.get(s.key) ?? ctx.theme.other,
      values: s.values,
      column: spec.y[0],
      isOther: Boolean(s.isOther),
    }));
    const ranks = wideSeries.map((s) =>
      s.raw === null ? null : statusOfValue(seriesColumn, String(s.raw))
    );
    if (ranks.every((r) => r !== null)) {
      const rank = new Map(
        wideSeries.map((s, i) => [s.key, STATUS_RANK[ranks[i]]])
      );
      series = [...series].sort(
        (a, b) => (rank.get(a.key) ?? 9) - (rank.get(b.key) ?? 9)
      );
    }
  } else {
    const ys = spec.y.map((key) => ({
      key,
      index: columnIndex(result.columns, key),
    }));
    const wide = wideFromColumns(result.rows, xIndex, ys);
    categories = wide.categories;
    const names = new Set(spec.y);
    const pair = seasonPairLabels(ctx);
    // The current season takes the first slot; `_prev` series recede.
    let slot = 0;
    series = wide.series.map((s) => {
      const isPrev = s.key.endsWith("_prev") && names.has(s.key.slice(0, -5));
      const isCurrent = names.has(`${s.key}_prev`);
      const color = isPrev
        ? ctx.theme.other
        : colorForColumn(s.key, slot++, ctx.theme);
      return {
        key: s.key,
        label:
          pair && isPrev
            ? pair.previous
            : pair && isCurrent
              ? pair.current
              : labelOf(spec, ctx, s.key),
        color,
        values: s.values,
        column: s.key,
        isOther: false,
        ...(isPrev ? { muted: true } : {}),
      };
    });
    const ranks = series.map((s) => statusOfColumn(s.key));
    if (series.length > 1 && ranks.every((r) => r !== null)) {
      const rank = new Map(
        series.map((s, i) => [s.key, STATUS_RANK[ranks[i]]])
      );
      series = [...series].sort(
        (a, b) => (rank.get(a.key) ?? 9) - (rank.get(b.key) ?? 9)
      );
    }
  }

  if (spec.type !== "bar" && spec.cumulative) {
    series = series.map((s) => ({ ...s, values: cumulate(s.values) }));
  }

  const xKind = xKindOf(spec, spec.x, categories);
  const isMonthKey =
    categories.length > 0 &&
    categories.every((c) => c === null || parseMonthKey(c) !== null);

  // Sort and limit (bars): by the category total, the query order kept
  // between equal totals.
  let order = categories.map((_, i) => i);
  const sorted = spec.type === "bar" && spec.sort !== "none";
  if (sorted) {
    const sign = spec.sort === "asc" ? 1 : -1;
    order = order.sort(
      (a, b) => sign * (total(series, a) - total(series, b)) || a - b
    );
  }
  const max =
    spec.type === "bar"
      ? (spec.limit ??
        (spec.orientation === "horizontal"
          ? MAX_CATEGORIES.horizontalBars
          : MAX_CATEGORIES.verticalBars))
      : MAX_CATEGORIES.points;
  // On a time axis the latest values matter: keep them.
  const keepLast = !sorted && (xKind === "time" || isMonthKey);
  const capped: CappedInfo | null =
    order.length > max
      ? {
          shown: max,
          total: order.length,
          which: keepLast ? "last" : "first",
          ...(spec.type === "bar" && spec.limit ? { limited: true } : {}),
        }
      : null;
  order = keepLast ? order.slice(-max) : order.slice(0, max);

  const allValues = (spec.series ? [spec.y[0]] : spec.y).flatMap((y) => {
    const i = columnIndex(result.columns, y);
    return i === -1 ? [] : result.rows.map((r) => r[i] ?? null);
  });
  const integer = allValues.every(
    (v) => v === null || (typeof v === "number" && Number.isInteger(v))
  );

  const names = new Set(spec.y);
  const base = spec.y.find((y) => names.has(`${y}_prev`));
  const measureColumn =
    spec.series || spec.y.length === 1
      ? spec.y[0]
      : spec.y.length === 2 && base
        ? base
        : null;

  const unknown = ctx.t("analytics.codes.unknown");
  const shortOf = (raw: SqlValue, i: number, list: number[]): string => {
    if (raw === null) return unknown;
    const month = isMonthKey ? parseMonthKey(raw) : null;
    if (month) {
      const prev = i > 0 ? parseMonthKey(categories[list[i - 1]]) : null;
      return monthTick(
        month.year,
        month.month,
        ctx.locale,
        i === 0 ||
          month.month === 1 ||
          (prev !== null && prev.year !== month.year)
      );
    }
    return formatShort(spec.x, raw);
  };

  return {
    categories: order.map((index, i) => {
      const raw = categories[index];
      const pos =
        xKind === "numeric" && typeof raw === "number"
          ? raw
          : xKind === "time" && typeof raw === "string"
            ? (() => {
                const date = parseLocalDate(raw);
                return date ? dayNumber(date) : undefined;
              })()
            : undefined;
      return {
        raw,
        label: raw === null ? unknown : format(spec.x, raw),
        short: shortOf(raw, i, order),
        ...(pos !== undefined ? { pos } : {}),
      };
    }),
    series: series.map((s) => ({
      ...s,
      values: order.map((i) => s.values[i] ?? null),
    })),
    capped,
    formatValue: (column, value) => format(column, value),
    formatTick: makeTickFormatter(spec, ctx, series[0]?.column ?? spec.y[0]),
    integer,
    xKind,
    xLabel: labelOf(spec, ctx, spec.x),
    xTitle: xKind === "numeric" ? labelOf(spec, ctx, spec.x) : null,
    measure: measureColumn ? captionOf(spec, ctx, measureColumn) : null,
  };
};
