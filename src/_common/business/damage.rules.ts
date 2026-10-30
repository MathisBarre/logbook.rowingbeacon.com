import {
  BoatDamage,
  DamageSeverity,
} from "../database/repositories/club.types";

/** From the least to the most serious. */
export const DAMAGE_SEVERITIES: DamageSeverity[] = [
  "usable",
  "limited",
  "unusable",
];

const severityRank = (severity: DamageSeverity) =>
  DAMAGE_SEVERITIES.indexOf(severity);

export const isDamageOpen = (damage: Pick<BoatDamage, "fixedAt">) =>
  damage.fixedAt === null;

export const getOpenDamagesOfBoat = (damages: BoatDamage[], boatId: string) =>
  sortDamages(
    damages.filter((damage) => damage.boatId === boatId && isDamageOpen(damage))
  );

/** A boat is out of service while one of its damages makes it unusable. */
export const isBoatUnusable = (damages: BoatDamage[], boatId: string) =>
  damages.some(
    (damage) =>
      damage.boatId === boatId &&
      isDamageOpen(damage) &&
      damage.severity === "unusable"
  );

export const getUnusableBoatIds = (damages: BoatDamage[]) =>
  new Set(
    damages
      .filter(
        (damage) => isDamageOpen(damage) && damage.severity === "unusable"
      )
      .map((damage) => damage.boatId)
  );

/** Open damages that do not block the boat but must be shown at departure. */
export const getDepartureWarnings = (damages: BoatDamage[], boatId: string) =>
  getOpenDamagesOfBoat(damages, boatId).filter(
    (damage) => damage.severity !== "unusable"
  );

/** The most serious open severity of a boat, or null when it has none. */
export const getWorstOpenSeverity = (
  damages: BoatDamage[],
  boatId: string
): DamageSeverity | null =>
  getOpenDamagesOfBoat(damages, boatId)[0]?.severity ?? null;

/** Open first, then the most serious, then the latest reported. */
export const sortDamages = (damages: BoatDamage[]) =>
  [...damages].sort((a, b) => {
    const open = Number(isDamageOpen(b)) - Number(isDamageOpen(a));
    if (open !== 0) return open;
    const severity = severityRank(b.severity) - severityRank(a.severity);
    if (severity !== 0) return severity;
    return b.reportedAt.localeCompare(a.reportedAt);
  });

/** Stored dates may come in other formats (efa import): compare instants. */
const timeOf = (date: string) => new Date(date).getTime() || 0;

/** The history of damages: the latest reported first, whatever their state. */
export const sortDamagesChronologically = (damages: BoatDamage[]) =>
  [...damages].sort((a, b) => timeOf(b.reportedAt) - timeOf(a.reportedAt));

/** Dates are typed to the minute: the seconds of a stored date are ignored. */
const minuteOf = (date: string | Date) =>
  Math.floor(new Date(date).getTime() / 60_000);

export const isInTheFuture = (date: string, now: Date = new Date()) =>
  minuteOf(date) > minuteOf(now);

/** A repair cannot come before the damage it repairs. */
export const isBeforeDate = (date: string, limit: string) =>
  minuteOf(date) < minuteOf(limit);

/**
 * The earliest repair date of a damage: its report date. A damage dated in
 * the future (an efa2 typo, a wrong clock) has none, or it could never be
 * repaired and would block its boat for good: its date cannot be edited.
 */
export const getEarliestFixDate = (
  damage: Pick<BoatDamage, "reportedAt">,
  now: Date = new Date()
) => (isInTheFuture(damage.reportedAt, now) ? null : damage.reportedAt);

/** A repair cost typed by hand: "12,50" or "12.5"; empty is no cost. */
export const parseRepairCost = (value: string): number | null | "invalid" => {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "invalid";
  return Number(text);
};
