import type { DictionaryColumn, DictionaryObject } from "../schema/dictionary";
import type { EngineObjects } from "../types";
import { normalizeSearch } from "./useQueryList";

/**
 * What the Dictionnaire panel shows (plan 1.3): views first ("Vues
 * simplifiées", the most useful first: VIEW_ORDER), then base tables
 * ("Tables avancées"), filtered by an accent-insensitive search over
 * names, translated labels, descriptions and code values. An object whose
 * tables are missing in this database is kept, marked unavailable, with
 * the module that brings the table when there is one.
 */

/** Views in the order a beginner needs them (review 48). */
export const VIEW_ORDER = [
  "v_outings",
  "v_outing_rowers",
  "v_boats",
  "v_rowers",
  "v_routes",
  "v_outing_types",
  "v_seasons",
  "v_days",
  "v_incidents",
  "v_damages",
  "v_settings",
];

/** The view a badge calls "La plus utile". */
export const MOST_USEFUL_VIEW = "v_outings";

/**
 * The filters that make numbers match the club's reports (review 50),
 * offered at the top of these views. Labels are
 * `analytics.explorer.dictionary.keyFilters.<id>`.
 */
export const KEY_FILTERS: Record<string, { id: string; sql: string }[]> = {
  v_outings: [
    { id: "season", sql: "season = :season" },
    { id: "countsInStats", sql: "counts_in_stats = 1" },
    { id: "isRowing", sql: "is_rowing = 1" },
  ],
  v_outing_rowers: [
    { id: "season", sql: "season = :season" },
    { id: "countsInStats", sql: "counts_in_stats = 1" },
    { id: "isRowing", sql: "is_rowing = 1" },
  ],
};

/** Tables that a module of the app brings (review 55). */
const TABLE_MODULES: Record<string, string> = {
  boat_damage: "damages",
};

/** The module whose table is missing, or null for a plain missing table. */
export const moduleForTable = (table: string): string | null =>
  TABLE_MODULES[table] ?? null;

const viewRank = (name: string) => {
  const index = VIEW_ORDER.indexOf(name);
  return index === -1 ? VIEW_ORDER.length : index;
};

interface DictionaryTexts {
  /** Localised description of an object. */
  object: (object: DictionaryObject) => string;
  /** Every text shown for a column (label, hint, values…), for search. */
  column: (column: DictionaryColumn) => string;
}

export interface DictionaryEntry {
  object: DictionaryObject;
  /** First required table missing in this database, else null. */
  missingTable: string | null;
  /** Columns to show (all of them when the object itself matched). */
  columns: DictionaryColumn[];
  /** True when the search matched something inside the object. */
  matched: boolean;
}

interface DictionaryView {
  views: DictionaryEntry[];
  tables: DictionaryEntry[];
}

const missingTableOf = (
  object: DictionaryObject,
  available: EngineObjects | null
): string | null => {
  if (!available) return null;
  const missing = object.requires.find(
    (table) => !available.tables.includes(table)
  );
  if (missing) return missing;
  if (object.kind === "view" && !available.views.includes(object.name)) {
    return object.requires[0] ?? object.name;
  }
  if (object.kind === "table" && !available.tables.includes(object.name)) {
    return object.name;
  }
  return null;
};

export const filterDictionary = (
  objects: DictionaryObject[],
  search: string,
  texts: DictionaryTexts,
  available: EngineObjects | null
): DictionaryView => {
  const needle = normalizeSearch(search);
  const entries: DictionaryEntry[] = [];
  for (const object of objects) {
    const missingTable = missingTableOf(object, available);
    if (!needle) {
      entries.push({
        object,
        missingTable,
        columns: object.columns,
        matched: false,
      });
      continue;
    }
    const objectMatches = normalizeSearch(
      `${object.name} ${texts.object(object)}`
    ).includes(needle);
    const columns = object.columns.filter((column) =>
      normalizeSearch(`${column.name} ${texts.column(column)}`).includes(needle)
    );
    if (!objectMatches && columns.length === 0) continue;
    entries.push({
      object,
      missingTable,
      columns: objectMatches && columns.length === 0 ? object.columns : columns,
      matched: true,
    });
  }
  return {
    views: entries
      .filter((entry) => entry.object.level === "simple")
      // Stable: unknown views keep the schema order, after the known ones.
      .sort((a, b) => viewRank(a.object.name) - viewRank(b.object.name)),
    tables: entries.filter((entry) => entry.object.level === "advanced"),
  };
};
