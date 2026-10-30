import { describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations";
import { createTestSqlClient } from "./testing/nodeSqlClient";
import { upgradeToBoatDamages } from "./upgradeToBoatDamages";
import { loadClubData } from "./repositories/club.repository";

const NOW = "2026-10-28T08:00:00.000Z";

const setup = async () => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  const boat = (id: string, maintenance: number, note: string | null = null) =>
    db.execute(
      "INSERT INTO boat (id, name, note, is_in_maintenance, created_at, updated_at) VALUES ($1, $1, $2, $3, $4, $4)",
      [id, note, maintenance, NOW]
    );
  await boat("plain", 0);
  await boat("flagged", 1, "Winter");
  await boat("efa-status", 1, "Bei Werft");
  await boat("efa-damage", 1);
  await db.execute(
    "INSERT INTO rower (id, first_name, created_at, updated_at) VALUES ('ines', 'Ines', $1, $1)",
    [NOW]
  );
  // An open blocking efa damage the 2.0 import turned into an incident.
  await db.execute(
    "INSERT INTO incident (id, boat_id, message, occurred_at, created_at) VALUES ('inc-1', 'efa-damage', 'Rollsitz gebrochen', '2026-10-12T11:20', $1)",
    [NOW]
  );
  const efa = (
    type: string,
    key: string,
    fields: Record<string, string>,
    rb: [string, string] | null = null
  ) =>
    db.execute(
      "INSERT INTO efa_record (object_type, object_name, record_key, rb_table, rb_id, fields) VALUES ($1, 'x', $2, $3, $4, $5)",
      [type, key, rb?.[0] ?? null, rb?.[1] ?? null, JSON.stringify(fields)]
    );
  await efa(
    "efa2boatdamages",
    "efa-damage|2",
    {
      BoatId: "efa-damage",
      Damage: "2",
      Description: "Rollsitz gebrochen",
      Severity: "NOTUSEABLE",
      ReportDate: "12.10.2026",
      ReportTime: "11:20:00",
      ReportedByPersonName: "Ines Koch",
    },
    ["incident", "inc-1"]
  );
  // A fixed damage the 2.0 import kept without showing it.
  await efa("efa2boatdamages", "plain|1", {
    BoatId: "plain",
    Damage: "1",
    Description: "Stemmbrett locker",
    Severity: "FULLYUSEABLE",
    Fixed: "true",
    ReportDate: "03.05.2025",
    ReportTime: "18:05:00",
    FixDate: "05.05.2025",
    FixTime: "17:00:00",
    ReportedByPersonId: "ines",
    FixedByPersonId: "unknown-person",
    RepairCosts: "12.5",
    Notes: "Schrauben ersetzt",
  });
  // A damage of a boat that is not in the database.
  await efa("efa2boatdamages", "gone|1", { BoatId: "gone", Damage: "1" });
  await efa("efa2boatstatus", "efa-status", {
    BoatId: "efa-status",
    BaseStatus: "NOTAVAILABLE",
    Comment: "Bei Werft",
  });
  await efa("efa2boatstatus", "efa-damage", {
    BoatId: "efa-damage",
    BaseStatus: "AVAILABLE",
  });
  return db;
};

