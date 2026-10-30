import type { TFunction } from "i18next";
import { columnLabel, formatValue } from "../charts/format";
import { buildKpiTiles } from "../charts/kinds/KpiTiles";
import { getChartTheme } from "../charts/palette";
import { formatSeason, seasonBounds } from "../params/season";
import {
  ANNUAL_CHAPTERS,
  ANNUAL_REPORT_SECTIONS,
  annualChapterKey,
  AnnualChapterId,
  AnnualReportSection,
  AnnualSectionId,
} from "../reports/annual";
import { limitRows, partialSeasonEnd } from "../reportsUi/reportHelpers";
import type { ChartSpec, ParamValue, QueryResult, SqlValue } from "../types";
import type {
  AnnualChapterDoc,
  AnnualDocument,
  AnnualKpi,
  AnnualSectionDoc,
  AnnualTable,
} from "./annualHtml";
import type { AnnualXlsxInput, AnnualXlsxKpi } from "./annualXlsx";

/**
 * The annual report's content, computed once from the query results and
 * shared by its three outputs (the preview, the printable HTML and Excel),
 * so they always agree: section titles and notes, the figures that need a
 * reading key (first season, partial month, members against guests),
 * which sections are printed, and the translated, formatted documents.
 */

export interface AnnualFormatContext {
  t: TFunction;
  locale: string;
  seasonStartMonth: number;
}

/** One planned section with the state of its query. */
export interface AnnualSectionInput {
  key: string;
  id: AnnualSectionId;
  /** The report's chart, the section's `limit` applied. */
  spec: ChartSpec;
  params: Record<string, ParamValue>;
  status: "loading" | "success" | "error";
  /** The whole result (before `limit`), null while loading or on error. */
  result: QueryResult | null;
}

/**
 * - `kpi`, `chart`: printed with its figures or chart;
 * - `goodNews`: empty, and that is good news (no incident): one sentence;
 * - `omitted`: no data, left out of the outputs;
 * - `error`: could not be computed, left out of the outputs.
 */
export type AnnualSectionKind =
  | "loading"
  | "error"
  | "kpi"
  | "chart"
  | "goodNews"
  | "omitted";

export interface PreparedAnnualSection {
  key: string;
  id: AnnualSectionId;
  chapter: AnnualChapterId | null;
  kind: AnnualSectionKind;
  title: string;
  intro: string;
  /** The chart to draw (labels, comparison and orientation adjusted). */
  spec: ChartSpec;
  /** The rows to show (limited, filtered); null while loading or on error. */
  result: QueryResult | null;
  params: Record<string, ParamValue>;
  /** Reading notes under the chart. */
  notes: string[];
  /** The good-news sentence of an empty section. */
  emptyText: string | null;
  sheetName: string | null;
  height?: number;
  exportHeight?: number;
}

export interface AnnualFacts {
  /** Last day with data when the season is still running. */
  partialEnd: string | null;
  /** No outing last season: nothing to compare with. */
  firstSeason: boolean;
  /** The overview resolved with no outing this season. */
  noOutings: boolean;
  /** The previous season has outings (to suggest it). */
  previousHasOutings: boolean;
  hasKm: boolean;
  hasCoached: boolean;
}

export interface PreparedAnnualReport {
  season: number;
  sections: PreparedAnnualSection[];
  facts: AnnualFacts;
  /** Sections done (success or error), for the progress line. */
  done: number;
  ready: boolean;
}

const DEFINITIONS: Record<AnnualSectionId, AnnualReportSection> =
  Object.fromEntries(
    ANNUAL_REPORT_SECTIONS.map((section) => [section.id, section])
  ) as Record<AnnualSectionId, AnnualReportSection>;

const CHAPTER_OF = new Map<AnnualSectionId, AnnualChapterId | null>(
  ANNUAL_CHAPTERS.flatMap((chapter) =>
    chapter.sections.map((id) => [id, chapter.id] as const)
  )
);

const columnAt = (result: QueryResult, column: string) =>
  result.columns.findIndex((c) => c.name === column);

