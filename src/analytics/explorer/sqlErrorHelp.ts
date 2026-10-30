import type { TFunction } from "i18next";
import { AnalyticsError, formatAnalyticsError } from "../engine/errors";
import { joinList } from "../components/AnalyticsStates";
import { offsetToLineColumn } from "../engine/errors";
import {
  CompletionSchema,
  findReferences,
  SchemaObject,
  SQL_WORDS,
  tokenize,
} from "./sqlCompletion";

/**
 * Turns an engine error into words a club volunteer can act on (review
 * 27 and 29). SQLite's own messages are English and point one word too
 * far ("near "10": syntax error" for a typo in LIMT), so the known ones
 * are recognised and explained in the user's language:
 *
 * - `no such table: X` / `no such column: X`: the name is underlined and
 *   the nearest existing names are offered as one-tap fixes;
 * - `near "X": syntax error`: when X or the word before it is a keyword
 *   typo (LIMT, FORM, SELCT…), "did you mean LIMIT?" with a fix, else
 *   "check the word before X";
 * - `incomplete input`, `ambiguous column name`, `misuse of aggregate`;
 * - a refused write (`not_read_only`, `denied` without an object): a
 *   reassuring notice, nothing was changed;
 * - a missing parameter: where to give its value.
 *
 * Anything else keeps the usual message, with SQLite's raw text moved to
 * `detail` (shown in a "Détail technique" disclosure).
 */

export interface SqlFix {
  /** Button label, e.g. "Corriger en LIMIT". */
  label: string;
  replace: { from: number; to: number; text: string };
}

export interface SqlErrorHelp {
  message: string;
  /** SQLite's raw text, for a "Détail technique" disclosure. */
  detail: string | null;
  /** A better place to underline than the engine's offset. */
  range: { from: number; to: number } | null;
  suggestions: SqlFix[];
  /** "info": nothing went wrong (a refused write); "error" otherwise. */
  tone: "error" | "info";
}

const K = "analytics.explorer.errors";

/** Words whose typos are worth a "did you mean" (review 27). */
const TYPO_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "ORDER",
  "BY",
  "LIMIT",
  "HAVING",
  "JOIN",
  "AND",
  "OR",
  "AS",
];

