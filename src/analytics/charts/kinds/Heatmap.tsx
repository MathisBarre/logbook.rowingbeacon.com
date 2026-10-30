import { useMemo } from "react";
import type { HeatmapSpec } from "../../chartSpec";
import type { QueryResult, SqlValue } from "../../types";
import { columnIndex } from "../columns";
import { compareRaw, domainOf, hasEntityOrder } from "../foldSeries";
import {
  ChartContext,
  labelOf,
  makeFormatter,
  measureLabelOf,
  xKindOf,
} from "../model";
import { ChartTheme, divergingFill, inkOn, sequentialStep } from "../palette";
import { resolveFormatByName } from "../format";
import { seriesKey, toNumberOrNull } from "../pivot";
import { clamp, labelStep } from "../scale";
import { textWidth, truncateText } from "../text";
import {
  ChartTooltip,
  Target,
  TooltipContent,
  useChartPointer,
} from "../Tooltip";
import {
  CappedNote,
  chartSummary,
  ChartSvg,
  KindProps,
  LABEL_FONT,
  TICK_FONT,
} from "./ChartSvg";
import { ScrollFrame } from "./ScrollFrame";

/**
 * Heatmap (custom SVG, plan 2.9): one cell per (x, y), 28 to 64 px wide
 * so a finger can hit it and a short grid stays square, a one-hue blue
 * ramp from zero (a diverging red/blue ramp when values go both ways),
 * zero and missing cells as the surface with a 1 px border, the value
 * inside every cell when all fit, the row and column names in the corner,
 * a "Sorties : Aucune | Moins … Plus" scale, column names repeated under
 * tall grids, and a horizontal scroll with edge fades when the columns do
 * not fit.
 */

const CELL = 28;
const GAP = 2;
/** Space between two column names. */
const LABEL_GAP = 8;
const MAX_X = 400;
const MAX_Y = 200;

const SEASON_MONTH_COLUMNS = new Set(["month", "start_month"]);

/** Distinct values of a column, in display order. */
const orderedValues = (
  rows: SqlValue[][],
  index: number,
  column: string,
  seasonStartMonth: number,
  params?: ChartContext["params"]
): SqlValue[] => {
  const seen = new Map<string, SqlValue>();
  for (const row of rows) {
    const value = row[index] ?? null;
    const key = seriesKey(value);
    if (!seen.has(key)) seen.set(key, value);
  }
  const values = [...seen.values()];
  const present = values.filter((v) => v !== null);
  const hasNull = present.length !== values.length;
  let ordered = present;
  // Codes and boat classes in their entity order, as bars and legends.
  const domain = domainOf(column, params);
  if (hasEntityOrder(domain) || resolveFormatByName(column) === "code") {
    ordered = [...present].sort(compareRaw(domain));
    return hasNull ? [...ordered, null] : ordered;
  }
  if (present.length > 0 && present.every((v) => typeof v === "number")) {
    let nums = present;
    // Complete the natural range so that empty hours, weekdays or months
    // keep their column.
    const format = resolveFormatByName(column);
    const ints = nums.every((v) => Number.isInteger(v));
    if (ints && format === "hour") {
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      nums = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    } else if (
      ints &&
      format === "weekday" &&
      nums.every((v) => v >= 1 && v <= 7)
    ) {
      nums = [1, 2, 3, 4, 5, 6, 7];
    } else if (
      ints &&
      SEASON_MONTH_COLUMNS.has(column) &&
      nums.every((v) => v >= 1 && v <= 12)
    ) {
      nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    }
    ordered = SEASON_MONTH_COLUMNS.has(column)
      ? [...nums].sort(
          (a, b) =>
            ((a - seasonStartMonth + 12) % 12) -
            ((b - seasonStartMonth + 12) % 12)
        )
      : [...nums].sort((a, b) => a - b);
  } else if (
    present.every(
      (v) => typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?/.test(v)
    )
  ) {
    ordered = [...present].sort((a, b) => String(a).localeCompare(String(b)));
  }
  return hasNull ? [...ordered, null] : ordered;
};

interface HeatmapModel {
  xs: { raw: SqlValue; label: string; short: string }[];
  ys: { raw: SqlValue; label: string }[];
  /** values[y][x], null when the pair is missing. */
  values: (number | null)[][];
  /** Largest value (the scale runs from 0); for diverging, largest |v|. */
  max: number;
  /** Values on both sides of zero: a diverging scale. */
  diverging: boolean;
  capped: { shown: number; total: number } | null;
  format: (value: number | null) => string;
}

