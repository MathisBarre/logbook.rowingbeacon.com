import { toCsvCell } from "../../../_common/utils/export";
import { ExportContext, exportHeaders, ExportInput } from "./context";

/**
 * CSV export (plan 2.10): UTF-8 with a BOM so that Excel reads accents,
 * raw values (codes untranslated, dates as stored) so the file stays
 * machine-readable, one header row of translated column labels, every cell
 * through `toCsvCell` (formula injection guard, RFC 4180 quoting).
 *
 * Separator and decimal mark follow the language, as Excel expects when it
 * opens the file with a double click: in French, German, Italian and Dutch
 * a comma is the decimal mark, so the separator is a semicolon and decimals
 * use a comma ("12,5"). In English: comma separator and dot decimals.
 */
export const BOM = "﻿";

const SEMICOLON_LANGUAGES = new Set(["fr", "de", "it", "nl"]);

export const csvFormatFor = (
  locale: string
): { separator: "," | ";"; decimal: "." | "," } =>
  SEMICOLON_LANGUAGES.has(locale.slice(0, 2).toLowerCase())
    ? { separator: ";", decimal: "," }
    : { separator: ",", decimal: "." };

/** Quoting for `;` files; the formula guard of `toCsvCell` on text. */
const semicolonCell = (value: string | number): string => {
  const text =
    typeof value === "number"
      ? String(value).replace(".", ",")
      : /^[=+\-@\t\r]/.test(value)
        ? `'${value}`
        : value;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const cell = (
  value: string | number,
  format: ReturnType<typeof csvFormatFor>
): string =>
  format.separator === "," ? toCsvCell(value) : semicolonCell(value);

export const buildCsv = (input: ExportInput, ctx: ExportContext): string => {
  const format = csvFormatFor(ctx.locale);
  const header = exportHeaders(input, ctx)
    .map((label) => cell(label, format))
    .join(format.separator);
  const lines = input.result.rows.map((row) =>
    input.result.columns
      .map((_, i) => {
        const value = row[i] ?? null;
        return value === null ? "" : cell(value, format);
      })
      .join(format.separator)
  );
  return `${BOM}${[header, ...lines].join("\r\n")}\r\n`;
};
