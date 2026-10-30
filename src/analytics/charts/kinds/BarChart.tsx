import { useMemo } from "react";
import type { BarSpec } from "../../chartSpec";
import {
  layoutLegend,
  seriesOpacity,
  SvgLegend,
  useSeriesFocus,
} from "../Legend";
import {
  buildCartesianModel,
  CartesianModel,
  CategoryModel,
  SeriesModel,
} from "../model";
import { inkOn } from "../palette";
import { clamp, labelStep, linearScale } from "../scale";
import { textWidth, truncateText, wrapText } from "../text";
import {
  ChartTooltip,
  seriesRows,
  Target,
  TooltipContent,
  TooltipRow,
  useChartPointer,
} from "../Tooltip";
import { bandMonthTicks } from "./axis";
import {
  barPath,
  CappedNote,
  chartSummary,
  ChartSvg,
  KindProps,
  LABEL_FONT,
  MEASURE_ROW,
  MeasureCaption,
  TICK_FONT,
} from "./ChartSvg";

/**
 * Vertical or horizontal bars, grouped or stacked (plan 2.9): bars at most
 * 24 px thick with a 4 px rounded data end, a 2 px surface gap between
 * stacked segments and between grouped bars, one axis, recessive grid,
 * value at the tip when it fits (single series, or the total of a stack).
 * The measure's name sits top left; a fully labelled chart drops its value
 * axis and grid; names on a nominal axis are never dropped (they wrap,
 * and more than 12 narrow bands turn the chart horizontal); a ranking
 * shows its ranks; a stack of 6 rows or fewer labels its segments.
 */

const GAP = 2;
const MAX_BAR = 24;
const MIN_ROW = 26;
const LINE = 14;
/** Room for the capped note of a `fitHeight` chart. */
const NOTE_ROOM = 32;

interface Segment {
  key: string;
  series: string;
  d: string;
  color: string;
  label?: { x: number; y: number; text: string; fill: string };
}

interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tooltip anchor: right of the bar end, flipping left of `flipX`. */
  tx: number;
  ty: number;
  flipX: number;
}

interface Layout {
  width: number;
  height: number;
  segments: Segment[];
  /** Hit band of each category, in chart coordinates. */
  bands: Band[];
  grid: { pos: number; label: string }[];
  baseline: number;
  categoryLabels: {
    x: number;
    y: number;
    lines: string[];
    anchor: "middle" | "end" | "start";
    rank?: { x: number; text: string };
  }[];
  valueLabels: {
    x: number;
    y: number;
    text: string;
    anchor: "start" | "middle";
  }[];
  captionY: number;
  legendY: number;
  plot: { x0: number; x1: number; y0: number; y1: number };
  xTitle: { x: number; y: number; text: string } | null;
}

const categoryTotal = (series: SeriesModel[], i: number) => {
  let positive = 0;
  let negative = 0;
  let any = false;
  for (const s of series) {
    const v = s.values[i];
    if (v === null || v === undefined) continue;
    any = true;
    if (v >= 0) positive += v;
    else negative += v;
  }
  return { positive, negative, any };
};

/** Muted (`_prev`) series first: painted under, and left in a group. */
const drawOrder = (series: SeriesModel[]) => [
  ...series.filter((s) => s.muted),
  ...series.filter((s) => !s.muted),
];

/** Competition ranks (1, 2, 2, 4…) of values sorted descending, else null. */
export const competitionRanks = (
  values: (number | null)[]
): number[] | null => {
  const present = values.filter((v): v is number => v !== null);
  if (present.length !== values.length) return null;
  for (let i = 1; i < present.length; i++) {
    if (present[i] > present[i - 1]) return null;
  }
  return present.map((v) => 1 + present.filter((o) => o > v).length);
};

/** Bars a horizontal chart of `height` can show at 26 px a row. */
export const rowsThatFit = (height: number, overhead: number) =>
  Math.max(1, Math.floor((height - overhead - NOTE_ROOM) / MIN_ROW));