export const buildHeatmapModel = (
  spec: HeatmapSpec,
  result: QueryResult,
  ctx: ChartContext
): HeatmapModel => {
  const xi = columnIndex(result.columns, spec.x);
  const yi = columnIndex(result.columns, spec.y);
  const vi = columnIndex(result.columns, spec.value);
  const format = makeFormatter(spec, ctx, false, result);
  const formatShort = makeFormatter(spec, ctx, true, result);
  const unknown = ctx.t("analytics.codes.unknown");
  const allX = orderedValues(
    result.rows,
    xi,
    spec.x,
    ctx.seasonStartMonth,
    ctx.params
  );
  const allY = orderedValues(
    result.rows,
    yi,
    spec.y,
    ctx.seasonStartMonth,
    ctx.params
  );
  const xsRaw = allX.slice(0, MAX_X);
  const ysRaw = allY.slice(0, MAX_Y);
  const xAt = new Map(xsRaw.map((v, i) => [seriesKey(v), i]));
  const yAt = new Map(ysRaw.map((v, i) => [seriesKey(v), i]));
  const values = ysRaw.map(() => xsRaw.map((): number | null => null));
  for (const row of result.rows) {
    const x = xAt.get(seriesKey(row[xi] ?? null));
    const y = yAt.get(seriesKey(row[yi] ?? null));
    if (x === undefined || y === undefined) continue;
    const v = toNumberOrNull(row[vi] ?? null);
    if (v === null) continue;
    values[y][x] = (values[y][x] ?? 0) + v;
  }
  let max = 0;
  let min = 0;
  for (const line of values) {
    for (const v of line) {
      if (v === null) continue;
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
  }
  const diverging = min < 0 && max > 0;
  const capped =
    allX.length > MAX_X || allY.length > MAX_Y
      ? {
          shown: xsRaw.length * ysRaw.length,
          total: allX.length * allY.length,
        }
      : null;
  return {
    xs: xsRaw.map((raw) => ({
      raw,
      label: raw === null ? unknown : format(spec.x, raw),
      short: raw === null ? unknown : formatShort(spec.x, raw),
    })),
    ys: ysRaw.map((raw) => ({
      raw,
      label: raw === null ? unknown : format(spec.y, raw),
    })),
    values,
    max: diverging ? Math.max(max, -min) : max,
    diverging,
    capped,
    format: (value) => format(spec.value, value),
  };
};

/** Fill of a cell value; null for zero and missing (bordered surface). */
export const cellFill = (
  v: number | null,
  model: Pick<HeatmapModel, "max" | "diverging">,
  theme: ChartTheme
): string | null => {
  if (v === null) return null;
  if (model.diverging) return divergingFill(v, model.max, theme);
  const step = sequentialStep(v, 0, model.max);
  return step < 0 ? null : theme.sequential[step];
};

const MAX_CELL = 64;

export const Heatmap = ({
  spec,
  result,
  ctx,
  width,
  svgRef,
  ariaLabel,
}: KindProps<HeatmapSpec>) => {
  const { theme } = ctx;
  const model = useMemo(
    () => buildHeatmapModel(spec, result, ctx),
    [spec, result, ctx]
  );
  const pointer = useChartPointer();
  const nx = model.xs.length;
  const ny = model.ys.length;
  const measure = measureLabelOf(spec, ctx, spec.value);
  const yLabel = labelOf(spec, ctx, spec.y);
  const xIsNumeric =
    xKindOf(
      spec,
      spec.x,
      model.xs.map((x) => x.raw)
    ) === "numeric";
  const xTitle = xIsNumeric ? labelOf(spec, ctx, spec.x) : null;

  const labelWidth = Math.min(
    Math.max(60, width * 0.32),
    Math.max(
      ...model.ys.map((y) => textWidth(y.label, LABEL_FONT)),
      textWidth(yLabel, LABEL_FONT),
      20
    ) + 4
  );
  const labelsLeft = labelWidth + 12;
  const widest = Math.max(
    ...model.xs.map((x) => textWidth(x.short, TICK_FONT)),
    1
  );
  const room = Math.floor((width - labelsLeft - 8) / Math.max(1, nx));
  // A few named columns ("Arrivée", "+1 saison", "+2 saisons") get cells
  // wide enough to name each one, when the card has the room.
  const named = Math.ceil(Math.min(widest, 110) + LABEL_GAP);
  const cellW = Math.max(
    clamp(room, CELL, MAX_CELL),
    named <= room ? named : 0
  );
  const cellH = cellW >= 48 ? 32 : CELL + 2;
  const plotW = cellW * nx;
  // A grid narrower than the card is centred.
  const offset = Math.max(0, Math.floor((width - labelsLeft - plotW - 8) / 2));
  const left = labelsLeft + offset;
  const top = 26 + (xTitle ? 18 : 0);
  const repeatX = ny > 12;
  const gridBottom = top + cellH * ny;
  const svgWidth = Math.max(width, left + plotW + 8);
  const scaleY = gridBottom + (repeatX ? 26 : 0) + 14;
  // The x title centres on the grid, and may run over the label column
  // when the grid is narrow (2 columns): "Saisons après l'arrivée" whole.
  const titleText = xTitle ? truncateText(xTitle, svgWidth - 8, TICK_FONT) : "";
  const titleHalf = textWidth(titleText, TICK_FONT) / 2;
  const titleX = clamp(
    left + plotW / 2,
    4 + titleHalf,
    Math.max(4 + titleHalf, svgWidth - 4 - titleHalf)
  );
  const legend = scaleLegendLayout(ctx, width - 4, {
    measure,
    maxText: model.max > 0 ? model.format(model.max) : undefined,
    minText:
      model.diverging && model.max > 0 ? model.format(-model.max) : undefined,
  });
  const svgHeight = scaleY + legend.height + 12;

  const every = labelStep(nx, cellW, Math.min(widest, 110), LABEL_GAP);

  const cells = model.ys.flatMap((_, y) => model.xs.map((__, x) => ({ x, y })));
  const valueFont = cellW >= 40 ? 12 : 11;
  // Values go in every cell or in none: a grid where only the small
  // numbers fit reads as if the large ones were missing.
  const labelsFit = model.values.every((row) =>
    row.every(
      (v) =>
        v === null ||
        v === 0 ||
        textWidth(model.format(v), valueFont) <= cellW - GAP - 6
    )
  );
  const target = (i: number): Target => {
    const { x, y } = cells[i];
    return {
      index: i,
      x: left + cellW * (x + 0.5),
      y: top + cellH * y,
      h: cellH,
      placement: "above",
    };
  };
  const tooltip = (i: number): TooltipContent => {
    const { x, y } = cells[i];
    const v = model.values[y][x];
    return {
      title: `${model.ys[y].label} · ${model.xs[x].label}`,
      rows: [
        v === null
          ? { key: "none", value: ctx.t("analytics.charts.noValue") }
          : { key: "v", value: model.format(v), label: measure },
      ],
    };
  };

  let top1: { x: number; y: number; v: number } | null = null;
  model.values.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v !== null && (!top1 || v > top1.v)) top1 = { x, y, v };
    })
  );
  const peak = top1 as { x: number; y: number; v: number } | null;
  const label =
    ariaLabel ??
    chartSummary(ctx, {
      type: "heatmap",
      measure,
      dimension: `${yLabel}, ${labelOf(spec, ctx, spec.x)}`,
      count: nx * ny,
      max: peak
        ? {
            label: `${model.ys[peak.y].label} · ${model.xs[peak.x].label}`,
            value: model.format(peak.v),
          }
        : null,
    });

  const xLabelRow = (y: number) =>
    model.xs.map((x, i) =>
      i % every === 0 ? (
        <text
          key={i}
          x={left + cellW * (i + 0.5)}
          y={y}
          textAnchor="middle"
          fontSize={TICK_FONT}
          fill={theme.textMuted}
        >
          {truncateText(x.short, cellW * every - 4, TICK_FONT)}
        </text>
      ) : null
    );

  return (
    <div style={{ width }}>
      <ScrollFrame width={width} surface={theme.surface}>
        <div
          ref={pointer.rootRef}
          className="relative"
          style={{ width: svgWidth }}
        >
          <ChartSvg
            ref={svgRef}
            width={svgWidth}
            height={svgHeight}
            theme={theme}
            label={label}
            hint={ctx.t("analytics.charts.aria.hint")}
            ring={false}
            onPointerLeave={pointer.leave}
            onKeyDown={(event) =>
              pointer.keyDown(event, cells.length, target, {
                h: 1,
                v: Math.max(1, nx),
                rowStart: (i) => i - (i % nx),
                rowEnd: (i) => i - (i % nx) + nx - 1,
              })
            }
          >
            {xTitle && (
              <text
                x={titleX}
                y={14}
                textAnchor="middle"
                fontSize={TICK_FONT}
                fill={theme.textSecondary}
              >
                {titleText}
              </text>
            )}
            {/* Corner: what the rows are. */}
            <text
              x={left - 8}
              y={top - 9}
              textAnchor="end"
              fontSize={LABEL_FONT}
              fontWeight={600}
              fill={theme.textSecondary}
            >
              {truncateText(yLabel, labelWidth, LABEL_FONT)}
            </text>
            <g>{xLabelRow(top - 9)}</g>
            {repeatX && <g>{xLabelRow(gridBottom + 18)}</g>}
            <g>
              {model.ys.map((y, i) => (
                <text
                  key={i}
                  x={left - 8}
                  y={top + cellH * i + cellH / 2 + 4}
                  textAnchor="end"
                  fontSize={LABEL_FONT}
                  fill={theme.textSecondary}
                >
                  {truncateText(y.label, labelWidth, LABEL_FONT)}
                </text>
              ))}
            </g>
            <g>
              {cells.map(({ x, y }, i) => {
                const v = model.values[y][x];
                const cx = left + cellW * x + GAP / 2;
                const cy = top + cellH * y + GAP / 2;
                const w = cellW - GAP;
                const h = cellH - GAP;
                const fill = cellFill(v, model, theme);
                const text = v === null ? "" : model.format(v);
                const showText = labelsFit && v !== null && v !== 0;
                const isActive = pointer.active?.index === i;
                return (
                  <g key={i}>
                    <rect
                      x={cx}
                      y={cy}
                      width={w}
                      height={h}
                      rx={3}
                      fill={fill ?? theme.surface}
                      stroke={
                        isActive
                          ? theme.textPrimary
                          : fill === null
                            ? theme.border
                            : "none"
                      }
                      strokeWidth={isActive ? 2 : 1}
                      data-active={isActive ? "mark" : undefined}
                      data-base-stroke={
                        isActive
                          ? fill === null
                            ? theme.border
                            : "none"
                          : undefined
                      }
                      data-base-stroke-width={isActive ? 1 : undefined}
                    />
                    {showText && (
                      <text
                        x={cx + w / 2}
                        y={cy + h / 2 + 4}
                        textAnchor="middle"
                        fontSize={valueFont}
                        fill={fill ? inkOn(fill) : theme.textSecondary}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                        pointerEvents="none"
                      >
                        {text}
                      </text>
                    )}
                    <rect
                      x={cx - GAP / 2}
                      y={cy - GAP / 2}
                      width={cellW}
                      height={cellH}
                      fill="transparent"
                      data-hit="true"
                      onPointerEnter={(event) =>
                        pointer.hover(target(i), event)
                      }
                      onClick={() => pointer.tap(target(i))}
                    />
                  </g>
                );
              })}
            </g>
            <ScaleLegend
              ctx={ctx}
              x={scaleLegendX(legend, labelsLeft, width)}
              y={scaleY}
              layout={legend}
              diverging={model.diverging}
            />
          </ChartSvg>
          <ChartTooltip
            target={pointer.active}
            content={
              pointer.active && cells[pointer.active.index]
                ? tooltip(pointer.active.index)
                : null
            }
            containerWidth={svgWidth}
            theme={theme}
          />
        </div>
      </ScrollFrame>
      <CappedNote ctx={ctx} capped={model.capped} />
    </div>
  );
};