const toNumber = (value: SqlValue | undefined): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
};

const firstRowValue = (result: QueryResult | null, column: string) => {
  if (!result) return null;
  const index = columnAt(result, column);
  return index === -1 ? null : (result.rows[0]?.[index] ?? null);
};

const sumOf = (result: QueryResult, column: string) => {
  const index = columnAt(result, column);
  if (index === -1) return null;
  return result.rows.reduce((sum, row) => sum + (toNumber(row[index]) ?? 0), 0);
};

/** Columns holding the measures a chart draws. */
const measureColumns = (spec: ChartSpec): string[] => {
  switch (spec.type) {
    case "bar":
    case "line":
    case "area":
      return spec.y;
    case "kpi":
      return spec.items.flatMap((item) =>
        item.compare ? [item.value, item.compare] : [item.value]
      );
    case "pie":
    case "heatmap":
    case "calendar":
      return [spec.value];
    case "table":
      return [];
  }
};

/**
 * True when the annual report has nothing to show for this result: no
 * row, or every measure is 0 or empty (a season with no outing draws no
 * chart of zeros).
 */
export const isAnnualEmpty = (
  spec: ChartSpec,
  result: QueryResult | null
): boolean => {
  if (!result || result.rows.length === 0) return true;
  const measures =
    spec.type === "kpi"
      ? spec.items.map((item) => item.value)
      : measureColumns(spec);
  const indexes = measures
    .map((name) => columnAt(result, name))
    .filter((index) => index !== -1);
  if (indexes.length === 0) {
    return result.rows.every((row) => row.every((value) => value === null));
  }
  return result.rows.every((row) =>
    indexes.every((index) => {
      const value = row[index] ?? null;
      return value === null || toNumber(value) === 0;
    })
  );
};

/** "19 juin 2026" from "2026-06-19". */
const longDate = (date: string, ctx: AnnualFormatContext) =>
  formatValue("date", date, {
    locale: ctx.locale,
    seasonStartMonth: ctx.seasonStartMonth,
    format: "date",
  });

const percentText = (value: number, ctx: AnnualFormatContext) =>
  formatValue("retention_pct", value, {
    locale: ctx.locale,
    seasonStartMonth: ctx.seasonStartMonth,
    format: "percent",
  });

const integerText = (value: number, ctx: AnnualFormatContext) =>
  new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 0 }).format(value);

const pad = (value: number) => String(value).padStart(2, "0");

/** Last day of the month of a "YYYY-MM-DD" date. */
const isLastDayOfMonth = (date: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return false;
  const next = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)
  );
  return next.getUTCDate() === 1;
};

