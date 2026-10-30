import {
  ExportContext,
  exportFormat,
  exportHeaders,
  ExportInput,
  exportText,
} from "./context";

/**
 * HTML pieces for printing (and the annual report, WP5): escaped text, a
 * result table with the table view's labels and formats.
 */

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const NUMERIC_FORMATS = new Set([
  "km",
  "percent",
  "hours",
  "minutes",
  "integer",
  "decimal",
]);

/** `<table>` of a result: translated headers, formatted cells. */
export const resultTableHtml = (
  input: ExportInput,
  ctx: ExportContext
): string => {
  const { result, spec } = input;
  const headers = exportHeaders(input, ctx);
  const numeric = result.columns.map((c, i) => {
    const sample = result.rows.slice(0, 50).map((r) => r[i] ?? null);
    const format = exportFormat(spec, c.name, sample);
    return (
      (format === null || NUMERIC_FORMATS.has(format)) &&
      sample.some((v) => typeof v === "number") &&
      sample.every((v) => v === null || typeof v === "number")
    );
  });
  const head = headers
    .map(
      (h, i) => `<th${numeric[i] ? ' class="num"' : ""}>${escapeHtml(h)}</th>`
    )
    .join("");
  const body = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map(
            (_, i) =>
              `<td${numeric[i] ? ' class="num"' : ""}>${escapeHtml(
                exportText(input, ctx, i, row[i] ?? null)
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
};

const PRINT_CSS = `
@page { size: A4; margin: 15mm; }
body { font-family: Roboto, Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0b0b0b; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
p.meta { color: #4b5563; font-size: 9pt; margin: 0 0 4pt; }
p.footer { color: #6b7280; font-size: 8pt; margin: 12pt 0 0; }
figure { margin: 8pt 0 12pt; break-inside: avoid; }
figure svg { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; }
th, td { border-bottom: 1px solid #e5e7eb; padding: 3pt 6pt; text-align: left; vertical-align: top; }
th { color: #4b5563; font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
`;

/**
 * A self-contained printable page: title, context (season, filters),
 * chart, table, then the footer ("RowingBeacon · généré le …"). No script.
 */
export const printableHtml = (args: {
  title: string;
  meta?: string;
  /** Season and active filters, one line each. */
  lines?: string[];
  svg?: string | null;
  table: string;
  lang: string;
  footer?: string;
}) =>
  `<!doctype html><html lang="${escapeHtml(args.lang)}"><head><meta charset="utf-8"><title>${escapeHtml(
    args.title
  )}</title><style>${PRINT_CSS}</style></head><body><h1>${escapeHtml(args.title)}</h1>${(
    args.lines ?? []
  )
    .map((line) => `<p class="meta">${escapeHtml(line)}</p>`)
    .join("")}${
    args.meta ? `<p class="meta">${escapeHtml(args.meta)}</p>` : ""
  }${args.svg ? `<figure>${args.svg}</figure>` : ""}${args.table}${
    args.footer ? `<p class="footer">${escapeHtml(args.footer)}</p>` : ""
  }</body></html>`;

/** True where the webview can print (plan risk 20). */
export const canPrint = () =>
  typeof window !== "undefined" && typeof window.print === "function";

/**
 * The hidden print frame. Sandboxed without `allow-scripts`, so nothing in
 * the printed page can run (nor reach the app's Tauri bridge), whatever
 * the text or SVG holds; `allow-same-origin` lets the app call print() on
 * it and `allow-modals` lets the print dialog open.
 */
export const createPrintFrame = (doc: Document): HTMLIFrameElement => {
  const frame = doc.createElement("iframe");
  frame.setAttribute("sandbox", "allow-modals allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  return frame;
};

/** Prints `html` from a hidden frame, without leaving the app's page. */
export const printHtml = (html: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const frame = createPrintFrame(document);
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.onload = () => {
      const target = frame.contentWindow;
      if (!target) {
        frame.remove();
        reject(new Error("print"));
        return;
      }
      try {
        target.focus();
        target.print();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setTimeout(() => frame.remove(), 60_000);
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
