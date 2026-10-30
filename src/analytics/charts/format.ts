import type { TFunction } from "i18next";
import i18n from "../../_common/i18n/config";
import { BUILTIN_OUTING_TYPE_CODES } from "../../_common/business/outingType.rules";
import type { ParamValue, SqlValue } from "../types";
import type { ValueFormat } from "../chartSpec";
import { formatSeason } from "../params/season";

/**
 * Value formatting (plan 2.9). Stored dates are local wall-clock text
 * ("YYYY-MM-DD", "YYYY-MM-DDTHH:mm…"): they are split into components and
 * formatted in UTC, so the time zone of the computer never shifts them and
 * nothing goes through `new Date(text)`.
 */

interface FormatContext {
  locale: string;
  seasonStartMonth: number;
  format?: ValueFormat;
  /** Report parameters, e.g. `dimension` for the `category` column. */
  params?: Record<string, ParamValue>;
  /** Shorter text for axis ticks and cells ("août" for "août 2025"). */
  compact?: boolean;
  /**
   * Decimals of every number of the column (`columnDecimals`), so that a
   * column lines up ("130,4" above "80,0"); default: per value.
   */
  decimals?: number;
  /** Numbers without their unit (table cells: the unit is in the header). */
  bare?: boolean;
  /** Translation function; default: the app's i18n in `locale`. */
  t?: TFunction;
}

/** What a column holds once its format is resolved. */
export type ResolvedFormat = Exclude<ValueFormat, "auto"> | "boolean";

/** Code columns translated through analytics.codes.<group>.<value>. */
const CODE_COLUMNS = new Set([
  "outing_type_code",
  "gender",
  "rower_status",
  "seriousness",
  "rigging",
  "role",
  "issue",
  "severity",
  "damage_kind",
  "distance_source",
  "age_group",
  "category",
  "status",
  "kind",
  "code",
  // Shown as stored ("4x+"), except "unknown" (a boat without rigging).
  "boat_class",
]);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** "YYYY-MM-DD" (or the date part of a date-time) → components. */
export const parseLocalDate = (text: string): LocalDate | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return null;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= 31
    ? date
    : null;
};

/** Day number since 1970-01-01 of a local date (pure arithmetic). */
export const dayNumber = (date: LocalDate): number =>
  Math.round(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);

export const fromDayNumber = (day: number): LocalDate => {
  const d = new Date(day * 86_400_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
};

/** ISO weekday (1 = Monday) of a local date. */
export const isoWeekday = (date: LocalDate): number => {
  const weekday = new Date(dayNumber(date) * 86_400_000).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

export const isDateText = (value: SqlValue) =>
  typeof value === "string" && DATE_RE.test(value);
export const isDateTimeText = (value: SqlValue) =>
  typeof value === "string" && DATETIME_RE.test(value);

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const dateFormatter = (locale: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "UTC",
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
};

const numberCache = new Map<string, Intl.NumberFormat>();
export const numberFormatter = (
  locale: string,
  options: Intl.NumberFormatOptions
) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberCache.set(key, formatter);
  }
  return formatter;
};

