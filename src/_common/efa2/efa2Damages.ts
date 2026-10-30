import { getDateTimeWithoutTimezone } from "../utils/date.utils";
import { DamageSeverity } from "../database/repositories/club.types";
import { Efa2Fields } from "./efa2Xml";
import { efaBoolean, efaDateToIso, efaTimeToHhMm, efaTimestamp } from "./efa2Values";

/**
 * efa2 damage reports (efa2boatdamages) and Rowing Beacon damages (ADR
 * 0007). efa2 severities: FULLYUSEABLE, LIMITEDUSEABLE, NOTUSEABLE.
 */
const SEVERITY_FROM_EFA: Record<string, DamageSeverity> = {
  FULLYUSEABLE: "usable",
  LIMITEDUSEABLE: "limited",
  NOTUSEABLE: "unusable",
};

export const SEVERITY_TO_EFA: Record<DamageSeverity, string> = {
  usable: "FULLYUSEABLE",
  limited: "LIMITEDUSEABLE",
  unusable: "NOTUSEABLE",
};

/** An unknown or missing severity does not block the boat. */
export const severityFromEfa = (value: string | undefined): DamageSeverity =>
  (value && SEVERITY_FROM_EFA[value]) || "usable";

/** A damage as stored in SQLite: dates are local "YYYY-MM-DDTHH:mm". */
export interface EfaDamageValues {
  boatId: string;
  severity: DamageSeverity;
  description: string;
  reportedAt: string;
  reportedByRowerId: string | null;
  fixedAt: string | null;
  fixedByRowerId: string | null;
  repairNote: string | null;
  repairCost: number | null;
}

const localDateTime = (
  date: string | undefined,
  time: string | undefined
): string | null => {
  const isoDate = efaDateToIso(date);
  if (!isoDate) return null;
  return `${isoDate}T${efaTimeToHhMm(time) ?? "00:00"}`;
};

/**
 * Reads an efa2 damage. A person reference that is not a known rower is
 * dropped (efa's free reporter names stay in the kept efa2 record).
 */
/** An efa2 timestamp as a date, or null when missing or out of the Date range. */
export const efaDate = (value: string | undefined) => {
  const ms = efaTimestamp(value);
  const date = ms === null ? null : new Date(ms);
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

export const damageFromEfa = (
  fields: Efa2Fields,
  context: { rowerIds: Set<string>; now: Date }
): EfaDamageValues => {
  const lastModified = getDateTimeWithoutTimezone(
    efaDate(fields.LastModified) ?? context.now
  );
  const reportedAt =
    localDateTime(fields.ReportDate, fields.ReportTime) ?? lastModified;
  const person = (id: string | undefined) =>
    id && context.rowerIds.has(id) ? id : null;
  const cost = fields.RepairCosts ? Number(fields.RepairCosts) : NaN;
  const fixed = efaBoolean(fields.Fixed);

  return {
    boatId: fields.BoatId,
    severity: severityFromEfa(fields.Severity),
    description: fields.Description ?? "",
    reportedAt,
    reportedByRowerId: person(fields.ReportedByPersonId),
    fixedAt: fixed
      ? (localDateTime(fields.FixDate, fields.FixTime) ?? lastModified)
      : null,
    fixedByRowerId: fixed ? person(fields.FixedByPersonId) : null,
    repairNote: fields.Notes || null,
    repairCost: Number.isFinite(cost) ? cost : null,
  };
};
