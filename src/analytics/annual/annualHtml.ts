import { CHART_FONT } from "../charts/palette";

/**
 * The printable annual report (plan 1.3, 2.10): one self-contained HTML
 * file (inline CSS, inline SVG charts, no script, no external resource),
 * laid out for A4 so the club can "Imprimer › Enregistrer en PDF" it for a
 * grant file or a general meeting. "Imprimer" in the app prints the same
 * page. Built from an `AnnualDocument` whose texts are already translated
 * and formatted, so this module is pure.
 */

export interface AnnualKpi {
  label: string;
  value: string;
  /** "En hausse +11 %", with the tone of the change; null without one. */
  trend: {
    direction: "up" | "down" | "flat";
    tone: "good" | "bad" | "neutral";
    text: string;
  } | null;
  /** "Saison précédente : 2 619", or null. */
  previous: string | null;
}

export interface AnnualTable {
  headers: string[];
  rows: string[][];
  /** Right-aligned columns (measures). */
  numeric: boolean[];
}

export interface AnnualSectionDoc {
  key: string;
  title: string;
  /** What the section shows (one short paragraph), or null. */
  intro?: string | null;
  /** Key figures (the overview section). */
  kpis?: AnnualKpi[];
  /** The chart, from `svgForHtml`. */
  svg?: string | null;
  /** An empty section that is good news ("Aucun incident…"). */
  emptyText?: string | null;
  notes?: string[];
}

export interface AnnualChapterDoc {
  /** null: the opening chapter (key figures), with no heading. */
  title: string | null;
  sections: AnnualSectionDoc[];
}

export interface AnnualDocument {
  /** BCP 47, for `<html lang>`. */
  lang: string;
  title: string;
  /** Empty when the club has not entered its name. */
  clubName: string;
  /** Data URL of the club's logo (PNG, JPEG or SVG), or "". */
  logo: string;
  /** "Saison 2025-2026". */
  seasonLabel: string;
  /** "Période : du … au … · Édité le …". */
  meta: string;
  /** How to get a PDF; shown on screen only. */
  banner: string;
  /** Bottom-left of every printed page: "Club · Rapport annuel 2025-2026". */
  runningFooter: string;
  notesHeading: string;
  /** The club's comment for the season (plain text). */
  notes: string;
  chapters: AnnualChapterDoc[];
  /** Detailed figures of every chart, after the narrative. */
  appendix: {
    title: string;
    tables: { caption: string; table: AnnualTable }[];
  } | null;
  definitions: { title: string; items: string[] };
  footer: string;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ESCAPES[char]);

/**
 * Text inside a CSS string ("…"): backslashes, quotes and line breaks
 * escaped, and `<` too so nothing can close the <style> element.
 */
export const escapeCssString = (text: string): string =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n|\r/g, " ")
    .replace(/</g, "\\3C ")
    .replace(/>/g, "\\3E ");

/** A logo as a data URL of a PNG, JPEG or SVG image, else "". */
export const safeLogo = (logo: string): string =>
  /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(logo)
    ? logo
    : "";

/** Paragraphs and line breaks of a plain-text comment. */
const paragraphs = (text: string): string =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");

/**
 * Removes from an SVG string what a self-contained page must not carry:
 * scripts, event handlers, foreign objects and links to anything but an
 * internal `#id`. The namespace declarations are dropped too (inline SVG
 * in HTML does not need them).
 */
export const sanitizeSvg = (svg: string): string =>
  svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+xmlns(:[a-z]+)?\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s+(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, "none");

/**
 * The chart SVG as markup for the HTML file: a clone that scales to the
 * page width (viewBox from its size), named after its section, with the
 * interactive bits removed (tab stops, data attributes, the tooltip title).
 */
export const svgForHtml = (svg: SVGSVGElement, label?: string): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("viewBox")) {
    const width = Number(svg.getAttribute("width")) || svg.clientWidth || 640;
    const height =
      Number(svg.getAttribute("height")) || svg.clientHeight || 320;
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  for (const name of ["width", "height", "style", "class"]) {
    clone.removeAttribute(name);
  }
  for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    element.removeAttribute("tabindex");
    element.removeAttribute("focusable");
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("data-")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const child of Array.from(clone.children)) {
    if (child.tagName.toLowerCase() === "title") child.remove();
  }
  clone.removeAttribute("aria-labelledby");
  clone.removeAttribute("aria-describedby");
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  clone.setAttribute("role", "img");
  if (label) clone.setAttribute("aria-label", label);
  return sanitizeSvg(clone.outerHTML);
};

