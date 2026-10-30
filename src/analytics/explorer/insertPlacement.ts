import { tokenize } from "./sqlCompletion";

/**
 * Where a tap in the Dictionary goes in the query (review 11, 50, 51), as
 * a pure function of the text so it is tested without a browser:
 *
 * - at the cursor once the user placed it in the editor; before that (a
 *   query just opened: the cursor means nothing), a column goes to the end
 *   of the SELECT list and a filter into the WHERE, before GROUP BY,
 *   ORDER BY or LIMIT;
 * - a column inside the SELECT list after another one gets its comma
 *   (`distance_km boat_name` would read the second name as an alias);
 * - a filter gets `AND ` after a condition, `WHERE ` when the query has
 *   none yet;
 * - words never stick to their neighbours.
 */

export type InsertKind = "column" | "object" | "filter";

export interface InsertPlan {
  from: number;
  to: number;
  insert: string;
  /** The inserted name or filter, without the comma and spaces around. */
  mark: { from: number; to: number };
}

const CONDITION_STARTS = new Set(["WHERE", "AND", "OR", "ON", "HAVING", "NOT"]);
const AFTER_WHERE = new Set(["GROUP", "ORDER", "LIMIT", "HAVING", "WINDOW"]);

interface TopToken {
  value: string;
  kind: string;
  from: number;
  to: number;
  depth: number;
}

const topTokens = (sql: string): TopToken[] => {
  let depth = 0;
  return tokenize(sql).map((token) => {
    if (token.value === ")") depth = Math.max(0, depth - 1);
    const out = { ...token, depth };
    if (token.value === "(") depth++;
    return out;
  });
};

const firstTop = (tokens: TopToken[], words: Set<string> | string[]) => {
  const set = words instanceof Set ? words : new Set(words);
  return tokens.find(
    (token) =>
      token.depth === 0 && token.kind === "word" && set.has(token.value)
  );
};

/** The significant token that ends before `pos`. */
const previousAt = (tokens: TopToken[], pos: number) => {
  let previous: TopToken | undefined;
  for (const token of tokens) {
    if (token.to <= pos) previous = token;
    else break;
  }
  return previous;
};

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_)]/.test(c);

const build = (
  sql: string,
  from: number,
  to: number,
  prefix: string,
  text: string,
  suffix = ""
): InsertPlan => {
  const before = sql[from - 1];
  const after = sql[to];
  const lead = prefix !== "" || !isWordChar(before) ? "" : " ";
  // A prefix that starts a word needs a space before it too.
  const prefixLead =
    prefix !== "" && /^[A-Za-z]/.test(prefix) && isWordChar(before) ? " " : "";
  const tail =
    suffix !== "" || !after || !/[A-Za-z0-9_(]/.test(after) ? "" : " ";
  const insert = prefixLead + lead + prefix + text + suffix + tail;
  const start = from + prefixLead.length + lead.length + prefix.length;
  return { from, to, insert, mark: { from: start, to: start + text.length } };
};

/**
 * The change for inserting `text` (a column, an object name or a filter
 * such as `counts_in_stats = 1`). `cursor` is null while the user has not
 * placed it, else the selection.
 */
export const planInsert = (
  sql: string,
  cursor: { from: number; to: number } | null,
  text: string,
  kind: InsertKind
): InsertPlan => {
  const tokens = topTokens(sql);

  if (kind === "filter") {
    const where = firstTop(tokens, ["WHERE"]);
    if (cursor === null) {
      // Before GROUP BY / ORDER BY / LIMIT, else at the end.
      const stop = tokens.find(
        (token) =>
          token.depth === 0 &&
          token.kind === "word" &&
          AFTER_WHERE.has(token.value) &&
          (!where || token.from > where.from)
      );
      const at = stop ? stop.from : sql.trimEnd().length;
      const prefix = where ? "AND " : "WHERE ";
      if (stop) {
        // Keep GROUP BY (or ORDER BY…) on its own line.
        return build(
          sql,
          at,
          at,
          prefix,
          text,
          sql[at - 1] === "\n" ? "\n" : " "
        );
      }
      const start = sql.trimEnd().length;
      const lead = start === 0 ? "" : "\n";
      const insert = lead + prefix + text;
      const from = start + lead.length + prefix.length;
      return {
        from: start,
        to: sql.length,
        insert,
        mark: { from, to: from + text.length },
      };
    }
    const previous = previousAt(tokens, cursor.from);
    const prefix =
      !previous ||
      previous.value === "(" ||
      CONDITION_STARTS.has(previous.value)
        ? ""
        : where && where.from < cursor.from
          ? "AND "
          : "WHERE ";
    return build(sql, cursor.from, cursor.to, prefix, text);
  }

  const select = firstTop(tokens, ["SELECT"]);
  const fromWord = firstTop(tokens, ["FROM"]);

  if (cursor === null) {
    if (kind === "column" && select && fromWord && fromWord.from > select.to) {
      // End of the SELECT list, before FROM.
      const listEnd = previousAt(tokens, fromWord.from);
      const at = listEnd ? listEnd.to : fromWord.from;
      const comma = listEnd && listEnd !== select ? ", " : " ";
      const insert = comma + text;
      return {
        from: at,
        to: at,
        insert,
        mark: { from: at + comma.length, to: at + insert.length },
      };
    }
    const start = sql.trimEnd().length;
    const lead = start === 0 ? "" : "\n";
    return {
      from: start,
      to: sql.length,
      insert: lead + text,
      mark: {
        from: start + lead.length,
        to: start + lead.length + text.length,
      },
    };
  }

  // At the cursor: a comma inside the SELECT list after another item.
  const inSelectList =
    kind === "column" &&
    select !== undefined &&
    cursor.from >= select.to &&
    (!fromWord || cursor.from <= fromWord.from);
  const previous = previousAt(tokens, cursor.from);
  const needsComma =
    inSelectList &&
    previous !== undefined &&
    previous !== select &&
    (previous.kind === "word" ||
      previous.kind === "quoted" ||
      previous.value === ")" ||
      previous.value === "*") &&
    previous.value !== "DISTINCT";
  return build(sql, cursor.from, cursor.to, needsComma ? ", " : "", text);
};