/** "Juin 2026" (capitalised: it starts a sentence). */
const monthOf = (date: string, ctx: AnnualFormatContext) => {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return date;
  const text = new Intl.DateTimeFormat(ctx.locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
  return text.charAt(0).toLocaleUpperCase(ctx.locale) + text.slice(1);
};

/** What the overview says about the season. */
export const annualFacts = (sections: AnnualSectionInput[]): AnnualFacts => {
  const overview = sections.find(
    (section) => section.id === "overview" && section.status === "success"
  );
  const result = overview?.result ?? null;
  const outings = toNumber(firstRowValue(result, "outings"));
  const previous = toNumber(firstRowValue(result, "outings_prev"));
  return {
    partialEnd: partialSeasonEnd(result),
    firstSeason: !!result && (previous === null || previous === 0),
    noOutings: !!result && (outings === null || outings === 0),
    previousHasOutings: previous !== null && previous > 0,
    hasKm: toNumber(firstRowValue(result, "km")) !== null,
    hasCoached: toNumber(firstRowValue(result, "coached_pct")) !== null,
  };
};

/**
 * Retention for the report's season only: cohorts up to it and the
 * seasons reached by then, "+1 saison" instead of 1. The heatmap keeps
 * the order of the rows (cohorts, then seasons after).
 */
const retentionForSeason = (
  result: QueryResult,
  season: number,
  ctx: AnnualFormatContext
): QueryResult => {
  const cohort = columnAt(result, "cohort");
  const after = columnAt(result, "seasons_after");
  if (cohort === -1 || after === -1) return result;
  const rows = result.rows
    .filter((row) => {
      const c = toNumber(row[cohort]);
      const a = toNumber(row[after]);
      return c !== null && a !== null && c <= season && c + a <= season;
    })
    .map((row) => {
      const copy = [...row];
      const a = toNumber(row[after]) ?? 0;
      copy[after] =
        a === 0
          ? ctx.t("analytics.annual.retention.joined")
          : ctx.t("analytics.annual.retention.after", { count: a });
      return copy;
    });
  return { ...result, rows };
};

const retentionNotes = (
  full: QueryResult,
  season: number,
  ctx: AnnualFormatContext
): string[] => {
  const cohort = columnAt(full, "cohort");
  const after = columnAt(full, "seasons_after");
  const size = columnAt(full, "cohort_size");
  const pct = columnAt(full, "retention_pct");
  if (cohort === -1 || after === -1) return [];
  const find = (c: number, a: number) =>
    full.rows.find(
      (row) => toNumber(row[cohort]) === c && toNumber(row[after]) === a
    );
  const arrivalsRow = find(season, 0);
  const arrivals =
    arrivalsRow && size !== -1 ? toNumber(arrivalsRow[size]) : null;
  const returnedRow = find(season - 1, 1);
  const returned =
    returnedRow && pct !== -1 ? toNumber(returnedRow[pct]) : null;
  const seasonText = formatSeason(season, ctx.seasonStartMonth);
  const prevText = formatSeason(season - 1, ctx.seasonStartMonth);
  const notes: string[] = [];
  const args = {
    arrivals: arrivals === null ? "" : integerText(arrivals, ctx),
    season: seasonText,
    pct: returned === null ? "" : percentText(returned, ctx),
    prev: prevText,
  };
  if (arrivals !== null && returned !== null) {
    notes.push(ctx.t("analytics.annual.notesFor.retentionBoth", args));
  } else if (arrivals !== null) {
    notes.push(ctx.t("analytics.annual.notesFor.retentionArrivals", args));
  } else if (returned !== null) {
    notes.push(ctx.t("analytics.annual.notesFor.retentionReturned", args));
  }
  const cohorts = full.rows
    .map((row) => toNumber(row[cohort]))
    .filter((c): c is number => c !== null);
  if (cohorts.length > 0 && Math.min(...cohorts) <= season) {
    notes.push(ctx.t("analytics.annual.notesFor.retentionFirst"));
  }
  return notes;
};

/** Every section's title, chart, rows and notes for one season. */
export const prepareAnnualReport = (
  inputs: AnnualSectionInput[],
  ctx: AnnualFormatContext,
  season: number
): PreparedAnnualReport => {
  const { t } = ctx;
  const facts = annualFacts(inputs);
  const overview = inputs.find((input) => input.id === "overview")?.result;
  const seasonText = formatSeason(season, ctx.seasonStartMonth);
  const previousText = formatSeason(season - 1, ctx.seasonStartMonth);

  const sections = inputs.map((input): PreparedAnnualSection => {
    const definition = DEFINITIONS[input.id];
    const base = {
      key: input.key,
      id: input.id,
      chapter: CHAPTER_OF.get(input.id) ?? null,
      intro: t(definition.introKey),
      params: input.params,
      sheetName: definition.sheetKey ? t(definition.sheetKey) : null,
      height: definition.height,
      exportHeight: definition.exportHeight,
      emptyText: null,
      notes: [] as string[],
    };
    const titleOf = (count?: number) =>
      t(definition.titleKey, count === undefined ? undefined : { count });
    if (input.status !== "success" || !input.result) {
      return {
        ...base,
        kind: input.status === "error" ? "error" : "loading",
        title: titleOf(definition.limit),
        spec: input.spec,
        result: null,
      };
    }

    const full = input.result;
    let spec: ChartSpec = input.spec;
    let result = limitRows(full, definition.limit);
    const notes: string[] = [];
    let intro = base.intro;

    switch (input.id) {
      case "overview":
        if (spec.type === "kpi") {
          spec = {
            ...spec,
            labels: {
              ...spec.labels,
              coached_pct: t("analytics.annual.labels.coachedPct"),
            },
            items: facts.firstSeason
              ? spec.items.map((item) => ({ ...item, compare: undefined }))
              : spec.items,
          };
          if (facts.firstSeason) {
            // "Comparé à la saison précédente" with nothing to compare.
            intro = "";
            if (!facts.noOutings) {
              notes.push(t("analytics.annual.notesFor.firstSeason"));
            }
          }
        }
        break;
      case "outingsMonthly":
      case "activeRowersMonthly":
        if (spec.type === "bar") {
          const prev = columnAt(result, "value_prev");
          const noPrevious =
            prev === -1 ||
            result.rows.every((row) => (toNumber(row[prev]) ?? 0) === 0);
          spec = {
            ...spec,
            labels: {
              ...spec.labels,
              value: seasonText,
              value_prev: previousText,
            },
            y: noPrevious ? spec.y.filter((y) => y !== "value_prev") : spec.y,
          };
          if (noPrevious) intro = t(`analytics.annual.introsAlone.${input.id}`);
        }
        if (facts.partialEnd && !isLastDayOfMonth(facts.partialEnd)) {
          notes.push(
            t("analytics.annual.notesFor.partialMonth", {
              month: monthOf(facts.partialEnd, ctx),
              date: longDate(facts.partialEnd, ctx),
            })
          );
        }
        break;
      case "demographics": {
        if (spec.type === "bar") spec = { ...spec, orientation: "horizontal" };
        const members = sumOf(result, "active_rowers");
        const active = toNumber(
          firstRowValue(overview ?? null, "active_rowers")
        );
        if (members !== null && active !== null && active - members > 0) {
          notes.push(
            t("analytics.annual.notesFor.demographics", {
              members: integerText(members, ctx),
              active: integerText(active, ctx),
              guests: integerText(active - members, ctx),
            })
          );
        }
        break;
      }
      case "retention":
        result = retentionForSeason(full, season, ctx);
        if (result.rows.length > 0) {
          notes.push(...retentionNotes(full, season, ctx));
        }
        break;
      case "incidents": {
        const total = sumOf(full, "incidents");
        const index = columnAt(full, "incidents");
        const boats =
          index === -1
            ? 0
            : full.rows.filter((row) => (toNumber(row[index]) ?? 0) > 0).length;
        if (total !== null && total > 0) {
          notes.push(
            total > 1 && boats === 1
              ? t("analytics.annual.notesFor.incidentsOneBoat", {
                  count: total,
                })
              : t("analytics.annual.notesFor.incidents", {
                  count: total,
                  boats: integerText(boats, ctx),
                })
          );
        }
        break;
      }
      default:
        break;
    }

    const empty = isAnnualEmpty(spec, result);
    const kind: AnnualSectionKind = empty
      ? definition.emptyKey
        ? "goodNews"
        : "omitted"
      : spec.type === "kpi"
        ? "kpi"
        : "chart";
    return {
      ...base,
      intro,
      kind,
      title: titleOf(definition.limit ? result.rows.length : undefined),
      spec,
      result,
      notes: empty ? [] : notes,
      emptyText:
        kind === "goodNews" && definition.emptyKey
          ? t(definition.emptyKey)
          : null,
    };
  });

  const done = inputs.filter((input) => input.status !== "loading").length;
  return {
    season,
    sections,
    facts,
    done,
    ready: done === inputs.length,
  };
};

/** Sections printed in the outputs (not empty, not failed). */
export const printedSections = (report: PreparedAnnualReport) =>
  report.sections.filter(
    (section) =>
      section.kind === "kpi" ||
      section.kind === "chart" ||
      section.kind === "goodNews"
  );

/** Sections whose chart is drawn for the exports. */
export const chartSections = (report: PreparedAnnualReport) =>
  report.sections.filter((section) => section.kind === "chart");

/** The printed sections grouped in chapters, empty chapters left out. */
export const annualChapters = <T extends { id: AnnualSectionId }>(
  sections: T[]
): { id: AnnualChapterId | null; sections: T[] }[] =>
  ANNUAL_CHAPTERS.map((chapter) => ({
    id: chapter.id,
    sections: chapter.sections.flatMap((id) =>
      sections.filter((section) => section.id === id)
    ),
  })).filter((chapter) => chapter.sections.length > 0);

/** The date the report is issued on, in words ("20 juin 2026"). */
export const formatGenerationDate = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);