/** Value-axis tick count for a plot length. */
const tickCount = (length: number, per: number, min: number) =>
  Math.max(min, Math.min(6, Math.floor(length / per)));

const layoutBars = (
  horizontal: boolean,
  stackedSpec: boolean,
  model: CartesianModel,
  width: number,
  height: number,
  legendHeight: number,
  locale: string
): Layout => {
  const stacked = stackedSpec && model.series.length > 1;
  const n = model.categories.length;
  const k = stacked ? 1 : model.series.length;
  const ordered = drawOrder(model.series);

  // Value domain.
  let min = 0;
  let max = 0;
  model.categories.forEach((_, i) => {
    if (stacked) {
      const { positive, negative } = categoryTotal(model.series, i);
      max = Math.max(max, positive);
      min = Math.min(min, negative);
    } else {
      for (const s of model.series) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
  });

  // Labels at the tip: single series, or totals of stacks.
  const tipValue = (i: number): number | null => {
    if (k === 1 && !stacked) return model.series[0]?.values[i] ?? null;
    if (stacked) {
      const total = categoryTotal(model.series, i);
      return total.any ? total.positive + total.negative : null;
    }
    return null;
  };
  const tipColumn = model.series[0]?.column ?? "";
  const tipTexts = model.categories.map((_, i) => {
    const v = tipValue(i);
    return v === null ? "" : model.formatValue(tipColumn, v);
  });
  const wantsTips = k === 1 || stacked;
  const single = k === 1 && !stacked;

  const captionY = 4;
  const legendY = captionY + (model.measure ? MEASURE_ROW : 0);
  const top = legendY + (legendHeight > 0 ? legendHeight + 8 : 4);
  const segments: Segment[] = [];
  const bands: Layout["bands"] = [];
  const categoryLabels: Layout["categoryLabels"] = [];
  const valueLabels: Layout["valueLabels"] = [];
  const scaleOptions = { integer: model.integer };

  if (!horizontal) {
    // A single series whose every value fits on its bar needs no axis.
    const slotFor = (left: number) =>
      (Math.max(left + 40, width - 8) - left) / Math.max(1, n);
    const fullyLabelled =
      single &&
      n <= 24 &&
      tipTexts.every((text) => textWidth(text, LABEL_FONT) <= slotFor(8) - 4);
    const probe = linearScale(min, max, 0, 1, {
      maxTicks: tickCount(height - top - 40, 45, 3),
      ...scaleOptions,
    });
    const left = fullyLabelled
      ? 8
      : Math.max(
          ...probe.ticks.map((t) =>
            textWidth(model.formatTick(t, probe.step), TICK_FONT)
          ),
          8
        ) + 10;
    const right = 8;
    const slot = slotFor(left);
    const nominal = model.xKind === "nominal";
    const wrapped = nominal
      ? model.categories.map((c) => wrapText(c.short, slot - 4, TICK_FONT, 2))
      : null;
    const twoLines = wrapped?.some((lines) => lines.length > 1) ?? false;
    const bottom = 26 + (twoLines ? LINE : 0);
    const titleRoom = model.xTitle ? 18 : 0;
    const tipSpace = wantsTips ? 18 : 6;
    const plot = {
      x0: left,
      x1: Math.max(left + 40, width - right),
      y0: top + tipSpace,
      y1: Math.max(top + tipSpace + 60, height - bottom - titleRoom),
    };
    const scale = linearScale(min, max, plot.y1, plot.y0, {
      maxTicks: tickCount(plot.y1 - plot.y0, 45, 3),
      ...scaleOptions,
    });
    const baseline = scale.map(0);
    const barW = Math.max(
      2,
      Math.min(MAX_BAR, (slot * 0.72 - (k - 1) * GAP) / k)
    );
    const groupW = k * barW + (k - 1) * GAP;

    model.categories.forEach((_, i) => {
      const cx = plot.x0 + slot * (i + 0.5);
      const tip = tipValue(i);
      let barTop = baseline;
      if (stacked) {
        let pos = 0;
        let neg = 0;
        const present = model.series.filter(
          (s) => s.values[i] != null && s.values[i] !== 0
        );
        const lastPos = [...present]
          .reverse()
          .find((s) => (s.values[i] ?? 0) > 0);
        const lastNeg = [...present]
          .reverse()
          .find((s) => (s.values[i] ?? 0) < 0);
        const firstPos = present.find((s) => (s.values[i] ?? 0) > 0);
        const firstNeg = present.find((s) => (s.values[i] ?? 0) < 0);
        for (const s of model.series) {
          const v = s.values[i];
          if (v === null || v === undefined || v === 0) continue;
          const from = v > 0 ? pos : neg;
          const to = from + v;
          if (v > 0) pos = to;
          else neg = to;
          let p0 = scale.map(from);
          let p1 = scale.map(to);
          // p0 is nearer the baseline; move away from neighbours by 1 px.
          const up = v > 0;
          const isFirst = s === (up ? firstPos : firstNeg);
          const isLast = s === (up ? lastPos : lastNeg);
          if (!isFirst) p0 += up ? -GAP / 2 : GAP / 2;
          if (!isLast) p1 += up ? GAP / 2 : -GAP / 2;
          const yTop = Math.min(p0, p1);
          const h = Math.abs(p1 - p0);
          barTop = Math.min(barTop, yTop);
          if (h < 0.5) continue;
          segments.push({
            key: `${s.key}-${i}`,
            series: s.key,
            color: s.color,
            d: barPath(
              cx - barW / 2,
              yTop,
              barW,
              h,
              up ? "top" : "bottom",
              isLast ? 4 : 0
            ),
          });
        }
      } else {
        ordered.forEach((s, j) => {
          const v = s.values[i];
          if (v === null || v === undefined) return;
          const x = cx - groupW / 2 + j * (barW + GAP);
          const p = scale.map(v);
          const yTop = Math.min(p, baseline);
          const h = Math.abs(baseline - p);
          barTop = Math.min(barTop, yTop);
          if (h < 0.5) return;
          segments.push({
            key: `${s.key}-${i}`,
            series: s.key,
            color: s.color,
            d: barPath(x, yTop, barW, h, v >= 0 ? "top" : "bottom"),
          });
        });
      }
      bands.push({
        x: plot.x0 + slot * i,
        y: plot.y0 - tipSpace,
        w: slot,
        h: plot.y1 - plot.y0 + tipSpace + bottom,
        tx: cx + groupW / 2 + 2,
        ty: Math.min(barTop, plot.y1 - 40),
        flipX: cx - groupW / 2 - 2,
      });

      if (wantsTips && tip !== null && tipTexts[i]) {
        valueLabels.push({
          x: cx,
          y: tip >= 0 ? scale.map(tip) - 6 : scale.map(tip) + 14,
          text: tipTexts[i],
          anchor: "middle",
        });
      }
    });

    // Tip labels only when every one fits its slot and they are few.
    const tipsFit =
      n <= 24 &&
      tipTexts.every((text) => textWidth(text, LABEL_FONT) <= slot - 4);
    if (!tipsFit) valueLabels.length = 0;

    // Category labels: names wrap (never dropped); dates show months;
    // other ordered values are thinned so that they never overlap.
    const xAt = (i: number) => plot.x0 + slot * (i + 0.5);
    const months =
      model.xKind === "time"
        ? bandMonthTicks(
            model.categories.map((c) => c.pos),
            xAt,
            locale
          )
        : null;
    if (wrapped) {
      wrapped.forEach((lines, i) =>
        categoryLabels.push({
          x: xAt(i),
          y: plot.y1 + 17,
          lines,
          anchor: "middle",
        })
      );
    } else if (months) {
      for (const m of months) {
        categoryLabels.push({
          x: m.x,
          y: plot.y1 + 17,
          lines: [m.text],
          anchor: "middle",
        });
      }
    } else {
      const widest = Math.max(
        ...model.categories.map((c) => textWidth(c.short, TICK_FONT)),
        1
      );
      const step = labelStep(n, slot, Math.min(widest, 120));
      model.categories.forEach((category, i) => {
        if (i % step !== 0) return;
        categoryLabels.push({
          x: xAt(i),
          y: plot.y1 + 17,
          lines: [truncateText(category.short, slot * step - 6, TICK_FONT)],
          anchor: "middle",
        });
      });
    }

    const noAxis = fullyLabelled && tipsFit;
    return {
      width,
      height: plot.y1 + bottom + titleRoom,
      segments,
      bands,
      grid: noAxis
        ? []
        : scale.ticks.map((t) => ({
            pos: scale.map(t),
            label: model.formatTick(t, scale.step),
          })),
      baseline,
      categoryLabels,
      valueLabels,
      captionY,
      legendY,
      plot,
      xTitle: model.xTitle
        ? {
            x: (plot.x0 + plot.x1) / 2,
            y: plot.y1 + bottom + 12,
            text: model.xTitle,
          }
        : null,
    };
  }

  // Horizontal bars: categories as rows, the chart grows to fit them.
  const ranks =
    single && n >= 6 ? competitionRanks(model.series[0]?.values ?? []) : null;
  const rankWidth = ranks
    ? textWidth(String(Math.max(...ranks)), LABEL_FONT) + 8
    : 0;
  const labelWidth = Math.min(
    Math.max(width * 0.38, 60),
    Math.max(
      ...model.categories.map((c) => textWidth(c.label, LABEL_FONT)),
      20
    ) + 4
  );
  const left = labelWidth + rankWidth + 12;
  const tipWidth = wantsTips
    ? Math.max(...tipTexts.map((text) => textWidth(text, LABEL_FONT)), 0) + 10
    : 0;
  const right = Math.max(12, tipWidth);
  const segmentLabels = stacked && n <= 6;
  const available = height - top - 24;
  const rowStep = clamp(available / Math.max(1, n), MIN_ROW, 44);
  const plot = {
    x0: left,
    x1: Math.max(left + 60, width - right),
    y0: top,
    y1: top + rowStep * n,
  };
  const scale = linearScale(min, max, plot.x0, plot.x1, {
    maxTicks: tickCount(plot.x1 - plot.x0, 70, 4),
    ...scaleOptions,
  });
  const baseline = scale.map(0);
  const barH = Math.max(
    2,
    Math.min(MAX_BAR, (rowStep * 0.72 - (k - 1) * GAP) / k)
  );
  const groupH = k * barH + (k - 1) * GAP;
  let everySegmentLabelled = segmentLabels;

  model.categories.forEach((category, i) => {
    const cy = plot.y0 + rowStep * (i + 0.5);
    let barEnd = baseline;
    categoryLabels.push({
      x: left - 8,
      y: cy + 4,
      lines: [truncateText(category.label, labelWidth, LABEL_FONT)],
      anchor: "end",
      ...(ranks ? { rank: { x: 0, text: String(ranks[i]) } } : {}),
    });
    if (stacked) {
      let pos = 0;
      let neg = 0;
      const present = model.series.filter(
        (s) => s.values[i] != null && s.values[i] !== 0
      );
      const lastPos = [...present]
        .reverse()
        .find((s) => (s.values[i] ?? 0) > 0);
      const lastNeg = [...present]
        .reverse()
        .find((s) => (s.values[i] ?? 0) < 0);
      const firstPos = present.find((s) => (s.values[i] ?? 0) > 0);
      const firstNeg = present.find((s) => (s.values[i] ?? 0) < 0);
      for (const s of model.series) {
        const v = s.values[i];
        if (v === null || v === undefined || v === 0) continue;
        const from = v > 0 ? pos : neg;
        const to = from + v;
        if (v > 0) pos = to;
        else neg = to;
        const toRight = v > 0;
        let p0 = scale.map(from);
        let p1 = scale.map(to);
        const isFirst = s === (toRight ? firstPos : firstNeg);
        const isLast = s === (toRight ? lastPos : lastNeg);
        if (!isFirst) p0 += toRight ? GAP / 2 : -GAP / 2;
        if (!isLast) p1 += toRight ? -GAP / 2 : GAP / 2;
        const x = Math.min(p0, p1);
        const w = Math.abs(p1 - p0);
        barEnd = Math.max(barEnd, x + w);
        if (w < 0.5) continue;
        const text = model.formatValue(s.column, v);
        const fits = textWidth(text, LABEL_FONT) <= w - 8 && barH >= 14;
        if (!fits) everySegmentLabelled = false;
        segments.push({
          key: `${s.key}-${i}`,
          series: s.key,
          color: s.color,
          d: barPath(
            x,
            cy - barH / 2,
            w,
            barH,
            toRight ? "right" : "left",
            isLast ? 4 : 0
          ),
          ...(segmentLabels && fits
            ? {
                label: {
                  x: x + w / 2,
                  y: cy + 4,
                  text,
                  fill: inkOn(s.color),
                },
              }
            : {}),
        });
      }
    } else {
      ordered.forEach((s, j) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        const y = cy - groupH / 2 + j * (barH + GAP);
        const p = scale.map(v);
        const x = Math.min(p, baseline);
        const w = Math.abs(p - baseline);
        barEnd = Math.max(barEnd, x + w);
        if (w < 0.5) return;
        segments.push({
          key: `${s.key}-${i}`,
          series: s.key,
          color: s.color,
          d: barPath(x, y, w, barH, v >= 0 ? "right" : "left"),
        });
      });
    }
    const tip = tipValue(i);
    const tipX =
      Math.max(tip === null ? baseline : scale.map(tip), baseline) + 6;
    if (wantsTips && tip !== null && tipTexts[i]) {
      valueLabels.push({
        x: tipX,
        y: cy + 4,
        text: tipTexts[i],
        anchor: "start",
      });
    }
    bands.push({
      x: 0,
      y: plot.y0 + rowStep * i,
      w: width,
      h: rowStep,
      tx:
        wantsTips && tipTexts[i]
          ? tipX + textWidth(tipTexts[i], LABEL_FONT)
          : barEnd,
      ty: cy - 4,
      flipX: Math.max(plot.x0, barEnd - 4),
    });
  });

  const noAxis = single || (stacked && everySegmentLabelled);
  return {
    width,
    height: plot.y1 + (noAxis ? 8 : 24),
    segments,
    bands,
    grid: noAxis
      ? []
      : scale.ticks.map((t) => ({
          pos: scale.map(t),
          label: model.formatTick(t, scale.step),
        })),
    baseline,
    categoryLabels,
    valueLabels,
    captionY,
    legendY,
    plot,
    xTitle: null,
  };
};

