import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { DictionaryObject } from "../schema/dictionary";
import type { EngineObjects } from "../types";

/**
 * Schema-aware completion of the SQL editor (plan 1.3, WP6):
 *
 * - after FROM / JOIN (or a comma in a FROM list): views first, then CTE
 *   names, then advanced tables;
 * - after `name.`: the columns of that object or alias;
 * - after `:` (or `@`, `$`): the parameters already used in the query,
 *   then the usual ones (season, boat_id…);
 * - elsewhere, once FROM / JOIN names an object: the columns of those
 *   objects, their aliases, `:params`, functions and a few keywords. No
 *   view or table: they belong after FROM;
 * - elsewhere, before any object is named: the columns of v_outings (the
 *   most useful view), then the other view columns, then the views
 *   themselves. Raw tables are only offered after FROM / JOIN.
 *
 * Keywords are a short curated list (KEYWORDS), offered last and only
 * once two letters are typed: the editor does not use
 * @codemirror/lang-sql's keyword source, which lists every SQLite word
 * (BOOL, BOTH, ABORT…).
 *
 * `completeSql` is a pure function of the text and the cursor, so it is
 * tested without a browser; `sqlCompletionSource` adapts it to CodeMirror.
 */

type CompletionKind =
  | "view"
  | "table"
  | "cte"
  | "column"
  | "param"
  | "function"
  | "keyword";

interface SchemaColumn {
  name: string;
  /** Short text next to the label, e.g. "Saison · entier". */
  detail?: string;
  /** Longer text in the info box (French label, description). */
  info?: string;
}

export interface SchemaObject {
  name: string;
  kind: "view" | "table";
  info?: string;
  columns: SchemaColumn[];
}

export interface SchemaFunction {
  /** Upper case, e.g. "COUNT"; inserted as "COUNT()". */
  name: string;
  info?: string;
}

export interface CompletionSchema {
  objects: SchemaObject[];
  /** Parameter names offered after ":" even when not used yet. */
  commonParams: string[];
  functions: SchemaFunction[];
}

interface SqlCompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
  info?: string;
  /** Text inserted (defaults to label). */
  apply?: string;
  /** Higher first, for equally good matches. */
  boost: number;
}

interface SqlCompletion {
  from: number;
  to: number;
  options: SqlCompletionItem[];
}

/** The parameters every user meets first (plan 1.3, guessed types). */
const COMMON_PARAMS = [
  "season",
  "boat_id",
  "rower_id",
  "route_id",
  "boat_class",
  "outing_type",
  "start_date",
  "end_date",
  "days",
  "limit",
];

export const COMMON_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "ROUND",
  "COALESCE",
  "NULLIF",
  "IFNULL",
  "STRFTIME",
  "DATE",
  "JULIANDAY",
  "GROUP_CONCAT",
  "LOWER",
  "UPPER",
  "LENGTH",
];

/** The keywords a volunteer needs, offered after the columns (review 13). */
export const KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "BETWEEN",
  "LIKE",
  "IS NULL",
  "IS NOT NULL",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "AS",
  "DISTINCT",
  "JOIN",
  "LEFT JOIN",
  "ON",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "WITH",
  "UNION ALL",
  "ASC",
  "DESC",
];

/**
 * Every SQL word the Explorer knows: never "corrected" as a typo
 * (sqlErrorHelp) and upper-cased by "Mettre en forme" (sqlFormat).
 */
export const SQL_WORDS: ReadonlySet<string> = new Set([
  ...KEYWORDS.flatMap((keyword) => keyword.split(" ")),
  "LEFT",
  "INNER",
  "OUTER",
  "CROSS",
  "UNION",
  "ALL",
  "OFFSET",
  "RECURSIVE",
  "VALUES",
  "EXISTS",
  "NULL",
  "COLLATE",
  "NOCASE",
  "USING",
  "OVER",
  "PARTITION",
  "WINDOW",
  "FILTER",
  "CAST",
  "INTEGER",
  "REAL",
  "TEXT",
  "GLOB",
  "ESCAPE",
  "EXCEPT",
  "INTERSECT",
  "RIGHT",
  "FULL",
  "NATURAL",
]);

/** The view whose columns come first before anything is named. */
const MAIN_VIEW = "v_outings";

// ─── Tokens ───────────────────────────────────────────────────────────────

interface Token {
  /** Upper-cased for words; the character for punctuation. */
  value: string;
  /** Original text (identifiers keep their case, quotes removed). */
  text: string;
  kind: "word" | "quoted" | "punct" | "param" | "other";
  from: number;
  to: number;
}

const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);

/**
 * Splits SQL into tokens, skipping strings and comments. Unterminated
 * strings and comments run to the end of the text (the editor is
 * mid-typing).
 */
