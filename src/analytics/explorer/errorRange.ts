import type { AnalyticsError } from "../engine/errors";
import { offsetToLineColumn } from "../engine/errors";
import { tokenize } from "./sqlCompletion";

/**
 * Where an engine error goes in the editor (plan 1.3): the range to
 * underline and its 1-based line and column.
 *
 * - With an `offset` (syntax errors, a second statement, a positional
 *   parameter): the word at that offset, else one character.
 * - `denied` with an `object` ("setting" or "rower.email"): the first
 *   occurrence of that name outside strings and comments.
 * - `missing_param` / `invalid_param`: the first `:name`.
 * - `not_read_only`: the first word (INSERT, PRAGMA…).
 * - Anything else (timeout, busy…) has no place in the text: null.
 */

export interface ErrorRange {
  from: number;
  to: number;
  line: number;
  column: number;
}

const WORD = /[A-Za-z0-9_]/;

const rangeAt = (sql: string, offset: number): { from: number; to: number } => {
  if (sql.length === 0) return { from: 0, to: 0 };
  let from = Math.max(0, Math.min(offset, sql.length));
  // On whitespace: the next word, or the last one at the end of the text
  // ("incomplete input" points after the last token).
  while (from < sql.length && /\s/.test(sql[from])) from++;
  if (from === sql.length) {
    // End of text: underline the last visible character.
    from = sql.trimEnd().length - 1;
    if (from < 0) return { from: 0, to: 0 };
    return { from, to: from + 1 };
  }
  let to = from;
  while (to < sql.length && WORD.test(sql[to])) to++;
  if (to === from) {
    // A quote or a symbol: up to the end of the line for an unterminated
    // string, else that character.
    if (`'"\`[`.includes(sql[from])) {
      const end = sql.indexOf("\n", from);
      to = end === -1 ? sql.length : end;
    } else {
      to = from + 1;
    }
  }
  return { from, to };
};

const findName = (
  sql: string,
  names: string[]
): { from: number; to: number } | null => {
  const wanted = names.map((name) => name.toUpperCase());
  for (const token of tokenize(sql)) {
    if (
      (token.kind === "word" || token.kind === "quoted") &&
      wanted.includes(token.value)
    ) {
      return { from: token.from, to: token.to };
    }
  }
  return null;
};

const findParam = (sql: string, name: string) => {
  const token = tokenize(sql).find(
    (t) => t.kind === "param" && t.value === name
  );
  return token ? { from: token.from, to: token.to } : null;
};

export const errorRange = (
  error: AnalyticsError,
  sql: string
): ErrorRange | null => {
  let range: { from: number; to: number } | null = null;
  if (error.offset !== null && error.offset >= 0) {
    range = rangeAt(sql, error.offset);
  } else if (error.code === "denied" && error.object) {
    const parts = error.object.split(".");
    // "rower.email": the column first (more precise), then the table.
    range = findName(sql, [parts[parts.length - 1]]) ?? findName(sql, parts);
  } else if (
    (error.code === "missing_param" || error.code === "invalid_param") &&
    error.object
  ) {
    range = findParam(sql, error.object);
  } else if (error.code === "not_read_only") {
    const first = tokenize(sql)[0];
    range = first ? { from: first.from, to: first.to } : null;
  }
  if (!range || range.to <= range.from) return null;
  const { line, column } = offsetToLineColumn(sql, range.from);
  return { ...range, line, column };
};