/** "du 1 août 2025 au 19 juin 2026 (saison en cours)". */
export const annualPeriodRange = (
  ctx: AnnualFormatContext,
  input: { season: number; partialEnd: string | null }
): string => {
  const bounds = seasonBounds(input.season, ctx.seasonStartMonth);
  const [y, m, d] = bounds.end.split("-").map(Number);
  const dayBefore = new Date(Date.UTC(y, m - 1, d - 1));
  const lastDay = `${dayBefore.getUTCFullYear()}-${pad(dayBefore.getUTCMonth() + 1)}-${pad(dayBefore.getUTCDate())}`;
  const partialEnd =
    input.partialEnd !== null &&
    input.partialEnd >= bounds.start &&
    input.partialEnd < lastDay
      ? input.partialEnd
      : null;
  return ctx.t(
    partialEnd
      ? "analytics.annual.meta.rangePartial"
      : "analytics.annual.meta.range",
    {
      start: longDate(bounds.start, ctx),
      end: longDate(partialEnd ?? lastDay, ctx),
    }
  );
};

/** The cover's meta line: period, then the issue date. */
export const annualMeta = (
  ctx: AnnualFormatContext,
  input: { season: number; partialEnd: string | null; issuedOn: string }
) =>
  `${ctx.t("analytics.annual.meta.period", {
    range: annualPeriodRange(ctx, input),
  })} · ${ctx.t("analytics.annual.meta.issued", { date: input.issuedOn })}`;