const SWATCH = 14;
const SWATCH_STEP = SWATCH + 2;
const LEGEND_LINE = 20;
const ITEM_GAP = 8;

type LegendPart =
  | { kind: "text"; text: string; strong?: boolean }
  | { kind: "none"; text: string }
  /** "Moins" and the swatches, kept together. */
  | { kind: "ramp"; less: string };

/**
 * Where the parts of the scale go within `maxWidth`: "Sorties :", "▢
 * Aucune", "Moins", the ramp, "Plus (max)", flowing onto more lines in
 * narrow cards (such as the Explorer's sidebar).
 */
export interface ScaleLegendLayout {
  items: { part: LegendPart; x: number; line: number; w: number }[];
  width: number;
  height: number;
  lines: number;
}

const rampWidth = (ctx: ChartContext, diverging: boolean) =>
  (diverging
    ? ctx.theme.sequential.length * 2 + 1
    : ctx.theme.sequential.length) *
    SWATCH_STEP -
  2;

const partWidth = (part: LegendPart, ctx: ChartContext, diverging: boolean) =>
  part.kind === "ramp"
    ? textWidth(part.less, TICK_FONT) + 6 + rampWidth(ctx, diverging)
    : part.kind === "none"
      ? SWATCH + 6 + textWidth(part.text, TICK_FONT)
      : textWidth(part.text, TICK_FONT);

