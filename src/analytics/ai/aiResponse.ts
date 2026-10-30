import {
  ChartSpec,
  ChartSpecInput,
  ParamDef,
  ParamDefInput,
  ValueFormat,
} from "../chartSpec";
import { checkSql } from "../engine/sqlGuard";
import { AiChart, AiParam, AiResponse } from "./aiSchema";

/**
 * From the model's JSON text to what the app uses (plan appendix E.2,
 * `toDraft`): lengths cut, sentinels ("", [], 0) turned into absent
 * fields, parameters matched against the `:names` of the SQL, the chart
 * validated with the app's ChartSpec. An invalid chart becomes null: the
 * caller then uses `autoChart` on the result (no extra API call).
 */

const TITLE_MAX = 120;
const EXPLANATION_MAX = 1000;
const ASSUMPTIONS_MAX = 5;
const ASSUMPTION_MAX = 200;
const PARAM_LABEL_MAX = 60;
const COLUMN_LABEL_MAX = 60;
const OPTIONS_MAX = 30;
const KPIS_MAX = 6;
const Y_MAX = 8;
const TABLE_COLUMNS_MAX = 50;
const CHOICES_MAX = 4;
const CHOICE_MAX = 80;

const PARAM_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface AiAnswer {
  title: string;
  explanation: string;
  /** null when the model asks for clarification. */
  sql: string | null;
  params: ParamDef[];
  /** null when the model's chart is not a valid ChartSpec. */
  chart: ChartSpec | null;
  assumptions: string[];
  clarification: string | null;
  /** Answers the user can pick for the clarification (0 to 4). */
  choices: string[];
}

type ParseResult =
  | { ok: true; response: AiResponse }
  | { ok: false; reason: "json" | "schema" };

/** Parses the text block of an API answer (strict: structured outputs). */
export const parseAiText = (text: string): ParseResult => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json" };
  }
  const parsed = AiResponse.safeParse(value);
  return parsed.success
    ? { ok: true, response: parsed.data }
    : { ok: false, reason: "schema" };
};