const css = (doc: AnnualDocument) => `
@page { size: A4; margin: 16mm 14mm 18mm;
  @bottom-left { content: "${escapeCssString(doc.runningFooter)}"; font-family: ${CHART_FONT}; font-size: 8pt; color: #6b7280; }
  @bottom-right { content: counter(page) " / " counter(pages); font-family: ${CHART_FONT}; font-size: 8pt; color: #6b7280; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #f3f4f6; color: #111827;
  font-family: ${CHART_FONT};
  font-size: 10.5pt; line-height: 1.45; }
.page { max-width: 190mm; margin: 0 auto; padding: 14mm 12mm; background: #fff; }
.screen-only { max-width: 190mm; margin: 6mm auto 0; padding: 3mm 5mm; background: #e8f0fa; color: #16243b; border-left: 3px solid #2d5f9c; font-size: 9.5pt; }
header.cover { position: relative; border-bottom: 3px solid #22426a; padding-bottom: 6mm; margin-bottom: 6mm; }
header.cover.with-logo { padding-right: 32mm; }
.logo { position: absolute; top: 0; right: 0; height: 18mm; width: auto; max-width: 30mm; object-fit: contain; }
.club { margin: 0 0 1mm; font-size: 12pt; font-weight: 600; color: #2d5f9c; letter-spacing: .02em; text-transform: uppercase; }
h1 { margin: 0; font-size: 22pt; line-height: 1.15; color: #16243b; }
.season { margin: 1mm 0 0; font-size: 15pt; font-weight: 600; color: #22426a; }
.meta { margin: 2mm 0 0; color: #4b5563; font-size: 9.5pt; }
.comment { margin: 0 0 6mm; padding: 4mm 5mm; background: #f3f6fc; border-left: 3px solid #4480c1; border-radius: 2px; }
.comment h2 { margin: 0 0 1.5mm; font-size: 11pt; border: 0; padding: 0; }
.comment p { margin: 0 0 2mm; }
.comment p:last-child { margin-bottom: 0; }
.chapter { margin: 0 0 4mm; }
section { margin: 0 0 7mm; }
.lead { break-inside: avoid; page-break-inside: avoid; }
h2 { margin: 0 0 3mm; padding-bottom: 1.5mm; font-size: 14pt; color: #16243b; border-bottom: 1px solid #c9d9ee; break-after: avoid; page-break-after: avoid; }
h3 { margin: 0 0 2mm; font-size: 11.5pt; color: #16243b; break-after: avoid; page-break-after: avoid; }
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3mm; }
.kpi { grid-column: span 2; padding: 3mm 4mm; border: 1px solid #e5e7eb; border-radius: 3px; background: #fafafa; min-width: 0; }
.kpi:nth-child(3n+1):nth-last-child(2), .kpi:nth-child(3n+1):nth-last-child(2) + .kpi { grid-column: span 3; }
.kpis:has(> .kpi:nth-child(4):last-child) > .kpi { grid-column: span 3; }
.kpi .label { color: #4b5563; font-size: 9pt; }
.kpi .value { font-size: 18pt; font-weight: 700; color: #16243b; line-height: 1.2; white-space: nowrap; }
.kpi .trend { display: block; font-size: 9pt; font-weight: 600; }
.kpi .previous { color: #4b5563; font-size: 8.5pt; }
.trend.good { color: #0b7a0b; }
.trend.bad { color: #b42f2f; }
.trend.neutral { color: #4b5563; }
figure { margin: 0 0 2mm; }
figure svg { display: block; width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 0 0 6mm; }
caption { caption-side: top; text-align: left; margin: 0 0 2mm; font-size: 11.5pt; font-weight: 700; color: #16243b; }
th, td { padding: 1.2mm 2mm; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
th { color: #374151; font-weight: 600; background: #f3f6fc; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr, table.keep { break-inside: avoid; page-break-inside: avoid; }
thead { display: table-header-group; }
.appendix { break-before: page; page-break-before: always; }
.intro { margin: 0 0 3mm; color: #4b5563; font-size: 9pt; }
.empty { color: #374151; margin: 0; }
.notes { margin: 1mm 0 0; padding: 0; list-style: none; color: #4b5563; font-size: 8.5pt; }
.notes li { margin: 0 0 .8mm; }
footer.end { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #c9d9ee; color: #4b5563; font-size: 8.5pt; break-inside: avoid; page-break-inside: avoid; }
footer.end h3 { font-size: 9.5pt; color: #374151; margin-bottom: 1mm; }
footer.end ul { margin: 0 0 3mm; padding-left: 4mm; }
footer.end li { margin: 0 0 1mm; }
footer.end p { margin: 0; }
@media print {
  body { background: #fff; }
  .screen-only { display: none; }
  .page { max-width: none; margin: 0; padding: 0; }
}
`;

