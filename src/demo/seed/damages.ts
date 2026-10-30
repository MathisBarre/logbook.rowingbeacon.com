// The damages of the Damages module scenes (the logbook's Damages tab, the damage form, the
// warning in the start dialog), relative to "now" like today's outings. The two boats out of
// service are written by seedClub (they exist with or without the module); these are the open
// damages that do not block a boat, and two repaired ones with their follow-up.
import { saveBoatDamage } from "../../_common/database/repositories/club.repository";
import type { SqlClient } from "../../_common/database/sqlClient";
import { addDays, toLocalDateTime } from "./calendar";
import { ClubStructure, FEATURED, idFor } from "./club";
import type { LocaleContent } from "./content/types";
import type { DamageScenario } from "./scenario";

/** Boats and people of the damages (keys of the club structure). */
export const DAMAGED = {
  /** Open damages that show in the start dialog: the quad of the start scene. */
  warningBoat: FEATURED.startBoat,
  /** A club single with a precaution damage. */
  precautionBoat: "1x.C4",
  /** A pair with a small damage that changes nothing for the crew. */
  minorBoat: "2-.S2",
  /** Repaired damages, with their notes. */
  fixedBoats: ["4x.Q5", "2x.C3"],
  /** The damage form's boat: the quad of the statistics scenes. */
  formBoat: FEATURED.statsBoat,
  /** Who reports and who repairs. */
  reporters: ["masters.F0", "comp.M4", "rec.F3", "masters.M3"],
  repairers: ["masters.M1", "masters.M2"],
} as const;

/** Writes the damages and says which ones the scenes open. */
export const seedDamages = async (
  db: SqlClient,
  {
    club,
    content,
    day,
    boatNames,
    rowerNames,
  }: {
    club: ClubStructure;
    content: LocaleContent;
    /** Today, "YYYY-MM-DD". */
    day: string;
    boatNames: (key: string) => string;
    rowerNames: (key: string) => string;
  }
): Promise<DamageScenario> => {
  const texts = content.damages;
  const boat = (key: string) => {
    const found = club.boatByKey.get(key);
    if (!found) throw new Error(`Unknown boat ${key} in the damages`);
    return found;
  };
  const rower = (key: string) => {
    const found = club.rowerByKey.get(key);
    if (!found) throw new Error(`Unknown rower ${key} in the damages`);
    return found;
  };
  const at = (daysAgo: number, atMinutes: number) =>
    toLocalDateTime(addDays(day, -daysAgo), atMinutes);
  const evening = 20 * 60 + 5;

  const open = [
    {
      key: "warning-limited",
      boatKey: DAMAGED.warningBoat,
      severity: "limited" as const,
      description: texts.warningLimited,
      reportedAt: at(2, 17 * 60 + 40),
      reporter: DAMAGED.reporters[0],
    },
    {
      key: "warning-usable",
      boatKey: DAMAGED.warningBoat,
      severity: "usable" as const,
      description: texts.warningUsable,
      reportedAt: at(6, 11 * 60 + 15),
      reporter: DAMAGED.reporters[1],
    },
    {
      key: "precaution",
      boatKey: DAMAGED.precautionBoat,
      severity: "limited" as const,
      description: texts.precaution,
      reportedAt: at(1, evening),
      reporter: DAMAGED.reporters[2],
    },
    {
      key: "minor",
      boatKey: DAMAGED.minorBoat,
      severity: "usable" as const,
      description: texts.minor,
      reportedAt: at(4, 9 * 60 + 30),
      reporter: DAMAGED.reporters[3],
    },
  ];
  for (const item of open) {
    await saveBoatDamage(db, {
      id: idFor("damage", item.key),
      boatId: boat(item.boatKey).id,
      kind: "damage",
      severity: item.severity,
      description: item.description,
      reportedAt: item.reportedAt,
      reportedByRowerId: rower(item.reporter).id,
      outingId: null,
      incidentId: null,
      fixedAt: null,
      fixedByRowerId: null,
      repairNote: null,
      repairCost: null,
    });
  }

  const fixed = [
    {
      key: "fixed-1",
      reportedDaysAgo: 19,
      fixedDaysAgo: 15,
      severity: "limited" as const,
    },
    {
      key: "fixed-2",
      reportedDaysAgo: 27,
      fixedDaysAgo: 24,
      severity: "usable" as const,
    },
  ];
  for (const [index, item] of fixed.entries()) {
    const text = texts.fixed[index];
    await saveBoatDamage(db, {
      id: idFor("damage", item.key),
      boatId: boat(DAMAGED.fixedBoats[index]).id,
      kind: "damage",
      severity: item.severity,
      description: text.description,
      reportedAt: at(item.reportedDaysAgo, 10 * 60 + 20),
      reportedByRowerId: rower(DAMAGED.reporters[index]).id,
      outingId: null,
      incidentId: null,
      fixedAt: at(item.fixedDaysAgo, 15 * 60 + 10),
      fixedByRowerId: rower(DAMAGED.repairers[index]).id,
      repairNote: text.repairNote,
      repairCost: text.repairCost,
    });
  }

  return {
    warning: {
      boatId: boat(DAMAGED.warningBoat).id,
      boatName: boatNames(DAMAGED.warningBoat),
      descriptions: [texts.warningLimited, texts.warningUsable],
    },
    form: {
      boatId: boat(DAMAGED.formBoat).id,
      boatName: boatNames(DAMAGED.formBoat),
      description: texts.formDescription,
      reporterId: rower(DAMAGED.reporters[0]).id,
      reporterName: rowerNames(DAMAGED.reporters[0]),
    },
    counts: { open: open.length + 2, fixed: fixed.length },
  };
};
