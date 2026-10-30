import { buildWorkbook, ExportContext, XlsxSheet } from "../charts/export/xlsx";
import type { ChartSpec, ParamValue, QueryResult } from "../types";

/**
 * Excel export of the annual report (plan 1.3, 2.10): a "Synthèse" sheet
 * first (title, club, season, period, date, the club's message, then the
 * key figures with last season and the change, then the contents), then
 * one sheet per charted section with typed values (WP4's workbook builder).
 */

export interface AnnualXlsxKpi {
  label: string;
  value: number | string | null;
  previous: number | string | null;
  /** Change in percent (one decimal), null when it has no meaning. */
  change: number | null;
}

export interface AnnualXlsxSection {
  /** Sheet name (short, 31 characters at most). */
  title: string;
  result: QueryResult;
  spec: ChartSpec | null;
  params: Record<string, ParamValue>;
}

export interface AnnualXlsxInput {
  labels: {
    summarySheet: string;
    title: string;
    club: string;
    season: string;
    period: string;
    issued: string;
    notes: string;
    indicator: string;
    change: string;
    contents: string;
  };
  clubName: string;
  seasonLabel: string;
  previousSeasonLabel: string;
  period: string;
  issuedOn: string;
  notes: string;
  kpis: AnnualXlsxKpi[];
  sections: AnnualXlsxSection[];
}

/** The sheets, in order (kept separate so tests can check them). */
export const annualSheets = (input: AnnualXlsxInput): XlsxSheet[] => {
  const { labels } = input;
  const rows: (string | number | null)[][] = [];
  if (input.clubName.trim()) rows.push([labels.club, input.clubName]);
  rows.push([labels.season, input.seasonLabel]);
  rows.push([labels.period, input.period]);
  rows.push([labels.issued, input.issuedOn]);
  if (input.notes.trim()) rows.push([labels.notes, input.notes.trim()]);
  if (input.kpis.length > 0) {
    rows.push([]);
    rows.push([
      labels.indicator,
      input.seasonLabel,
      input.previousSeasonLabel,
      labels.change,
    ]);
    for (const kpi of input.kpis) {
      rows.push([kpi.label, kpi.value, kpi.previous, kpi.change]);
    }
  }
  if (input.sections.length > 0) {
    rows.push([]);
    rows.push([labels.contents]);
    for (const section of input.sections) rows.push([section.title]);
  }
  return [
    {
      name: labels.summarySheet,
      header: [labels.title, "", "", ""],
      rows,
    },
    ...input.sections.map((section) => ({
      name: section.title,
      result: section.result,
      spec: section.spec,
      params: section.params,
    })),
  ];
};

export const buildAnnualWorkbook = (
  input: AnnualXlsxInput,
  ctx: ExportContext
): Uint8Array => buildWorkbook(annualSheets(input), ctx);
