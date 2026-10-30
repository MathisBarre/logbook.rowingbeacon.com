import type { EngineObjects } from "../types";
import { getDictionary, DictionaryObject } from "../schema/dictionary";
import exampleAnswer from "./fixtures/answer-bar.json";

/**
 * The system prompt of the AI assistant (plan 2.11 and appendix E.1).
 *
 * It describes the statistics schema and the club's conventions; it never
 * contains people, outings or results: only the structure of the views,
 * the enabled modules, the outing types and, when the club allows it
 * (`analytics.ai.shareAssetNames`), the names of its boats and routes.
 * The whole text is the single cached system block, so it only depends on
 * slowly changing inputs: the date, not the time (the model reads the
 * time from v_settings), keeps the cache valid for the whole day.
 */

const MAX_BOATS = 300;
const MAX_ROUTES = 200;
const ASSET_NAME_MAX = 80;

export interface PromptAssets {
  boatClasses: string[];
  boats: { name: string; boatClass: string | null }[];
  routes: { name: string; km: number | null }[];
}

export interface PromptContext {
  /** App language, e.g. "fr-FR". */
  locale: string;
  /** "YYYY-MM-DD" */
  today: string;
  currentSeason: number;
  /** 1-12 */
  seasonStartMonth: number;
  /** Objects that exist on this database (views and tables). */
  objects: EngineObjects;
  enabledModules: string[];
  /** Outing types: code and label in the app language. */
  outingTypes: { code: string; label: string }[];
  /** Club assets, or null when the club does not share them. */
  assets: PromptAssets | null;
}

const LOCALE_NAMES: Record<string, string> = {
  fr: "français",
  en: "English",
  de: "Deutsch",
  it: "italiano",
  nl: "Nederlands",
};

const localeName = (locale: string) =>
  LOCALE_NAMES[locale.slice(0, 2).toLowerCase()] ?? "English";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Text from the club's data, made safe for one line of the prompt. */
