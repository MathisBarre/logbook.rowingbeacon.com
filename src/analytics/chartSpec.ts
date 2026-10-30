import { z } from "zod";

/**
 * Chart and parameter specs (ADR 0008, plan 2.7). Every chart shown by the
 * analytics hub is described by a `ChartSpec`; every query parameter by a
 * `ParamDef`. Both are stored as JSON (`analytics_query.chart`,
 * `analytics_query.params`, `analytics_dashboard_item.chart_override`) and
 * validated with these schemas on read.
 */

export const SPEC_VERSION = 1;

const Column = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

export const ValueFormat = z.enum([
  "auto",
  "integer",
  "decimal",
  "percent",
  "km",
  "hours",
  "minutes",
  "date",
  "datetime",
  "month",
  "week",
  "weekday",
  "hour",
  "season",
  "code",
  "text",
  "year",
  "months",
]);
export type ValueFormat = z.infer<typeof ValueFormat>;

const Labels = {
  title: z.string().max(120).optional(),
  note: z.string().max(300).optional(),
  /** Literal labels (user, AI). */
  labels: z.record(Column, z.string().max(60)).optional(),
  /** i18n keys for prebuilt reports; may contain "{param}" placeholders. */
  labelKeys: z
    .record(Column, z.string().regex(/^analytics\.[A-Za-z0-9_.{}]+$/))
    .optional(),
  formats: z.record(Column, ValueFormat).optional(),
};

const Table = z.object({
  type: z.literal("table"),
  columns: z.array(Column).max(50).optional(),
  ...Labels,
});

const KpiItem = z.object({
  value: Column,
  compare: Column.optional(),
  format: ValueFormat.optional(),
  higherIsBetter: z.boolean().optional(),
  hideWhenNull: z.boolean().optional(),
  label: z.string().max(60).optional(),
});

const Kpi = z.object({
  type: z.literal("kpi"),
  items: z.array(KpiItem).min(1).max(6),
  ...Labels,
});

const Bar = z
  .object({
    type: z.literal("bar"),
    x: Column,
    y: z.array(Column).min(1).max(8),
    series: Column.optional(),
    orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
    stacked: z.boolean().default(false),
    sort: z.enum(["none", "asc", "desc"]).default("none"),
    limit: z.number().int().min(1).max(100).optional(),
    ...Labels,
  })
  .refine((s) => !s.series || s.y.length === 1, "series needs exactly one y");

const Line = z
  .object({
    type: z.enum(["line", "area"]),
    x: Column,
    y: z.array(Column).min(1).max(8),
    series: Column.optional(),
    cumulative: z.boolean().default(false),
    ...Labels,
  })
  .refine((s) => !s.series || s.y.length === 1, "series needs exactly one y");

const Pie = z.object({
  type: z.literal("pie"),
  label: Column,
  value: Column,
  ...Labels,
});

const Heatmap = z.object({
  type: z.literal("heatmap"),
  x: Column,
  y: Column,
  value: Column,
  ...Labels,
});

const Calendar = z.object({
  type: z.literal("calendar"),
  date: Column,
  value: Column,
  ...Labels,
});

// A plain union: refine() breaks discriminatedUnion in zod 3.23.
export const ChartSpec = z.union([
  Table,
  Kpi,
  Bar,
  Line,
  Pie,
  Heatmap,
  Calendar,
]);
export type ChartSpec = z.infer<typeof ChartSpec>;
/** What a caller may write before defaults are applied. */
export type ChartSpecInput = z.input<typeof ChartSpec>;

export const CHART_TYPES = [
  "table",
  "kpi",
  "bar",
  "line",
  "area",
  "pie",
  "heatmap",
  "calendar",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export type KpiSpec = Extract<ChartSpec, { type: "kpi" }>;
export type BarSpec = Extract<ChartSpec, { type: "bar" }>;
export type LineSpec = Extract<ChartSpec, { type: "line" | "area" }>;
export type PieSpec = Extract<ChartSpec, { type: "pie" }>;
export type HeatmapSpec = Extract<ChartSpec, { type: "heatmap" }>;
export type CalendarSpec = Extract<ChartSpec, { type: "calendar" }>;

/** Parses a stored spec (JSON text or value); null when invalid. */
export const parseChartSpec = (json: unknown): ChartSpec | null => {
  let value = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch {
      return null;
    }
  }
  const parsed = ChartSpec.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const ParamType = z.enum([
  "season",
  "date",
  "boat",
  "rower",
  "route",
  "outing_type",
  "boat_class",
  "integer",
  "choice",
  "boolean",
  "text",
]);
export type ParamType = z.infer<typeof ParamType>;

export const ParamDef = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  type: ParamType,
  /** Literal label (user, AI); prebuilt reports use analytics.params.<name>. */
  label: z.string().max(60).optional(),
  /** Prebuilt override, e.g. analytics.params.absentDays. */
  labelKey: z
    .string()
    .regex(/^analytics\.params\.[A-Za-z0-9_]+$/)
    .optional(),
  required: z.boolean().default(false),
  /** `season` accepts "current". */
  default: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .default(null),
  options: z
    .array(
      z.object({ value: z.string(), label: z.string().max(60).optional() })
    )
    .max(30)
    .optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
export type ParamDef = z.infer<typeof ParamDef>;
export type ParamDefInput = z.input<typeof ParamDef>;

export const ParamDefs = z.array(ParamDef);

/** Parses stored params (JSON text or value); null when invalid. */
export const parseParamDefs = (json: unknown): ParamDef[] | null => {
  let value = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch {
      return null;
    }
  }
  const parsed = ParamDefs.safeParse(value);
  return parsed.success ? parsed.data : null;
};