/** The "Définitions" list: only the terms the document uses. */
export const annualDefinitions = (
  ctx: AnnualFormatContext,
  facts: AnnualFacts
): string[] => [
  ctx.t("analytics.annual.definitions.activeRower"),
  ...(facts.hasCoached ? [ctx.t("analytics.annual.definitions.coached")] : []),
  ctx.t("analytics.annual.definitions.hours"),
  ...(facts.hasKm ? [ctx.t("analytics.annual.definitions.km")] : []),
];

/** Columns a chart shows, in reading order, with their role. */
const specColumns = (
  spec: ChartSpec,
  result: QueryResult
): { name: string; measure: boolean }[] => {
  const all = result.columns.map((column) => column.name);
  const seen = new Set<string>();
  const pick = (names: (string | undefined)[], measure: boolean) =>
    names.flatMap((name) => {
      if (!name || !all.includes(name) || seen.has(name)) return [];
      seen.add(name);
      return [{ name, measure }];
    });
  switch (spec.type) {
    case "table":
      return pick(spec.columns ?? all, false);
    case "kpi":
      return pick(
        spec.items.flatMap((item) => [item.value, item.compare]),
        true
      );
    case "bar":
    case "line":
    case "area":
      return [...pick([spec.x, spec.series], false), ...pick(spec.y, true)];
    case "pie":
      return [...pick([spec.label], false), ...pick([spec.value], true)];
    case "heatmap":
      return [...pick([spec.y, spec.x], false), ...pick([spec.value], true)];
    case "calendar":
      return [...pick([spec.date], false), ...pick([spec.value], true)];
  }
};

