import { BoatDamage, ClubIncident } from "../database/repositories/club.types";
import { isDamageOpen } from "./damage.rules";

export type DamageFilter = "open" | "all";

export const filterDamages = (damages: BoatDamage[], filter: DamageFilter) =>
  filter === "open" ? damages.filter(isDamageOpen) : damages;

/** Incidents that no damage was declared from yet. */
export const getIncidentsWithoutDamage = (
  incidents: ClubIncident[],
  damages: BoatDamage[]
) => {
  const declared = new Set(
    damages.flatMap((damage) => (damage.incidentId ? [damage.incidentId] : []))
  );
  return incidents.filter((incident) => !declared.has(incident.id));
};

/**
 * What the declaration dialog starts with when it comes from an incident.
 * The text stored for an incident without details ("No details provided",
 * in the language of the moment) is not a damage description.
 */
export const getDamageDefaultsFromIncident = (
  incident: ClubIncident,
  noDetailsTexts: ReadonlySet<string> = new Set()
) => ({
  boatId: incident.boatId,
  description: noDetailsTexts.has(incident.message) ? "" : incident.message,
  outingId: incident.sessionId === "" ? null : incident.sessionId,
  incidentId: incident.id,
  reportedAt: incident.datetime,
});

/** The typed description, or null for an entry without one. */
export const getDamageDescription = (
  damage: Pick<BoatDamage, "description">
) => {
  const description = damage.description.trim();
  return description === "" ? null : description;
};

/** A date-time field value ("2026-10-28T14:30") as an ISO date, or null. */
export const parseDamageDateTime = (value: string) => {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const formatRepairCost = (cost: number, locale: string) =>
  cost.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(cost) ? 0 : 2,
    maximumFractionDigits: 2,
  });
