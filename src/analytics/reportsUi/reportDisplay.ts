import type { TFunction } from "i18next";
import type { ChartSpec } from "../chartSpec";
import { formatValue, monthName } from "../charts/format";
import { currentSeason, formatSeason } from "../params/season";
import type {
  ParamValue,
  QueryResult,
  ReportDefinition,
  SqlValue,
} from "../types";

/**
 * How the report page shows a report (review C, I): the chart it draws
 * when it differs from the catalogue's (the catalogue chart stays the
 * summary drawn by the dashboard and the annual report), the reshaping of
 * a result for that chart, the season names in the legends and the notes
 * that depend on the data. The SQL and its columns are left as they are:
 * the annual report and the MCP clients read them.
 */

/** Charts of the report page that differ from `report.chart`. */
const PAGE_CHARTS: Record<string, ChartSpec> = {
  // "Faut-il acheter un bateau ?": the saturated days answer it (C 10).
  "fleet-by-class": {
    type: "table",
    columns: [
      "boat_class",
      "saturated_days",
      "max_concurrent",
      "fleet_size",
      "outings",
      "outings_per_boat",
      "km",
    ],
  },
  // The grant form's table: age groups by gender, with totals (C 14).
  "active-members-demographics": {
    type: "table",
    labelKeys: {
      female: "analytics.reports.labels.female",
      male: "analytics.reports.labels.male",
      other_gender: "analytics.reports.labels.otherGender",
      unknown_gender: "analytics.reports.labels.unknownGender",
      total: "analytics.reports.labels.total",
    },
  },
  // A rate compares a busy boat with a quiet one (C 13).
  "incidents-per-boat": {
    type: "bar",
    x: "boat_name",
    y: ["incidents_per_100_outings"],
    orientation: "horizontal",
    stacked: false,
    sort: "desc",
    limit: 25,
  },
};

/** The chart of the report page. */
export const reportPageChart = (
  report: Pick<ReportDefinition, "id" | "chart">
): ChartSpec => PAGE_CHARTS[report.id] ?? report.chart;

const toNumber = (value: SqlValue | undefined): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
};

const columnAt = (result: QueryResult, name: string) =>
  result.columns.findIndex((column) => column.name === name);

const AGE_GROUPS = ["youth", "adult", "unknown"];
const GENDER_COLUMNS: [string, string][] = [
  ["female", "female"],
  ["male", "male"],
  ["other", "other_gender"],
  ["unknown", "unknown_gender"],
];

/**
 * active-members-demographics as the grant form asks for it: one row per
 * age group, one column per gender (headcounts), totals last. "Other" is
 * shown only when someone has it; "not specified" always, so the gap in
 * the records is visible.
 */
export const pivotDemographics = (
  result: QueryResult,
  t: TFunction
): QueryResult => {
  const age = columnAt(result, "age_group");
  const gender = columnAt(result, "gender");
  const count = columnAt(result, "active_rowers");
  if (age === -1 || gender === -1 || count === -1) return result;
  const cells = new Map<string, number>();
  for (const row of result.rows) {
    const key = `${row[age]}|${row[gender]}`;
    cells.set(key, (cells.get(key) ?? 0) + (toNumber(row[count]) ?? 0));
  }
  const genders = GENDER_COLUMNS.filter(
    ([code]) =>
      code !== "other" || result.rows.some((row) => row[gender] === "other")
  );
  const groups = [
    ...AGE_GROUPS.filter(
      (group) =>
        group !== "unknown" || result.rows.some((row) => row[age] === group)
    ),
    ...[
      ...new Set(
        result.rows
          .map((row) => String(row[age]))
          .filter((group) => !AGE_GROUPS.includes(group))
      ),
    ],
  ];
  const rows: SqlValue[][] = groups.map((group) => {
    const values = genders.map(([code]) => cells.get(`${group}|${code}`) ?? 0);
    return [group, ...values, values.reduce((a, b) => a + b, 0)];
  });
  const totals = genders.map((_, index) =>
    rows.reduce((sum, row) => sum + (row[index + 1] as number), 0)
  );
  rows.push([
    t("analytics.reports.labels.total"),
    ...totals,
    totals.reduce((a, b) => a + b, 0),
  ]);
  return {
    ...result,
    columns: [
      result.columns[age],
      ...genders.map(([, name]) => ({ name, declType: "INTEGER" })),
      { name: "total", declType: "INTEGER" },
    ],
    rows,
  };
};

/**
 * retention-cohorts without the arrival season, always 100 % (review
 * C 16). The seasons after stay numbers, so the heatmap titles the axis
 * "Saisons après l'arrivée" and keeps every column label short.
 */
export const retentionAfterArrival = (result: QueryResult): QueryResult => {
  const after = columnAt(result, "seasons_after");
  if (after === -1) return result;
  return {
    ...result,
    rows: result.rows.filter((row) => (toNumber(row[after]) ?? 0) > 0),
  };
};

/**
 * The result as the report page shows it with `spec`: a customised chart
 * of the demographics report gets the rows of the SQL.
 */
export const pageResult = (
  report: Pick<ReportDefinition, "id">,
  spec: ChartSpec,
  result: QueryResult,
  t: TFunction
): QueryResult => {
  if (report.id === "retention-cohorts") return retentionAfterArrival(result);
  if (
    report.id === "active-members-demographics" &&
    spec === PAGE_CHARTS["active-members-demographics"]
  ) {
    return pivotDemographics(result, t);
  }
  return result;
};

export interface DisplayContext {
  t: TFunction;
  locale: string;
  season: number;
  seasonStartMonth: number;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm". */
  now: string;
}

