import type { ParamValue, SqlValue } from "../types";
import { BUILTIN_OUTING_TYPE_CODES } from "../../_common/business/outingType.rules";
import type { WideSeries } from "./pivot";
import {
  ChartTheme,
  MAX_SERIES,
  STATUS,
  statusOfColumn,
  statusOfValue,
} from "./palette";

/**
 * At most 8 series (plan 2.9): the 9th and beyond fold into "Autres" (sum),
 * drawn in the neutral colour, never a generated hue. Series are ordered
 * by entity (fixed code order, else natural order) and coloured by entity,
 * never by rank, so a boat class or a gender keeps its colour when the
 * other series change.
 */

export const OTHER_KEY = "__other__";

export interface FoldedSeries extends WideSeries {
  isOther?: boolean;
}

const sum = (values: (number | null)[]) =>
  values.reduce<number>((total, v) => total + Math.abs(v ?? 0), 0);

/** Keeps the `max` largest series (by total), folds the rest. */
export const foldSeries = (
  series: WideSeries[],
  max: number = MAX_SERIES
): { kept: WideSeries[]; other: FoldedSeries | null } => {
  if (series.length <= max) return { kept: series, other: null };
  const ranked = series
    .map((s, i) => ({ s, i, total: sum(s.values) }))
    .sort((a, b) => b.total - a.total || a.i - b.i);
  const keep = new Set(ranked.slice(0, max).map((r) => r.s.key));
  const kept = series.filter((s) => keep.has(s.key));
  const rest = series.filter((s) => !keep.has(s.key));
  const length = Math.max(0, ...series.map((s) => s.values.length));
  const values: (number | null)[] = [];
  for (let i = 0; i < length; i++) {
    let total: number | null = null;
    for (const s of rest) {
      const v = s.values[i] ?? null;
      if (v !== null) total = (total ?? 0) + v;
    }
    values.push(total);
  }
  return {
    kept,
    other: { key: OTHER_KEY, raw: null, values, isOther: true },
  };
};

/** Fixed order of known code values (their palette slot). */
const DOMAINS: Record<string, readonly string[]> = {
  gender: ["female", "male", "other", "unknown"],
  rower_status: ["member", "guest", "other", "unknown"],
  seriousness: ["recreational", "competitor", "unknown"],
  rigging: ["scull", "sweep"],
  role: ["rower", "cox"],
  age_group: ["youth", "adult", "unknown"],
  age_category: ["J10", "J12", "J14", "J16", "J18", "Senior", "unknown"],
  damage_kind: ["damage", "unavailable"],
  distance_source: ["recorded", "route"],
  outing_type_code: BUILTIN_OUTING_TYPE_CODES,
  outing_type: BUILTIN_OUTING_TYPE_CODES,
};

/**
 * Palette slots that differ from the domain order: the largest age group,
 * Senior, takes the first (blue) slot rather than a dark green block that
 * reads as "good" elsewhere.
 */
const SLOTS: Record<string, Record<string, number>> = {
  age_category: { Senior: 0, J18: 1, J16: 2, J14: 3, J12: 4, J10: 6 },
};

/** The code group a series column belongs to (`category` → dimension). */
export const domainOf = (
  column: string | undefined,
  params?: Record<string, ParamValue>
): string | null => {
  if (!column) return null;
  if (column === "category") {
    const dimension = params?.dimension;
    return typeof dimension === "string" ? dimension : null;
  }
  return column;
};

const BOAT_CLASS_RE = /^(\d+)([x-]?)(\+?)$/;
/** 1x, 2x, 2-, 2+, 4x, 4x+, 4-, 4+, 8+: seats, then scull, then coxed. */
export const compareBoatClass = (a: string, b: string): number => {
  const ma = BOAT_CLASS_RE.exec(a);
  const mb = BOAT_CLASS_RE.exec(b);
  if (!ma || !mb) {
    if (ma) return -1;
    if (mb) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  }
  const rig = (m: RegExpExecArray) => (m[2] === "x" ? 0 : m[2] === "-" ? 1 : 2);
  return (
    Number(ma[1]) - Number(mb[1]) ||
    rig(ma) - rig(mb) ||
    ma[3].length - mb[3].length
  );
};

/** True when values of `domain` have a fixed entity order (codes, boat classes). */
export const hasEntityOrder = (domain: string | null) =>
  domain !== null && (domain in DOMAINS || domain === "boat_class");

export const compareRaw = (domain: string | null) => {
  const list = domain ? DOMAINS[domain] : undefined;
  return (a: SqlValue, b: SqlValue): number => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (list) {
      const ia = list.indexOf(String(a));
      const ib = list.indexOf(String(b));
      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      }
    }
    if (String(a) === "unknown") return 1;
    if (String(b) === "unknown") return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (domain === "boat_class") return compareBoatClass(String(a), String(b));
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  };
};

/** Series sorted by entity: code order, else natural order; null last. */
export const orderSeries = <T extends WideSeries>(
  series: T[],
  domain: string | null
): T[] => {
  const compare = compareRaw(domain);
  return [...series].sort((a, b) => compare(a.raw, b.raw));
};

/**
 * Colour of each series of a `series` column, by entity: a known code
 * keeps its slot whatever else is shown; other values take the slots in
 * their entity order. Severities and safety issues take status colours;
 * "Autres" the neutral colour.
 */
export const colorSeriesByEntity = (
  series: FoldedSeries[],
  column: string | undefined,
  theme: ChartTheme,
  params?: Record<string, ParamValue>
): Map<string, string> => {
  const domain = domainOf(column, params);
  const list = domain ? DOMAINS[domain] : undefined;
  const colors = new Map<string, string>();
  const used = new Set<number>();
  const pending: FoldedSeries[] = [];
  for (const s of series) {
    if (s.isOther) {
      // "Autres" recedes; "Non renseigné" recedes further.
      colors.set(s.key, theme.other);
      continue;
    }
    if (s.raw === null || String(s.raw) === "unknown") {
      colors.set(s.key, theme.unknown);
      continue;
    }
    const status =
      column && s.raw !== null ? statusOfValue(column, String(s.raw)) : null;
    if (status) {
      colors.set(s.key, STATUS[status]);
      continue;
    }
    const fixed = domain ? SLOTS[domain]?.[String(s.raw)] : undefined;
    const slot =
      fixed ?? (list && s.raw !== null ? list.indexOf(String(s.raw)) : -1);
    if (slot !== -1 && slot < MAX_SERIES && !used.has(slot)) {
      used.add(slot);
      colors.set(s.key, theme.categorical[slot]);
    } else {
      pending.push(s);
    }
  }
  let next = 0;
  for (const s of orderSeries(pending, domain)) {
    while (used.has(next) && next < MAX_SERIES) next++;
    const slot = next < MAX_SERIES ? next : MAX_SERIES - 1;
    used.add(slot);
    colors.set(s.key, theme.categorical[slot]);
  }
  return colors;
};

/** Colour of the i-th y column (status columns take status colours). */
export const colorForColumn = (
  column: string,
  index: number,
  theme: ChartTheme
): string => {
  const status = statusOfColumn(column);
  if (status) return STATUS[status];
  return theme.categorical[Math.min(index, MAX_SERIES - 1)];
};
