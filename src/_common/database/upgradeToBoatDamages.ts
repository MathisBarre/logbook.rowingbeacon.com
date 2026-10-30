import { v4 } from "uuid";
import { deriveEfa2Id } from "../efa2/planEfa2Import";
import { damageFromEfa } from "../efa2/efa2Damages";
import { Efa2Fields } from "../efa2/efa2Xml";
import { getDateTimeWithoutTimezone } from "../utils/date.utils";
import { SqlClient } from "./sqlClient";

const insertDamage = async (
  db: SqlClient,
  damage: {
    id: string;
    boatId: string;
    kind: "damage" | "unavailable";
    severity: string;
    description: string;
    reportedAt: string;
    reportedByRowerId?: string | null;
    fixedAt?: string | null;
    fixedByRowerId?: string | null;
    repairNote?: string | null;
    repairCost?: number | null;
  },
  now: string
) => {
  await db.execute(
    /* sql */ `INSERT OR IGNORE INTO boat_damage (id, boat_id, kind, severity, description,
      reported_at, reported_by_rower_id, fixed_at, fixed_by_rower_id, repair_note, repair_cost,
      created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [
      damage.id,
      damage.boatId,
      damage.kind,
      damage.severity,
      damage.description,
      damage.reportedAt,
      damage.reportedByRowerId ?? null,
      damage.fixedAt ?? null,
      damage.fixedByRowerId ?? null,
      damage.repairNote ?? null,
      damage.repairCost ?? null,
      now,
    ]
  );
};

/**
 * Moves data saved before the damages module into `boat_damage` (ADR
 * 0007). Safe to run on every start: it only picks what is left.
 * - efa2 damage reports kept by an import (open ones were incidents,
 *   fixed ones were hidden) become damages;
 * - a boat flagged "in maintenance" gets an "unavailable" entry, unless an
 *   open efa2 damage already blocks it, then the flag is cleared.
 */
export const upgradeToBoatDamages = async (db: SqlClient, now = new Date()) => {
  const nowIso = now.toISOString();
  const boats = await db.select<{ id: string; is_in_maintenance: number }[]>(
    "SELECT id, is_in_maintenance FROM boat"
  );
  const boatIds = new Set(boats.map((r) => r.id));
  const flaggedBoatIds = new Set(
    boats.filter((r) => r.is_in_maintenance === 1).map((r) => r.id)
  );
  const rowerIds = new Set(
    (await db.select<{ id: string }[]>("SELECT id FROM rower")).map((r) => r.id)
  );

  const efaDamages = await db.select<
    {
      object_name: string;
      record_key: string;
      rb_table: string | null;
      rb_id: string | null;
      fields: string;
    }[]
  >(/* sql */ `SELECT object_name, record_key, rb_table, rb_id, fields FROM efa_record
    WHERE object_type = 'efa2boatdamages' AND (rb_table IS NULL OR rb_table <> 'boat_damage')
    ORDER BY position`);
  // A boat whose damage failed to move keeps its flag, so the retry on the
  // next start still sees it as out of service.
  const boatsWithFailedDamage = new Set<string>();
  for (const record of efaDamages) {
    let boatId: string | undefined;
    // One bad record must not stop the others from moving.
    try {
      const fields = JSON.parse(record.fields) as Efa2Fields;
      boatId = fields.BoatId;
      if (!boatIds.has(fields.BoatId)) continue;
      const fromIncident = record.rb_table === "incident" && record.rb_id;
      const id = fromIncident
        ? record.rb_id!
        : deriveEfa2Id(`damage:${fields.BoatId}:${fields.Damage}`);
      const values = damageFromEfa(fields, { rowerIds, now });
      // The 2.0 import put the boat in maintenance for an open NOTUSEABLE
      // damage. A boat taken out of maintenance since then was put back in
      // service by the club: the damage is closed instead of blocking it again.
      if (
        values.severity === "unusable" &&
        !values.fixedAt &&
        !flaggedBoatIds.has(fields.BoatId)
      ) {
        values.fixedAt = getDateTimeWithoutTimezone(now);
      }
      await insertDamage(db, { id, kind: "damage", ...values }, nowIso);
      if (fromIncident) {
        await db.execute("DELETE FROM incident WHERE id = $1", [id]);
      }
      await db.execute(
        "UPDATE efa_record SET rb_table = 'boat_damage', rb_id = $1 WHERE object_type = 'efa2boatdamages' AND object_name = $2 AND record_key = $3",
        [id, record.object_name, record.record_key]
      );
    } catch (error) {
      if (boatId) boatsWithFailedDamage.add(boatId);
      console.error("efa2 damage not moved to boat_damage", record, error);
    }
  }

  const flagged = await db.select<{ id: string; note: string | null }[]>(
    "SELECT id, note FROM boat WHERE is_in_maintenance = 1"
  );
  for (const boat of flagged) {
    if (boatsWithFailedDamage.has(boat.id)) continue;
    try {
      const [status] = await db.select<{ fields: string }[]>(
        "SELECT fields FROM efa_record WHERE object_type = 'efa2boatstatus' AND json_extract(fields, '$.BoatId') = $1",
        [boat.id]
      );
      const efaStatus = status
        ? (JSON.parse(status.fields) as Efa2Fields)
        : undefined;
      const open = await db.select<{ kind: string }[]>(
        "SELECT kind FROM boat_damage WHERE boat_id = $1 AND fixed_at IS NULL AND severity = 'unusable'",
        [boat.id]
      );
      const notAvailableInEfa = efaStatus?.BaseStatus === "NOTAVAILABLE";
      // An entry left by an interrupted run is not added twice.
      const alreadyUnavailable = open.some((d) => d.kind === "unavailable");
      // The efa2 import copied the reason into the boat note.
      const reason = notAvailableInEfa ? (efaStatus?.Comment ?? "") : "";
      if (!alreadyUnavailable && (notAvailableInEfa || open.length === 0)) {
        await insertDamage(
          db,
          {
            id: v4(),
            boatId: boat.id,
            kind: "unavailable",
            severity: "unusable",
            description: reason,
            reportedAt: getDateTimeWithoutTimezone(now),
          },
          nowIso
        );
      }
      // Also on a run resumed after the entry was added.
      if (reason && boat.note === reason) {
        await db.execute("UPDATE boat SET note = NULL WHERE id = $1", [
          boat.id,
        ]);
      }
      await db.execute("UPDATE boat SET is_in_maintenance = 0 WHERE id = $1", [
        boat.id,
      ]);
    } catch (error) {
      console.error(
        "maintenance flag not moved to boat_damage",
        boat.id,
        error
      );
    }
  }
};