/** The table of a section: the chart's columns, in the chart's order. */
export const annualTable = (
  section: Pick<PreparedAnnualSection, "spec" | "result" | "params">,
  ctx: AnnualFormatContext
): AnnualTable | null => {
  const { spec, result, params } = section;
  if (!result) return null;
  const columns = specColumns(spec, result);
  const indexes = columns.map(({ name }) => columnAt(result, name));
  let rows = result.rows;
  if (spec.type === "bar" && spec.sort !== "none") {
    const sortIndex = columnAt(result, spec.y[0]);
    const sign = spec.sort === "asc" ? 1 : -1;
    rows = rows
      .map((row, position) => ({ row, position }))
      .sort(
        (a, b) =>
          sign *
            ((toNumber(a.row[sortIndex]) ?? 0) -
              (toNumber(b.row[sortIndex]) ?? 0)) || a.position - b.position
      )
      .map(({ row }) => row);
  }
  const formats = spec.formats ?? {};
  return {
    headers: columns.map(({ name }) =>
      columnLabel(name, ctx.t, spec.labels, spec.labelKeys, params)
    ),
    rows: rows.map((row) =>
      indexes.map((index, i) =>
        formatValue(columns[i].name, row[index] ?? null, {
          locale: ctx.locale,
          seasonStartMonth: ctx.seasonStartMonth,
          format: formats[columns[i].name],
          params,
          t: ctx.t,
        })
      )
    ),
    numeric: columns.map(({ measure }) => measure),
  };
};

/** The key figures as the app's tiles show them: trend, change, last season. */
const kpisOf = (
  section: PreparedAnnualSection,
  ctx: AnnualFormatContext
): AnnualKpi[] => {
  if (section.spec.type !== "kpi" || !section.result) return [];
  const tiles = buildKpiTiles(section.spec, section.result, {
    t: ctx.t,
    locale: ctx.locale,
    seasonStartMonth: ctx.seasonStartMonth,
    params: section.params,
    theme: getChartTheme("light"),
  });
  const trendKey = {
    up: "analytics.charts.kpi.trendUp",
    down: "analytics.charts.kpi.trendDown",
    flat: "analytics.charts.kpi.trendFlat",
  } as const;
  return tiles.map((tile) => ({
    label: tile.label,
    value: tile.value,
    trend: tile.compare
      ? {
          direction: tile.compare.trend,
          tone: tile.compare.tone,
          text: [ctx.t(trendKey[tile.compare.trend]), tile.compare.change]
            .filter(Boolean)
            .join(" "),
        }
      : null,
    previous: tile.compare
      ? ctx.t("analytics.charts.kpi.previous", {
          value: tile.compare.previous,
        })
      : null,
  }));
};

const sectionDoc = (
  section: PreparedAnnualSection,
  ctx: AnnualFormatContext,
  svgs: Record<string, string | null | undefined>
): AnnualSectionDoc => ({
  key: section.id,
  title: section.title,
  intro: section.intro || null,
  kpis: section.kind === "kpi" ? kpisOf(section, ctx) : undefined,
  svg: section.kind === "chart" ? (svgs[section.key] ?? null) : null,
  emptyText: section.emptyText,
  notes: section.notes,
});

export interface AnnualDocumentInput {
  season: number;
  clubName: string;
  /** Data URL of the club's logo, or "". */
  logo?: string;
  notes: string;
  generatedAt: Date;
  report: PreparedAnnualReport;
  /** Chart markup by section key (`svgForHtml`). */
  svgs?: Record<string, string | null | undefined>;
}

