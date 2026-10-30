import { z } from "zod";
import dictionaryJson from "./dictionary.json";

/**
 * The analytics dictionary (plan appendix B): the views and base tables
 * analytics may read, with every column classified. The Rust authorizer
 * reads the same file (assets.rs): an object not listed is denied, a
 * column not listed reads as NULL.
 */

const ColumnType = z.enum(["text", "integer", "real", "boolean"]);
type ColumnType = z.infer<typeof ColumnType>;

const ColumnSemantic = z.enum([
  "id",
  "name",
  "code",
  "date",
  "datetime",
  "month_key",
  "week_start",
  "integer",
  "decimal",
  "km",
  "metres",
  "minutes",
  "hours",
  "percent",
  "boolean",
  "season",
  "weekday",
  "hour",
  "month",
  "year",
  "money",
  "free_text",
]);
type ColumnSemantic = z.infer<typeof ColumnSemantic>;

const ColumnClass = z.enum(["public", "personal", "contact", "freeText"]);
type ColumnClass = z.infer<typeof ColumnClass>;

const DictionaryColumn = z
  .object({
    name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
    type: ColumnType,
    semantic: ColumnSemantic,
    class: ColumnClass.default("public"),
    codes: z.array(z.string()).optional(),
    /** English, read by the AI and the MCP clients. */
    description: z.string().min(1),
  })
  .strict();
export type DictionaryColumn = z.infer<typeof DictionaryColumn>;

const DictionaryObject = z
  .object({
    name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
    kind: z.enum(["view", "table"]),
    level: z.enum(["simple", "advanced"]),
    /** Tables that must exist for the object to exist. */
    requires: z.array(z.string()),
    description: z.string().min(1),
    columns: z.array(DictionaryColumn).min(1),
  })
  .strict();
export type DictionaryObject = z.infer<typeof DictionaryObject>;

const Dictionary = z
  .object({ version: z.literal(1), objects: z.array(DictionaryObject) })
  .strict();
type Dictionary = z.infer<typeof Dictionary>;

let cached: Dictionary | null = null;

export const getDictionary = (): Dictionary => {
  cached ??= Dictionary.parse(dictionaryJson);
  return cached;
};

export const getObject = (name: string): DictionaryObject | undefined =>
  getDictionary().objects.find((object) => object.name === name);

/**
 * Class of a column, or null when the object or the column is not in the
 * dictionary (the engine then denies the object or reads the column as
 * NULL).
 */
export const columnClass = (
  table: string,
  column: string
): ColumnClass | null =>
  getObject(table)?.columns.find((c) => c.name === column)?.class ?? null;

/**
 * Allowed values of a code column: from the first object that lists codes
 * for this column name, or for `table.column` when a table is given.
 */
export const codeValues = (column: string, table?: string): string[] => {
  const objects = table
    ? [getObject(table)].filter((o): o is DictionaryObject => Boolean(o))
    : getDictionary().objects;
  for (const object of objects) {
    const codes = object.columns.find((c) => c.name === column)?.codes;
    if (codes) {
      return codes;
    }
  }
  return [];
};

/** Columns hidden in pseudonymised mode or always (badge "Personnel"). */
export const isPersonalClass = (cls: ColumnClass | null) =>
  cls === "personal" || cls === "contact" || cls === "freeText";
