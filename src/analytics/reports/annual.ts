import type { EngineObjects, ParamValue, ReportDefinition } from "../types";
import { getReportAvailability } from "./availability";
import { getReport } from "./catalog";

/**
 * Sections of the annual activity report (plan 1.3, appendix C): what a
 * club board shows at its general meeting or attaches to a grant
 * application. No section shows names. A section whose report is
 * unavailable is omitted. `params` are fixed values on top of the season;
 * `limit` keeps the first rows (the reports are already sorted).
 *
 * The document groups the sections into chapters (`ANNUAL_CHAPTERS`); the
 * array below keeps the order the queries are started in.
 */
export type AnnualChapterId = "activity" | "rowers" | "fleet" | "safety";

export type AnnualSectionId =
  | "overview"
  | "outingsMonthly"
  | "activeRowersMonthly"
  | "demographics"
  | "fleet"
  | "topBoats"
  | "routes"
  | "outingTypes"
  | "incidents"
  | "damages"
  | "retention"
  | "safety";

export interface AnnualReportSection {
  /** Stable id of the section (texts, chapters, transforms). */
  id: AnnualSectionId;
  reportId: string;
  params?: Record<string, ParamValue>;
  limit?: number;
  /** analytics.annual.sections.<id>; may use {{count}} (rows shown). */
  titleKey: string;
  /** analytics.annual.intros.<id>: what the chart shows, for the reader. */
  introKey: string;
  /** analytics.annual.sheets.<id>: Excel sheet name (31 characters max). */
  sheetKey?: string;
  /**
   * analytics.annual.empty.<id>: an empty result is good news and prints
   * as this sentence. Without it, an empty section is left out.
   */
  emptyKey?: string;
  /** Chart height in the app and in the exports (px); bars grow to fit. */
  height?: number;
  exportHeight?: number;
  /** Draws the bars horizontally (few categories). */
  horizontal?: boolean;
}

const keys = (id: AnnualSectionId, extra: { sheet?: boolean } = {}) => ({
  id,
  titleKey: `analytics.annual.sections.${id}`,
  introKey: `analytics.annual.intros.${id}`,
  ...(extra.sheet === false
    ? {}
    : { sheetKey: `analytics.annual.sheets.${id}` }),
});

export const ANNUAL_REPORT_SECTIONS: AnnualReportSection[] = [
  { ...keys("overview", { sheet: false }), reportId: "season-overview" },
  {
    ...keys("outingsMonthly"),
    reportId: "yoy-monthly",
    params: { metric: "outings" },
    height: 220,
    exportHeight: 240,
  },
  {
    ...keys("activeRowersMonthly"),
    reportId: "yoy-monthly",
    params: { metric: "active_rowers" },
    height: 220,
    exportHeight: 240,
  },
  {
    ...keys("demographics"),
    reportId: "active-members-demographics",
    horizontal: true,
  },
  {
    ...keys("fleet"),
    reportId: "fleet-by-class",
    height: 200,
    exportHeight: 220,
  },
  { ...keys("topBoats"), reportId: "boat-usage-ranking", limit: 10 },
  { ...keys("routes"), reportId: "routes-usage", limit: 10 },
  { ...keys("outingTypes"), reportId: "outing-types" },
  {
    ...keys("incidents"),
    reportId: "incidents-per-boat",
    limit: 10,
    emptyKey: "analytics.annual.empty.incidents",
  },
  {
    ...keys("damages"),
    reportId: "damages-per-boat",
    limit: 10,
    emptyKey: "analytics.annual.empty.damages",
  },
  { ...keys("retention"), reportId: "retention-cohorts" },
  {
    ...keys("safety"),
    reportId: "safety-summary",
    height: 220,
    exportHeight: 240,
    emptyKey: "analytics.annual.empty.safety",
  },
];

/**
 * Chapters of the document, in reading order; the first one has no
 * heading (key figures). A chapter whose sections are all left out is
 * left out.
 */
export const ANNUAL_CHAPTERS: {
  id: AnnualChapterId | null;
  sections: AnnualSectionId[];
}[] = [
  { id: null, sections: ["overview"] },
  { id: "activity", sections: ["outingsMonthly", "outingTypes", "routes"] },
  {
    id: "rowers",
    sections: ["activeRowersMonthly", "demographics", "retention"],
  },
  { id: "fleet", sections: ["fleet", "topBoats"] },
  { id: "safety", sections: ["incidents", "damages", "safety"] },
];

/** analytics.annual.chapters.<id>. */
export const annualChapterKey = (id: AnnualChapterId) =>
  `analytics.annual.chapters.${id}`;

/**
 * The sections that can run on this database with these modules, with
 * their report and the parameter values to resolve (`season` plus the
 * section's own values; the other parameters take their defaults).
 */
export const getAnnualReportSections = (
  season: number,
  ctx: { objects: EngineObjects; enabledModules: readonly string[] }
): {
  section: AnnualReportSection;
  report: ReportDefinition;
  paramValues: Record<string, ParamValue>;
}[] =>
  ANNUAL_REPORT_SECTIONS.flatMap((section) => {
    const report = getReport(section.reportId);
    if (!report || !getReportAvailability(report, ctx).available) {
      return [];
    }
    const paramValues: Record<string, ParamValue> = { ...section.params };
    if (report.params.some((param) => param.name === "season")) {
      paramValues.season = season;
    }
    return [{ section, report, paramValues }];
  });