export const tokenize = (sql: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      tokens.push({
        value: "'",
        text: sql.slice(i, j + 1),
        kind: "other",
        from: i,
        to: Math.min(j + 1, sql.length),
      });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const end = sql.indexOf(close, i + 1);
      const to = end === -1 ? sql.length : end + 1;
      const text = sql.slice(i + 1, end === -1 ? sql.length : end);
      tokens.push({
        value: text.toUpperCase(),
        text,
        kind: "quoted",
        from: i,
        to,
      });
      i = to;
      continue;
    }
    if (
      (c === ":" || c === "@" || c === "$") &&
      isWordStart(sql[i + 1] ?? "")
    ) {
      let j = i + 1;
      while (j < sql.length && isWordChar(sql[j])) j++;
      tokens.push({
        value: sql.slice(i + 1, j),
        text: sql.slice(i, j),
        kind: "param",
        from: i,
        to: j,
      });
      i = j;
      continue;
    }
    if (isWordStart(c)) {
      let j = i;
      while (j < sql.length && isWordChar(sql[j])) j++;
      const text = sql.slice(i, j);
      tokens.push({
        value: text.toUpperCase(),
        text,
        kind: "word",
        from: i,
        to: j,
      });
      i = j;
      continue;
    }
    tokens.push({ value: c, text: c, kind: "punct", from: i, to: i + 1 });
    i++;
  }
  return tokens;
};

/** True when `pos` is inside a string literal or a comment. */
export const isInStringOrComment = (sql: string, pos: number): boolean => {
  let i = 0;
  while (i < pos) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      if (end === -1 || end >= pos) return true;
      i = end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1 || end + 2 > pos) return true;
      i = end + 2;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      if (j >= pos) return true;
      i = j + 1;
      continue;
    }
    i++;
  }
  return false;
};

// ─── References (FROM, JOIN, WITH) ─────────────────────────────────────────

/** Words that end a FROM item, so they are never read as an alias. */
const CLAUSE_WORDS = new Set([
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "NATURAL",
  "OUTER",
  "ON",
  "USING",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "WINDOW",
  "SELECT",
  "FROM",
  "AS",
  "AND",
  "OR",
  "NOT",
  "BY",
  "WITH",
  "VALUES",
]);

interface QueryReferences {
  /** Objects named in FROM / JOIN, with their alias (null without one). */
  objects: { name: string; alias: string | null }[];
  /** Names defined by WITH. */
  ctes: string[];
}

const identOf = (token: Token | undefined) =>
  token && (token.kind === "word" || token.kind === "quoted")
    ? token.text
    : null;

export const findReferences = (sql: string): QueryReferences => {
  const tokens = tokenize(sql);
  const objects: QueryReferences["objects"] = [];
  const ctes: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // WITH [RECURSIVE] name [(cols)] AS ( … ), name AS ( … )
    if (token.kind === "word" && token.value === "WITH") {
      let j = i + 1;
      if (tokens[j]?.value === "RECURSIVE") j++;
      for (;;) {
        const name = identOf(tokens[j]);
        if (!name) break;
        ctes.push(name);
        j++;
        if (tokens[j]?.value === "(") {
          // Column list.
          while (j < tokens.length && tokens[j].value !== ")") j++;
          j++;
        }
        if (tokens[j]?.value !== "AS") break;
        j++;
        if (tokens[j]?.value !== "(") break;
        let depth = 0;
        for (; j < tokens.length; j++) {
          if (tokens[j].value === "(") depth++;
          if (tokens[j].value === ")") {
            depth--;
            if (depth === 0) break;
          }
        }
        j++;
        if (tokens[j]?.value !== ",") break;
        j++;
      }
      continue;
    }

    if (
      token.kind !== "word" ||
      (token.value !== "FROM" && token.value !== "JOIN")
    ) {
      continue;
    }
    let j = i + 1;
    for (;;) {
      const name = identOf(tokens[j]);
      if (
        !name ||
        (tokens[j].kind === "word" && CLAUSE_WORDS.has(tokens[j].value))
      ) {
        break;
      }
      j++;
      let alias: string | null = null;
      if (tokens[j]?.value === "AS") j++;
      const maybeAlias = tokens[j];
      if (
        maybeAlias &&
        (maybeAlias.kind === "quoted" ||
          (maybeAlias.kind === "word" && !CLAUSE_WORDS.has(maybeAlias.value)))
      ) {
        alias = maybeAlias.text;
        j++;
      }
      objects.push({ name, alias });
      // A comma continues a FROM list (not a JOIN).
      if (token.value === "FROM" && tokens[j]?.value === ",") {
        j++;
        continue;
      }
      break;
    }
  }
  return { objects, ctes };
};

