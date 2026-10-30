import { ParamType, ValueFormat, CHART_TYPES } from "../chartSpec";
import { checkSql } from "../engine/sqlGuard";
import { paramDefsFromSql } from "../params/resolveParams";
import type { ParamDef } from "../types";
import {
  AI_RESPONSE_JSON_SCHEMA,
  AiChart,
  AiParam,
  AiResponse,
  EMPTY_AI_CHART,
} from "./aiSchema";
import { AiAnswer, toDraft } from "./aiResponse";

/**
 * The assistant without an API key (plan 2.11, "Copy-paste fallback"):
 * the same system prompt and question are copied for the club's AI
 * assistant (Claude, ChatGPT, Le Chat…), and the answer pasted back is
 * read here. A chat does not enforce the schema, so the paste is read
 * leniently: the JSON object (bare or in a code block, with null or
 * missing fields), or a ```sql code block, or a bare SELECT statement.
 * `parseLooseJsonAnswer` reads the answers of an OpenAI-compatible server
 * that ignores the schema the same way (JSON only).
 */

/**
 * `header`: a first line in the app's language (review #26), so a
 * volunteer pasting the request into a chat does not first see a wall of
 * English instructions meant for the model.
 */
export const buildCopyText = (
  system: string,
  question: string,
  header?: string
) =>
  `${header ? `${header.trim()}\n\n` : ""}${system}
# Question
${question.trim()}

Answer only with a JSON object matching this JSON Schema (no other text):
${JSON.stringify(AI_RESPONSE_JSON_SCHEMA)}
`;

/** The text to copy after a pasted query failed in the app. */
export const buildCopyRepairText = (repairMessage: string) =>
  `${repairMessage}\nAnswer only with the corrected JSON object.`;

type PasteResult =
  | { ok: true; answer: AiAnswer; source: "json" | "sql" }
  | { ok: false };

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const bool = (value: unknown): boolean => value === true;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const objects = (value: unknown): Loose[] =>
  Array.isArray(value) ? value.filter(isObject) : [];
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const looseParam = (value: Loose): AiParam | null => {
  const type = ParamType.safeParse(value.type);
  if (typeof value.name !== "string" || !type.success) {
    return null;
  }
  const fallback = value.default;
  return {
    name: value.name,
    type: type.data,
    label: str(value.label),
    required: bool(value.required),
    default:
      typeof fallback === "string" ||
      typeof fallback === "number" ||
      typeof fallback === "boolean"
        ? fallback
        : null,
    options: objects(value.options)
      .filter((o) => typeof o.value === "string")
      .map((o) => ({ value: str(o.value), label: str(o.label) })),
    min: num(value.min),
    max: num(value.max),
  };
};

const looseChart = (value: unknown): AiChart => {
  if (!isObject(value)) {
    return EMPTY_AI_CHART;
  }
  const formats = ValueFormat.options;
  return {
    type: oneOf(value.type, CHART_TYPES, "table"),
    x: str(value.x),
    y: strings(value.y),
    series: str(value.series),
    orientation: oneOf(
      value.orientation,
      ["vertical", "horizontal"] as const,
      "vertical"
    ),
    stacked: bool(value.stacked),
    sort: oneOf(value.sort, ["none", "asc", "desc"] as const, "none"),
    limit: Math.max(0, Math.round(num(value.limit) ?? 0)),
    cumulative: bool(value.cumulative),
    label: str(value.label),
    value: str(value.value),
    date: str(value.date),
    kpis: objects(value.kpis)
      .filter((k) => typeof k.value === "string")
      .map((k) => ({
        value: str(k.value),
        compare: str(k.compare),
        format: oneOf(k.format, formats, "auto"),
        higher_is_better: k.higher_is_better !== false,
        label: str(k.label),
      })),
    columns: strings(value.columns),
    column_labels: objects(value.column_labels).map((l) => ({
      column: str(l.column),
      label: str(l.label),
    })),
    column_formats: objects(value.column_formats).map((f) => ({
      column: str(f.column),
      format: oneOf(f.format, formats, "auto"),
    })),
  };
};

