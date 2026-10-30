import { CHART_FONT, getChartTheme } from "../palette";
import { saveDownload } from "./saveDownload";

/**
 * PNG export (plan 2.10): the chart's SVG is cloned and made
 * self-contained (xmlns, explicit size, system font stack, no
 * interactive attributes, no hover highlight or dimmed series), framed
 * with a header (report title, season, filters) and a footer
 * ("RowingBeacon · généré le 20 juin 2026") so that a picture pasted in a
 * newsletter keeps its context, drawn on a canvas at scale 2 on its
 * surface colour, and written to Downloads. Charts paint every colour as
 * an attribute, so the clone needs no stylesheet.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const sizeOf = (svg: SVGSVGElement) => {
  const width = Number(svg.getAttribute("width")) || svg.clientWidth || 640;
  const height = Number(svg.getAttribute("height")) || svg.clientHeight || 320;
  return { width, height };
};

/** Standalone SVG text of a rendered chart. */
export const serializeChartSvg = (
  svg: SVGSVGElement,
  opts: { background?: string } = {}
): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = sizeOf(svg);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clone.setAttribute("font-family", CHART_FONT);
  for (const name of ["class", "style", "tabindex", "role"]) {
    clone.removeAttribute(name);
  }
  // The pointer's highlight (band, crosshair) is not part of the chart.
  clone.querySelectorAll('[data-active="overlay"]').forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll('[data-active="mark"]').forEach((node) => {
    const stroke = node.getAttribute("data-base-stroke");
    const width = node.getAttribute("data-base-stroke-width");
    if (stroke !== null) node.setAttribute("stroke", stroke);
    if (width !== null) node.setAttribute("stroke-width", width);
    for (const name of [
      "data-active",
      "data-base-stroke",
      "data-base-stroke-width",
    ]) {
      node.removeAttribute(name);
    }
  });
  // Legend focus (dimmed series) and keyboard attributes.
  clone.querySelectorAll("*").forEach((node) => {
    for (const name of [
      "opacity",
      "tabindex",
      "role",
      "aria-pressed",
      "aria-label",
      "data-legend-entry",
    ]) {
      node.removeAttribute(name);
    }
  });
  // Transparent hit targets carry nothing to draw.
  clone.querySelectorAll("[data-hit]").forEach((node) => {
    if (
      node.getAttribute("fill") === "transparent" &&
      node.childElementCount === 0
    ) {
      node.remove();
    } else {
      node.removeAttribute("data-hit");
    }
  });
  clone.querySelectorAll("[style]").forEach((node) => {
    // Only tabular figures are set by style; keep them as an attribute.
    const style = node.getAttribute("style") ?? "";
    if (style.includes("tabular-nums")) {
      node.setAttribute("font-variant-numeric", "tabular-nums");
    }
    node.removeAttribute("style");
  });
  if (opts.background) {
    const rect = clone.ownerDocument.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(height));
    rect.setAttribute("fill", opts.background);
    clone.insertBefore(rect, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
};

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Context printed around an exported chart. */
export interface ChartFrame {
  title?: string;
  /** Season and filters, one line each. */
  lines?: string[];
  /** "RowingBeacon · généré le 20 juin 2026". */
  footer?: string;
}

const PAD = 16;

/**
 * The chart's SVG text inside a page with its title, context lines and
 * footer; same width, taller.
 */
export const framedChartSvg = (
  svgText: string,
  size: { width: number; height: number },
  frame: ChartFrame,
  background = "#ffffff"
): { text: string; width: number; height: number } => {
  const theme = getChartTheme("light");
  const width = size.width + PAD * 2;
  const parts: string[] = [];
  let y = PAD;
  if (frame.title) {
    y += 18;
    parts.push(
      `<text x="${PAD}" y="${y}" font-size="16" font-weight="600" fill="${theme.textPrimary}">${escapeXml(frame.title)}</text>`
    );
    y += 4;
  }
  for (const line of frame.lines ?? []) {
    y += 16;
    parts.push(
      `<text x="${PAD}" y="${y}" font-size="12" fill="${theme.textSecondary}">${escapeXml(line)}</text>`
    );
  }
  y += parts.length > 0 ? 12 : 0;
  const chartY = y;
  y += size.height;
  if (frame.footer) {
    y += 22;
    parts.push(
      `<text x="${PAD}" y="${y}" font-size="11" fill="${theme.textMuted}">${escapeXml(frame.footer)}</text>`
    );
  }
  const height = y + PAD;
  // The chart, nested at its place (its own xmlns and viewBox).
  const nested = svgText.replace(/^<svg\b/, `<svg x="${PAD}" y="${chartY}"`);
  const text =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(CHART_FONT)}">` +
    `<rect width="${width}" height="${height}" fill="${background}"/>` +
    parts.join("") +
    nested +
    `</svg>`;
  return { text, width, height };
};

/** PNG bytes of an SVG text at `scale` (2 = sharp on high-density screens). */
const svgToPng = (
  svgText: string,
  width: number,
  height: number,
  scale = 2
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("canvas"));
        return;
      }
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("png"));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(reject);
      }, "image/png");
    };
    image.onerror = () => reject(new Error("svg"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });

/** Exports a rendered chart as a PNG file in Downloads, framed when asked. */
export const exportChartPng = async (
  svg: SVGSVGElement,
  fileName: string,
  opts: { background?: string; frame?: ChartFrame } = {}
): Promise<string> => {
  const size = sizeOf(svg);
  const text = serializeChartSvg(svg, opts);
  const page = opts.frame
    ? framedChartSvg(text, size, opts.frame, opts.background)
    : { text, ...size };
  const bytes = await svgToPng(page.text, page.width, page.height);
  return saveDownload(fileName, bytes);
};
