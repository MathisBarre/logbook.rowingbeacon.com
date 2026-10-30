import { describe, expect, test } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import { deriveEfa2Id } from "./planEfa2Import";
import { loadClubData } from "../database/repositories/club.repository";
import { readFixtureProject } from "./__fixtures__/readFixtureProject";
import {
  Efa2BackupFailedError,
  Efa2ImportFailedError,
  runEfa2Import,
} from "./runEfa2Import";

const labels = {
  externalBoatNote: "Bateau extérieur importé d'efa",
  statusGroupPrefix: "Statut : ",
  closedOpenOutingNote: "Restée ouverte dans efa.",
};

const importFixture = async () => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  let backups = 0;
  const report = await runEfa2Import(db, readFixtureProject(), {
    backup: () => Promise.resolve(backups++),
    labels,
    now: new Date("2026-10-19T12:00:00Z"),
  });
  return { db, report, backups };
};

describe("runEfa2Import", () => {
  test("imports a project written by efa, after a backup", async () => {
    const { db, report, backups } = await importFixture();
    expect(backups).toBe(1);

    expect(report.logbooks.sort()).toEqual(["2025", "2026"]);
    expect(report.outings).toBe(57);
    expect(report.ongoingOutings).toBe(2);

    const data = await loadClubData(db);
    expect(data.ongoingOutings).toHaveLength(2);

    // A convertible boat keeps both configurations.
    const neckar = data.boats.find((boat) => boat.name === "Neckar")!;
    expect(
      neckar.configurations.map((c) => [
        c.seats,
        c.rigging,
        c.coxed,
        c.isDefault,
      ])
    ).toEqual([
      [4, "scull", false, true],
      [4, "sweep", false, false],
    ]);

    // Free boat names become archived external boats, once per name.
    const external = data.boats.filter(
      (boat) => boat.note === labels.externalBoatNote
    );
    expect(external.length).toBe(report.externalBoats);
    expect(external.every((boat) => boat.archivedAt)).toBe(true);
    expect(new Set(external.map((boat) => boat.name)).size).toBe(
      external.length
    );

    // Free crew names become guests, once per name.
    const max = data.rowers.filter(
      (rower) => rower.firstName === "Max" && rower.lastName === "Mustermann"
    );
    expect(max).toHaveLength(1);
    expect(max[0].status).toBe("guest");
  });

  test("keeps every efa record, linked to what it produced", async () => {
    const { db, report } = await importFixture();
    const project = readFixtureProject();
    const total =
      project.projectRecords.length +
      project.objects.reduce((sum, object) => sum + object.records.length, 0);

    const [{ count }] = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM efa_record"
    );
    expect(Number(count)).toBe(total);

    const [{ linked }] = await db.select<{ linked: number }[]>(
      "SELECT COUNT(*) AS linked FROM efa_record WHERE rb_table = 'outing'"
    );
    expect(Number(linked)).toBe(57);
    // The three reservations became rows, linked to their records.
    expect(report.reservations).toBe(3);
    expect(report.keptWithoutScreen.efa2boatreservations).toBeUndefined();
    expect(report.keptWithoutScreen.efa2messages).toBe(3);
  });

  test("turns on the modules the project has data for", async () => {
    const { db } = await importFixture();
    const data = await loadClubData(db);
    expect(data.settings["modules.enabled"]).toEqual([
      "distances",
      "outingTypes",
      "memberProfile",
      "guests",
      "captain",
      "damages",
      "reservations",
    ]);
  });

  test("imports efa damages as damages, open or repaired", async () => {
    const { db, report } = await importFixture();
    expect(report).toMatchObject({
      openDamages: 2,
      fixedDamages: 1,
      unavailableBoats: 1,
    });

    const rows = await db.select<Record<string, string | number | null>[]>(
      "SELECT * FROM boat_damage WHERE kind = 'damage' ORDER BY reported_at"
    );
    expect(rows.map((r) => [r.description, r.severity, r.fixed_at])).toEqual([
      ["Stemmbrett locker", "usable", "2025-05-05T17:00"],
      ["Kratzer am Bug, Dollen schwergängig", "limited", null],
      ["Rollsitz gebrochen", "unusable", null],
    ]);
    // Same ids as the former import, and the efa record points to them.
    expect(rows[0]).toMatchObject({
      id: deriveEfa2Id("damage:c11f575b-b1e3-41dc-993b-faa89205061e:1"),
      reported_at: "2025-05-03T18:05",
      reported_by_rower_id: "f3f495ff-6c03-4b57-9a2a-284f322ddee4",
      fixed_by_rower_id: "a847062f-fec2-4279-97c0-6c0cc8042bea",
      repair_note: "Schrauben ersetzt",
      repair_cost: 12.5,
    });
    // A reporter efa only knew by name is left in the efa record.
    expect(rows[2].reported_by_rower_id).toBeNull();
    expect(rows[1].reported_at).toBe("2026-09-26T00:00");
    const [{ linked }] = await db.select<{ linked: number }[]>(
      "SELECT COUNT(*) AS linked FROM efa_record WHERE rb_table = 'boat_damage'"
    );
    expect(Number(linked)).toBe(3);

    // Damages are no longer incidents.
    const [{ incidents }] = await db.select<{ incidents: number }[]>(
      "SELECT COUNT(*) AS incidents FROM incident"
    );
    expect(Number(incidents)).toBe(0);
  });

  test("a boat efa shows as not available gets an unavailable entry", async () => {
    const { db } = await importFixture();
    const weser = "cc71e998-9195-443d-bbb4-fcc9b846ef99";
    const [entry] = await db.select<Record<string, string | null>[]>(
      "SELECT * FROM boat_damage WHERE kind = 'unavailable'"
    );
    expect(entry).toMatchObject({
      id: deriveEfa2Id(`unavailable:${weser}`),
      boat_id: weser,
      severity: "unusable",
      description: "Rollsitz defekt – in Reparatur bis Ende Oktober",
      fixed_at: null,
    });
    // The reason is no longer copied into the note, and the flag is gone.
    const [boat] = await db.select<
      { note: string | null; is_in_maintenance: number }[]
    >("SELECT note, is_in_maintenance FROM boat WHERE id = $1", [weser]);
    expect(boat).toEqual({ note: null, is_in_maintenance: 0 });
    const data = await loadClubData(db);
    expect(data.boats.find((b) => b.id === weser)!.isInMaintenance).toBe(true);
  });

  test("a project without damages does not turn the damages module on", async () => {
    const project = readFixtureProject();
    project.objects.find((o) => o.type === "efa2boatdamages")!.records = [];
    for (const status of project.objects.find(
      (o) => o.type === "efa2boatstatus"
    )!.records) {
      if (status.BaseStatus === "NOTAVAILABLE") status.BaseStatus = "AVAILABLE";
    }
    const db = createTestSqlClient();
    await applyMigrations(db);
    const report = await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    expect(report).toMatchObject({
      openDamages: 0,
      fixedDamages: 0,
      unavailableBoats: 0,
    });
    const data = await loadClubData(db);
    expect(data.settings["modules.enabled"]).not.toContain("damages");
  });

  test("the latest report of a damage wins and unknown boats are left aside", async () => {
    const project = readFixtureProject();
    const damages = project.objects.find(
      (o) => o.type === "efa2boatdamages"
    )!;
    damages.records.push(
      { ...damages.records[0], Description: "Zweite Fassung" },
      { BoatId: "no-such-boat", Damage: "9", Description: "Fremdes Boot" }
    );
    const db = createTestSqlClient();
    await applyMigrations(db);
    const report = await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    expect(report.openDamages + report.fixedDamages).toBe(3);
    const descriptions = await db.select<{ description: string }[]>(
      "SELECT description FROM boat_damage WHERE kind = 'damage'"
    );
    expect(descriptions.map((d) => d.description)).toContain("Zweite Fassung");
    expect(descriptions.map((d) => d.description)).not.toContain(
      "Fremdes Boot"
    );
  });

  test("keeps the latest version of a record and archives expired ones", async () => {
    const { db } = await importFixture();
    const project = readFixtureProject();
    const persons = project.objects.find(
      (o) => o.type === "efa2persons"
    )!.records;
    const versioned = persons.filter(
      (p) => persons.filter((other) => other.Id === p.Id).length > 1
    );
    expect(versioned.length).toBeGreaterThan(0);

    const rows = await db.select<
      { id: string; first_name: string; archived_at: string | null }[]
    >("SELECT id, first_name, archived_at FROM rower");
    for (const id of new Set(versioned.map((p) => p.Id))) {
      const versions = persons
        .filter((p) => p.Id === id)
        .sort((a, b) => Number(a.ValidFrom) - Number(b.ValidFrom));
      const latest = versions[versions.length - 1];
      const row = rows.find((r) => r.id === id)!;
      expect(row.first_name).toBe(latest.FirstName);
      expect(row.archived_at !== null).toBe(
        latest.InvalidFrom !== "9223372036854775807"
      );
    }
  });

  test("can run twice with the same result", async () => {
    const { db } = await importFixture();
    await runEfa2Import(db, readFixtureProject(), {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    const data = await loadClubData(db);
    expect(data.ongoingOutings).toHaveLength(2);
  });

  test("rolls everything back when a row count does not match", async () => {
    const db = createTestSqlClient();
    await applyMigrations(db);
    await db.execute(
      "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('b1', 'Hirondelle', 'x', 'x')"
    );
    // Something drops a route as it is written: the count check fails.
    await db.execute(
      "CREATE TRIGGER lose_route AFTER INSERT ON route BEGIN DELETE FROM route WHERE id = NEW.id; END;"
    );

    await expect(
      runEfa2Import(db, readFixtureProject(), {
        backup: () => Promise.resolve(),
        labels,
        now: new Date("2026-10-19T12:00:00Z"),
      })
    ).rejects.toBeInstanceOf(Efa2ImportFailedError);

    const data = await loadClubData(db);
    expect(data.boats.map((boat) => boat.name)).toEqual(["Hirondelle"]);
    expect(data.settings["modules.enabled"]).toBeUndefined();
  });

  test("imports nothing when the backup fails", async () => {
    const db = createTestSqlClient();
    await applyMigrations(db);
    await expect(
      runEfa2Import(db, readFixtureProject(), {
        backup: () => Promise.reject(new Error("disk full")),
        labels,
      })
    ).rejects.toBeInstanceOf(Efa2BackupFailedError);
    const data = await loadClubData(db);
    expect(data.boats).toEqual([]);
  });

  test("an outing past midnight without end date ends the next day", async () => {
    const project = readFixtureProject();
    project.objects
      .find((o) => o.type === "efa2logbook")!
      .records.push({
        EntryId: "9002",
        Date: "31.12.2025",
        StartTime: "23:00:00",
        EndTime: "01:00:00",
        BoatName: "Nachtboot",
      });
    const db = createTestSqlClient();
    await applyMigrations(db);
    await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    const [outing] = await db.select<
      { start_date_time: string; end_date_time: string }[]
    >(
      "SELECT start_date_time, end_date_time FROM outing WHERE start_date_time = '2025-12-31T23:00'"
    );
    expect(outing.end_date_time).toBe("2026-01-01T01:00");
  });

  test("closes outings left open in efa before today", async () => {
    const project = readFixtureProject();
    project.objects
      .find((o) => o.type === "efa2logbook")!
      .records.push({
        EntryId: "9003",
        Date: "02.05.2025",
        StartTime: "09:00:00",
        Open: "true",
        BoatName: "Vergessen",
        Comments: "Training",
      });
    const db = createTestSqlClient();
    await applyMigrations(db);
    const report = await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    expect(report.ongoingOutings).toBe(2);
    expect(report.closedOpenOutings).toBe(1);
    const [outing] = await db.select<
      { end_date_time: string; comment: string }[]
    >(
      "SELECT end_date_time, comment FROM outing WHERE start_date_time = '2025-05-02T09:00'"
    );
    expect(outing).toMatchObject({
      end_date_time: "2025-05-02T09:00",
      comment: "Training Restée ouverte dans efa.",
    });
  });

  test("a free name shared by several records prefers the active one", async () => {
    const project = readFixtureProject();
    const person = (id: string, first: string, last: string, gone = false) => ({
      Id: id,
      FirstName: first,
      LastName: last,
      ValidFrom: "0",
      InvalidFrom: gone ? "1700000000000" : "9223372036854775807",
    });
    project.objects
      .find((o) => o.type === "efa2persons")!
      .records.push(
        person("aaaaaaaa-0000-4000-8000-000000000001", "Paul", "Klein", true),
        person("aaaaaaaa-0000-4000-8000-000000000002", "Paul", "Klein"),
        person("aaaaaaaa-0000-4000-8000-000000000003", "Anna", "Weber"),
        person("aaaaaaaa-0000-4000-8000-000000000004", "Anna", "Weber")
      );
    project.objects
      .find((o) => o.type === "efa2logbook")!
      .records.push({
        EntryId: "9004",
        Date: "03.05.2025",
        StartTime: "09:00:00",
        EndTime: "10:00:00",
        BoatName: "Gast",
        Crew1Name: "Paul Klein",
        Crew2Name: "Anna Weber",
      });
    const db = createTestSqlClient();
    await applyMigrations(db);
    const report = await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    expect(report.ambiguousNames).toBe(1);
    const crew = await db.select<{ rower_id: string; status: string }[]>(
      "SELECT c.rower_id, r.status FROM outing_crew c JOIN outing o ON o.id = c.outing_id JOIN rower r ON r.id = c.rower_id WHERE o.start_date_time = '2025-05-03T09:00' ORDER BY c.position"
    );
    expect(crew[0].rower_id).toBe("aaaaaaaa-0000-4000-8000-000000000002");
    expect(crew[1].status).toBe("guest");
  });
  test("a repeated entry number keeps the last entry", async () => {
    const project = readFixtureProject();
    const logbook = project.objects.find((o) => o.type === "efa2logbook")!;
    const entry = { EntryId: "9005", Date: "04.05.2025", BoatName: "Gast" };
    logbook.records.push(
      { ...entry, Comments: "first" },
      { ...entry, Comments: "second" }
    );
    const db = createTestSqlClient();
    await applyMigrations(db);
    await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    const outings = await db.select<{ comment: string }[]>(
      "SELECT comment FROM outing WHERE start_date_time LIKE '2025-05-04%'"
    );
    expect(outings.map((o) => o.comment)).toEqual(["second"]);
  });

  test("a free boat name goes to the active boat, not an archived homonym", async () => {
    const project = readFixtureProject();
    const boat = (id: string, gone: boolean) => ({
      Id: id,
      Name: "Wiking",
      ValidFrom: "0",
      InvalidFrom: gone ? "1700000000000" : "9223372036854775807",
    });
    project.objects
      .find((o) => o.type === "efa2boats")!
      .records.push(
        boat("bbbbbbbb-0000-4000-8000-000000000002", false),
        boat("bbbbbbbb-0000-4000-8000-000000000001", true)
      );
    project.objects
      .find((o) => o.type === "efa2logbook")!
      .records.push({ EntryId: "9006", Date: "05.05.2025", BoatName: "Wiking" });
    const db = createTestSqlClient();
    await applyMigrations(db);
    await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    const [outing] = await db.select<{ boat_id: string }[]>(
      "SELECT boat_id FROM outing WHERE start_date_time LIKE '2025-05-05%'"
    );
    expect(outing.boat_id).toBe("bbbbbbbb-0000-4000-8000-000000000002");
  });
  test("the preview counts entries left aside once, on their own line", async () => {
    const project = readFixtureProject();
    project.objects
      .find((o) => o.type === "efa2logbook")!
      .records.push({ EntryId: "9007", Crew1Name: "Ohne Datum" });
    const db = createTestSqlClient();
    await applyMigrations(db);
    const report = await runEfa2Import(db, project, {
      backup: () => Promise.resolve(),
      labels,
      now: new Date("2026-10-19T12:00:00Z"),
    });
    expect(report.unreadableEntries).toBe(1);
    expect(report.keptWithoutScreen.efa2logbook).toBeUndefined();
  });
});
