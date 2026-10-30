import { forwardRef, KeyboardEventHandler, ReactNode, useId } from "react";
import type { QueryResult } from "../../types";
import type { CappedInfo, ChartContext } from "../model";
import { CHART_FONT, ChartTheme } from "../palette";
import { truncateText } from "../text";

/**
 * Root of every SVG chart: `data-chart-root` marks it for the PNG export
 * and the annual HTML (WP5); colours are attributes, the font is inline,
 * and a surface rectangle paints the background, so a clone of the
 * element is a complete picture.
 */

export interface KindProps<S> {
  spec: S;
  result: QueryResult;
  ctx: ChartContext;
  /** Available width in px. */
  width: number;
  /** Preferred height in px (some charts grow to fit their rows). */
  height: number;
  svgRef?: React.Ref<SVGSVGElement>;
  /** Accessible name instead of the computed summary. */
  ariaLabel?: string;
  /**
   * Horizontal bars: keep to `height`, showing the top rows that fit, then
   * a note that offers the full report (`onOpenFull`).
   */
  fitHeight?: boolean;
  /** Opens the full report (the note of a `fitHeight` chart). */
  onOpenFull?: () => void;
}

export const TICK_FONT = 12;
export const LABEL_FONT = 12;

export const ChartSvg = forwardRef<
  SVGSVGElement,
  {
    width: number;
    height: number;
    theme: ChartTheme;
    label: string;
    children: ReactNode;
    onKeyDown?: KeyboardEventHandler<SVGSVGElement>;
    onPointerLeave?: React.PointerEventHandler<SVGSVGElement>;
    /**
     * Draw the focus ring on the SVG (default). Charts inside a scroll
     * wrapper put it on the wrapper instead (`focus-within`), where it is
     * never clipped.
     */
    ring?: boolean;
    /** Keyboard hint read after the name ("Flèches pour parcourir…"). */
    hint?: string;
  }
>(
  (
    {
      width,
      height,
      theme,
      label,
      children,
      onKeyDown,
      onPointerLeave,
      ring = true,
      hint,
    },
    ref
  ) => {
    const hintId = useId();
    return (
      <>
        {/* No <title>: the browser would show it over the chart's tooltip. */}
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          data-chart-root="true"
          role="img"
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          tabIndex={0}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          fontFamily={CHART_FONT}
          className={`block max-w-none select-none outline-none rounded ${
            ring ? "focus-visible:ring-2 focus-visible:ring-steel-blue-400" : ""
          }`}
          style={{ touchAction: "pan-x pan-y" }}
          onKeyDown={onKeyDown}
          onPointerLeave={onPointerLeave}
        >
          <rect width={width} height={height} fill={theme.surface} />
          {children}
        </svg>
        {hint && (
          <span id={hintId} hidden>
            {hint}
          </span>
        )}
      </>
    );
  }
);
ChartSvg.displayName = "ChartSvg";

/**
 * Bar with a 4 px rounded data end and a square end on the baseline.
 * `end` is the side of the data end.
 */
export const barPath = (
  x: number,
  y: number,
  w: number,
  h: number,
  end: "top" | "bottom" | "right" | "left",
  radius = 4
): string => {
  if (w <= 0 || h <= 0) return "";
  const r = Math.max(
    0,
    Math.min(
      radius,
      end === "top" || end === "bottom" ? w / 2 : h / 2,
      end === "top" || end === "bottom" ? h : w
    )
  );
  const x2 = x + w;
  const y2 = y + h;
  const f = (n: number) => Number(n.toFixed(2));
  switch (end) {
    case "top":
      return `M${f(x)},${f(y2)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}H${f(x2 - r)}Q${f(x2)},${f(y)} ${f(x2)},${f(y + r)}V${f(y2)}Z`;
    case "bottom":
      return `M${f(x)},${f(y)}V${f(y2 - r)}Q${f(x)},${f(y2)} ${f(x + r)},${f(y2)}H${f(x2 - r)}Q${f(x2)},${f(y2)} ${f(x2)},${f(y2 - r)}V${f(y)}Z`;
    case "right":
      return `M${f(x)},${f(y)}H${f(x2 - r)}Q${f(x2)},${f(y)} ${f(x2)},${f(y + r)}V${f(y2 - r)}Q${f(x2)},${f(y2)} ${f(x2 - r)},${f(y2)}H${f(x)}Z`;
    case "left":
      return `M${f(x2)},${f(y)}H${f(x + r)}Q${f(x)},${f(y)} ${f(x)},${f(y + r)}V${f(y2 - r)}Q${f(x)},${f(y2)} ${f(x + r)},${f(y2)}H${f(x2)}Z`;
  }
};