/** A pasted object as a response, or null when it is not one. */
const normalizeLooseResponse = (value: unknown): AiResponse | null => {
  if (!isObject(value)) {
    return null;
  }
  const sql = typeof value.sql === "string" ? value.sql : null;
  const clarification =
    typeof value.clarification === "string" ? value.clarification : null;
  if (!sql?.trim() && !clarification?.trim()) {
    return null;
  }
  return {
    title: str(value.title),
    explanation: str(value.explanation),
    sql,
    params: objects(value.params)
      .map(looseParam)
      .filter((p): p is AiParam => p !== null),
    chart: looseChart(value.chart),
    assumptions: strings(value.assumptions),
    clarification,
    choices: strings(value.choices),
  };
};

const FENCE = /```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g;

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Title of an answer that has none: the start of the question. */
export const questionTitle = (question: string) => {
  const title = question.trim().replace(/\s+/g, " ");
  return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title;
};

const READ_START = /^\s*(select|with)\b/i;

const fromSql = (sql: string, question: string): AiAnswer | null => {
  const checked = checkSql(sql);
  if (!checked.ok && checked.error.code === "not_read_only") {
    return null;
  }
  const trimmed = checked.ok ? checked.sql.trim() : sql.trim();
  const params: ParamDef[] = paramDefsFromSql(trimmed);
  return {
    title: questionTitle(question),
    explanation: "",
    sql: trimmed,
    params,
    chart: null,
    assumptions: [],
    clarification: null,
    choices: [],
  };
};

/** The JSON candidates of a text: itself, its non-SQL code blocks, its outermost {...}. */
const jsonCandidatesOf = (
  trimmed: string,
  fences: { lang: string; body: string }[]
) => {
  const candidates = [
    trimmed,
    ...fences.filter((f) => f.lang !== "sql").map((f) => f.body),
  ];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }
  return candidates;
};

const fencesOf = (trimmed: string) =>
  [...trimmed.matchAll(FENCE)].map((m) => ({
    lang: m[1].toLowerCase(),
    body: m[2],
  }));

/**
 * An answer of a server that does not enforce the schema (JSON mode or
 * plain text): the JSON object read leniently, as a paste is; null when
 * there is none with a query or a question.
 */
export const parseLooseJsonAnswer = (text: string): AiResponse | null => {
  const trimmed = text.trim();
  for (const candidate of jsonCandidatesOf(trimmed, fencesOf(trimmed))) {
    const response = normalizeLooseResponse(tryJson(candidate.trim()));
    if (response) return response;
  }
  return null;
};

export const parsePastedAnswer = (
  text: string,
  question: string
): PasteResult => {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false };
  }

  // 1. JSON: the whole text, a ```json block, or the outermost {...}.
  const fences = fencesOf(trimmed);
  for (const candidate of jsonCandidatesOf(trimmed, fences)) {
    const response = normalizeLooseResponse(tryJson(candidate.trim()));
    if (response) {
      const answer = toDraft(response);
      if (!answer.title) {
        answer.title = questionTitle(question);
      }
      return { ok: true, answer, source: "json" };
    }
  }

  // 2. A ```sql block, or a bare statement.
  const sqlCandidates = [
    ...fences
      .filter(
        (f) => f.lang === "sql" || (f.lang === "" && READ_START.test(f.body))
      )
      .map((f) => f.body),
    ...(READ_START.test(trimmed) ? [trimmed] : []),
  ];
  for (const candidate of sqlCandidates) {
    if (candidate.trim() === "") continue;
    const answer = fromSql(candidate, question);
    if (answer) {
      return { ok: true, answer, source: "sql" };
    }
  }
  return { ok: false };
};
