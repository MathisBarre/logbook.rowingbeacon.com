import viewsSql from "./views.sql?raw";

/**
 * Block files shared with Rust (assets.rs): `views.sql` (marker `@view`)
 * and `reports/reports.sql` (marker `@report`). A block starts with a line
 * `-- @view <name> requires=<table>[,<table>…]` (or `-- @report <id>`) and
 * holds everything up to the next marker line. Lines before the first
 * marker are a file header and are ignored.
 */

type BlockMarker = "@view" | "@report";

interface SqlBlock {
  name: string;
  /** Tables the block needs; always empty for reports. */
  requires: string[];
  /** The statement, trimmed, trailing `;` kept. */
  sql: string;
}

const MARKER_LINE =
  /^-- (@view|@report) ([A-Za-z0-9_-]+)(?: requires=(\S*))?\s*$/;

export const parseBlocks = (text: string, marker: BlockMarker): SqlBlock[] => {
  const blocks: SqlBlock[] = [];
  let current: { name: string; requires: string[]; lines: string[] } | null =
    null;

  const flush = () => {
    if (current) {
      blocks.push({
        name: current.name,
        requires: current.requires,
        sql: current.lines.join("\n").trim(),
      });
    }
  };

  for (const line of text.split(/\r?\n/)) {
    const match = MARKER_LINE.exec(line);
    if (match && match[1] === marker) {
      flush();
      current = {
        name: match[2],
        requires: (match[3] ?? "")
          .split(",")
          .map((table) => table.trim())
          .filter(Boolean),
        lines: [],
      };
      continue;
    }
    current?.lines.push(line);
  }
  flush();

  return blocks;
};

/** @public Also used by the screenshot studio's browser engine. */
export const NOW_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

interface ViewTemplateValues {
  /** analytics.seasonStartMonth, integer 1-12. */
  seasonStartMonth: number;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm". */
  now: string;
}

const assertTemplateValues = ({
  seasonStartMonth,
  now,
}: ViewTemplateValues) => {
  if (
    !Number.isInteger(seasonStartMonth) ||
    seasonStartMonth < 1 ||
    seasonStartMonth > 12
  ) {
    throw new Error(`Invalid season start month: ${String(seasonStartMonth)}`);
  }
  if (!NOW_PATTERN.test(now)) {
    throw new Error(`Invalid local date-time: ${now}`);
  }
};

/**
 * Substitutes `{{SEASON_START_MONTH}}` and `{{NOW}}` after validating both,
 * so the substitution cannot inject SQL. Throws on invalid values.
 */
export const renderViewSql = (
  block: SqlBlock,
  values: ViewTemplateValues
): string => {
  assertTemplateValues(values);
  return block.sql
    .split("{{SEASON_START_MONTH}}")
    .join(String(values.seasonStartMonth))
    .split("{{NOW}}")
    .join(values.now);
};

export const VIEW_BLOCKS: SqlBlock[] = parseBlocks(viewsSql, "@view");

interface ViewPlan {
  /** Rendered statements, in file order. */
  statements: { name: string; sql: string }[];
  created: string[];
  /** Views skipped because a required table is missing. */
  missing: string[];
}

/**
 * Which views can be created on a database holding `existingTables`, with
 * their rendered SQL. Used by the test engine and the screenshot studio;
 * the Rust engine applies the same rule.
 */
export const planViews = (
  existingTables: Iterable<string>,
  values: ViewTemplateValues,
  blocks: SqlBlock[] = VIEW_BLOCKS
): ViewPlan => {
  const tables = new Set(existingTables);
  const plan: ViewPlan = { statements: [], created: [], missing: [] };
  for (const block of blocks) {
    if (block.requires.every((table) => tables.has(table))) {
      plan.statements.push({
        name: block.name,
        sql: renderViewSql(block, values),
      });
      plan.created.push(block.name);
    } else {
      plan.missing.push(block.name);
    }
  }
  return plan;
};