const utc = (year: number, month: number, day = 1, hour = 0, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

/** A typographic minus ("−3 %"), not a hyphen. */
export const withMinus = (text: string) => text.replace(/^-(?=\d)/, "\u2212");

const formatNumber = (
  value: number,
  locale: string,
  maximumFractionDigits = 2,
  minimumFractionDigits = 0
) =>
  withMinus(
    numberFormatter(locale, {
      maximumFractionDigits,
      minimumFractionDigits: Math.min(
        minimumFractionDigits,
        maximumFractionDigits
      ),
    }).format(value)
  );

/** A number with exactly `decimals` decimals ("80,0" beside "130,4"). */
const fixedNumber = (value: number, locale: string, decimals: number) =>
  formatNumber(value, locale, decimals, decimals);

/**
 * Decimals of a whole column (finding: one precision per column): 0 when
 * every value is whole or the largest reaches 1 000, 1 from 10, else 2.
 */
export const columnDecimals = (values: readonly SqlValue[]): number => {
  let max = 0;
  let whole = true;
  let any = false;
  for (const value of values) {
    const number = toNumber(value);
    if (number === null) continue;
    any = true;
    max = Math.max(max, Math.abs(number));
    if (!Number.isInteger(number)) whole = false;
  }
  if (!any || whole || max >= 1000) return 0;
  return max >= 10 ? 1 : 2;
};

/**
 * Axis tick: decimals from the tick step (step 1 → 0, 0,5 → 1, 0,25 → 2),
 * compact from 10 000 ("12 k").
 */
export const formatCompact = (value: number, locale: string, decimals = 0) =>
  Math.abs(value) < 10_000
    ? fixedNumber(value, locale, decimals)
    : withMinus(
        numberFormatter(locale, {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value)
      );

function toNumber(value: SqlValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

const translator = (ctx: FormatContext): TFunction =>
  ctx.t ?? i18n.getFixedT(ctx.locale);

/** Month name of 1-12 ("août"), short when compact ("août", "sept."). */
export const monthName = (month: number, locale: string, short = false) =>
  dateFormatter(locale, { month: short ? "short" : "long" }).format(
    utc(2001, month)
  );

/** Weekday name of ISO 1-7 (1 = Monday). 2001-01-01 was a Monday. */
export const weekdayName = (weekday: number, locale: string, short = false) =>
  dateFormatter(locale, { weekday: short ? "short" : "long" }).format(
    utc(2001, 1, weekday)
  );

/** Hour of day: "18 h", "6 PM", "18 Uhr", "18:00". */
const hourLabel = (hour: number, locale: string) => {
  const date = utc(2001, 1, 1, hour);
  const text = dateFormatter(locale, { hour: "numeric" })
    .format(date)
    .replace(/^0(\d)/, "$1");
  return /^\d+$/.test(text.trim())
    ? dateFormatter(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
    : text;
};

export const formatLocalDate = (
  date: LocalDate,
  locale: string,
  compact = false
) =>
  dateFormatter(
    locale,
    compact
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "long", year: "numeric" }
  ).format(utc(date.year, date.month, date.day));

const formatDateTimeText = (text: string, locale: string, compact: boolean) => {
  const match = DATETIME_RE.exec(text);
  if (!match) {
    const date = parseLocalDate(text);
    return date ? formatLocalDate(date, locale, compact) : text;
  }
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const date = formatLocalDate({ year, month, day }, locale, compact);
  const time = dateFormatter(locale, { timeStyle: "short" }).format(
    utc(year, month, day, hour, minute)
  );
  return `${date}, ${time}`;
};

const formatMonth = (value: SqlValue, locale: string, compact: boolean) => {
  const number = toNumber(value);
  if (
    number !== null &&
    Number.isInteger(number) &&
    number >= 1 &&
    number <= 12
  ) {
    return monthName(number, locale, compact);
  }
  if (typeof value === "string") {
    const match = MONTH_KEY_RE.exec(value) ?? /^(\d{4})-(\d{2})-/.exec(value);
    if (match) {
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) {
        // Compact: the month alone; axes add the year on their first
        // tick and on January (`monthTick`), never "août 25".
        return dateFormatter(
          locale,
          compact ? { month: "short" } : { month: "long", year: "numeric" }
        ).format(utc(Number(match[1]), month));
      }
    }
  }
  return String(value);
};

/**
 * Month tick of a time axis: "sept.", with the year on the first tick and
 * on January ("janv. 2026").
 */
export const monthTick = (
  year: number,
  month: number,
  locale: string,
  withYear: boolean
) =>
  dateFormatter(
    locale,
    withYear ? { month: "short", year: "numeric" } : { month: "short" }
  ).format(utc(year, month));

/** Year and month of a month key ("2025-08") or a date text. */
export const parseMonthKey = (
  value: SqlValue
): { year: number; month: number } | null => {
  if (typeof value !== "string") return null;
  const match = MONTH_KEY_RE.exec(value) ?? /^(\d{4})-(\d{2})-/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
};

const formatMinutes = (minutes: number, ctx: FormatContext) => {
  const t = translator(ctx);
  const rounded = Math.round(minutes);
  if (Math.abs(rounded) < 60) {
    return t("analytics.charts.format.minutes", {
      value: formatNumber(rounded, ctx.locale, 0),
    });
  }
  const sign = rounded < 0 ? "\u2212" : "";
  const abs = Math.abs(rounded);
  return (
    sign +
    t("analytics.charts.format.hoursMinutes", {
      h: formatNumber(Math.floor(abs / 60), ctx.locale, 0),
      mm: String(abs % 60).padStart(2, "0"),
    })
  );
};

/** Translation group of a code column, or null to show the value as is. */
const codeGroup = (
  column: string,
  params: Record<string, ParamValue> | undefined
): string | null => {
  if (column === "category") {
    const dimension = params?.dimension;
    return typeof dimension === "string" ? dimension : null;
  }
  return column;
};

/** Label of a code value (plan 2.9 and appendix D.3). */
const formatCode = (
  group: string | null,
  value: string,
  ctx: Pick<FormatContext, "locale" | "t">
): string => {
  const t = ctx.t ?? i18n.getFixedT(ctx.locale);
  if (value === "unknown") return t("analytics.codes.unknown");
  if (group === null) return value;
  if (group === "outing_type_code" || group === "outing_type") {
    // Same labels as getOutingTypeLabel, in the locale of `t`.
    return (BUILTIN_OUTING_TYPE_CODES as readonly string[]).includes(value)
      ? t(`outingTypes.${value}`)
      : value;
  }
  if (group === "age_category" || group === "boat_class") return value;
  return t(`analytics.codes.${group}.${value}`, { defaultValue: value });
};

const formatSeasonValue = (value: SqlValue, seasonStartMonth: number) => {
  const number = toNumber(value);
  return number !== null && Number.isInteger(number)
    ? formatSeason(number, seasonStartMonth)
    : String(value);
};

/**
 * The format a column gets from its name (first matching rule of plan
 * 2.9), looking at a few values for `month`; null for plain numbers and
 * text.
 */
export const resolveFormatByName = (
  column: string,
  sampleValues: SqlValue[] = []
): ResolvedFormat | null => {
  const name = column.toLowerCase();
  if (name === "km" || name.endsWith("_km") || name.startsWith("km_")) {
    return "km";
  }
  if (name.endsWith("_pct")) return "percent";
  if (name === "hours" || name.startsWith("hours") || name.endsWith("hours")) {
    return "hours";
  }
  if (name.endsWith("_min")) return "minutes";
  if (name === "months" || name.endsWith("_months")) return "months";
  if (
    name === "year" ||
    (name.endsWith("_year") && !name.endsWith("_in_year"))
  ) {
    return "year";
  }
  if (
    name.endsWith("_date") ||
    name === "date" ||
    name === "day" ||
    name === "week_start"
  ) {
    return "date";
  }
  if (name.endsWith("_at")) return "datetime";
  if (
    name === "month" ||
    name === "start_month" ||
    name === "start_month_key"
  ) {
    return "month";
  }
  if (name === "weekday" || name === "start_weekday") return "weekday";
  if (name === "hour" || name === "start_hour") return "hour";
  if (name === "season" || name === "cohort" || name === "current_season") {
    return "season";
  }
  if (CODE_COLUMNS.has(name)) return "code";
  if (name.startsWith("is_") || name.startsWith("has_")) {
    const values = sampleValues.filter((v) => v !== null);
    return values.every((v) => v === 0 || v === 1 || v === "0" || v === "1")
      ? "boolean"
      : null;
  }
  return null;
};

/**
 * The format a column gets when the spec names none (`ValueFormat`); yes/no
 * columns, which have no `ValueFormat`, return null and are still shown as
 * yes/no by `formatValue`.
 */
export const inferFormat = (
  column: string,
  sampleValues: SqlValue[]
): ValueFormat | null => {
  const resolved = resolveFormatByName(column, sampleValues);
  if (resolved === "boolean") return null;
  if (resolved) return resolved;
  const values = sampleValues.filter((v) => v !== null);
  if (values.length === 0) return null;
  if (values.every((v) => typeof v === "number")) {
    return values.every((v) => Number.isInteger(v)) ? "integer" : "decimal";
  }
  if (values.every((v) => isDateText(v))) return "date";
  if (values.every((v) => isDateTimeText(v))) return "datetime";
  return null;
};

/** A plain number: the column's decimals, else 0 or 2 by value. */
const plainNumber = (value: number, locale: string, decimals?: number) =>
  decimals !== undefined
    ? fixedNumber(value, locale, decimals)
    : formatNumber(value, locale, Number.isInteger(value) ? 0 : 2);

/** Unit a format puts after its numbers, shown once in a table header. */
export const unitOfFormat = (format: string | null | undefined) =>
  format === "km"
    ? "km"
    : format === "hours"
      ? "h"
      : format === "percent"
        ? "%"
        : null;

/** Words that already say the unit ("Kilomètres", "Heures sur l'eau"). */
const UNIT_WORDS: Record<string, RegExp> = {
  km: /\bkm\b|kilom/i,
  h: /\bh\b|heure|hour|stunde|\bore\b|\buur|\buren\b/i,
  "%": /%/,
};

/** "Distance (km)": a label with its unit, unless it already names it. */
export const labelWithUnit = (label: string, unit: string | null) =>
  !unit || UNIT_WORDS[unit]?.test(label) || label.includes(`(${unit}`)
    ? label
    : `${label} (${unit})`;

/** Formats one value of `column` for display. */
export const formatValue = (
  column: string,
  value: SqlValue,
  ctx: FormatContext
): string => {
  const t = translator(ctx);
  if (value === null || value === undefined) {
    return t("analytics.common.values.null", { defaultValue: "—" });
  }
  const explicit = ctx.format && ctx.format !== "auto" ? ctx.format : undefined;
  const format: ResolvedFormat | null =
    explicit ?? resolveFormatByName(column, [value]);
  const compact = ctx.compact ?? false;
  const number = toNumber(value);
  const { locale, decimals, bare = false } = ctx;
  const unit = (key: string, text: string) =>
    bare ? text : t(`analytics.charts.format.${key}`, { value: text });

  switch (format) {
    case "km":
      if (number === null) return String(value);
      return unit(
        "km",
        decimals !== undefined
          ? fixedNumber(number, locale, decimals)
          : formatNumber(number, locale, Math.abs(number) < 100 ? 1 : 0)
      );
    case "percent": {
      if (number === null) return String(value);
      const digits =
        decimals ??
        (Math.abs(number) < 10 && !Number.isInteger(number) ? 1 : 0);
      if (bare) return fixedNumber(number, locale, digits);
      return withMinus(
        numberFormatter(locale, {
          style: "percent",
          maximumFractionDigits: digits,
          minimumFractionDigits: decimals ?? 0,
        }).format(number / 100)
      );
    }
    case "hours":
      if (number === null) return String(value);
      return unit(
        "hours",
        decimals !== undefined
          ? fixedNumber(number, locale, decimals)
          : formatNumber(number, locale, 1)
      );
    case "year":
      return number === null ? String(value) : String(Math.round(number));
    case "months":
      // A duration in months: "6 mois", "1 month".
      return number === null
        ? String(value)
        : withMinus(
            t("analytics.charts.format.months", {
              count: number,
              value: formatNumber(number, locale, 0),
            })
          );
    case "minutes":
      return number === null ? String(value) : formatMinutes(number, ctx);
    case "date": {
      if (typeof value !== "string") return String(value);
      const date = parseLocalDate(value);
      return date ? formatLocalDate(date, locale, compact) : value;
    }
    case "datetime":
      return typeof value === "string"
        ? formatDateTimeText(value, locale, compact)
        : String(value);
    case "week": {
      if (typeof value === "string") {
        const date = parseLocalDate(value);
        return date
          ? t("analytics.charts.format.weekOf", {
              date: formatLocalDate(date, locale, true),
            })
          : value;
      }
      return number === null
        ? String(value)
        : t("analytics.charts.format.week", { value: number });
    }
    case "month":
      return formatMonth(value, locale, compact);
    case "weekday":
      return number !== null && number >= 1 && number <= 7
        ? weekdayName(number, locale, compact)
        : String(value);
    case "hour":
      return number !== null && number >= 0 && number <= 24
        ? hourLabel(number, locale)
        : String(value);
    case "season":
      return formatSeasonValue(value, ctx.seasonStartMonth);
    case "code":
      return formatCode(
        explicit && !CODE_COLUMNS.has(column)
          ? column
          : codeGroup(column, ctx.params),
        String(value),
        { locale, t }
      );
    case "boolean":
      if (number === 1) return t("analytics.common.values.yes");
      if (number === 0) return t("analytics.common.values.no");
      return String(value);
    case "integer":
      return number === null
        ? String(value)
        : formatNumber(Math.round(number), locale, 0);
    case "decimal":
      if (number === null) return String(value);
      return decimals !== undefined
        ? fixedNumber(number, locale, decimals)
        : formatNumber(number, locale, 2);
    case "text":
      return String(value);
    case null:
      return typeof value === "number"
        ? plainNumber(value, locale, decimals)
        : String(value);
  }
};

/** Fills "{param}" placeholders of a label key with parameter values. */
const fillKey = (key: string, params?: Record<string, ParamValue>) =>
  key.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, name: string) => {
    const value = params?.[name];
    return value === null || value === undefined ? "" : String(value);
  });

/** Parameters as i18next values, without names i18next reserves. */
const RESERVED = new Set([
  "lng",
  "lngs",
  "ns",
  "count",
  "context",
  "defaultValue",
  "ordinal",
  "returnObjects",
  "interpolation",
]);
const safeParams = (params?: Record<string, ParamValue>) =>
  Object.fromEntries(
    Object.entries(params ?? {}).filter(([name]) => !RESERVED.has(name))
  );

/**
 * Column header: literal label, then label key (with "{param}"
 * placeholders), then `analytics.columns.<name>`, else the raw name.
 */
export const columnLabel = (
  column: string,
  t: TFunction,
  labels?: Record<string, string>,
  labelKeys?: Record<string, string>,
  params?: Record<string, ParamValue>
): string => {
  const literal = labels?.[column];
  if (literal) return literal;
  const key = labelKeys?.[column];
  const fallback = t(`analytics.columns.${column}`, { defaultValue: column });
  if (key) {
    const filled = fillKey(key, params);
    if (!filled.endsWith(".")) {
      return t(filled, { ...safeParams(params), defaultValue: fallback });
    }
  }
  return fallback;
};
