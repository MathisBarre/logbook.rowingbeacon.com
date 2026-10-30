import { z } from "zod";
import catalogJson from "./catalog.json";
import reportsSql from "./reports.sql?raw";
import { ChartSpec, ParamDefs } from "../chartSpec";
import { parseBlocks } from "../schema/views";
import {
  DashboardItemSize,
  ParamValue,
  REPORT_CATEGORIES,
  ReportCategory,
  ReportDefinition,
} from "../types";

/**
 * The 29 prebuilt reports (plan 2.8, appendix C): metadata in
 * catalog.json, SQL in reports.sql (one `-- @report <id>` block each),
 * titles, descriptions and reading guides in the `reports` i18n namespace.
 * Rust embeds the same two files for the MCP tools.
 */

/**
 * Notes a report can show (keys under analytics.reports.notes). The first
 * four are footnotes under the chart (appendix D.5); the others explain
 * the counting rules in the report's "i" popover.
 */
const REPORT_FOOTNOTES = [
  "multiDay",
  "km",
  "noStartTime",
  "retention",
] as const;
const REPORT_DETAIL_NOTES = [
  "membersOnly",
  "motorboat",
  "excluded",
  "v1Coxes",
] as const;

const CatalogEntry = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    category: z.enum(REPORT_CATEGORIES),
    visibility: z.enum(["public", "nominative", "admin"]),
    cost: z.enum(["light", "medium", "heavy"]),
    requires: z
      .object({
        tables: z.array(z.string()).min(1),
        modules: z.array(z.string()).optional(),
      })
      .strict(),
    params: ParamDefs,
    chart: ChartSpec,
    coverage: z
      .object({
        column: z.enum([
          "gender",
          "birth_date",
          "age_category",
          "distance",
          "is_coached",
          "has_start_time",
        ]),
        sql: z.string().min(1),
      })
      .strict()
      .optional(),
    notes: z
      .array(z.enum([...REPORT_FOOTNOTES, ...REPORT_DETAIL_NOTES]))
      .optional(),
    mcpDescription: z.string().min(1).max(300),
  })
  .strict();

const buildReports = (): ReportDefinition[] => {
  const blocks = parseBlocks(reportsSql, "@report");
  const sqlById = new Map(blocks.map((block) => [block.name, block.sql]));
  const entries = z.array(CatalogEntry).parse(catalogJson);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new Error("catalog.json lists a report twice");
  }
  const orphan = blocks.find((block) => !ids.has(block.name));
  if (orphan) {
    throw new Error(`reports.sql block ${orphan.name} is not in catalog.json`);
  }
  return entries.map((entry) => {
    const sql = sqlById.get(entry.id);
    if (!sql) {
      throw new Error(`Report ${entry.id} has no SQL block in reports.sql`);
    }
    return { ...entry, sql };
  });
};

let reports: ReportDefinition[] | null = null;

/** Every prebuilt report, in display order. */
export const getReports = (): ReportDefinition[] => {
  reports ??= buildReports();
  return reports;
};

export const getReport = (id: string): ReportDefinition | undefined =>
  getReports().find((report) => report.id === id);

/** Non-empty categories in the order of plan 1.3, with their reports. */
export const getReportsByCategory = (): {
  category: ReportCategory;
  reports: ReportDefinition[];
}[] =>
  REPORT_CATEGORIES.map((category) => ({
    category,
    reports: getReports().filter((report) => report.category === category),
  })).filter((group) => group.reports.length > 0);

/** i18n keys of a report (they exist for every catalogue id). */
export const reportTitleKey = (id: string) =>
  `analytics.reports.items.${id}.title`;
/** One or two sentences: the question the report answers (catalogue card). */
export const reportDescriptionKey = (id: string) =>
  `analytics.reports.items.${id}.description`;
/** How to read the chart or table (report view, annual report). */
export const reportHowToReadKey = (id: string) =>
  `analytics.reports.items.${id}.howToRead`;
/** Words volunteers may search with (review D 22), not shown. */
export const reportKeywordsKey = (id: string) =>
  `analytics.reports.items.${id}.keywords`;
export const reportNoteKey = (note: string) =>
  `analytics.reports.notes.${note}`;

/** A report's notes, split between footnotes and the "i" popover. */
export const splitReportNotes = (
  report: Pick<ReportDefinition, "notes">
): { footnotes: string[]; details: string[] } => {
  const notes = report.notes ?? [];
  const isFootnote = (note: string) =>
    (REPORT_FOOTNOTES as readonly string[]).includes(note);
  return {
    footnotes: notes.filter(isFootnote),
    details: notes.filter((note) => !isFootnote(note)),
  };
};

/** The dashboard written on the first visit (plan 1.3), in order. */
export const DEFAULT_DASHBOARD: {
  reportId: string;
  size: DashboardItemSize;
  paramValues: Record<string, ParamValue>;
}[] = [
  { reportId: "season-overview", size: "full", paramValues: {} },
  { reportId: "yoy-monthly", size: "half", paramValues: { metric: "outings" } },
  { reportId: "attendance-heatmap", size: "half", paramValues: {} },
  { reportId: "boat-usage-ranking", size: "half", paramValues: {} },
  { reportId: "active-rowers-monthly", size: "half", paramValues: {} },
  { reportId: "fleet-class-monthly", size: "full", paramValues: {} },
];