// ─── Completion ───────────────────────────────────────────────────────────

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The object or CTE an alias or a name refers to. */
const resolveQualifier = (
  qualifier: string,
  refs: QueryReferences,
  schema: CompletionSchema
): SchemaObject | null => {
  const viaAlias = refs.objects.find(
    (ref) => ref.alias !== null && sameName(ref.alias, qualifier)
  );
  const name = viaAlias?.name ?? qualifier;
  return schema.objects.find((object) => sameName(object.name, name)) ?? null;
};

/** Keyword or punctuation just before `pos`, skipping the word being typed. */
const previousToken = (tokens: Token[], from: number): Token | undefined => {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].to <= from) return tokens[i];
  }
  return undefined;
};

/** True when the comma or the word before `from` belongs to a FROM list. */
const inFromList = (tokens: Token[], from: number): boolean => {
  let depth = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.to > from) continue;
    if (token.value === ")") depth++;
    if (token.value === "(") {
      if (depth === 0) return false;
      depth--;
    }
    if (depth > 0 || token.kind !== "word") continue;
    if (token.value === "FROM") return true;
    if (CLAUSE_WORDS.has(token.value) && token.value !== "AS") return false;
  }
  return false;
};

const objectItems = (
  schema: CompletionSchema,
  refs: QueryReferences
): SqlCompletionItem[] => [
  ...schema.objects
    .filter((object) => object.kind === "view")
    .map((object) => ({
      label: object.name,
      kind: "view" as const,
      info: object.info,
      boost: 30,
    })),
  ...refs.ctes.map((name) => ({
    label: name,
    kind: "cte" as const,
    boost: 25,
  })),
  ...schema.objects
    .filter((object) => object.kind === "table")
    .map((object) => ({
      label: object.name,
      kind: "table" as const,
      info: object.info,
      boost: 0,
    })),
];

const columnItems = (
  object: SchemaObject,
  boost: number
): SqlCompletionItem[] =>
  object.columns.map((column) => ({
    label: column.name,
    kind: "column" as const,
    detail: column.detail ? `${object.name} · ${column.detail}` : object.name,
    info: column.info,
    boost,
  }));

const paramItems = (
  sql: string,
  schema: CompletionSchema,
  prefix: string,
  boost: number
): SqlCompletionItem[] => {
  const used = tokenize(sql)
    .filter((token) => token.kind === "param")
    .map((token) => token.value);
  const names = [...new Set([...used, ...schema.commonParams])];
  return names.map((name, index) => ({
    label: `${prefix}${name}`,
    kind: "param" as const,
    // Parameters already in the query come first.
    boost: boost - (used.includes(name) ? 0 : 1) - index / 100,
  }));
};

const functionItems = (schema: CompletionSchema): SqlCompletionItem[] =>
  schema.functions.map((fn) => ({
    label: fn.name,
    kind: "function" as const,
    info: fn.info,
    apply: `${fn.name}(`,
    boost: -10,
  }));

const keywordItems = (): SqlCompletionItem[] =>
  KEYWORDS.map((keyword) => ({
    label: keyword,
    kind: "keyword" as const,
    apply: `${keyword} `,
    boost: -10,
  }));

/**
 * Suggestions at `pos`, or null when nothing should pop up (inside a
 * string or a comment, or no word started and not asked with Ctrl+Space).
 */