const ARROWS = { up: "▲", down: "▼", flat: "■" } as const;

const renderKpis = (kpis: AnnualKpi[]): string =>
  `<div class="kpis">${kpis
    .map(
      (kpi) =>
        `<div class="kpi"><div class="label">${escapeHtml(kpi.label)}</div>` +
        `<div class="value">${escapeHtml(kpi.value)}</div>` +
        (kpi.trend
          ? `<span class="trend ${kpi.trend.tone}"><span aria-hidden="true">${ARROWS[kpi.trend.direction]}</span> ${escapeHtml(kpi.trend.text)}</span>`
          : "") +
        (kpi.previous
          ? `<div class="previous">${escapeHtml(kpi.previous)}</div>`
          : "") +
        `</div>`
    )
    .join("")}</div>`;

const renderTable = (caption: string, table: AnnualTable): string => {
  const cls = (index: number) => (table.numeric[index] ? ' class="num"' : "");
  return (
    // A short table stays whole; a long one flows with its header repeated.
    `<table${table.rows.length <= 15 ? ' class="keep"' : ""}><caption>${escapeHtml(caption)}</caption><thead><tr>${table.headers
      .map((header, index) => `<th${cls(index)}>${escapeHtml(header)}</th>`)
      .join("")}</tr></thead><tbody>` +
    table.rows
      .map(
        (row) =>
          `<tr>${row
            .map((value, index) => `<td${cls(index)}>${escapeHtml(value)}</td>`)
            .join("")}</tr>`
      )
      .join("") +
    `</tbody></table>`
  );
};

/**
 * A section prints as one block kept on a page: title, what it shows,
 * key figures or chart, reading notes. Its exact figures are in the
 * appendix.
 */
const renderSection = (section: AnnualSectionDoc, level: "h2" | "h3") => {
  const intro = section.intro
    ? `<p class="intro">${escapeHtml(section.intro)}</p>`
    : "";
  const body = section.emptyText
    ? `<p class="empty">${escapeHtml(section.emptyText)}</p>`
    : (section.kpis?.length ? renderKpis(section.kpis) : "") +
      (section.svg ? `<figure>${sanitizeSvg(section.svg)}</figure>` : "");
  const notes = section.notes?.length
    ? `<ul class="notes">${section.notes
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join("")}</ul>`
    : "";
  return (
    `<section data-section="${escapeHtml(section.key)}"><div class="lead">` +
    `<${level}>${escapeHtml(section.title)}</${level}>${intro}${body}${notes}</div></section>`
  );
};

const renderChapter = (chapter: AnnualChapterDoc) =>
  chapter.title
    ? `<div class="chapter"><h2>${escapeHtml(chapter.title)}</h2>${chapter.sections
        .map((section) => renderSection(section, "h3"))
        .join("")}</div>`
    : chapter.sections.map((section) => renderSection(section, "h2")).join("");

export const buildAnnualHtml = (doc: AnnualDocument): string => {
  const pageTitle = [doc.title, doc.clubName, doc.seasonLabel]
    .filter(Boolean)
    .join(" · ");
  const logo = safeLogo(doc.logo);
  return (
    `<!doctype html><html lang="${escapeHtml(doc.lang)}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="generator" content="Rowing Beacon">` +
    `<title>${escapeHtml(pageTitle)}</title><style>${css(doc)}</style></head><body>` +
    `<div class="screen-only" role="note">${escapeHtml(doc.banner)}</div>` +
    `<main class="page">` +
    `<header class="cover${logo ? " with-logo" : ""}">` +
    (logo ? `<img class="logo" alt="" src="${escapeHtml(logo)}">` : "") +
    (doc.clubName ? `<p class="club">${escapeHtml(doc.clubName)}</p>` : "") +
    `<h1>${escapeHtml(doc.title)}</h1>` +
    `<p class="season">${escapeHtml(doc.seasonLabel)}</p>` +
    `<p class="meta">${escapeHtml(doc.meta)}</p>` +
    `</header>` +
    (doc.notes.trim()
      ? `<div class="comment"><h2>${escapeHtml(doc.notesHeading)}</h2>${paragraphs(doc.notes)}</div>`
      : "") +
    doc.chapters.map(renderChapter).join("") +
    `<footer class="end"><h3>${escapeHtml(doc.definitions.title)}</h3><ul>${doc.definitions.items
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</ul><p>${escapeHtml(doc.footer)}</p></footer>` +
    (doc.appendix
      ? `<section class="appendix"><h2>${escapeHtml(doc.appendix.title)}</h2>${doc.appendix.tables
          .map(({ caption, table }) => renderTable(caption, table))
          .join("")}</section>`
      : "") +
    `</main></body></html>`
  );
};
