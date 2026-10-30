import type { TFunction } from "i18next";
import type { ParamDef } from "../chartSpec";
import type {
  ParamValue,
  QueryResult,
  ReportDefinition,
  SqlValue,
} from "../types";
import { formatSeason } from "../params/season";
import { formatValue } from "../charts/format";
import { canSeeReport } from "../access/canSee";
import { paramLabel } from "../params/labels";
import {
  reportDescriptionKey,
  reportHowToReadKey,
  reportKeywordsKey,
  reportTitleKey,
} from "../reports/catalog";

/**
 * Small helpers shared by the report view, the dashboard cards and the
 * annual report: titles, parameter summaries, the partial-season note and
 * accent-insensitive search.
 */

export const reportTitle = (reportId: string, t: TFunction): string =>
  t(reportTitleKey(reportId), { defaultValue: reportId });

export const reportDescription = (reportId: string, t: TFunction): string =>
  t(reportDescriptionKey(reportId), { defaultValue: "" });

/** "Comment lire ce rapport" text, empty when the report has none. */
export const reportHowToRead = (reportId: string, t: TFunction): string =>
  t(reportHowToReadKey(reportId), { defaultValue: "" });

/** Names of the parameters the hub's season selector sets. */
export const seasonParamNames = (defs: ParamDef[]): string[] =>
  defs.filter((def) => def.type === "season").map((def) => def.name);

/** Label of a parameter (plan 2.7), shared with the params bar. */
export { paramLabel };

/**
 * Human value of a resolved parameter, or null when it is not worth
 * showing in a subtitle (empty, or an id such as a boat or a rower).
 */
const paramValueText = (
  def: ParamDef,
  value: ParamValue,
  ctx: { t: TFunction; locale: string; seasonStartMonth: number }
): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const { t } = ctx;
  switch (def.type) {
    case "season":
      return typeof value === "number"
        ? t("analytics.common.season.value", {
            label: formatSeason(value, ctx.seasonStartMonth),
          })
        : null;
    case "choice": {
      const text = String(value);
      const option = def.options?.find((o) => o.value === text);
      return t(`analytics.codes.${def.name}.${text}`, {
        defaultValue: option?.label ?? text,
      });
    }
    case "boolean":
      return t(
        value === 1 || value === true
          ? "analytics.common.values.yes"
          : "analytics.common.values.no"
      );
    case "integer":
      return typeof value === "number"
        ? new Intl.NumberFormat(ctx.locale).format(value)
        : String(value);
    case "date":
      return formatValue(def.name, String(value), {
        locale: ctx.locale,
        seasonStartMonth: ctx.seasonStartMonth,
        format: "date",
      });
    case "boat":
    case "rower":
    case "route":
      return null;
    case "outing_type":
    case "boat_class":
    case "text":
      return String(value);
  }
};

/**
 * "Saison 2025-2026 · Métrique : sorties": the season first, then the
 * other parameters that have a readable value.
 */
export const paramsSummary = (
  defs: ParamDef[],
  values: Record<string, ParamValue>,
  ctx: { t: TFunction; locale: string; seasonStartMonth: number }
): string => {
  const ordered = [
    ...defs.filter((def) => def.type === "season"),
    ...defs.filter((def) => def.type !== "season"),
  ];
  const parts: string[] = [];
  for (const def of ordered) {
    const text = paramValueText(def, values[def.name] ?? null, ctx);
    if (text === null) continue;
    parts.push(
      def.type === "season"
        ? text
        : ctx.t("analytics.dashboard.card.param", {
            label: paramLabel(def, ctx.t),
            value: text,
          })
    );
  }
  return parts.join(" · ");
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The day before a "YYYY-MM-DD" date, built from local components. */
export const previousDay = (date: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const day = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) - 1
  );
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
};

const cell = (result: QueryResult, column: string): SqlValue | undefined => {
  const index = result.columns.findIndex((c) => c.name === column);
  return index === -1 ? undefined : result.rows[0]?.[index];
};

/**
 * Last day with data when the result says the season is still running
 * (`is_partial` = 1 and an exclusive `cutoff_date`, as season-overview
 * returns them); null otherwise.
 */
export const partialSeasonEnd = (result: QueryResult | null): string | null => {
  if (!result || result.rows.length === 0) return null;
  const partial = cell(result, "is_partial");
  const cutoff = cell(result, "cutoff_date");
  if ((partial !== 1 && partial !== "1") || typeof cutoff !== "string") {
    return null;
  }
  return previousDay(cutoff);
};

/** Lower case without accents, for the catalogue search. */
export const foldText = (text: string): string =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Everything a volunteer may type to find a report (review D 22): title,
 * description, reading guide, theme and the report's own keywords.
 */
const searchText = (
  report: Pick<ReportDefinition, "id"> & { category?: string },
  t: TFunction
): string =>
  foldText(
    [
      reportTitle(report.id, t),
      reportDescription(report.id, t),
      reportHowToRead(report.id, t),
      report.category
        ? t(`analytics.reports.categories.${report.category}`, {
            defaultValue: "",
          })
        : "",
      t(reportKeywordsKey(report.id), { defaultValue: "" }),
    ].join(" ")
  );

/**
 * True when every word of the query is found. Words of one or two
 * letters ("km", "AG") must be whole words, so "AG" does not find "âge".
 */
export const matchesSearch = (
  query: string,
  report: Pick<ReportDefinition, "id"> & { category?: string },
  t: TFunction
): boolean => {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = searchText(report, t);
  const tokens = new Set(haystack.split(/[^\p{L}\p{N}]+/u));
  return words.every((word) =>
    word.length <= 2 ? tokens.has(word) : haystack.includes(word)
  );
};

/** Result rows cut to `limit` (annual top 10). */
export const limitRows = (
  result: QueryResult,
  limit: number | undefined
): QueryResult =>
  limit === undefined || result.rows.length <= limit
    ? result
    : { ...result, rows: result.rows.slice(0, limit) };

/** True when the result has no row, or only nulls. */
export const isEmptyResult = (result: QueryResult): boolean =>
  result.rows.length === 0 ||
  result.rows.every((row) => row.every((value) => value === null));

/**
 * The SQL a report view or a dashboard card may run, or null (plan 1.5,
 * 1.6): never for a report the viewer may not see (decided before any
 * query is issued), nor before its availability is known, nor while a
 * required parameter is empty.
 */
export const reportQuerySql = (
  report: Pick<ReportDefinition, "sql" | "visibility">,
  ctx: {
    isUnlocked: boolean;
    publicRankings: boolean;
    availability: { available: boolean } | "pending";
    missingRequired: boolean;
  }
): string | null => {
  if (!canSeeReport(report, ctx) || ctx.missingRequired) return null;
  if (ctx.availability === "pending" || !ctx.availability.available) {
    return null;
  }
  return report.sql;
};