export const scaleLegendLayout = (
  ctx: ChartContext,
  maxWidth: number,
  args: {
    measure?: string;
    maxText?: string;
    minText?: string;
    /** Days or cells without a value get the "Aucune" swatch (default). */
    none?: boolean;
  } = {}
): ScaleLegendLayout => {
  const less = ctx.t("analytics.charts.calendar.less");
  const more = ctx.t("analytics.charts.calendar.more");
  const diverging = args.minText !== undefined;
  const parts: LegendPart[] = [];
  if (args.measure) {
    parts.push({
      kind: "text",
      text: truncateText(
        ctx.t("analytics.charts.calendar.measure", { measure: args.measure }),
        maxWidth,
        TICK_FONT
      ),
      strong: true,
    });
  }
  if (args.none !== false) {
    parts.push({ kind: "none", text: ctx.t("analytics.charts.calendar.none") });
  }
  parts.push({
    kind: "ramp",
    less: args.minText ? `${less} (${args.minText})` : less,
  });
  parts.push({
    kind: "text",
    text: args.maxText ? `${more} (${args.maxText})` : more,
  });
  const items: ScaleLegendLayout["items"] = [];
  let x = 0;
  let line = 0;
  let width = 0;
  parts.forEach((part) => {
    const w = partWidth(part, ctx, diverging);
    // A gap after the measure and after "Aucune"; keep "Moins" with the ramp.
    if (x > 0 && x + w > maxWidth) {
      x = 0;
      line += 1;
    }
    items.push({ part, x, line, w });
    width = Math.max(width, x + w);
    const sep = part.kind === "none" || (part.kind === "text" && part.strong);
    x += w + (sep ? ITEM_GAP * 2 : ITEM_GAP);
  });
  return {
    items,
    width: Math.min(width, Math.max(maxWidth, 0)),
    height: (line + 1) * LEGEND_LINE - 6,
    lines: line + 1,
  };
};

