import { useMemo } from "react";
import type { CalendarSpec } from "../../chartSpec";
import type { QueryResult } from "../../types";
import { currentSeason, localNow, seasonBounds } from "../../params/season";
import { columnIndex } from "../columns";
import {
  dayNumber,
  formatLocalDate,
  fromDayNumber,
  isoWeekday,
  monthName,
  monthTick,
  parseLocalDate,
  weekdayName,
} from "../format";
import { ChartContext, makeFormatter, measureLabelOf } from "../model";
import { sequentialStep } from "../palette";
import { toNumberOrNull } from "../pivot";
import { clamp } from "../scale";
import { textWidth } from "../text";
import {
  ChartTooltip,
  Target,
  TooltipContent,
  useChartPointer,
} from "../Tooltip";
import { ScaleLegend, scaleLegendLayout, scaleLegendX } from "./Heatmap";
import {
  CappedNote,
  chartSummary,
  ChartSvg,
  KindProps,
  TICK_FONT,
} from "./ChartSvg";
import { ScrollFrame } from "./ScrollFrame";

/**
 * Activity calendar (custom SVG, plan 2.9): weeks as columns, ISO
 * weekdays as rows (Monday first), month names on top (with the year on
 * the first and on January), a one-hue ramp from zero, a bordered surface
 * for days without value, today outlined. It spans the season of the
 * `season` parameter when there is one (days after today are not drawn),
 * else the dates of the result; at most three years (the latest). In a
 * narrow card it opens scrolled to the latest weeks.
 */

const MAX_WEEKS = 157;

interface CalendarModel {
  /** Day number of the Monday of the first column. */
  firstMonday: number;
  weeks: number;
  firstDay: number;
  lastDay: number;
  values: Map<number, number>;
  max: number;
  /** Day number of today when it is drawn. */
  today: number | null;
  capped: { shown: number; total: number } | null;
}

export const buildCalendarModel = (
  spec: CalendarSpec,
  result: QueryResult,
  ctx: ChartContext,
  today: string = localNow()
): CalendarModel | null => {
  const di = columnIndex(result.columns, spec.date);
  const vi = columnIndex(result.columns, spec.value);
  const values = new Map<number, number>();
  for (const row of result.rows) {
    const text = row[di];
    if (typeof text !== "string") continue;
    const date = parseLocalDate(text);
    if (!date) continue;
    const v = toNumberOrNull(row[vi] ?? null);
    if (v === null) continue;
    const day = dayNumber(date);
    values.set(day, (values.get(day) ?? 0) + v);
  }
  const days = [...values.keys()];
  const todayDate = parseLocalDate(today);
  const todayDay = todayDate ? dayNumber(todayDate) : Infinity;

  let firstDay: number;
  let lastDay: number;
  const given = ctx.params.season;
  const season =
    given === "current" ? currentSeason(today, ctx.seasonStartMonth) : given;
  if (typeof season === "number" && Number.isInteger(season)) {
    const bounds = seasonBounds(season, ctx.seasonStartMonth);
    const start = parseLocalDate(bounds.start);
    const end = parseLocalDate(bounds.end);
    if (!start || !end) return null;
    firstDay = dayNumber(start);
    lastDay = Math.min(dayNumber(end) - 1, Math.max(todayDay, ...days));
    if (days.length > 0) {
      firstDay = Math.min(firstDay, ...days);
      lastDay = Math.max(lastDay, ...days);
    }
  } else {
    if (days.length === 0) return null;
    firstDay = Math.min(...days);
    lastDay = Math.max(...days);
  }
  if (lastDay < firstDay) lastDay = firstDay;

  const mondayOf = (day: number) => day - (isoWeekday(fromDayNumber(day)) - 1);
  let firstMonday = mondayOf(firstDay);
  const totalWeeks = Math.floor((lastDay - firstMonday) / 7) + 1;
  // Longer spans keep the latest weeks (the table has every day).
  const capped: CalendarModel["capped"] = null;
  if (totalWeeks > MAX_WEEKS) {
    firstMonday = mondayOf(lastDay) - (MAX_WEEKS - 1) * 7;
    firstDay = Math.max(firstDay, firstMonday);
  }
  const weeks = Math.floor((lastDay - firstMonday) / 7) + 1;
  let max = 0;
  for (const [day, v] of values) {
    if (day < firstDay || day > lastDay) continue;
    max = Math.max(max, v);
  }
  return {
    firstMonday,
    weeks,
    firstDay,
    lastDay,
    values,
    max,
    today: todayDay >= firstDay && todayDay <= lastDay ? todayDay : null,
    capped,
  };
};

