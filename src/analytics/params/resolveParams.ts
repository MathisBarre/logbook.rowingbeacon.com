import type { ParamDef, ParamType } from "../chartSpec";
import type { ParamValue } from "../types";
import { checkSql } from "../engine/sqlGuard";
import { currentSeason } from "./season";

/**
 * Turns parameter values (from the params bar, a dashboard item or a
 * saved query) into the values bound by the engine (plan 2.7):
 *
 * - `season` binds the integer start year; "current" is resolved from
 *   `seasonStartMonth` and `now`;
 * - `boat`, `rower`, `route`, `outing_type`, `boat_class`, `text` bind
 *   strings (ids for boat, rower, route);
 * - `boolean` binds 1 / 0; `date` binds "YYYY-MM-DD"; `integer` binds an
 *   integer within min / max; `choice` binds one of its options;
 * - an empty optional value binds NULL.
 *
 * A missing value takes the default. An invalid value falls back to the
 * default and is reported in `errors` (the UI shows a warning); an empty
 * required value is reported as "required".
 */

export interface ParamContext {
  /** Local wall-clock time "YYYY-MM-DDTHH:mm". */
  now: string;
  seasonStartMonth: number;
}

export type ParamErrorCode = "required" | "invalid" | "range";
export interface ParamError {
  name: string;
  code: ParamErrorCode;
  min?: number;
  max?: number;
}

const isEmpty = (value: ParamValue | undefined) =>
  value === undefined || value === null || value === "";

type Coerced =
  | { ok: true; value: ParamValue }
  | { ok: false; error: ParamErrorCode };

const coerce = (
  def: ParamDef,
  value: ParamValue,
  ctx: ParamContext
): Coerced => {
  switch (def.type) {
    case "season": {
      if (value === "current") {
        return {
          ok: true,
          value: currentSeason(ctx.now, ctx.seasonStartMonth),
        };
      }
      const season = typeof value === "string" ? Number(value) : value;
      return typeof season === "number" &&
        Number.isInteger(season) &&
        season >= 1900 &&
        season <= 2200
        ? { ok: true, value: season }
        : { ok: false, error: "invalid" };
    }
    case "integer": {
      const number =
        typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : value;
      if (typeof number !== "number" || !Number.isInteger(number)) {
        return { ok: false, error: "invalid" };
      }
      if (
        (def.min !== undefined && number < def.min) ||
        (def.max !== undefined && number > def.max)
      ) {
        return { ok: false, error: "range" };
      }
      return { ok: true, value: number };
    }
    case "boolean":
      if (value === true || value === 1 || value === "1" || value === "true") {
        return { ok: true, value: 1 };
      }
      if (
        value === false ||
        value === 0 ||
        value === "0" ||
        value === "false"
      ) {
        return { ok: true, value: 0 };
      }
      return { ok: false, error: "invalid" };
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { ok: true, value }
        : { ok: false, error: "invalid" };
    case "choice": {
      const text = typeof value === "string" ? value : String(value);
      return !def.options || def.options.some((option) => option.value === text)
        ? { ok: true, value: text }
        : { ok: false, error: "invalid" };
    }
    case "boat":
    case "rower":
    case "route":
    case "outing_type":
    case "boat_class":
    case "text":
      return typeof value === "string" || typeof value === "number"
        ? { ok: true, value: String(value) }
        : { ok: false, error: "invalid" };
  }
};

export const resolveParams = (
  defs: ParamDef[],
  values: Record<string, ParamValue>,
  ctx: ParamContext
): { values: Record<string, ParamValue>; errors: ParamError[] } => {
  const resolved: Record<string, ParamValue> = {};
  const errors: ParamError[] = [];

  for (const def of defs) {
    const given = values[def.name];
    const fallback = (): ParamValue => {
      if (isEmpty(def.default)) return null;
      const coerced = coerce(def, def.default, ctx);
      return coerced.ok ? coerced.value : null;
    };

    if (given === undefined) {
      resolved[def.name] = fallback();
    } else if (isEmpty(given)) {
      resolved[def.name] = null;
    } else {
      const coerced = coerce(def, given, ctx);
      if (coerced.ok) {
        resolved[def.name] = coerced.value;
      } else {
        resolved[def.name] = fallback();
        errors.push(
          coerced.error === "range"
            ? { name: def.name, code: "range", min: def.min, max: def.max }
            : { name: def.name, code: coerced.error }
        );
      }
    }

    if (def.required && resolved[def.name] === null) {
      errors.push({ name: def.name, code: "required" });
    }
  }

  return { values: resolved, errors };
};

/** Names volunteers give to period bounds, in English and in French. */
const DATE_NAMES = new Set([
  "date",
  "from",
  "to",
  "since",
  "until",
  "start",
  "end",
  "depuis",
  "debut",
  "fin",
  "jusqua",
]);

const INTEGER_NAMES = new Set(["n", "top"]);

/** Parameter type guessed from a `:name` written in the editor. */
export const guessParamType = (name: string): ParamType => {
  if (name === "season") return "season";
  if (name === "boat_id") return "boat";
  if (name === "rower_id") return "rower";
  if (name === "route_id") return "route";
  if (name === "boat_class") return "boat_class";
  if (name === "outing_type" || name === "outing_type_code")
    return "outing_type";
  if (
    DATE_NAMES.has(name) ||
    name.endsWith("_date") ||
    name.startsWith("date_")
  ) {
    return "date";
  }
  if (
    INTEGER_NAMES.has(name) ||
    name.startsWith("nb_") ||
    name === "days" ||
    name === "limit" ||
    name.endsWith("_days") ||
    name.startsWith("min_") ||
    name.startsWith("max_")
  ) {
    return "integer";
  }
  return "text";
};

/**
 * Definitions for the `:names` of `sql`, in order of appearance: existing
 * definitions are kept, new names get a guessed type.
 */
export const paramDefsFromSql = (
  sql: string,
  existing: ParamDef[] = []
): ParamDef[] => {
  const checked = checkSql(sql);
  const names = checked.ok
    ? checked.paramNames
    : [
        ...new Set(
          [...sql.matchAll(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
        ),
      ];
  return names
    .filter((name) => /^[a-z][a-z0-9_]{0,31}$/.test(name))
    .map((name) => {
      const known = existing.find((def) => def.name === name);
      if (known) return known;
      const type = guessParamType(name);
      return {
        name,
        type,
        required: type === "season",
        default: type === "season" ? "current" : null,
      };
    });
};
