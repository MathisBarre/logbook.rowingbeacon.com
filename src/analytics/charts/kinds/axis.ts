import { fromDayNumber, monthTick } from "../format";
import { textWidth } from "../text";
import { TICK_FONT } from "./ChartSvg";

/**
 * Ticks of time axes: on the first of the month, printed "sept.", with the
 * year on the first tick and on January ("janv. 2026"), never on arbitrary
 * days ("26 sept.") nor as "août 25".
 */

export interface AxisTick {
  x: number;
  text: string;
}

const MONTH_STEPS = [1, 2, 3, 6, 12];

/** Day number of the first of a month (month 1-12). */
const firstOf = (year: number, month: number) =>
  Math.round(Date.UTC(year, month - 1, 1) / 86_400_000);

const yearMarks = (
  months: { year: number; month: number; x: number }[],
  locale: string
): AxisTick[] =>
  months.map((m, i) => ({
    x: m.x,
    text: monthTick(m.year, m.month, locale, i === 0 || m.month === 1),
  }));

/**
 * Month ticks of a continuous time axis between two day numbers; every
 * 1, 2, 3, 6 or 12 months, the smallest step whose labels fit. Null when
 * the range holds fewer than two month starts (the caller labels days).
 */
export const monthTicks = (
  firstDay: number,
  lastDay: number,
  xOf: (day: number) => number,
  locale: string,
  plotWidth: number
): AxisTick[] | null => {
  const start = fromDayNumber(firstDay);
  const all: { year: number; month: number; day: number }[] = [];
  let year = start.year;
  let month = start.month;
  if (start.day !== 1) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  for (;;) {
    const day = firstOf(year, month);
    if (day > lastDay) break;
    all.push({ year, month, day });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (all.length > 600) break;
  }
  if (all.length < 2) return null;
  const widest = textWidth(monthTick(2026, 9, locale, true), TICK_FONT) + 10;
  for (const step of MONTH_STEPS) {
    const picked = all.filter((m) => (m.month - 1) % step === 0);
    if (picked.length < 2 && step > 1) continue;
    const gap = picked.length > 1 ? plotWidth / (picked.length - 1) : plotWidth;
    if (gap >= widest || step === 12) {
      return yearMarks(
        picked.map((m) => ({ ...m, x: xOf(m.day) })),
        locale
      );
    }
  }
  return null;
};

/**
 * Month labels of a band axis (bars per day or week): the first band of
 * each month, thinned so that labels never overlap.
 */
export const bandMonthTicks = (
  days: (number | undefined)[],
  xAt: (index: number) => number,
  locale: string
): AxisTick[] | null => {
  const starts: { year: number; month: number; x: number }[] = [];
  let previous: string | null = null;
  days.forEach((day, i) => {
    if (day === undefined) return;
    const date = fromDayNumber(day);
    const key = `${date.year}-${date.month}`;
    if (key !== previous) starts.push({ ...date, x: xAt(i) });
    previous = key;
  });
  if (starts.length < 2) return null;
  const widest = textWidth(monthTick(2026, 9, locale, true), TICK_FONT) + 10;
  for (const step of MONTH_STEPS) {
    const picked = starts.filter(
      (m, i) => i === 0 || (m.month - 1) % step === 0
    );
    const fits = picked.every(
      (m, i) => i === 0 || m.x - picked[i - 1].x >= widest
    );
    if (fits || step === 12) return yearMarks(picked, locale);
  }
  return null;
};