export const CalendarChart = ({
  spec,
  result,
  ctx,
  width,
  svgRef,
  today,
  ariaLabel,
}: KindProps<CalendarSpec> & { today?: string }) => {
  const model = useMemo(
    () => buildCalendarModel(spec, result, ctx, today),
    [spec, result, ctx, today]
  );
  const pointer = useChartPointer();
  if (!model) return null;
  return (
    <CalendarSvg
      spec={spec}
      ctx={ctx}
      model={model}
      width={width}
      svgRef={svgRef}
      pointer={pointer}
      ariaLabel={ariaLabel}
    />
  );
};

const CalendarSvg = ({
  spec,
  ctx,
  model,
  width,
  svgRef,
  pointer,
  ariaLabel,
}: {
  spec: CalendarSpec;
  ctx: ChartContext;
  model: CalendarModel;
  width: number;
  svgRef?: React.Ref<SVGSVGElement>;
  pointer: ReturnType<typeof useChartPointer>;
  ariaLabel?: string;
}) => {
  const { theme } = ctx;
  const format = makeFormatter(spec, ctx);
  const measure = measureLabelOf(spec, ctx, spec.value);
  const left =
    Math.max(
      ...[1, 2, 3, 4, 5, 6, 7].map((d) =>
        textWidth(weekdayName(d, ctx.locale, true), TICK_FONT)
      )
    ) + 10;
  // 12 px cells still read (a season of 53 weeks fits ~700 px, no scroll).
  const cell = clamp(Math.floor((width - left - 8) / model.weeks), 12, 26);
  const gap = 2;
  const top = 24;
  const svgWidth = Math.max(width, left + cell * model.weeks + 8);
  // The frame opens scrolled to the end: the legend sits in that view,
  // clear of its 24 px left fade.
  const viewStart = svgWidth - width;
  const scaleY = top + cell * 7 + 14;
  const legend = scaleLegendLayout(ctx, width - 4, {
    measure,
    maxText: model.max > 0 ? format(spec.value, model.max) : undefined,
  });
  const svgHeight = scaleY + legend.height + 12;

  const days: number[] = [];
  for (let d = model.firstDay; d <= model.lastDay; d++) days.push(d);
  const position = (day: number) => {
    const offset = day - model.firstMonday;
    return { col: Math.floor(offset / 7), row: offset % 7 };
  };

  // Month labels at the first column holding the 1st of a month; the
  // first and January carry the year ("août 2025", "janv. 2026").
  const months: { x: number; text: string }[] = [];
  let lastX = -Infinity;
  for (const day of days) {
    const date = fromDayNumber(day);
    if (date.day !== 1 && day !== model.firstDay) continue;
    const { col } = position(day);
    const x = left + col * cell;
    const short = cell * 4 < 70;
    const withYear = months.length === 0 || date.month === 1;
    const text = withYear
      ? monthTick(date.year, date.month, ctx.locale, true)
      : monthName(date.month, ctx.locale, short);
    if (x - lastX < textWidth(text, TICK_FONT) + 6) continue;
    months.push({ x, text });
    lastX = x;
  }

  const target = (i: number): Target => {
    const { col, row } = position(days[i]);
    return {
      index: i,
      x: left + col * cell + cell / 2,
      y: top + row * cell,
      h: cell,
      placement: "above",
    };
  };
  const tooltip = (i: number): TooltipContent => {
    const date = fromDayNumber(days[i]);
    const v = model.values.get(days[i]);
    return {
      title: formatLocalDate(date, ctx.locale),
      rows: [
        v === undefined || v === 0
          ? { key: "none", value: ctx.t("analytics.charts.noValue") }
          : {
              key: "v",
              value: format(spec.value, v),
              label: measure,
            },
      ],
    };
  };

  let peak: { day: number; v: number } | null = null;
  for (const day of days) {
    const v = model.values.get(day);
    if (v !== undefined && (!peak || v > peak.v)) peak = { day, v };
  }
  const best = peak;
  const label =
    ariaLabel ??
    chartSummary(ctx, {
      type: "calendar",
      measure,
      count: days.length,
      max: best
        ? {
            label: formatLocalDate(fromDayNumber(best.day), ctx.locale),
            value: format(spec.value, best.v),
          }
        : null,
    });
  const count = days.length;

  return (
    <div style={{ width }}>
      <ScrollFrame width={width} surface={theme.surface} startAtEnd>
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
              // Weeks are columns: ↑↓ a day, ←→ a week.
              pointer.keyDown(event, count, target, {
                h: 7,
                v: 1,
                rowStart: (i) => i % 7,
                rowEnd: (i) => count - 1 - ((count - 1 - i) % 7),
              })
            }
          >
            <g>
              {months.map((m) => (
                <text
                  key={m.x}
                  x={m.x}
                  y={top - 8}
                  fontSize={TICK_FONT}
                  fill={theme.textMuted}
                >
                  {m.text}
                </text>
              ))}
            </g>
            <g>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <text
                  key={d}
                  x={left - 8}
                  y={top + (d - 1) * cell + cell / 2 + 4}
                  textAnchor="end"
                  fontSize={TICK_FONT}
                  fill={theme.textMuted}
                >
                  {weekdayName(d, ctx.locale, true)}
                </text>
              ))}
            </g>
            <g>
              {days.map((day, i) => {
                const { col, row } = position(day);
                const v = model.values.get(day) ?? 0;
                const step = sequentialStep(v, 0, model.max);
                const x = left + col * cell + gap / 2;
                const y = top + row * cell + gap / 2;
                const isActive = pointer.active?.index === i;
                const isToday = day === model.today;
                return (
                  <rect
                    data-today={isToday ? "true" : undefined}
                    data-active={isActive ? "mark" : undefined}
                    data-base-stroke={
                      isActive
                        ? isToday
                          ? theme.textPrimary
                          : step < 0
                            ? theme.border
                            : "none"
                        : undefined
                    }
                    data-base-stroke-width={
                      isActive ? (isToday ? 2 : 1) : undefined
                    }
                    key={day}
                    x={x}
                    y={y}
                    width={cell - gap}
                    height={cell - gap}
                    rx={cell < 16 ? 2 : 3}
                    fill={step < 0 ? theme.surface : theme.sequential[step]}
                    stroke={
                      isActive || isToday
                        ? theme.textPrimary
                        : step < 0
                          ? theme.border
                          : "none"
                    }
                    strokeWidth={isActive || isToday ? 2 : 1}
                    data-hit="true"
                    onPointerEnter={(event) => pointer.hover(target(i), event)}
                    onClick={() => pointer.tap(target(i))}
                  />
                );
              })}
            </g>
            <ScaleLegend
              ctx={ctx}
              x={viewStart + scaleLegendX(legend, viewStart ? 28 : left, width)}
              y={scaleY}
              layout={legend}
            />
          </ChartSvg>
          <ChartTooltip
            target={pointer.active}
            content={
              pointer.active && days[pointer.active.index] !== undefined
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