export const completeSql = (
  sql: string,
  pos: number,
  schema: CompletionSchema,
  explicit = false
): SqlCompletion | null => {
  if (isInStringOrComment(sql, pos)) return null;

  const before = sql.slice(0, pos);
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)?.[0] ?? "";
  let from = pos - word.length;
  const after = /^[A-Za-z0-9_]*/.exec(sql.slice(pos))?.[0] ?? "";
  const to = pos + after.length;
  const charBefore = sql[from - 1] ?? "";

  // :param, @param, $param
  if (charBefore === ":" || charBefore === "@" || charBefore === "$") {
    if (sql[from - 2] === ":") return null; // "::" is not a parameter
    from -= 1;
    return { from, to, options: paramItems(sql, schema, charBefore, 10) };
  }

  const refs = findReferences(sql);

  // qualifier.column
  if (charBefore === ".") {
    const qualifier = /([A-Za-z_][A-Za-z0-9_]*)\.$/.exec(
      sql.slice(0, from)
    )?.[1];
    const object = qualifier ? resolveQualifier(qualifier, refs, schema) : null;
    return object ? { from, to, options: columnItems(object, 20) } : null;
  }

  if (!word && !explicit) return null;

  const tokens = tokenize(sql);
  const previous = previousToken(tokens, from);
  const expectsObject =
    previous !== undefined &&
    ((previous.kind === "word" &&
      (previous.value === "FROM" || previous.value === "JOIN")) ||
      (previous.value === "," && inFromList(tokens, from)));
  if (expectsObject) {
    return { from, to, options: objectItems(schema, refs) };
  }

  const named = refs.objects
    .map((ref) =>
      schema.objects.find((object) => sameName(object.name, ref.name))
    )
    .filter((object): object is SchemaObject => object !== undefined);
  const uniqueNamed = [...new Set(named)];

  const aliases = refs.objects
    .filter((ref) => ref.alias !== null)
    .map((ref) => ({
      label: ref.alias as string,
      kind: "cte" as const,
      detail: ref.name,
      boost: 22,
    }));
  // Keywords only once a word is under way (or asked for): two letters.
  const keywords = word.length >= 2 || explicit ? keywordItems() : [];

  if (uniqueNamed.length > 0) {
    return {
      from,
      to,
      options: [
        ...uniqueNamed.flatMap((object) => columnItems(object, 30)),
        ...aliases,
        ...paramItems(sql, schema, ":", 10),
        ...functionItems(schema),
        ...keywords,
      ],
    };
  }

  // Nothing named yet: the main view's columns, then every other view
  // column once (first view wins), then the views themselves.
  const views = schema.objects.filter((object) => object.kind === "view");
  const main = views.find((object) => sameName(object.name, MAIN_VIEW));
  const seen = new Set<string>();
  const columns = [
    ...(main ? columnItems(main, 20) : []),
    ...views
      .filter((object) => object !== main)
      .flatMap((object) => columnItems(object, 15)),
  ].filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });

  return {
    from,
    to,
    options: [
      ...columns,
      ...aliases,
      ...objectItems(schema, refs)
        .filter((item) => item.kind !== "table")
        .map((item) => ({ ...item, boost: item.kind === "cte" ? 5 : 0 })),
      ...paramItems(sql, schema, ":", 10),
      ...functionItems(schema),
      ...keywords,
    ],
  };
};

// ─── Schema from the dictionary ───────────────────────────────────────────

interface SchemaLabels {
  /** French (current locale) label of a column, or null. */
  columnLabel: (column: string) => string | null;
  /** Description of an object, in the current locale. */
  objectInfo: (object: DictionaryObject) => string;
  /** Name of a semantic type, e.g. "date" → "Date". */
  semanticLabel: (semantic: string) => string;
  functionInfo: (name: string) => string | undefined;
}

/**
 * The completion schema: objects of the dictionary that exist in this
 * database (all of them while the engine has not answered yet).
 */
export const buildCompletionSchema = (
  objects: DictionaryObject[],
  available: EngineObjects | null,
  labels: SchemaLabels
): CompletionSchema => ({
  objects: objects
    .filter((object) =>
      available === null
        ? true
        : object.kind === "view"
          ? available.views.includes(object.name)
          : available.tables.includes(object.name)
    )
    .map((object) => ({
      name: object.name,
      kind: object.kind,
      info: labels.objectInfo(object),
      columns: object.columns.map((column) => {
        const label = labels.columnLabel(column.name);
        const semantic = labels.semanticLabel(column.semantic);
        return {
          name: column.name,
          detail: semantic,
          info: label ?? undefined,
        };
      }),
    })),
  commonParams: COMMON_PARAMS,
  functions: COMMON_FUNCTIONS.map((name) => ({
    name,
    info: labels.functionInfo(name),
  })),
});

// ─── CodeMirror adapter ───────────────────────────────────────────────────

const CM_TYPES: Record<CompletionKind, string> = {
  view: "class",
  table: "type",
  cte: "variable",
  column: "property",
  param: "variable",
  function: "function",
  keyword: "keyword",
};

const applyFunction =
  (name: string) =>
  (view: EditorView, _completion: Completion, from: number, to: number) => {
    const insert = `${name}()`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + name.length + 1 },
      userEvent: "input.complete",
    });
  };

const toCodeMirrorCompletion = (item: SqlCompletionItem): Completion => ({
  label: item.label,
  type: CM_TYPES[item.kind],
  detail: item.detail,
  info: item.info,
  boost: Math.max(-99, Math.min(99, Math.round(item.boost))),
  apply: item.kind === "function" ? applyFunction(item.label) : item.apply,
});

/** A CodeMirror completion source over `completeSql`. */
export const sqlCompletionSource =
  (getSchema: () => CompletionSchema): CompletionSource =>
  (context: CompletionContext): CompletionResult | null => {
    const sql = context.state.doc.toString();
    const result = completeSql(sql, context.pos, getSchema(), context.explicit);
    if (!result) return null;
    return {
      from: result.from,
      to: result.to,
      options: result.options.map(toCodeMirrorCompletion),
      validFor: /^[:@$]?[A-Za-z0-9_]*$/,
    };
  };
