import * as XLSX from "xlsx";
import type { ChartSpec } from "../../chartSpec";
import type { ParamValue, QueryResult, SqlValue } from "../../types";
import { parseLocalDate } from "../format";
import {
  ExportContext,
  exportFormat,
  exportHeaders,
  exportText,
} from "./context";

/**
 * Excel export (plan 2.10). Own builder, not `exportData` (which turns
 * "YYYY-MM-DD" text into UTC dates): numbers stay numbers, dates become
 * Excel dates built from their local components, codes, months, weekdays,
 * hours, seasons and yes/no are translated, one sheet per table. Sheet
 * names are cleaned, cut to 31 characters and made unique.
 */

export type { ExportContext } from "./context";

export type XlsxCell = string | number | null;

export type XlsxSheet =
  | {
      name: string;
      result: QueryResult;
      spec?: ChartSpec | null;
      params?: Record<string, ParamValue>;
    }
  | { name: string; header: string[]; rows: XlsxCell[][] };

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Excel serial date of local components (no time zone involved). */
export const excelSerial = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
) =>
  (Date.UTC(year, month - 1, day, hour, minute, second) - EXCEL_EPOCH) /
  86_400_000;

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

const dateFormats = (locale: string) =>
  locale === "en-US"
    ? { date: "mm/dd/yyyy", datetime: "mm/dd/yyyy hh:mm" }
    : { date: "dd/mm/yyyy", datetime: "dd/mm/yyyy hh:mm" };

const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;

/** Sheet names: no []:*?/\, at most 31 characters, unique. */
export const uniqueSheetName = (name: string, used: Set<string>): string => {
  const base =
    name
      .replace(INVALID_SHEET_CHARS, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^'+|'+$/g, "") || "Feuille";
  let candidate = base.slice(0, 31).trim();
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
};

const columnWidths = (header: string[], rows: string[][]) =>
  header.map((h, i) => ({
    wch: Math.min(
      50,
      Math.max(
        8,
        h.length + 2,
        ...rows.slice(0, 500).map((r) => (r[i] ?? "").length + 2)
      )
    ),
  }));

const resultSheet = (
  sheet: Extract<XlsxSheet, { result: QueryResult }>,
  ctx: ExportContext
): XLSX.WorkSheet => {
  const { result, spec } = sheet;
  const header = exportHeaders(sheet, ctx);
  const formats = result.columns.map((c, i) =>
    exportFormat(
      spec,
      c.name,
      result.rows.slice(0, 50).map((r) => r[i] ?? null)
    )
  );
  const { date: dateZ, datetime: datetimeZ } = dateFormats(ctx.locale);
  const texts: string[][] = [];
  const cells: (XLSX.CellObject | null)[][] = result.rows.map((row) => {
    const text: string[] = [];
    const line = result.columns.map((_, i): XLSX.CellObject | null => {
      const value: SqlValue = row[i] ?? null;
      if (value === null) {
        text.push("");
        return null;
      }
      const format = formats[i];
      if (
        (format === "date" || format === "datetime") &&
        typeof value === "string"
      ) {
        const dt = DATETIME_RE.exec(value);
        if (dt && format === "datetime") {
          const [y, mo, d, h, mi, s] = dt.slice(1).map((v) => Number(v ?? 0));
          text.push("0000-00-00 00:00");
          return { t: "n", v: excelSerial(y, mo, d, h, mi, s), z: datetimeZ };
        }
        const date = parseLocalDate(value);
        if (date) {
          text.push("0000-00-00");
          return {
            t: "n",
            v: excelSerial(date.year, date.month, date.day),
            z: dateZ,
          };
        }
      }
      const translated =
        format === "month" ||
        format === "weekday" ||
        format === "hour" ||
        format === "season" ||
        format === "code" ||
        format === "boolean" ||
        format === "week";
      if (translated) {
        const label = exportText(sheet, ctx, i, value);
        text.push(label);
        return { t: "s", v: label };
      }
      if (typeof value === "number") {
        text.push(String(value));
        return { t: "n", v: value };
      }
      text.push(value);
      return { t: "s", v: value };
    });
    texts.push(text);
    return line;
  });
  const ws: XLSX.WorkSheet = {};
  header.forEach((h, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: h };
  });
  cells.forEach((line, r) =>
    line.forEach((cell, c) => {
      if (cell) ws[XLSX.utils.encode_cell({ r: r + 1, c })] = cell;
    })
  );
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(0, cells.length), c: Math.max(0, header.length - 1) },
  });
  ws["!cols"] = columnWidths(header, texts);
  return ws;
};

const rawSheet = (sheet: Extract<XlsxSheet, { header: string[] }>) => {
  const ws = XLSX.utils.aoa_to_sheet([sheet.header, ...sheet.rows]);
  ws["!cols"] = columnWidths(
    sheet.header,
    sheet.rows.map((r) => r.map((v) => (v === null ? "" : String(v))))
  );
  return ws;
};

export const buildWorkbook = (
  sheets: XlsxSheet[],
  ctx: ExportContext
): Uint8Array => {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of sheets) {
    const ws = "result" in sheet ? resultSheet(sheet, ctx) : rawSheet(sheet);
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(sheet.name, used));
  }
  if (sheets.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Feuille");
  }
  const out = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return new Uint8Array(out);
};
