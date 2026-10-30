import { useMemo } from "react";
import type { PieSpec } from "../../chartSpec";
import type { QueryResult } from "../../types";
import { columnIndex } from "../columns";
import { colorSeriesByEntity, domainOf, orderSeries } from "../foldSeries";
import {
  ChartContext,
  labelOf,
  makeFormatter,
  measureLabelOf,
  seriesValueLabel,
} from "../model";
import { numberFormatter } from "../format";
import { seriesKey, toNumberOrNull, WideSeries } from "../pivot";
import { textWidth, truncateText } from "../text";
import {
  ChartTooltip,
  Target,
  TooltipContent,
  useChartPointer,
} from "../Tooltip";
import { chartSummary, ChartSvg, KindProps, LABEL_FONT } from "./ChartSvg";

/**
 * Part-to-whole ring for 6 slices or fewer (plan 2.9; ChartView draws
 * horizontal bars otherwise): slices from the largest, "Non renseigné"
 * last, 2 px surface gaps between slices, the total and the measure's
 * name in the centre, a legend with value and share ("< 1 %" for a
 * sliver) beside or under the ring.
 */

const MAX_PIE_SLICES = 6;

interface PieSlice {
  key: string;
  raw: string | number | null;
  value: number;
}

/** Slices of a result (duplicates summed); null when a pie cannot show it. */
export const pieSlices = (
  spec: PieSpec,
  result: QueryResult
): PieSlice[] | null => {
  const li = columnIndex(result.columns, spec.label);
  const vi = columnIndex(result.columns, spec.value);
  const byKey = new Map<string, PieSlice>();
  for (const row of result.rows) {
    const value = toNumberOrNull(row[vi] ?? null);
    if (value === null) continue;
    if (value < 0) return null;
    const raw = row[li] ?? null;
    const key = seriesKey(raw);
    const slice = byKey.get(key);
    if (slice) slice.value += value;
    else byKey.set(key, { key, raw, value });
  }
  const slices = [...byKey.values()].filter((s) => s.value > 0);
  return slices.length > MAX_PIE_SLICES ? null : slices;
};

const arc = (
  cx: number,
  cy: number,
  r: number,
  inner: number,
  a0: number,
  a1: number
) => {
  const p = (radius: number, angle: number) =>
    `${(cx + radius * Math.sin(angle)).toFixed(2)},${(cy - radius * Math.cos(angle)).toFixed(2)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // Full ring: two halves.
    return (
      `M${p(r, 0)}A${r},${r} 0 1 1 ${p(r, Math.PI)}A${r},${r} 0 1 1 ${p(r, 0)}Z` +
      `M${p(inner, 0)}A${inner},${inner} 0 1 0 ${p(inner, Math.PI)}A${inner},${inner} 0 1 0 ${p(inner, 0)}Z`
    );
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}` +
    `L${p(inner, a1)}A${inner},${inner} 0 ${large} 0 ${p(inner, a0)}Z`
  );
};