describe("upgradeToBoatDamages", () => {
  it("moves efa2 damages and maintenance flags to damages, once", async () => {
    const db = await setup();

    await upgradeToBoatDamages(db, new Date(NOW));
    await upgradeToBoatDamages(db, new Date(NOW));

    const data = await loadClubData(db);
    const byBoat = (id: string) => data.damages.filter((d) => d.boatId === id);

    expect(byBoat("efa-damage")).toEqual([
      expect.objectContaining({
        id: "inc-1",
        kind: "damage",
        severity: "unusable",
        description: "Rollsitz gebrochen",
        fixedAt: null,
        reportedByRowerId: null,
      }),
    ]);
    expect(data.incidents).toEqual([]);

    const [fixed] = byBoat("plain");
    expect(fixed).toMatchObject({
      severity: "usable",
      reportedByRowerId: "ines",
      fixedByRowerId: null,
      repairNote: "Schrauben ersetzt",
      repairCost: 12.5,
    });
    expect(fixed.fixedAt).not.toBeNull();

    expect(byBoat("flagged")).toEqual([
      expect.objectContaining({
        kind: "unavailable",
        severity: "unusable",
        description: "",
      }),
    ]);
    expect(byBoat("efa-status")).toEqual([
      expect.objectContaining({
        kind: "unavailable",
        description: "Bei Werft",
      }),
    ]);

    const boats = new Map(data.boats.map((boat) => [boat.id, boat]));
    expect(boats.get("plain")?.isInMaintenance).toBe(false);
    expect(boats.get("flagged")?.isInMaintenance).toBe(true);
    expect(boats.get("flagged")?.note).toBe("Winter");
    // The reason copied into the note by the 2.0 import moved to the entry.
    expect(boats.get("efa-status")?.note).toBe("");
    expect(boats.get("efa-damage")?.isInMaintenance).toBe(true);

    const flags = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM boat WHERE is_in_maintenance = 1"
    );
    expect(flags[0].n).toBe(0);
    const links = await db.select<{ rb_table: string | null }[]>(
      "SELECT rb_table FROM efa_record WHERE object_type = 'efa2boatdamages' ORDER BY record_key"
    );
    expect(links.map((l) => l.rb_table)).toEqual([
      "boat_damage",
      null,
      "boat_damage",
    ]);
  });

  it("closes an open blocking efa2 damage of a boat put back in service", async () => {
    const db = await setup();
    // The club took the boat out of maintenance after the 2.0 import.
    await db.execute(
      "UPDATE boat SET is_in_maintenance = 0 WHERE id = 'efa-damage'"
    );
    // A malformed record does not stop the others.
    await db.execute(
      "INSERT INTO efa_record (object_type, object_name, record_key, fields) VALUES ('efa2boatdamages', 'x', 'bad', 'not json')"
    );

    await upgradeToBoatDamages(db, new Date(NOW));

    const data = await loadClubData(db);
    const [damage] = data.damages.filter((d) => d.boatId === "efa-damage");
    expect(damage).toMatchObject({ id: "inc-1", severity: "unusable" });
    expect(damage.fixedAt).not.toBeNull();
    const boats = new Map(data.boats.map((boat) => [boat.id, boat]));
    expect(boats.get("efa-damage")?.isInMaintenance).toBe(false);
    expect(boats.get("flagged")?.isInMaintenance).toBe(true);
  });
  it("clears the copied reason on a run resumed after the entry was added", async () => {
    const db = await setup();
    // An earlier run stopped right after adding the entry.
    await db.execute(
      "INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, created_at, updated_at) VALUES ('u1', 'efa-status', 'unavailable', 'unusable', 'Bei Werft', '2026-10-28T08:00', $1, $1)",
      [NOW]
    );

    await upgradeToBoatDamages(db, new Date(NOW));

    const data = await loadClubData(db);
    expect(data.damages.filter((d) => d.boatId === "efa-status")).toHaveLength(1);
    const boat = data.boats.find((b) => b.id === "efa-status");
    expect(boat?.note).toBe("");
  });

  it("keeps the flag of a boat whose blocking damage failed to move", async () => {
    const db = await setup();
    await db.execute(
      "CREATE TRIGGER fail BEFORE INSERT ON boat_damage WHEN NEW.id = 'inc-1' BEGIN SELECT RAISE(ABORT, 'boom'); END"
    );

    await upgradeToBoatDamages(db, new Date(NOW));

    const [flag] = await db.select<{ is_in_maintenance: number }[]>(
      "SELECT is_in_maintenance FROM boat WHERE id = 'efa-damage'"
    );
    expect(flag.is_in_maintenance).toBe(1);
  });
});