const lowerFirst = (text: string, locale: string) =>
  locale.startsWith("de") ? text : text.charAt(0).toLowerCase() + text.slice(1);

/**
 * One-sentence accessible name of a chart: "Sorties par bateau, 12
 * valeurs, maximum Aiguillon avec 265." (with the series names when there
 * are several).
 */
export const chartSummary = (
  ctx: ChartContext,
  args: {
    type: string;
    measure?: string | null;
    dimension?: string | null;
    count?: number;
    max?: { label: string; value: string } | null;
    series?: string[];
  }
): string => {
  const { t, locale } = ctx;
  const parts: string[] = [];
  if (args.measure && args.dimension) {
    parts.push(
      t("analytics.charts.aria.subject", {
        measure: args.measure,
        dimension: lowerFirst(args.dimension, locale),
      })
    );
  } else {
    parts.push(args.measure ?? t(`analytics.charts.types.${args.type}`));
  }
  if (args.series && args.series.length > 1) {
    parts.push(
      t("analytics.charts.aria.series", { names: args.series.join(", ") })
    );
  }
  if (args.count !== undefined) {
    parts.push(t("analytics.charts.aria.count", { count: args.count }));
  }
  if (args.max) {
    parts.push(t("analytics.charts.aria.max", args.max));
  }
  return `${parts.join(", ")}.`;
};

/**
 * Name of the plotted quantity ("Distance (km)"), top left inside the
 * SVG, so that a bar's length always says what it measures.
 */
export const MeasureCaption = ({
  text,
  theme,
  x = 8,
  y = 4,
  maxWidth,
}: {
  text: string | null;
  theme: ChartTheme;
  x?: number;
  y?: number;
  maxWidth: number;
}) =>
  text ? (
    <text
      x={x}
      y={y + 12}
      fontSize={MEASURE_FONT}
      fill={theme.textSecondary}
      data-measure="true"
    >
      {truncateText(text, maxWidth, MEASURE_FONT)}
    </text>
  ) : null;
export const MEASURE_FONT = 12;
/** Height the measure caption takes (with its gap). */
export const MEASURE_ROW = 20;

/**
 * Note under a chart that shows fewer values than the table: the first or
 * latest values, a report's own top N, or in a dashboard card the rows
 * that fit with a link to the full report.
 */
export const CappedNote = ({
  ctx,
  capped,
  onOpen,
}: {
  ctx: ChartContext;
  capped: CappedInfo | null;
  /** A card's "Ouvrir pour tout voir". */
  onOpen?: () => void;
}) => {
  if (!capped) return null;
  const values = { count: capped.shown, total: capped.total };
  const text = onOpen
    ? ctx.t("analytics.charts.cappedCard", values)
    : capped.limited
      ? ctx.t("analytics.charts.cappedLimit", values)
      : capped.which === "last"
        ? ctx.t("analytics.charts.cappedLast", values)
        : ctx.t("analytics.charts.capped", values);
  return (
    <p
      className="mt-1 flex flex-wrap items-center gap-x-2 text-xs"
      style={{ color: ctx.theme.textSecondary }}
    >
      <span>{text}</span>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="min-h-11 font-medium text-steel-blue-700 underline-offset-2 hover:underline"
        >
          {ctx.t("analytics.charts.openFull")}
        </button>
      )}
    </p>
  );
};
