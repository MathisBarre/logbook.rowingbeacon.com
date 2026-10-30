import type { AnalyticsErrorPayload } from "../types";

/**
 * Single-statement lexer (plan 2.2 step 2), the TypeScript twin of the Rust
 * `engine/lexer.rs`: both must give the results of `engine-cases.json`.
 *
 * - Skips '…' (with ''), "…" (with ""), `…` (with ``), […], -- … and /* … *\/.
 * - A `;` followed by anything but whitespace or comments is
 *   `multiple_statements`; a trailing `;` (and what follows it) is removed.
 * - Unterminated strings, identifiers or comments are `syntax`, with the
 *   offset of their first character.
 * - The first keyword must be SELECT, WITH or VALUES (`not_read_only`).
 * - Named parameters `:name`, `@name`, `$name` are collected (without
 *   prefix, first occurrence order); positional `?` / `?N` are
 *   `invalid_param`.
 *
 * Offsets are indexes in the JavaScript string (UTF-16 code units); the Rust
 * engine converts SQLite's byte offsets to the same unit.
 */

type SqlCheck =
  | { ok: true; sql: string; paramNames: string[] }
  | { ok: false; error: AnalyticsErrorPayload };

const READ_KEYWORDS = new Set(["SELECT", "WITH", "VALUES"]);

const isSpace = (c: string) =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);

const fail = (
  code: AnalyticsErrorPayload["code"],
  message: string,
  offset?: number
): SqlCheck => ({
  ok: false,
  error: offset === undefined ? { code, message } : { code, message, offset },
});

const closers: Record<string, string> = {
  "'": "'",
  '"': '"',
  "`": "`",
  "[": "]",
};

export const checkSql = (sql: string): SqlCheck => {
  const paramNames: string[] = [];
  let firstKeyword: string | null = null;
  let sawToken = false;
  let end = sql.length;
  let i = 0;

  /** Index after the comment starting at i, or -1 when unterminated. */
  const skipComment = (): number | null => {
    if (sql.startsWith("--", i)) {
      const newline = sql.indexOf("\n", i + 2);
      return newline === -1 ? sql.length : newline + 1;
    }
    if (sql.startsWith("/*", i)) {
      const close = sql.indexOf("*/", i + 2);
      return close === -1 ? -1 : close + 2;
    }
    return null;
  };

  while (i < sql.length) {
    const c = sql[i];

    if (isSpace(c)) {
      i++;
      continue;
    }

    const afterComment = skipComment();
    if (afterComment === -1) {
      return fail("syntax", "Unterminated comment", i);
    }
    if (afterComment !== null) {
      i = afterComment;
      continue;
    }

    if (c === ";") {
      // Only whitespace and comments may follow.
      let j = i + 1;
      while (j < sql.length) {
        if (isSpace(sql[j])) {
          j++;
          continue;
        }
        const save = i;
        i = j;
        const next = skipComment();
        i = save;
        if (next === -1) {
          return fail("syntax", "Unterminated comment", j);
        }
        if (next === null) {
          return fail(
            "multiple_statements",
            "Only one statement is allowed",
            j
          );
        }
        j = next;
      }
      end = i;
      break;
    }

    if (!sawToken) {
      sawToken = true;
      if (isWordStart(c)) {
        let j = i;
        while (j < sql.length && isWordChar(sql[j])) j++;
        firstKeyword = sql.slice(i, j).toUpperCase();
        i = j;
        continue;
      }
      firstKeyword = null;
    }

    const closer = closers[c];
    if (closer) {
      let j = i + 1;
      let closed = false;
      while (j < sql.length) {
        if (sql[j] === closer) {
          // Doubled quote = escaped quote (not for […]).
          if (c !== "[" && sql[j + 1] === closer) {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        return fail(
          "syntax",
          c === "'" ? "Unterminated string" : "Unterminated identifier",
          i
        );
      }
      i = j + 1;
      continue;
    }

    if (c === "?") {
      return fail(
        "invalid_param",
        "Positional parameters are not supported: use :name",
        i
      );
    }

    if (c === ":" || c === "@" || c === "$") {
      let j = i + 1;
      if (j < sql.length && isWordStart(sql[j])) {
        while (j < sql.length && isWordChar(sql[j])) j++;
        const name = sql.slice(i + 1, j);
        if (!paramNames.includes(name)) {
          paramNames.push(name);
        }
        i = j;
        continue;
      }
      i++;
      continue;
    }

    if (isWordStart(c)) {
      // Skip whole words so a "$" or ":" inside one is not a parameter.
      let j = i;
      while (j < sql.length && isWordChar(sql[j])) j++;
      i = j;
      continue;
    }

    i++;
  }

  if (!sawToken) {
    return fail("syntax", "The query is empty");
  }
  if (!firstKeyword || !READ_KEYWORDS.has(firstKeyword)) {
    return fail(
      "not_read_only",
      "Only read queries (SELECT, WITH, VALUES) are allowed"
    );
  }

  return { ok: true, sql: sql.slice(0, end).trimEnd(), paramNames };
};