/** The model cut to its first `rows` categories (a card's height). */
const firstRows = (model: CartesianModel, rows: number): CartesianModel => ({
  ...model,
  categories: model.categories.slice(0, rows),
  series: model.series.map((s) => ({ ...s, values: s.values.slice(0, rows) })),
  capped: {
    shown: rows,
    total: model.capped?.total ?? model.categories.length,
    which: "first",
  },
});

const maxOf = (model: CartesianModel, stacked: boolean) => {
  let best: { category: CategoryModel; value: number } | null = null;
  model.categories.forEach((category, i) => {
    const value = stacked
      ? model.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
      : (model.series[0]?.values[i] ?? null);
    if (value === null) return;
    if (!best || value > best.value) best = { category, value };
  });
  return best as { category: CategoryModel; value: number } | null;
};

export const BarChart = ({
  spec,
  result,
  ctx,
  width,
  height,
  svgRef,
  ariaLabel,
  fitHeight = false,
  onOpenFull,
}: KindProps<BarSpec>) => {
  const fullModel = useMemo(
    () => buildCartesianModel(spec, result, ctx),
    [spec, result, ctx]
  );
  const n0 = fullModel.categories.length;
  // Names never get dropped: many narrow bands turn the chart sideways.
  const horizontal =
    spec.orientation === "horizontal" ||
    (fullModel.xKind === "nominal" && n0 > 12 && (width - 60) / n0 < 48);
  const stacked = spec.stacked && fullModel.series.length > 1;
  const legend = useMemo(
    () =>
      layoutLegend(
        fullModel.series.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          mark: "rect" as const,
        })),
        width - 16
      ),
    [fullModel, width]
  );
  const overhead =
    4 +
    (fullModel.measure ? MEASURE_ROW : 0) +
    (legend.height > 0 ? legend.height + 8 : 4) +
    8;
  const fit = horizontal && fitHeight ? rowsThatFit(height, overhead) : null;
  const model =
    fit !== null && n0 > fit ? firstRows(fullModel, fit) : fullModel;
  const layout = useMemo(
    () =>
      layoutBars(
        horizontal,
        spec.stacked,
        model,
        width,
        height,
        legend.height,
        ctx.locale
      ),
    [horizontal, spec.stacked, model, width, height, legend.height, ctx.locale]
  );
  const pointer = useChartPointer();
  const focus = useSeriesFocus();
  const { theme } = ctx;

  const target = (i: number): Target => ({
    index: i,
    x: layout.bands[i].tx,
    y: layout.bands[i].ty,
    flipX: layout.bands[i].flipX,
    placement: "right",
  });

  const measure = model.measure;
  const tooltip = (i: number): TooltipContent => {
    const category = model.categories[i];
    const missing = ctx.t("analytics.common.values.null");
    let rows: TooltipRow[];
    if (model.series.length === 1) {
      const s = model.series[0];
      const v = s.values[i];
      rows = [
        {
          key: s.key,
          color: s.color,
          mark: "rect",
          value: v === null ? missing : model.formatValue(s.column, v),
          label: measure ?? s.label,
        },
      ];
    } else {
      // As drawn: a vertical stack from the top down.
      const listed =
        stacked && !horizontal ? [...model.series].reverse() : model.series;
      rows = seriesRows(
        listed,
        (s) => s.values[i] ?? null,
        model.formatValue,
        "rect",
        missing
      );
      if (stacked) {
        const total = model.series.reduce(
          (sum, s) => sum + (s.values[i] ?? 0),
          0
        );
        rows.push({
          key: "__total__",
          value: model.formatValue(model.series[0].column, total),
          label: ctx.t("analytics.charts.total"),
          total: true,
        });
      }
    }
    return { title: category.label, rows };
  };

  const top = maxOf(model, stacked);
  const label =
    ariaLabel ??
    chartSummary(ctx, {
      type: "bar",
      measure,
      dimension: model.xLabel,
      count: model.categories.length,
      max:
        top && (model.series.length === 1 || stacked)
          ? {
              label: top.category.label,
              value: model.formatValue(model.series[0].column, top.value),
            }
          : null,
      series: model.series.map((s) => s.label),
    });

  const active = pointer.active;
  return (
    <div ref={pointer.rootRef} className="relative" style={{ width }}>
      <ChartSvg
        ref={svgRef}
        width={layout.width}
        height={layout.height}
        theme={theme}
        label={label}
        hint={ctx.t("analytics.charts.aria.hint")}
        onPointerLeave={pointer.leave}
        onKeyDown={(event) => {
          if (event.key === "Escape") focus.clear();
          pointer.keyDown(event, model.categories.length, target);
        }}
      >
        <MeasureCaption
          text={measure}
          theme={theme}
          y={layout.captionY}
          maxWidth={width - 16}
        />
        <SvgLegend
          layout={legend}
          theme={theme}
          x={8}
          y={layout.legendY}
          focus={focus}
        />
        {/* Grid and ticks */}
        <g>
          {layout.grid.map((g) =>
            horizontal ? (
              <g key={g.pos}>
                <line
                  x1={g.pos}
                  x2={g.pos}
                  y1={layout.plot.y0}
                  y2={layout.plot.y1}
                  stroke={theme.grid}
                  strokeWidth={1}
                />
                <text
                  x={g.pos}
                  y={layout.plot.y1 + 16}
                  fontSize={TICK_FONT}
                  textAnchor="middle"
                  fill={theme.textMuted}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {g.label}
                </text>
              </g>
            ) : (
              <g key={g.pos}>
                <line
                  x1={layout.plot.x0}
                  x2={layout.plot.x1}
                  y1={g.pos}
                  y2={g.pos}
                  stroke={theme.grid}
                  strokeWidth={1}
                />
                <text
                  x={layout.plot.x0 - 8}
                  y={g.pos + 4}
                  fontSize={TICK_FONT}
                  textAnchor="end"
                  fill={theme.textMuted}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {g.label}
                </text>
              </g>
            )
          )}
        </g>
        {active && layout.bands[active.index] && (
          <rect
            data-active="overlay"
            x={horizontal ? layout.plot.x0 : layout.bands[active.index].x}
            y={horizontal ? layout.bands[active.index].y : layout.plot.y0}
            width={
              horizontal
                ? layout.plot.x1 - layout.plot.x0
                : layout.bands[active.index].w
            }
            height={
              horizontal
                ? layout.bands[active.index].h
                : layout.plot.y1 - layout.plot.y0
            }
            fill={theme.highlight}
          />
        )}
        <g>
          {layout.segments.map((s) => (
            <path
              key={s.key}
              d={s.d}
              fill={s.color}
              opacity={seriesOpacity(focus, s.series)}
            />
          ))}
        </g>
        <g pointerEvents="none">
          {layout.segments.map((s) =>
            s.label ? (
              <text
                key={s.key}
                x={s.label.x}
                y={s.label.y}
                fontSize={LABEL_FONT}
                textAnchor="middle"
                fill={s.label.fill}
                opacity={seriesOpacity(focus, s.series)}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {s.label.text}
              </text>
            ) : null
          )}
        </g>
        {/* Baseline */}
        {horizontal ? (
          <line
            x1={layout.baseline}
            x2={layout.baseline}
            y1={layout.plot.y0}
            y2={layout.plot.y1}
            stroke={theme.axis}
            strokeWidth={1}
          />
        ) : (
          <line
            x1={layout.plot.x0}
            x2={layout.plot.x1}
            y1={layout.baseline}
            y2={layout.baseline}
            stroke={theme.axis}
            strokeWidth={1}
          />
        )}
        <g>
          {layout.categoryLabels.map((l, i) => (
            <g key={i}>
              {l.rank && (
                <text
                  x={8}
                  y={l.y}
                  fontSize={LABEL_FONT}
                  fill={theme.textMuted}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {l.rank.text}
                </text>
              )}
              <text
                x={l.x}
                y={l.y}
                fontSize={horizontal ? LABEL_FONT : TICK_FONT}
                textAnchor={l.anchor}
                fill={horizontal ? theme.textSecondary : theme.textMuted}
              >
                {l.lines.map((line, j) => (
                  <tspan key={j} x={l.x} dy={j === 0 ? 0 : LINE}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          ))}
        </g>
        {layout.xTitle && (
          <text
            x={layout.xTitle.x}
            y={layout.xTitle.y}
            fontSize={TICK_FONT}
            textAnchor="middle"
            fill={theme.textSecondary}
          >
            {truncateText(layout.xTitle.text, width - 16, TICK_FONT)}
          </text>
        )}
        <g>
          {layout.valueLabels.map((l, i) => (
            <text
              key={i}
              x={l.x}
              y={l.y}
              fontSize={LABEL_FONT}
              textAnchor={l.anchor}
              fill={theme.textSecondary}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {l.text}
            </text>
          ))}
        </g>
        {/* Hit targets: the whole band of a category. */}
        <g>
          {layout.bands.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill="transparent"
              data-hit="true"
              onPointerEnter={(event) => pointer.hover(target(i), event)}
              onPointerMove={(event) => pointer.hover(target(i), event)}
              onClick={() => pointer.tap(target(i))}
            />
          ))}
        </g>
      </ChartSvg>
      <ChartTooltip
        target={active}
        content={active ? tooltip(active.index) : null}
        containerWidth={width}
        containerHeight={layout.height}
        theme={theme}
      />
      <CappedNote
        ctx={ctx}
        capped={model.capped}
        onOpen={model !== fullModel ? onOpenFull : undefined}
      />
    </div>
  );
};
