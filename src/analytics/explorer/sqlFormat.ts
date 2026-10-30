import { COMMON_FUNCTIONS, SQL_WORDS, tokenize } from "./sqlCompletion";

/**
 * "Mettre en forme" (review 18): a pasted one-line query becomes readable
 * in the narrow editor. Keywords are upper-cased; a new line starts each
 * clause (SELECT, FROM, WHERE, GROUP BY, ORDER BY, HAVING, LIMIT, JOIN,
 * UNION…) and each top-level AND / OR of a WHERE or HAVING, indented by
 * two spaces. Subqueries are indented by their depth. Strings, quoted
 * names and comments are kept exactly as written.
 */

const CLAUSES = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "JOIN",
  "LEFT",
  "INNER",
  "CROSS",
  "NATURAL",
  "RIGHT",
  "FULL",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "WINDOW",
]);

/** Words before JOIN that already started its line. */
const JOIN_PREFIXES = new Set([
  "LEFT",
  "INNER",
  "CROSS",
  "NATURAL",
  "RIGHT",
  "FULL",
  "OUTER",
]);

const FUNCTIONS = new Set(COMMON_FUNCTIONS);

interface Level {
  /** True for the top level and a parenthesised SELECT / WITH. */
  query: boolean;
  /** The clause being written at this level (WHERE, HAVING…). */
  clause: string | null;
}

export const tidySql = (sql: string): string => {
  const tokens = tokenize(sql);
  if (tokens.length === 0) return sql;
  const levels: Level[] = [{ query: true, clause: null }];
  let out = "";
  let end = 0;
  let afterBetween = false;

  const indentOf = () =>
    "  ".repeat(levels.filter((level) => level.query).length - 1);

  tokens.forEach((token, index) => {
    const gap = sql.slice(end, token.from);
    const level = levels[levels.length - 1];
    const previous = tokens[index - 1];
    const word = token.kind === "word" ? token.value : null;

    let breakBefore = false;
    let extra = "";
    if (word && level.query) {
      if (CLAUSES.has(word)) {
        breakBefore = !(
          word === "JOIN" &&
          previous?.kind === "word" &&
          JOIN_PREFIXES.has(previous.value)
        );
        if (word !== "JOIN" && !JOIN_PREFIXES.has(word)) level.clause = word;
        // SELECT right after "(" stays on the parenthesis line.
        if (word === "SELECT" && previous?.value === "(") breakBefore = false;
      } else if (
        (word === "AND" || word === "OR") &&
        (level.clause === "WHERE" || level.clause === "HAVING")
      ) {
        if (word === "AND" && afterBetween) {
          afterBetween = false;
        } else {
          breakBefore = true;
          extra = "  ";
        }
      }
    }
    if (word === "BETWEEN") afterBetween = true;

    if (/--|\/\*/.test(gap)) {
      // A comment: kept with its own line breaks.
      out += gap;
    } else if (breakBefore && out !== "") {
      out = out.replace(/[ \t]+$/, "") + "\n" + indentOf() + extra;
    } else if (gap !== "" && out !== "") {
      out += " ";
    }

    const text = sql.slice(token.from, token.to);
    out +=
      word && (SQL_WORDS.has(word) || FUNCTIONS.has(word))
        ? text.toUpperCase()
        : text;
    end = token.to;

    if (token.value === "(") {
      const next = tokens[index + 1];
      levels.push({
        query:
          next?.kind === "word" &&
          (next.value === "SELECT" || next.value === "WITH"),
        clause: null,
      });
    } else if (token.value === ")" && levels.length > 1) {
      levels.pop();
    }
  });

  const rest = sql.slice(end);
  return out + (/--|\/\*/.test(rest) ? rest.trimEnd() : "");
};