/** Left edge of the scale: under the cells when it fits, else from 0. */
export const scaleLegendX = (
  layout: ScaleLegendLayout,
  left: number,
  visibleWidth: number
) => (left + layout.width <= visibleWidth - 4 ? left : 0);

/** "Sorties : ▢ Aucune  Moins ▢▢▢▢▢▢▢ Plus (max)". */
export const ScaleLegend = ({
  ctx,
  x,
  y,
  layout,
  diverging = false,
}: {
  ctx: ChartContext;
  x: number;
  y: number;
  layout: ScaleLegendLayout;
  diverging?: boolean;
}) => {
  const { theme } = ctx;
  const ramp = diverging
    ? [...theme.negative].reverse().concat([theme.zero], theme.sequential)
    : [...theme.sequential];
  return (
    <g transform={`translate(${x},${y})`} data-legend="true">
      {layout.items.map(({ part, x: px, line }, i) => {
        const ty = line * LEGEND_LINE;
        if (part.kind === "ramp") {
          const rx = px + textWidth(part.less, TICK_FONT) + 6;
          return (
            <g key={i}>
              <text
                x={px}
                y={ty + 11}
                fontSize={TICK_FONT}
                fill={theme.textMuted}
              >
                {part.less}
              </text>
              {ramp.map((color, j) => (
                <rect
                  key={j}
                  x={rx + j * SWATCH_STEP}
                  y={ty}
                  width={SWATCH}
                  height={SWATCH}
                  rx={3}
                  fill={color}
                />
              ))}
            </g>
          );
        }
        if (part.kind === "none") {
          return (
            <g key={i}>
              <rect
                x={px}
                y={ty}
                width={SWATCH}
                height={SWATCH}
                rx={3}
                fill={theme.surface}
                stroke={theme.border}
              />
              <text
                x={px + SWATCH + 6}
                y={ty + 11}
                fontSize={TICK_FONT}
                fill={theme.textMuted}
              >
                {part.text}
              </text>
            </g>
          );
        }
        return (
          <text
            key={i}
            x={px}
            y={ty + 11}
            fontSize={TICK_FONT}
            fill={part.strong ? theme.textSecondary : theme.textMuted}
            fontWeight={part.strong ? 600 : undefined}
          >
            {part.text}
          </text>
        );
      })}
    </g>
  );
};
