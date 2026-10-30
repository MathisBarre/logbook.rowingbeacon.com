import { z } from "zod";
import { CHART_TYPES, ParamType, ValueFormat } from "../chartSpec";

/**
 * The answer format of the AI assistant (plan appendix E.2): the JSON
 * Schema sent as `output_config.format.schema`, and its zod mirror.
 *
 * The API limits a structured-output schema to 16 union-typed properties
 * (`anyOf` or type arrays) and 24 optional properties. So only five fields
 * are unions (sql, clarification, params.default, params.min, params.max),
 * every property is required, and the chart fields use "empty" sentinels
 * instead of null: "" for a column or label, [] for a list, 0 for `limit`,
 * false for a flag, "none" for `sort`, "auto" for a KPI format.
 * `toDraft()` (aiResponse.ts) turns sentinels into absent fields.
 *
 * Constraints the API does not support (minLength, maximum, recursion…)
 * are absent: lengths and counts are enforced by `toDraft()`.
 */

const PARAM_TYPES = ParamType.options;
const VALUE_FORMATS = ValueFormat.options;

type JsonSchema = Record<string, unknown>;

const str = (description?: string): JsonSchema =>
  description ? { type: "string", description } : { type: "string" };
const bool = (description?: string): JsonSchema =>
  description ? { type: "boolean", description } : { type: "boolean" };
const strArray = (description?: string): JsonSchema => ({
  type: "array",
  items: { type: "string" },
  ...(description ? { description } : {}),
});
const nullable = (schema: JsonSchema, description?: string): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
  ...(description ? { description } : {}),
});
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const COLUMN_OR_EMPTY = 'A result column name, or "" when it does not apply.';

export const AI_RESPONSE_JSON_SCHEMA: JsonSchema = object({
  title: str(),
  explanation: str(),
  sql: nullable(
    { type: "string" },
    "One SQLite SELECT statement, or null when asking for clarification."
  ),
  params: {
    type: "array",
    items: object({
      name: str(),
      type: { type: "string", enum: [...PARAM_TYPES] },
      label: str(),
      required: bool(),
      default: {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
        ],
      },
      options: {
        type: "array",
        description: "Choices of a choice parameter; [] otherwise.",
        items: object({ value: str(), label: str() }),
      },
      min: nullable({ type: "number" }),
      max: nullable({ type: "number" }),
    }),
  },
  chart: object({
    type: { type: "string", enum: [...CHART_TYPES] },
    x: str(COLUMN_OR_EMPTY),
    y: strArray("Value columns; [] when it does not apply."),
    series: str(COLUMN_OR_EMPTY),
    orientation: { type: "string", enum: ["vertical", "horizontal"] },
    stacked: bool(),
    sort: { type: "string", enum: ["none", "asc", "desc"] },
    limit: {
      type: "integer",
      description: "Bars to show, 1-100; 0 for no limit.",
    },
    cumulative: bool(),
    label: str(COLUMN_OR_EMPTY),
    value: str(COLUMN_OR_EMPTY),
    date: str(COLUMN_OR_EMPTY),
    kpis: {
      type: "array",
      description: "KPI tiles of a kpi chart; [] otherwise.",
      items: object({
        value: str(),
        compare: str(COLUMN_OR_EMPTY),
        format: { type: "string", enum: [...VALUE_FORMATS] },
        higher_is_better: bool(),
        label: str('Tile label, or "" for the default label.'),
      }),
    },
    columns: strArray("Table columns to show; [] for all."),
    column_labels: {
      type: "array",
      items: object({ column: str(), label: str() }),
    },
    column_formats: {
      type: "array",
      items: object({
        column: str(),
        format: { type: "string", enum: [...VALUE_FORMATS] },
      }),
    },
  }),
  assumptions: strArray(),
  clarification: nullable({ type: "string" }),
  choices: strArray(
    "When clarification is set: 2 to 4 short answers the user can pick; [] otherwise."
  ),
});

/* ---------------------------------------------------------------------- */
/* zod mirror: what a model answer must look like, exactly.              */
/* ---------------------------------------------------------------------- */

const AiParam = z
  .object({
    name: z.string(),
    type: ParamType,
    label: z.string(),
    required: z.boolean(),
    default: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    options: z.array(
      z.object({ value: z.string(), label: z.string() }).strict()
    ),
    min: z.number().nullable(),
    max: z.number().nullable(),
  })
  .strict();
export type AiParam = z.infer<typeof AiParam>;

const AiKpi = z
  .object({
    value: z.string(),
    compare: z.string(),
    format: ValueFormat,
    higher_is_better: z.boolean(),
    label: z.string(),
  })
  .strict();

const AiChart = z
  .object({
    type: z.enum(CHART_TYPES),
    x: z.string(),
    y: z.array(z.string()),
    series: z.string(),
    orientation: z.enum(["vertical", "horizontal"]),
    stacked: z.boolean(),
    sort: z.enum(["none", "asc", "desc"]),
    limit: z.number().int(),
    cumulative: z.boolean(),
    label: z.string(),
    value: z.string(),
    date: z.string(),
    kpis: z.array(AiKpi),
    columns: z.array(z.string()),
    column_labels: z.array(
      z.object({ column: z.string(), label: z.string() }).strict()
    ),
    column_formats: z.array(
      z.object({ column: z.string(), format: ValueFormat }).strict()
    ),
  })
  .strict();
export type AiChart = z.infer<typeof AiChart>;

export const AiResponse = z
  .object({
    title: z.string(),
    explanation: z.string(),
    sql: z.string().nullable(),
    params: z.array(AiParam),
    chart: AiChart,
    assumptions: z.array(z.string()),
    clarification: z.string().nullable(),
    choices: z.array(z.string()),
  })
  .strict();
export type AiResponse = z.infer<typeof AiResponse>;

/** An empty chart: a table of every column. */
export const EMPTY_AI_CHART: AiChart = {
  type: "table",
  x: "",
  y: [],
  series: "",
  orientation: "vertical",
  stacked: false,
  sort: "none",
  limit: 0,
  cumulative: false,
  label: "",
  value: "",
  date: "",
  kpis: [],
  columns: [],
  column_labels: [],
  column_formats: [],
};