export const buildAnnualDocument = (
  ctx: AnnualFormatContext,
  input: AnnualDocumentInput
): AnnualDocument => {
  const { t } = ctx;
  const { report } = input;
  const printed = printedSections(report);
  const issuedOn = formatGenerationDate(input.generatedAt, ctx.locale);
  const seasonLabel = t("analytics.common.season.value", {
    label: formatSeason(input.season, ctx.seasonStartMonth),
  });
  const title = t("analytics.annual.title");
  const clubName = input.clubName.trim();
  const chapters: AnnualChapterDoc[] = annualChapters(printed).map(
    (chapter) => ({
      title: chapter.id ? t(annualChapterKey(chapter.id)) : null,
      sections: chapter.sections.map((section) =>
        sectionDoc(section, ctx, input.svgs ?? {})
      ),
    })
  );
  const tables = annualChapters(printed)
    .flatMap((chapter) => chapter.sections)
    .filter((section) => section.kind === "chart")
    .flatMap((section) => {
      const table = annualTable(section, ctx);
      return table ? [{ caption: section.title, table }] : [];
    });
  return {
    lang: ctx.locale,
    title,
    clubName,
    logo: input.logo ?? "",
    seasonLabel,
    meta: annualMeta(ctx, {
      season: input.season,
      partialEnd: report.facts.partialEnd,
      issuedOn,
    }),
    banner: t("analytics.annual.pdfBanner"),
    runningFooter: [
      clubName,
      `${title} ${formatSeason(input.season, ctx.seasonStartMonth)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    notesHeading: t("analytics.annual.notes.heading"),
    notes: input.notes,
    chapters,
    appendix: tables.length
      ? { title: t("analytics.annual.appendix"), tables }
      : null,
    definitions: {
      title: t("analytics.annual.definitions.title"),
      items: annualDefinitions(ctx, report.facts),
    },
    footer: t("analytics.annual.footer"),
  };
};

/** Change in percent for Excel; null for percentages or without a base. */
const changePercent = (
  value: number | null,
  previous: number | null,
  percent: boolean
) =>
  percent || value === null || previous === null || previous === 0
    ? null
    : Math.round((value / previous - 1) * 1000) / 10;

export const buildAnnualXlsxInput = (
  ctx: AnnualFormatContext,
  input: Omit<AnnualDocumentInput, "svgs" | "logo">
): AnnualXlsxInput => {
  const { t } = ctx;
  const { report } = input;
  const printed = printedSections(report);
  const kpis: AnnualXlsxKpi[] = printed
    .filter((section) => section.kind === "kpi")
    .flatMap((section) => {
      const { spec, result } = section;
      if (spec.type !== "kpi" || !result) return [];
      return spec.items.flatMap((item) => {
        const value = firstRowValue(result, item.value);
        if (value === null && item.hideWhenNull) return [];
        const previous = item.compare
          ? firstRowValue(result, item.compare)
          : null;
        const label =
          item.label ??
          columnLabel(
            item.value,
            t,
            spec.labels,
            spec.labelKeys,
            section.params
          );
        return [
          {
            label,
            value: toNumber(value) ?? value,
            previous: item.compare ? (toNumber(previous) ?? previous) : null,
            change: item.compare
              ? changePercent(
                  toNumber(value),
                  toNumber(previous),
                  item.format === "percent"
                )
              : null,
          },
        ];
      });
    });
  const sheets = annualChapters(printed)
    .flatMap((chapter) => chapter.sections)
    .filter((section) => section.kind === "chart" && section.sheetName);
  return {
    labels: {
      summarySheet: t("analytics.annual.summarySheet"),
      title: t("analytics.annual.title"),
      club: t("analytics.annual.summary.club"),
      season: t("analytics.annual.summary.season"),
      period: t("analytics.annual.summary.period"),
      issued: t("analytics.annual.summary.issued"),
      notes: t("analytics.annual.summary.notes"),
      indicator: t("analytics.annual.summary.indicator"),
      change: t("analytics.annual.summary.change"),
      contents: t("analytics.annual.summary.contents"),
    },
    clubName: input.clubName.trim(),
    seasonLabel: formatSeason(input.season, ctx.seasonStartMonth),
    previousSeasonLabel: formatSeason(input.season - 1, ctx.seasonStartMonth),
    period: annualPeriodRange(ctx, {
      season: input.season,
      partialEnd: report.facts.partialEnd,
    }),
    issuedOn: formatGenerationDate(input.generatedAt, ctx.locale),
    notes: input.notes,
    kpis,
    sections: sheets.map((section) => ({
      title: section.sheetName ?? section.title,
      result: section.result as QueryResult,
      spec: section.spec,
      params: section.params,
    })),
  };
};
