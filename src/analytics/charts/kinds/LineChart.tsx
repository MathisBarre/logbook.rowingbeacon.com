import { PointerEvent as ReactPointerEvent, useMemo } from "react";
import type { LineSpec } from "../../chartSpec";
import { formatValue } from "../format";
import {
  layoutLegend,
  seriesOpacity,
  SvgLegend,
  useSeriesFocus,
} from "../Legend";
import { buildCartesianModel, SeriesModel } from "../model";
import { clamp, labelStep, linearScale } from "../scale";
import { textWidth, truncateText } from "../text";
import {
  ChartTooltip,
  seriesRows,
  Target,
  TooltipContent,
  useChartPointer,
} from "../Tooltip";
import { AxisTick, monthTicks } from "./axis";
import {
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
 * Lines and areas (plan 2.9): 2 px lines with round joins, areas as a 10 %
 * wash of the series colour, gaps where values are null, a crosshair that
 * snaps to the nearest x with markers (8 px, surface ring) on every
 * series, and the last point of each line marked with its value (with
 * the series name when there are 2 to 4 that do not collide; the legend
 * is always there for 2 series or more). Numbers on x are spaced by value
 * and dates by day (month ticks), other values evenly; a previous season
 * (`_prev`) is grey and painted under the current one.
 */

const END_LABEL_MAX = 120;

const drawOrder = (series: SeriesModel[]) => [
  ...series.filter((s) => s.muted),
  ...series.filter((s) => !s.muted),
];

export const LineChart = ({
  spec,
  result,
  ctx,
  width,
  height,
  svgRef,
  ariaLabel,
}: KindProps<LineSpec>) => {
  const model = useMemo(
    () => buildCartesianModel(spec, result, ctx),
    [spec, result, ctx]
  );
  const { theme } = ctx;
  const isArea = spec.type === "area";
  const n = model.categories.length;
  const pointer = useChartPointer();
  const focus = useSeriesFocus();

  const legend = useMemo(
    () =>
      layoutLegend(
        model.series.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          mark: isArea ? ("rect" as const) : ("line" as const),
        })),
        width - 16
      ),
    [model, width, isArea]
  );

  const layout = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of model.series) {
      for (const v of s.values) {
        if (v === null) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 0;
    }
    const includeZero = isArea || min >= 0;
    const captionY = 4;
    const legendY = captionY + (model.measure ? MEASURE_ROW : 0);
    const top = legendY + (legend.height > 0 ? legend.height + 10 : 8);
    const bottom = 26 + (model.xTitle ? 18 : 0);
    const plotHeight = Math.max(60, height - bottom - top);
    const maxTicks = Math.max(3, Math.min(6, Math.floor(plotHeight / 45)));
    const probe = linearScale(min, max, 0, 1, {
      includeZero,
      maxTicks,
      integer: model.integer,
    });
    const left =
      Math.max(
        ...probe.ticks.map((t) =>
          textWidth(model.formatTick(t, probe.step), TICK_FONT)
        ),
        8
      ) + 10;

    // The last point of each series, marked with its value.
    const ends = model.series.map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] === null) i--;
      const v = i >= 0 ? s.values[i] : null;
      return {
        s,
        i,
        v,
        value: v === null ? "" : model.formatValue(s.column, v),
      };
    });
    const named =
      model.series.length >= 2 &&
      model.series.length <= 4 &&
      width >= 360 &&
      ends.every((e) => textWidth(e.s.label, LABEL_FONT) <= END_LABEL_MAX);
    const endWidth = (e: (typeof ends)[number], withName: boolean) =>
      textWidth(e.value, LABEL_FONT) +
      (withName ? textWidth(e.s.label, LABEL_FONT) + 6 : 0);
    const right = Math.max(12, ...ends.map((e) => endWidth(e, named) + 16));
    const plot = {
      x0: left,
      x1: Math.max(left + 40, width - right),
      y0: top,
      y1: top + plotHeight,
    };
    const scale = linearScale(min, max, plot.y1, plot.y0, {
      includeZero,
      maxTicks,
      integer: model.integer,
    });

    // x: by value (numbers), by day (dates), else evenly.
    const positions = model.categories.map((c) => c.pos);
    const continuous =
      (model.xKind === "numeric" || model.xKind === "time") &&
      n > 1 &&
      positions.every((p) => p !== undefined);
    let xAt: (i: number) => number;
    let xTicks: AxisTick[] = [];
    let step = n > 1 ? (plot.x1 - plot.x0) / (n - 1) : 0;
    if (continuous) {
      const values = positions;
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (model.xKind === "numeric") {
        const xScale = linearScale(lo, hi, plot.x0, plot.x1, {
          includeZero: false,
          maxTicks: Math.max(3, Math.floor((plot.x1 - plot.x0) / 60)),
          integer: values.every((v) => Number.isInteger(v)),
        });
        xAt = (i) => xScale.map(values[i]);
        xTicks = xScale.ticks.map((t) => ({
          x: xScale.map(t),
          text: formatValue(spec.x, t, {
            locale: ctx.locale,
            seasonStartMonth: ctx.seasonStartMonth,
            format: spec.formats?.[spec.x],
            t: ctx.t,
            compact: true,
          }),
        }));
      } else {
        const span = hi - lo || 1;
        const dayX = (day: number) =>
          plot.x0 + ((day - lo) / span) * (plot.x1 - plot.x0);
        xAt = (i) => dayX(values[i]);
        xTicks = monthTicks(lo, hi, dayX, ctx.locale, plot.x1 - plot.x0) ?? [];
      }
      step = (plot.x1 - plot.x0) / Math.max(1, n - 1);
    } else {
      xAt = (i: number) =>
        n > 1 ? plot.x0 + step * i : (plot.x0 + plot.x1) / 2;
    }
    if (xTicks.length === 0) {
      const widest = Math.max(
        ...model.categories.map((c) => textWidth(c.short, TICK_FONT)),
        1
      );
      const slot = n > 1 ? (plot.x1 - plot.x0) / (n - 1) : plot.x1 - plot.x0;
      const every = labelStep(n, slot, Math.min(widest, 120));
      xTicks = model.categories
        .map((c, i) => ({ i, text: c.short }))
        .filter(({ i }) => i % every === 0)
        .map(({ i, text }) => ({
          x: xAt(i),
          text: truncateText(text, slot * every - 6, TICK_FONT),
        }));
    }
    const xs = model.categories.map((_, i) => xAt(i));

    const paths = drawOrder(model.series).map((s) => {
      let line = "";
      let area = "";
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length === 0) return;
        line += run
          .map(
            ([x, y], j) =>
              `${j === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
          )
          .join("");
        if (isArea) {
          const base = scale.map(Math.max(scale.min, Math.min(0, scale.max)));
          area +=
            `M${run[0][0].toFixed(1)},${base.toFixed(1)}` +
            run.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join("") +
            `L${run[run.length - 1][0].toFixed(1)},${base.toFixed(1)}Z`;
        }
        run = [];
      };
      s.values.forEach((v, i) => {
        if (v === null) flush();
        else run.push([xs[i], scale.map(v)]);
      });
      flush();
      // A lone point between gaps would be invisible: mark it.
      const lonely = s.values
        .map((v, i) => ({ v, i }))
        .filter(
          ({ v, i }) =>
            v !== null &&
            (s.values[i - 1] ?? null) === null &&
            (s.values[i + 1] ?? null) === null
        )
        .map(({ v, i }) => ({ x: xs[i], y: scale.map(v as number) }));
      return { key: s.key, color: s.color, line, area, lonely };
    });

    // End labels: value (and name), dropped when two would collide.
    type EndLabel = {
      key: string;
      x: number;
      y: number;
      name: string | null;
      value: string;
    };
    const place = (withName: boolean): EndLabel[] =>
      ends
        .filter((e) => e.v !== null)
        .map((e) => ({
          key: e.s.key,
          x: xs[e.i] + 9,
          y: scale.map(e.v as number) + 4,
          name: withName ? e.s.label : null,
          value: e.value,
        }));
    const collides = (labels: EndLabel[]) => {
      const ys = labels.map((l) => l.y).sort((a, b) => a - b);
      return ys.some((y, j) => j > 0 && y - ys[j - 1] < 15);
    };
    let endLabels = place(named);
    if (collides(endLabels)) endLabels = place(false);
    if (collides(endLabels)) endLabels = [];
    const endDots = ends
      .filter((e) => e.v !== null)
      .map((e) => ({
        key: e.s.key,
        color: e.s.color,
        x: xs[e.i],
        y: scale.map(e.v as number),
      }));

    return {
      plot,
      scale,
      xs,
      paths,
      endLabels,
      endDots,
      xTicks,
      step,
      captionY,
      legendY,
      height: plot.y1 + bottom,
    };
  }, [model, width, height, legend.height, isArea, n, spec, ctx]);

  const target = (i: number): Target => {
    const values = model.series
      .map((s) => s.values[i])
      .filter((v): v is number => v !== null);
    const y = values.length
      ? layout.scale.map(Math.max(...values))
      : layout.plot.y0;
    return {
      index: i,
      x: layout.xs[i],
      y,
      placement: "right",
      flipX: layout.xs[i],
    };
  };

  const indexAtX = (x: number) => {
    if (n <= 1) return 0;
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(layout.xs[i] - x) < Math.abs(layout.xs[best] - x)) best = i;
    }
    return clamp(best, 0, n - 1);
  };
  const indexAt = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    return indexAtX(box ? event.clientX - box.left : 0);
  };

  const missing = ctx.t("analytics.common.values.null");
  const tooltip = (i: number): TooltipContent => ({
    title: model.categories[i].label,
    rows:
      model.series.length === 1
        ? [
            {
              key: model.series[0].key,
              color: model.series[0].color,
              mark: isArea ? "rect" : "line",
              value:
                model.series[0].values[i] === null
                  ? missing
                  : model.formatValue(
                      model.series[0].column,
                      model.series[0].values[i]
                    ),
              label: model.measure ?? model.series[0].label,
            },
          ]
        : seriesRows(
            model.series,
            (s) => s.values[i] ?? null,
            model.formatValue,
            isArea ? "rect" : "line",
            missing
          ),
  });

  const single = model.series.length === 1 ? model.series[0] : null;
  let peak: { i: number; v: number } | null = null;
  single?.values.forEach((v, i) => {
    if (v !== null && (!peak || v > peak.v)) peak = { i, v };
  });
  const top = peak as { i: number; v: number } | null;
  const label =
    ariaLabel ??
    chartSummary(ctx, {
      type: spec.type,
      measure: model.measure,
      dimension: model.xLabel,
      count: n,
      max:
        single && top
          ? {
              label: model.categories[top.i].label,
              value: model.formatValue(single.column, top.v),
            }
          : null,
      series: model.series.map((s) => s.label),
    });

  const active = pointer.active;
  const { plot, scale } = layout;
  return (
    <div ref={pointer.rootRef} className="relative" style={{ width }}>
      <ChartSvg
        ref={svgRef}
        width={width}
        height={layout.height}
        theme={theme}
        label={label}
        hint={ctx.t("analytics.charts.aria.hint")}
        onPointerLeave={pointer.leave}
        onKeyDown={(event) => {
          if (event.key === "Escape") focus.clear();
          pointer.keyDown(event, n, target);
        }}
      >
        <MeasureCaption
          text={model.measure}
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
        <g>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line
                x1={plot.x0}
                x2={plot.x1}
                y1={scale.map(t)}
                y2={scale.map(t)}
                stroke={t === 0 ? theme.axis : theme.grid}
                strokeWidth={1}
              />
              <text
                x={plot.x0 - 8}
                y={scale.map(t) + 4}
                fontSize={TICK_FONT}
                textAnchor="end"
                fill={theme.textMuted}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {model.formatTick(t, scale.step)}
              </text>
            </g>
          ))}
        </g>
        <g>
          {layout.xTicks.map((l, i) => (
            <text
              key={i}
              x={l.x}
              y={plot.y1 + 17}
              fontSize={TICK_FONT}
              textAnchor="middle"
              fill={theme.textMuted}
            >
              {l.text}
            </text>
          ))}
        </g>
        {model.xTitle && (
          <text
            x={(plot.x0 + plot.x1) / 2}
            y={plot.y1 + 38}
            fontSize={TICK_FONT}
            textAnchor="middle"
            fill={theme.textSecondary}
          >
            {truncateText(model.xTitle, width - 16, TICK_FONT)}
          </text>
        )}
        {isArea && (
          <g>
            {layout.paths.map((p) => (
              <path
                key={p.key}
                d={p.area}
                fill={p.color}
                fillOpacity={0.1}
                opacity={seriesOpacity(focus, p.key)}
              />
            ))}
          </g>
        )}
        <g>
          {layout.paths.map((p) => (
            <g key={p.key} opacity={seriesOpacity(focus, p.key)}>
              <path
                d={p.line}
                fill="none"
                stroke={p.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {p.lonely.map((dot, j) => (
                <circle key={j} cx={dot.x} cy={dot.y} r={3} fill={p.color} />
              ))}
            </g>
          ))}
        </g>
        <g>
          {layout.endDots.map((d) => (
            <circle
              key={d.key}
              cx={d.x}
              cy={d.y}
              r={4}
              fill={d.color}
              stroke={theme.surface}
              strokeWidth={2}
              opacity={seriesOpacity(focus, d.key)}
            />
          ))}
        </g>
        <g>
          {layout.endLabels.map((l) => (
            <text
              key={l.key}
              x={l.x}
              y={l.y}
              fontSize={LABEL_FONT}
              opacity={seriesOpacity(focus, l.key)}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {l.name && (
                <tspan fill={theme.textSecondary}>{`${l.name} `}</tspan>
              )}
              <tspan fill={theme.textPrimary} fontWeight={600}>
                {l.value}
              </tspan>
            </text>
          ))}
        </g>
        {active && model.categories[active.index] && (
          <g pointerEvents="none" data-active="overlay">
            <line
              x1={layout.xs[active.index]}
              x2={layout.xs[active.index]}
              y1={plot.y0}
              y2={plot.y1}
              stroke={theme.axis}
              strokeWidth={1}
            />
            {model.series.map((s) => {
              const v = s.values[active.index];
              return v === null ? null : (
                <circle
                  key={s.key}
                  cx={layout.xs[active.index]}
                  cy={scale.map(v)}
                  r={5}
                  fill={s.color}
                  stroke={theme.surface}
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
        <rect
          x={plot.x0 - Math.max(8, layout.step / 2)}
          y={plot.y0}
          width={plot.x1 - plot.x0 + Math.max(16, layout.step)}
          height={plot.y1 - plot.y0 + 20}
          fill="transparent"
          data-hit="true"
          onPointerEnter={(event) =>
            pointer.hover(target(indexAt(event)), event)
          }
          onPointerMove={(event) =>
            pointer.hover(target(indexAt(event)), event)
          }
          onClick={(event) => {
            const box =
              event.currentTarget.ownerSVGElement?.getBoundingClientRect();
            const x = box ? event.clientX - box.left : 0;
            pointer.tap(target(indexAtX(x)));
          }}
        />
      </ChartSvg>
      <ChartTooltip
        target={active}
        content={
          active && model.categories[active.index]
            ? tooltip(active.index)
            : null
        }
        containerWidth={width}
        containerHeight={layout.height}
        theme={theme}
      />
      <CappedNote ctx={ctx} capped={model.capped} />
    </div>
  );
};