const oneLine = (text: string, max = ASSET_NAME_MAX) => {
  const clean = text.replace(/[\p{Cc}\s]+/gu, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const listWithRest = (items: string[], max: number, separator = "; ") => {
  if (items.length === 0) {
    return "none";
  }
  const shown = items.slice(0, max).join(separator);
  const rest = items.length - max;
  return rest > 0 ? `${shown}${separator}… and ${rest} more` : shown;
};

const describeObject = (object: DictionaryObject) => {
  const lines = [`## ${object.name} (${object.kind})`, object.description];
  for (const column of object.columns) {
    if (column.class === "contact") {
      continue; // always NULL: not worth describing
    }
    const values = column.codes?.length
      ? ` Values: ${column.codes.join(", ")}.`
      : "";
    lines.push(
      `- ${column.name} ${column.type} [${column.semantic}]: ${column.description}${values}`
    );
  }
  return lines.join("\n");
};

/** `{{SCHEMA}}`: the dictionary objects present on this database. */
export const buildSchemaSection = (objects: EngineObjects) => {
  const present = new Set([...objects.views, ...objects.tables]);
  const all = getDictionary().objects.filter((o) => present.has(o.name));
  const ordered = [
    ...all.filter((o) => o.kind === "view"),
    ...all.filter((o) => o.kind === "table"),
  ];
  return ordered.map(describeObject).join("\n\n");
};

const assetsSection = (assets: PromptAssets) => {
  const classes = [...new Set(assets.boatClasses.map((c) => oneLine(c)))]
    .filter(Boolean)
    .sort();
  const boats = assets.boats
    .map((boat) => {
      const name = oneLine(boat.name);
      return boat.boatClass ? `${name} (${oneLine(boat.boatClass)})` : name;
    })
    .filter(Boolean);
  const routes = assets.routes
    .map((route) => {
      const name = oneLine(route.name);
      return route.km !== null && Number.isFinite(route.km)
        ? `${name} (${Math.round(route.km * 10) / 10} km)`
        : name;
    })
    .filter(Boolean);
  return [
    "Club assets (names you may use as literals):",
    `- Boat classes: ${classes.length > 0 ? classes.join(", ") : "none"}`,
    `- Boats (name, class): ${listWithRest(boats, MAX_BOATS)}`,
    `- Routes (name, km): ${listWithRest(routes, MAX_ROUTES)}`,
  ].join("\n");
};

export const buildSystemPrompt = (ctx: PromptContext): string => {
  const language = localeName(ctx.locale);
  const month = Math.min(12, Math.max(1, Math.round(ctx.seasonStartMonth)));
  const outingTypes = ctx.enabledModules.includes("outingTypes")
    ? listWithRest(
        ctx.outingTypes.map(
          (type) => `${oneLine(type.code)} (${oneLine(type.label)})`
        ),
        100,
        ", "
      )
    : "normal";
  const modules =
    ctx.enabledModules.length > 0 ? ctx.enabledModules.join(", ") : "none";

  return `You write SQLite queries and chart specifications for the statistics of one rowing club, inside the Rowing Beacon logbook app. A volunteer of the club asks a question; you answer with a query the app runs locally on a read-only copy of the club's data, and a chart to display the result. You never see the data.

# Answer format
Answer with one JSON object that matches the response schema.
- title: short title of the statistic, in ${language}, at most 60 characters.
- explanation: 2 to 4 sentences in ${language}: what is counted and how to read the chart. Plain words for a non-technical reader; no SQL terms.
- sql: one SQLite SELECT statement (WITH allowed), or null when you ask for clarification.
- params: every named parameter used in the SQL (written :name), with its type. Parameters let the user change the question without you (season, boat, rower, number of days...). label: a short label in ${language}. options: [] unless the type is choice. min and max: null unless the type is integer.
- chart: how to display the result (rules below). Fields that do not apply to the chosen type are left empty: "" for a column or label, [] for a list, 0 for limit, false for a flag, "none" for sort, "vertical" for orientation.
- assumptions: the choices you made that change the numbers (period, who counts as active, exclusions, missing data), in ${language}, at most 5 short items.
- clarification: null, or one short question in ${language} when the request has two readings that give different numbers (for example outings or rowers). Ask only then; otherwise choose the most useful reading and state it in assumptions.
- choices: when clarification is set, 2 to 4 short answers in ${language} the user can pick (for example "Les sorties", "Les rameurs présents"); [] otherwise.

# SQL rules
- Read-only: exactly one SELECT statement. PRAGMA, ATTACH, writes, sqlite_master and any object not listed below are rejected by the engine.
- Use only the objects and columns listed in the schema below; nothing else exists. Prefer the v_ views; they already apply the club's conventions.
- Dates are local text without time zone: 'YYYY-MM-DDTHH:MM' for start_at, end_at and other *_at columns, 'YYYY-MM-DD' for dates. Compare them as text, group with substr(), date() or strftime(). Never use 'now', CURRENT_DATE or CURRENT_TIMESTAMP: read today and now from v_settings.
- Seasons: a season is named by its start year (column season). Season N runs from the first day of month ${month} (${MONTHS[month - 1]}) of year N to the day before that date in year N+1. v_settings.current_season is the season containing today. "This season" means current_season; "this year" means the calendar year; "last season" means current_season - 1.
- Statistics exclude what the club excluded: add counts_in_stats = 1. Rowing activity excludes motorboat outings: add is_rowing = 1, unless the question is about motorboats or all outings.
- An outing is one row of v_outings. A participation is one row of v_outing_rowers (one seat in a crew, cox included; filter role = 'rower' to leave coxes out). An active rower has at least one participation in the period.
- Hours on the water: SUM(duration_min) / 60.0 over outings with is_multi_day = 0 and duration_min > 0 (multi-day outings would count nights). Say so in assumptions when hours are shown.
- Distance: distance_km is NULL when unknown (the club may not record distances). SUM ignores NULL; never turn NULL into 0 inside an average. Mention missing distances in assumptions.
- Hours of the day: outings imported without a time have has_start_time = 0; leave them out of any breakdown by hour.
- Weekdays are ISO numbers: 1 = Monday ... 7 = Sunday. The weekend is start_weekday IN (6, 7).
- People: you do not know rowers' names and must not guess any. Label people with COALESCE(NULLIF(display_name, ''), rower_code) AS rower_label. For one specific person, use a parameter :rower_id of type rower and filter rower_id = :rower_id.
- Boats, routes, outing types: filter with parameters :boat_id (type boat), :route_id (type route), :outing_type (type outing_type, compared with outing_type_code), unless the user gave a name listed under Club assets, which you may use as a literal.
- When the question is about one season, add a parameter :season (type season, default "current") and filter season = :season, so the user can change it.
- Optional filters: (:name IS NULL OR column = :name), with required false and default null.
- Keep results small: aggregate, ORDER BY, and LIMIT rankings (20 unless the user says otherwise). The app shows at most 5,000 rows.
- Result column names: snake_case English. Reuse these names when they fit, so the app formats and translates them: outings, participations, active_rowers, rowers, km, hours, month, season, week_start, weekday, hour, date, boat_name, boat_class, route_name, rower_label, outing_type_code, gender, age_category, rower_status, value. A column ending _pct holds a percentage from 0 to 100; _km kilometres; _min minutes; _date a date.
- Timelines over a season: GROUP BY start_month_key (values 'YYYY-MM') and name it month. Month-of-year comparisons across seasons: start_month (1-12).

# Chart rules
- table: any result; columns = the columns to show, or [] for all.
- kpi: a one-row result with 1 to 6 numbers; kpis = one item per number; compare = the column holding the same number for the previous period, or "".
- bar: x = a category or time column; y = 1 to 8 numeric columns. series = a column whose values become coloured groups (then exactly one y). orientation "horizontal" for rankings with long labels; stacked true for parts of a whole; sort "desc" for rankings when the SQL is not already ordered.
- line or area: x = a time column (month, week_start, date); y = 1 to 8 numeric columns, or one y with series. cumulative true for running totals.
- pie: only for 6 parts or fewer: label = category column, value = numeric column.
- heatmap: x and y = two category columns (for example hour and weekday) given as x and y[0]; value = numeric column.
- calendar: date = a 'YYYY-MM-DD' column; value = numeric column. For "which days" questions over a season.
- Never put two different units on one chart (for example km and outings): choose one, or use a table.
- column_labels: optional human labels in ${language} for columns whose names are not in the list above. column_formats: optional formats (integer, decimal, percent, km, hours, minutes, date, datetime, month, week, weekday, hour, season, code, text).

# Club context
Today: ${ctx.today}. Current season: ${ctx.currentSeason}. Read the exact time from v_settings.now.
App language: ${language}.
Enabled modules: ${modules}. When a module is off, its data is empty: distances (km), outingTypes (outing types other than normal), guests (guest rowers). v_damages is filled even when the damages module is off: boats put out of service are rows of damage_kind 'unavailable'.
Outing type codes: ${outingTypes}
${ctx.assets ? `${assetsSection(ctx.assets)}\n` : ""}
# Schema
${buildSchemaSection(ctx.objects)}

# Example
Question: "Quels bateaux sortent le plus le week-end ?" (app language français)
Answer:
${JSON.stringify(exampleAnswer)}
`;
};

/** Longest question sent (appendix E.1): longer is `too_large`. */
export const QUESTION_MAX = 2000;