const cut = (text: string, max: number) => {
  const trimmed = text.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}…`
    : trimmed;
};

/** `:names` of a statement, in order (also when the lexer rejects it). */
const sqlParamNames = (sql: string): string[] => {
  const checked = checkSql(sql);
  if (checked.ok) {
    return checked.paramNames;
  }
  return [
    ...new Set(
      [...sql.matchAll(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
    ),
  ];
};

const toParamDef = (param: AiParam): ParamDef | null => {
  const label = cut(param.label, PARAM_LABEL_MAX);
  let fallback = param.default;
  if (typeof fallback === "string") {
    fallback = fallback.trim() === "" ? null : fallback;
  }
  // A season parameter follows the current season unless told otherwise.
  if (param.type === "season" && fallback === null) {
    fallback = "current";
  }
  const input: ParamDefInput = {
    name: param.name,
    type: param.type,
    required: param.required,
    default: fallback,
    ...(label ? { label } : {}),
    ...(param.min !== null ? { min: param.min } : {}),
    ...(param.max !== null ? { max: param.max } : {}),
    ...(param.options.length > 0
      ? {
          options: param.options.slice(0, OPTIONS_MAX).map((option) => {
            const optionLabel = cut(option.label, PARAM_LABEL_MAX);
            return optionLabel
              ? { value: option.value, label: optionLabel }
              : { value: option.value };
          }),
        }
      : {}),
  };
  const parsed = ParamDef.safeParse(input);
  return parsed.success ? parsed.data : null;
};

const textParam = (name: string): ParamDef => ({
  name,
  type: "text",
  required: false,
  default: null,
});

/**
 * Parameters of the answer: one per `:name` of the SQL, in SQL order; the
 * model's definition when valid, else a free text parameter.
 */
export const toParamDefs = (sql: string | null, params: AiParam[]) => {
  if (!sql) {
    return [];
  }
  const byName = new Map<string, ParamDef>();
  for (const param of params) {
    if (!PARAM_NAME.test(param.name) || byName.has(param.name)) {
      continue;
    }
    const def = toParamDef(param);
    if (def) {
      byName.set(param.name, def);
    }
  }
  return sqlParamNames(sql)
    .filter((name) => PARAM_NAME.test(name))
    .map((name) => byName.get(name) ?? textParam(name));
};

const column = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const labelsOf = (chart: AiChart) => {
  const labels: Record<string, string> = {};
  for (const entry of chart.column_labels) {
    const label = cut(entry.label, COLUMN_LABEL_MAX);
    if (COLUMN_NAME.test(entry.column) && label) {
      labels[entry.column] = label;
    }
  }
  const formats: Record<string, ValueFormat> = {};
  for (const entry of chart.column_formats) {
    if (COLUMN_NAME.test(entry.column) && entry.format !== "auto") {
      formats[entry.column] = entry.format;
    }
  }
  return {
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    ...(Object.keys(formats).length > 0 ? { formats } : {}),
  };
};

/** The model's chart as a ChartSpec, or null when it is not valid. */
export const toChartSpec = (chart: AiChart): ChartSpec | null => {
  const extra = labelsOf(chart);
  const y = chart.y.map((c) => c.trim()).filter(Boolean);
  const series = column(chart.series);
  let input: ChartSpecInput | null = null;

  switch (chart.type) {
    case "table": {
      const columns = chart.columns.map((c) => c.trim()).filter(Boolean);
      input = {
        type: "table",
        ...(columns.length > 0
          ? { columns: columns.slice(0, TABLE_COLUMNS_MAX) }
          : {}),
        ...extra,
      };
      break;
    }
    case "kpi":
      input = {
        type: "kpi",
        items: chart.kpis.slice(0, KPIS_MAX).map((kpi) => {
          const compare = column(kpi.compare);
          const label = cut(kpi.label, COLUMN_LABEL_MAX);
          return {
            value: kpi.value.trim(),
            higherIsBetter: kpi.higher_is_better,
            ...(compare ? { compare } : {}),
            ...(kpi.format !== "auto" ? { format: kpi.format } : {}),
            ...(label ? { label } : {}),
          };
        }),
        ...extra,
      };
      break;
    case "bar": {
      const x = column(chart.x);
      if (!x) break;
      input = {
        type: "bar",
        x,
        // A series needs exactly one value column.
        y: series ? y.slice(0, 1) : y.slice(0, Y_MAX),
        ...(series ? { series } : {}),
        orientation: chart.orientation,
        stacked: chart.stacked,
        sort: chart.sort,
        ...(chart.limit > 0
          ? { limit: Math.min(100, Math.max(1, chart.limit)) }
          : {}),
        ...extra,
      };
      break;
    }
    case "line":
    case "area": {
      const x = column(chart.x);
      if (!x) break;
      input = {
        type: chart.type,
        x,
        y: series ? y.slice(0, 1) : y.slice(0, Y_MAX),
        ...(series ? { series } : {}),
        cumulative: chart.cumulative,
        ...extra,
      };
      break;
    }
    case "pie": {
      const label = column(chart.label);
      const value = column(chart.value);
      if (!label || !value) break;
      input = { type: "pie", label, value, ...extra };
      break;
    }
    case "heatmap": {
      const x = column(chart.x);
      const value = column(chart.value);
      if (!x || !value || y.length === 0) break;
      input = { type: "heatmap", x, y: y[0], value, ...extra };
      break;
    }
    case "calendar": {
      const date = column(chart.date);
      const value = column(chart.value);
      if (!date || !value) break;
      input = { type: "calendar", date, value, ...extra };
      break;
    }
  }
  if (!input) {
    return null;
  }
  const parsed = ChartSpec.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const toDraft = (response: AiResponse): AiAnswer => {
  const sql = response.sql?.trim() ? response.sql.trim() : null;
  const clarification = response.clarification?.trim()
    ? cut(response.clarification, EXPLANATION_MAX)
    : null;
  return {
    title: cut(response.title, TITLE_MAX),
    explanation: cut(response.explanation, EXPLANATION_MAX),
    sql,
    params: toParamDefs(sql, response.params),
    chart: toChartSpec(response.chart),
    assumptions: response.assumptions
      .map((text) => cut(text, ASSUMPTION_MAX))
      .filter(Boolean)
      .slice(0, ASSUMPTIONS_MAX),
    clarification,
    choices: clarification
      ? [
          ...new Set(
            response.choices
              .map((text) => cut(text, CHOICE_MAX))
              .filter(Boolean)
          ),
        ].slice(0, CHOICES_MAX)
      : [],
  };
};