export const PieChart = ({
  spec,
  ctx,
  width,
  height,
  svgRef,
  slices,
  ariaLabel,
}: Omit<KindProps<PieSpec>, "result"> & { slices: PieSlice[] }) => {
  const { theme } = ctx;
  const pointer = useChartPointer();
  const model = useMemo(() => buildPie(spec, slices, ctx), [spec, slices, ctx]);

  const wide = width >= 440;
  const legendRow = 26;
  const legendHeight = model.items.length * legendRow;
  const size = wide
    ? Math.max(120, Math.min(height - 16, width * 0.42, 280))
    : Math.max(120, Math.min(width - 32, 240));
  const r = size / 2;
  const cx = wide ? 16 + r : width / 2;
  const cy = 8 + r;
  const legendX = wide ? cx + r + 28 : 16;
  const legendY = wide ? Math.max(8, cy - legendHeight / 2) : cy + r + 16;
  const svgHeight = wide
    ? Math.max(size + 16, legendHeight + 16)
    : size + 32 + legendHeight;
  const legendWidth = width - legendX - 8;
  const shareWidth = Math.max(
    ...model.items.map((i) => textWidth(i.shareText, LABEL_FONT))
  );
  const valueWidth =
    Math.max(...model.items.map((i) => textWidth(i.valueText, LABEL_FONT))) +
    shareWidth +
    8;

  const target = (i: number): Target => ({
    index: i,
    x: cx + r * 0.8 * Math.sin(model.items[i].mid),
    y: cy - r * 0.8 * Math.cos(model.items[i].mid),
  });

  const tooltip = (i: number): TooltipContent => ({
    title: model.items[i].label,
    rows: [
      {
        key: "value",
        color: model.items[i].color,
        mark: "rect",
        value: model.items[i].valueText,
        label: model.items[i].shareText,
      },
    ],
  });

  return (
    <div ref={pointer.rootRef} className="relative" style={{ width }}>
      <ChartSvg
        ref={svgRef}
        width={width}
        height={svgHeight}
        theme={theme}
        label={
          ariaLabel ??
          chartSummary(ctx, {
            type: "pie",
            measure: model.measure,
            dimension: labelOf(spec, ctx, spec.label),
            count: model.items.length,
            max: model.items[0]
              ? {
                  label: model.items[0].label,
                  value: `${model.items[0].valueText} (${model.items[0].shareText})`,
                }
              : null,
          })
        }
        hint={ctx.t("analytics.charts.aria.hint")}
        onPointerLeave={pointer.leave}
        onKeyDown={(event) =>
          pointer.keyDown(event, model.items.length, target)
        }
      >
        <g>
          {model.items.map((item, i) => (
            <path
              key={item.key}
              d={arc(
                cx,
                cy,
                r * (pointer.active?.index === i ? 1 : 0.97),
                r * 0.6,
                item.a0,
                item.a1
              )}
              fill={item.color}
              stroke={theme.surface}
              strokeWidth={model.items.length > 1 ? 2 : 0}
              fillRule="evenodd"
              data-hit="true"
              onPointerEnter={(event) => pointer.hover(target(i), event)}
              onPointerMove={(event) => pointer.hover(target(i), event)}
              onClick={() => pointer.tap(target(i))}
            />
          ))}
        </g>
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          fontSize={Math.max(16, Math.min(24, r / 4))}
          fontWeight={600}
          fill={theme.textPrimary}
        >
          {model.totalText}
        </text>
        <text
          x={cx}
          y={cy + 20}
          textAnchor="middle"
          fontSize={LABEL_FONT}
          fill={theme.textSecondary}
        >
          {truncateText(model.measure, r * 1.1, LABEL_FONT)}
        </text>
        <g transform={`translate(${legendX},${legendY})`}>
          {model.items.map((item, i) => (
            <g
              key={item.key}
              transform={`translate(0,${i * legendRow})`}
              data-hit="true"
              onPointerEnter={(event) => pointer.hover(target(i), event)}
              onClick={() => pointer.tap(target(i))}
            >
              <rect
                width={Math.max(0, legendWidth)}
                height={legendRow}
                fill="transparent"
              />
              <rect
                x={0}
                y={7}
                width={12}
                height={12}
                rx={2}
                fill={item.color}
              />
              <text
                x={20}
                y={17}
                fontSize={LABEL_FONT}
                fill={theme.textSecondary}
              >
                {truncateText(
                  item.label,
                  Math.max(40, legendWidth - valueWidth - 32),
                  LABEL_FONT
                )}
              </text>
              <text
                x={Math.max(20, legendWidth - shareWidth - 8)}
                y={17}
                fontSize={LABEL_FONT}
                textAnchor="end"
                fill={theme.textPrimary}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {item.valueText}
              </text>
              <text
                x={Math.max(20, legendWidth)}
                y={17}
                fontSize={LABEL_FONT}
                textAnchor="end"
                fill={theme.textMuted}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {item.shareText}
              </text>
            </g>
          ))}
        </g>
      </ChartSvg>
      <ChartTooltip
        target={pointer.active}
        content={pointer.active ? tooltip(pointer.active.index) : null}
        containerWidth={width}
        theme={theme}
      />
    </div>
  );
};

const buildPie = (spec: PieSpec, slices: PieSlice[], ctx: ChartContext) => {
  const format = makeFormatter(spec, ctx);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const series: WideSeries[] = slices.map((s) => ({
    key: s.key,
    raw: s.raw,
    values: [s.value],
  }));
  const ordered = orderSeries(series, domainOf(spec.label, ctx.params));
  const colors = colorSeriesByEntity(
    ordered,
    spec.label,
    ctx.theme,
    ctx.params
  );
  // Largest slice first, "Non renseigné" last; colours by entity.
  const sorted = [...slices].sort((a, b) => {
    const unknownA = a.raw === null || a.raw === "unknown" ? 1 : 0;
    const unknownB = b.raw === null || b.raw === "unknown" ? 1 : 0;
    return unknownA - unknownB || b.value - a.value;
  });
  let angle = 0;
  const percent = numberFormatter(ctx.locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const shareText = (share: number) =>
    share > 0 && share < 0.005
      ? `<\u00a0${percent.format(0.01)}`
      : percent.format(share);
  const items = sorted.map((s) => {
    const share = total > 0 ? s.value / total : 0;
    const a0 = angle;
    angle += share * Math.PI * 2;
    return {
      key: s.key,
      label: seriesValueLabel(spec, ctx, spec.label, s.raw),
      color: colors.get(s.key) ?? ctx.theme.other,
      valueText: format(spec.value, s.value),
      shareText: shareText(share),
      a0,
      a1: angle,
      mid: (a0 + angle) / 2,
    };
  });
  return {
    items,
    totalText: format(spec.value, total),
    measure: measureLabelOf(spec, ctx, spec.value),
  };
};
