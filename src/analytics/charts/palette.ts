/**
 * Chart colours (plan 2.9), from the dataviz reference instance. The
 * categorical order is fixed and never cycled: a ninth series folds into
 * "Autres" (foldSeries.ts), drawn in the neutral `other` colour. Colours are
 * plain hex so that charts can be serialised as self-contained SVG (PNG
 * export, annual HTML).
 *
 * Validated with the dataviz validator (scripts/validate_palette.js):
 * light (surface #fcfcfb and #ffffff) and dark (surface #1a1a19) pass every
 * hard gate; three light slots sit under 3:1 contrast, so every chart has
 * a legend or direct labels and a table view (relief rule).
 */

export type ChartMode = "light" | "dark";

const CATEGORICAL: Record<ChartMode, readonly string[]> = {
  light: [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#6250d6",
    "#e34948",
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
};

export const MAX_SERIES = CATEGORICAL.light.length;

/**
 * Sequential blue ramp, steps 100 → 700 (heatmap, calendar), in even
 * lightness steps (OKLab L .905 → .338, 0.095 apart) so that no two
 * buckets look alike.
 */
const SEQUENTIAL = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

/**
 * Red ramp for negative values of a diverging heatmap (same lightness
 * steps as the blue one, in the hue of #d03b3b), the neutral #f0efec at
 * zero.
 */
const DIVERGING_NEGATIVE = [
  "#fed4d0",
  "#f7aba4",
  "#ed7f77",
  "#e14c49",
  "#ba3233",
  "#912022",
  "#671214",
] as const;
export const DIVERGING_ZERO = "#f0efec";

/**
 * Status colours: only for severity and safety issues, always labelled.
 * Warning is a light yellow (with ink text) so that the loudest colour
 * stays on the most serious level; validated: all pairs ΔE 13.9 under
 * colour-vision deficiency, 15.7 for normal vision.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#f7d04a",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;
type StatusLevel = keyof typeof STATUS;

export interface ChartTheme {
  mode: ChartMode;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  grid: string;
  axis: string;
  border: string;
  /** "Autres", the previous season and other de-emphasised marks. */
  other: string;
  /** "Non renseigné": lighter than "Autres" so the two never look alike. */
  unknown: string;
  /** Wash behind the hovered category. */
  highlight: string;
  successText: string;
  errorText: string;
  categorical: readonly string[];
  sequential: readonly string[];
  /** Negative half of a diverging scale, light → dark. */
  negative: readonly string[];
  /** Midpoint of a diverging scale. */
  zero: string;
}

export const CHART_THEMES: Record<ChartMode, ChartTheme> = {
  light: {
    mode: "light",
    surface: "#ffffff",
    textPrimary: "#0b0b0b",
    // Cool greys, as the app's Tailwind gray-200…600.
    textSecondary: "#4b5563",
    textMuted: "#6b7280",
    grid: "#e5e7eb",
    axis: "#d1d5db",
    border: "#e5e7eb",
    other: "#9ca3af",
    unknown: "#d1d5db",
    highlight: "rgba(17,24,39,0.05)",
    successText: "#006300",
    errorText: "#b42323",
    categorical: CATEGORICAL.light,
    sequential: SEQUENTIAL,
    negative: DIVERGING_NEGATIVE,
    zero: DIVERGING_ZERO,
  },
  dark: {
    mode: "dark",
    surface: "#1a1a19",
    textPrimary: "#f0efec",
    textSecondary: "#c3c2b7",
    textMuted: "#a3a29b",
    grid: "#2c2c2a",
    axis: "#383835",
    border: "#383835",
    other: "#6b7280",
    unknown: "#4b5563",
    highlight: "rgba(255,255,255,0.07)",
    successText: "#0ca30c",
    errorText: "#e66767",
    categorical: CATEGORICAL.dark,
    // The ramp reversed: on the dark surface "more" is lighter.
    sequential: [...SEQUENTIAL].reverse(),
    negative: [...DIVERGING_NEGATIVE].reverse(),
    zero: "#383835",
  },
};

/** System sans, inlined in exported SVG. */
export const CHART_FONT =
  'Roboto, Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * The app has no dark theme yet (tailwind `darkMode: ["class"]`, never
 * set); charts follow the `dark` class on <html> as soon as it exists.
 */
export const getChartMode = (): ChartMode => {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};

export const getChartTheme = (mode: ChartMode = getChartMode()) =>
  CHART_THEMES[mode];

const INK = "#0b0b0b";

/** WCAG relative luminance of a #rrggbb colour. */
export const luminance = (hex: string): number => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 0;
  const channel = (i: number) => {
    const c = parseInt(match[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};

/** WCAG contrast ratio of two colours. */
export const contrast = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * Text colour inside a filled mark: ink or white, whichever contrasts
 * more (steps 1-4 of the blue ramp take ink, 5-7 white, 5.4:1 and up).
 */
export const inkOn = (fill: string): string =>
  contrast(fill, INK) >= contrast(fill, "#ffffff") ? INK : "#ffffff";

/**
 * Status of a series named after a severity or a safety issue (plan 2.9):
 * damage severity unusable = critical, limited = serious, usable =
 * warning; outings never closed = critical, late returns and youth
 * without coaching = serious, no planned return = warning.
 */
const STATUS_BY_NAME: Record<string, StatusLevel> = {
  unusable: "critical",
  limited: "serious",
  usable: "warning",
  not_closed: "critical",
  late_return: "serious",
  late_returns: "serious",
  youth_not_coached: "serious",
  no_estimated_end: "warning",
};

/** Columns whose values are severities or issues. */
const STATUS_COLUMNS = new Set(["severity", "issue"]);

export const statusOfColumn = (column: string): StatusLevel | null =>
  STATUS_BY_NAME[column] ?? null;

export const statusOfValue = (
  column: string,
  value: string
): StatusLevel | null =>
  STATUS_COLUMNS.has(column) ? (STATUS_BY_NAME[value] ?? null) : null;

/**
 * Index of `value` in the sequential ramp (0-6) on a scale from `min`
 * (callers pass 0: magnitude always starts at zero, so 80 % is never the
 * lightest cell) to `max`; values ≤ 0 return -1 (drawn as the surface
 * with a border).
 */
export const sequentialStep = (
  value: number,
  min: number,
  max: number
): number => {
  if (!(value > 0)) return -1;
  const steps = SEQUENTIAL.length;
  if (max <= min) return steps - 1;
  const ratio = (value - min) / (max - min);
  return Math.max(0, Math.min(steps - 1, Math.ceil(ratio * steps) - 1));
};

/**
 * Fill of a diverging cell, symmetric around 0: the blue ramp above, the
 * red one below, `zero` at 0.
 */
export const divergingFill = (
  value: number,
  maxAbs: number,
  theme: ChartTheme
): string => {
  if (value === 0 || !(maxAbs > 0)) return theme.zero;
  const steps = theme.sequential.length;
  const index = Math.max(
    0,
    Math.min(steps - 1, Math.ceil((Math.abs(value) / maxAbs) * steps) - 1)
  );
  return value > 0 ? theme.sequential[index] : theme.negative[index];
};