/** Season-against-season reports and their two measures. */
const SEASON_PAIRS: Record<string, [string, string]> = {
  "yoy-monthly": ["value", "value_prev"],
  "yoy-cumulative": ["outings_cumulative", "outings_cumulative_prev"],
};

const hasPrevious = (result: QueryResult | null, column: string) => {
  if (!result) return true;
  const index = columnAt(result, column);
  return (
    index !== -1 && result.rows.some((row) => (toNumber(row[index]) ?? 0) !== 0)
  );
};

/**
 * A season-against-season chart without the previous season when it has
 * no data (review C 17); the chart names both seasons in its legend. For
 * the dashboard cards too.
 */
export const dropEmptyPrevious = (
  report: Pick<ReportDefinition, "id">,
  spec: ChartSpec,
  result: QueryResult | null
): ChartSpec => {
  const pair = SEASON_PAIRS[report.id];
  if (!pair || (spec.type !== "bar" && spec.type !== "line")) return spec;
  const previous = pair[1];
  if (!spec.y.includes(previous) || hasPrevious(result, previous)) return spec;
  return { ...spec, y: spec.y.filter((column) => column !== previous) };
};

/** The last day of the month of a "YYYY-MM-DD" date. */
const isLastDayOfMonth = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate() === day;
};

/** "YYYY-MM-DD" of `now`, when `season` is running; null otherwise. */
export const runningSeasonDay = (
  season: number,
  ctx: Pick<DisplayContext, "seasonStartMonth" | "now">
): string | null =>
  currentSeason(ctx.now, ctx.seasonStartMonth) === season
    ? ctx.now.slice(0, 10)
    : null;

const longDate = (date: string, locale: string, seasonStartMonth: number) =>
  formatValue("cutoff_date", date, {
    locale,
    seasonStartMonth,
    format: "date",
  });

/**
 * Notes that depend on the data shown: the month in progress of a
 * season-against-season report, and a previous season without data.
 */
export const dataHints = (
  report: Pick<ReportDefinition, "id">,
  result: QueryResult | null,
  ctx: DisplayContext
): string[] => {
  const pair = SEASON_PAIRS[report.id];
  if (!pair || !result) return [];
  const hints: string[] = [];
  const today = runningSeasonDay(ctx.season, ctx);
  if (report.id === "yoy-monthly" && today && !isLastDayOfMonth(today)) {
    const month = Number(today.slice(5, 7));
    const label = monthName(month, ctx.locale);
    hints.push(
      ctx.t("analytics.reports.hints.partialMonth", {
        month: label.charAt(0).toLocaleUpperCase(ctx.locale) + label.slice(1),
        date: longDate(today, ctx.locale, ctx.seasonStartMonth),
      })
    );
  }
  if (!hasPrevious(result, pair[1]) && result.rows.length > 0) {
    hints.push(
      ctx.t("analytics.reports.hints.noPrevious", {
        season: formatSeason(ctx.season - 1, ctx.seasonStartMonth),
      })
    );
  }
  return hints;
};

/**
 * "Saison 2025-2026 · en cours, données jusqu'au 20 juin 2026", "Sur les
 * 365 derniers jours · la saison choisie ne s'applique pas" or "Tout
 * l'historique du club · …" (review F 40).
 */
export const scopeLine = (
  report: Pick<ReportDefinition, "params">,
  values: Record<string, ParamValue>,
  ctx: DisplayContext & { fixedSeason: boolean }
): string => {
  const { t } = ctx;
  if (report.params.some((def) => def.type === "season")) {
    const parts = [
      t("analytics.reports.scope.season", {
        season: formatSeason(ctx.season, ctx.seasonStartMonth),
      }),
    ];
    const today = runningSeasonDay(ctx.season, ctx);
    if (today) {
      parts.push(
        t("analytics.reports.scope.running", {
          date: longDate(today, ctx.locale, ctx.seasonStartMonth),
        })
      );
    }
    if (ctx.fixedSeason) parts.push(t("analytics.reports.scope.fixed"));
    return parts.join(" · ");
  }
  const period = report.params.find(
    (def) => def.labelKey === "analytics.params.periodDays"
  );
  const days = period ? values[period.name] : null;
  const first =
    period && typeof days === "number"
      ? t("analytics.reports.scope.lastDays", {
          days: new Intl.NumberFormat(ctx.locale).format(days),
        })
      : t("analytics.reports.scope.allHistory");
  return `${first} · ${t("analytics.reports.scope.noSeason")}`;
};

/** Footnotes that concern what is shown (review F 41). */
const FOOTNOTE_COLUMNS: Record<string, RegExp> = {
  km: /km/,
  multiDay: /hours/,
  noStartTime: /hour|weekday/,
};

export const relevantNotes = (
  notes: string[],
  result: QueryResult | null,
  spec: ChartSpec,
  values: Record<string, ParamValue>
): string[] => {
  if (!result) return notes;
  const shown = [
    ...(spec.type === "table" && spec.columns
      ? spec.columns
      : result.columns.map((column) => column.name)),
    ...Object.values(values).map((value) => String(value ?? "")),
  ];
  return notes.filter((note) => {
    const pattern = FOOTNOTE_COLUMNS[note];
    return !pattern || shown.some((name) => pattern.test(name));
  });
};

/**
 * The question of a description (up to its first "?", else its first
 * sentence) and the rest (review D 25).
 */
export const splitDescription = (
  description: string
): { question: string; rest: string } => {
  const text = description.trim();
  const mark = text.indexOf("?");
  let end = mark === -1 ? text.search(/\.(\s|$)/) : mark;
  if (end === -1) return { question: text, rest: "" };
  end += 1;
  return { question: text.slice(0, end), rest: text.slice(end).trim() };
};
