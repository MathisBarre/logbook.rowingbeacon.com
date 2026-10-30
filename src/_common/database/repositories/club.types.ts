import { BoatTypeEnum } from "../../business/boat.rules";
import { BoatConfiguration } from "../../business/boatConfiguration.rules";
import { AgeCategoryEnum } from "../../business/ageCategory.rules";
import { SeriousnessCategoryEnum } from "../../business/seriousness.rules";

export type RowerStatus = "member" | "guest" | "other";
export type Gender = "female" | "male" | "other";

export interface ClubBoat {
  id: string;
  name: string;
  isInMaintenance?: boolean;
  /** Boat class of the default configuration, used by levels and sorting. */
  type?: BoatTypeEnum;
  note?: string;
  archivedAt?: string | undefined;
  configurations: BoatConfiguration[];
  owner?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  buildYear?: number | null;
  purchaseDate?: string | null;
  maxCrewWeightKg?: number | null;
  excludeFromStats?: boolean;
}

export interface ClubRower {
  id: string;
  /** First and last name joined, for display. */
  name: string;
  firstName: string;
  lastName: string;
  status: RowerStatus;
  archivedAt?: string | undefined;
  type?: SeriousnessCategoryEnum | undefined;
  category?: AgeCategoryEnum | undefined;
  gender?: Gender | null;
  birthDate?: string | null;
  email?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  address?: string | null;
  note?: string | null;
  excludeFromStats?: boolean;
  mergedIntoId?: string | null;
  anonymizedAt?: string | null;
}

export interface ClubRoute {
  id: string;
  name: string;
  distanceM?: number | null;
  note?: string | null;
  archivedAt?: string | undefined;
}

export interface OutingCrewMember {
  id: string;
  name: string;
  role: "rower" | "cox";
}

export interface OngoingOuting {
  id: string;
  rowers: OutingCrewMember[];
  route: { id: string; name: string } | null;
  boat: { id: string; name: string };
  boatConfigurationId?: string | null;
  outingTypeCode?: string | null;
  captainRowerId?: string | null;
  startDateTime: string;
  estimatedEndDateTime?: string | undefined;
  comment: string;
  endDateTime: string | null;
}

export interface ClubIncident {
  id: string;
  boatId: string;
  message: string;
  sessionId: string;
  datetime: string;
}

/** How far a damage limits the use of the boat. */
export type DamageSeverity = "usable" | "limited" | "unusable";

/**
 * "damage": something broken, reported and fixed. "unavailable": the boat
 * is put out of service without a damage (winter storage, lent out…), as
 * efa2's NOTAVAILABLE status; it is always "unusable".
 */
export type DamageKind = "damage" | "unavailable";

export interface BoatDamage {
  id: string;
  boatId: string;
  kind: DamageKind;
  severity: DamageSeverity;
  description: string;
  /** ISO date-time, as the other store dates. */
  reportedAt: string;
  reportedByRowerId: string | null;
  outingId: string | null;
  /** The incident reported at the end of an outing, when it came from one. */
  incidentId: string | null;
  /** Null while the damage is open. */
  fixedAt: string | null;
  fixedByRowerId: string | null;
  repairNote: string | null;
  repairCost: number | null;
}
