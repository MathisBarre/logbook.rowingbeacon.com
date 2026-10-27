import { describe, expect, test } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
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
    expect(report.keptWithoutScreen.efa2boatreservations).toBe(3);
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
    ]);
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