/** Levenshtein distance, case-insensitive. */
export const editDistance = (a: string, b: string): number => {
  const s = a.toUpperCase();
  const u = b.toUpperCase();
  let previous = Array.from({ length: u.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const current = [i];
    for (let j = 1; j <= u.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (s[i - 1] === u[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[u.length];
};

/** The closest names within `max` edits, best first, at most `limit`. */
export const nearestNames = (
  name: string,
  candidates: string[],
  max = 3,
  limit = 3
): string[] =>
  [...new Set(candidates)]
    .map((candidate) => ({ candidate, d: editDistance(name, candidate) }))
    .filter(({ candidate, d }) => d <= max && candidate !== name)
    .sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map(({ candidate }) => candidate);

const findWord = (sql: string, name: string) => {
  const wanted = name.toUpperCase();
  return (
    tokenize(sql).find(
      (token) =>
        (token.kind === "word" || token.kind === "quoted") &&
        token.value === wanted
    ) ?? null
  );
};

/** The keyword a typo stands for (LIMT → LIMIT), or null. */
const keywordFor = (word: string, sql: string, schema: CompletionSchema) => {
  const upper = word.toUpperCase();
  if (upper.length < 3 || SQL_WORDS.has(upper)) return null;
  // A name of the schema or an alias is not a typo.
  const lower = word.toLowerCase();
  const refs = findReferences(sql);
  if (
    schema.objects.some(
      (object) =>
        object.name.toLowerCase() === lower ||
        object.columns.some((column) => column.name.toLowerCase() === lower)
    ) ||
    refs.ctes.some((name) => name.toLowerCase() === lower)
  ) {
    return null;
  }
  const max = upper.length <= 4 ? 1 : 2;
  return (
    TYPO_KEYWORDS.map((keyword) => ({
      keyword,
      d: editDistance(upper, keyword),
    }))
      .filter(({ d }) => d <= max)
      .sort((a, b) => a.d - b.d)[0]?.keyword ?? null
  );
};

const namedObjects = (sql: string, schema: CompletionSchema) => {
  const refs = findReferences(sql);
  return refs.objects
    .map((ref) =>
      schema.objects.find(
        (object) => object.name.toLowerCase() === ref.name.toLowerCase()
      )
    )
    .filter((object): object is SchemaObject => object !== undefined);
};

const withLine = (
  message: string,
  sql: string,
  from: number | null,
  t: TFunction
) => {
  if (from === null || !sql.includes("\n")) return message;
  const { line } = offsetToLineColumn(sql, from);
  return t(`${K}.atLine`, { line, message });
};

const syntaxHelp = (
  error: AnalyticsError,
  sql: string,
  schema: CompletionSchema,
  t: TFunction,
  locale: string
): SqlErrorHelp | null => {
  const raw = error.message;
  const help = (
    message: string,
    range: { from: number; to: number } | null,
    suggestions: SqlFix[] = []
  ): SqlErrorHelp => ({
    message: withLine(message, sql, range?.from ?? null, t),
    detail: raw,
    range,
    suggestions,
    tone: "error",
  });

  const table = /no such table: (?:main\.)?([\w$]+)/i.exec(raw)?.[1];
  if (table) {
    const token = findWord(sql, table);
    const range = token ? { from: token.from, to: token.to } : null;
    const names = nearestNames(
      table,
      schema.objects.map((object) => object.name)
    );
    // Nothing close: v_outings, the view that answers most questions.
    const offered = names.length > 0 ? names : ["v_outings"];
    return help(
      t(`${K}.tableMissing`, { name: table }),
      range,
      range
        ? offered.map((name) => ({
            label: t(`${K}.replaceWith`, { name }),
            replace: { ...range, text: name },
          }))
        : []
    );
  }

  const column = /no such column: ([\w$.]+)/i.exec(raw)?.[1];
  if (column) {
    const name = column.split(".").pop() ?? column;
    const token = findWord(sql, name);
    const range = token ? { from: token.from, to: token.to } : null;
    const objects = namedObjects(sql, schema);
    const pool = (
      objects.length > 0
        ? objects
        : schema.objects.filter((object) => object.kind === "view")
    ).flatMap((object) => object.columns.map((c) => c.name));
    const suggestions = range
      ? nearestNames(name, pool).map((candidate) => ({
          label: t(`${K}.replaceWith`, { name: candidate }),
          replace: { ...range, text: candidate },
        }))
      : [];
    return help(
      objects.length > 0
        ? t(`${K}.columnMissing`, {
            name,
            objects: joinList(
              [...new Set(objects.map((object) => object.name))],
              locale
            ),
          })
        : t(`${K}.columnMissingNoFrom`, { name }),
      range,
      suggestions
    );
  }

  const near = /near "([^"]*)": syntax error/i.exec(raw)?.[1];
  if (near !== undefined) {
    const tokens = tokenize(sql);
    const at =
      (error.offset !== null
        ? tokens.find(
            (token) => token.from <= error.offset! && error.offset! < token.to
          )
        : undefined) ??
      tokens.find((token) => token.text.toUpperCase() === near.toUpperCase());
    // The word at the error, then the one before it.
    const index = at ? tokens.indexOf(at) : -1;
    const candidates = [tokens[index], tokens[index - 1]].filter(
      (token) => token !== undefined && token.kind === "word"
    );
    for (const token of candidates) {
      const keyword = keywordFor(token.text, sql, schema);
      if (keyword) {
        const range = { from: token.from, to: token.to };
        return help(t(`${K}.typo`, { word: token.text, keyword }), range, [
          {
            label: t(`${K}.fixTo`, { keyword }),
            replace: { ...range, text: keyword },
          },
        ]);
      }
    }
    return help(
      t(`${K}.syntaxNear`, { token: near }),
      at ? { from: at.from, to: at.to } : null
    );
  }

  if (/incomplete input/i.test(raw)) {
    return help(t(`${K}.incomplete`), null);
  }

  const ambiguous = /ambiguous column name: ([\w$.]+)/i.exec(raw)?.[1];
  if (ambiguous) {
    const token = findWord(sql, ambiguous);
    return help(
      t(`${K}.ambiguous`, { name: ambiguous }),
      token ? { from: token.from, to: token.to } : null
    );
  }

  if (/misuse of aggregate/i.test(raw)) {
    const token = findWord(sql, "WHERE");
    return help(
      t(`${K}.aggregate`),
      token ? { from: token.from, to: token.to } : null
    );
  }
  return null;
};

export const explainSqlError = (
  error: AnalyticsError,
  sql: string,
  schema: CompletionSchema,
  t: TFunction,
  locale = "fr-FR"
): SqlErrorHelp => {
  const plain = (message: string, detail: string | null = null) => ({
    message,
    detail,
    range: null,
    suggestions: [],
    tone: "error" as const,
  });
  switch (error.code) {
    case "syntax": {
      const known = syntaxHelp(error, sql, schema, t, locale);
      if (known) return known;
      // Our own checks (unterminated string, empty query) speak English
      // too: the position stays, the text goes to the detail.
      const position =
        error.offset !== null ? offsetToLineColumn(sql, error.offset) : null;
      return plain(
        position ? t(`${K}.syntaxAt`, position) : t(`${K}.syntaxOther`),
        error.message
      );
    }
    case "internal": {
      const known = syntaxHelp(error, sql, schema, t, locale);
      if (known) return known;
      return plain(t(`${K}.internal`), error.message);
    }
    case "not_read_only":
      return { ...plain(t(`${K}.readOnly`)), tone: "info" };
    case "denied":
      return error.object
        ? plain(formatAnalyticsError(error, t))
        : { ...plain(t(`${K}.readOnly`)), tone: "info" };
    case "missing_param":
      return plain(
        t(`${K}.missingParam`, { name: error.object ?? error.message })
      );
    default:
      return plain(formatAnalyticsError(error, t));
  }
};
