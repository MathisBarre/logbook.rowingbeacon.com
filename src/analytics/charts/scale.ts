/** Linear scales and round ticks for the SVG charts. */

const niceStep = (rough: number): number => {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / power;
  const nice =
    fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 2.5
          ? 2.5
          : fraction <= 5
            ? 5
            : 10;
  return nice * power;
};

export interface LinearScale {
  min: number;
  max: number;
  ticks: number[];
  /** Distance between two ticks (decides the decimals of their labels). */
  step: number;
  /** Pixel position of `value` between `from` (min) and `to` (max). */
  map: (value: number) => number;
}

interface Candidate {
  start: number;
  end: number;
  step: number;
  count: number;
}

const candidate = (min: number, max: number, step: number): Candidate => {
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  return { start, end, step, count: Math.round((end - start) / step) + 1 };
};

/**
 * Round domain and ticks around `[min, max]`, always including 0 when
 * `includeZero` (bars and areas grow from a single baseline). Every tick
 * count from 3 to `maxTicks + 1` is tried and the one whose ends overshoot
 * the data the least wins (ties: the count nearest `maxTicks`), so that a
 * narrow chart never runs to 500 for a maximum of 265. `integer` keeps
 * ticks on whole numbers (counts never read "0,5 sortie").
 */
export const linearScale = (
  dataMin: number,
  dataMax: number,
  from: number,
  to: number,
  options: { maxTicks?: number; includeZero?: boolean; integer?: boolean } = {}
): LinearScale => {
  const { includeZero = true, integer = false } = options;
  const maxTicks = Math.max(2, options.maxTicks ?? 5);
  let min = Number.isFinite(dataMin) ? dataMin : 0;
  let max = Number.isFinite(dataMax) ? dataMax : 0;
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    if (max === 0) max = integer ? 4 : 1;
    else if (max > 0) min = includeZero ? 0 : max - Math.abs(max) * 0.5;
    else max = includeZero ? 0 : min + Math.abs(min) * 0.5;
  }
  const span = max - min;
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (let count = 3; count <= maxTicks + 1; count++) {
    let step = niceStep(span / (count - 1));
    if (integer && step < 1) step = 1;
    if (integer && !Number.isInteger(step)) continue;
    const c = candidate(min, max, step);
    if (c.count > maxTicks + 1 || c.count < 2) continue;
    // Overshoot as a share of the data span, then closeness to maxTicks.
    const overshoot = (c.end - max + (min - c.start)) / span;
    const score = overshoot * 100 + Math.abs(c.count - maxTicks) * 0.01;
    if (score < bestScore - 1e-9) {
      best = c;
      bestScore = score;
    }
  }
  if (!best) {
    let step = niceStep(span / Math.max(1, maxTicks - 1));
    if (integer) step = Math.max(1, Math.ceil(step));
    best = candidate(min, max, step);
  }
  const { start, end, step } = best;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Number(v.toFixed(10)));
    if (ticks.length > 50) break;
  }
  const extent = end - start || 1;
  return {
    min: start,
    max: end,
    ticks,
    step,
    map: (value: number) => from + ((value - start) / extent) * (to - from),
  };
};

/** Decimals a tick label needs for `step` (1 → 0, 0.5 → 1, 0.25 → 2). */
export const stepDecimals = (step: number): number => {
  if (!(step > 0) || step >= 1) return 0;
  for (let d = 1; d <= 6; d++) {
    if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  }
  return 6;
};

/** Every `step`-th label index shown so that labels do not overlap. */
export const labelStep = (
  count: number,
  slot: number,
  labelWidth: number,
  gap = 8
): number => {
  if (count <= 1 || slot <= 0) return 1;
  return Math.max(1, Math.ceil((labelWidth + gap) / slot));
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
