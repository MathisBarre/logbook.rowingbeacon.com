import { describe, expect, test } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import { readFixtureProject } from "./__fixtures__/readFixtureProject";
import { runEfa2Import } from "./runEfa2Import";
import { buildEfa2Export } from "./buildEfa2Export";
import { EFA2_FOREVER } from "./efa2Values";
import { deriveEfa2Id } from "./planEfa2Import";
import { anonymizeRower } from "../database/repositories/club.repository";
import {
  findObject,
  findObjects,
  readEfa2ProjectFromZip,
  writeEfa2BackupZip,
} from "./efa2Project";

const importLabels = {
  externalBoatNote: "Bateau extérieur importé d'efa",
  statusGroupPrefix: "Statut : ",
  closedOpenOutingNote: "Restée ouverte dans efa.",
};
const exportLabels = {
  statuses: { member: "Membre", guest: "Invité", other: "Autre" },
  defaultProjectName: "Mon club",
  boathouseName: "Hangar",
};
const now = new Date("2026-10-19T12:00:00Z");

const freshDb = async () => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  return db;
};

const importProject = async (project = readFixtureProject()) => {
  const db = await freshDb();
  await runEfa2Import(db, project, {
    backup: () => Promise.resolve(),
    labels: importLabels,
    now,
  });
  return db;
};

describe("buildEfa2Export", () => {
  test("writes back an imported project with its logbooks and kept records", async () => {
    const db = await importProject();
    const { project, report } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });

    expect(project.name).toBe("TestClub");
    expect(report.logbooks).toEqual(["2025", "2026"]);
    expect(
      findObjects(project, "efa2logbook")
        .map((l) => l.records.length)
        .sort()
    ).toEqual([25, 32]);
    expect(findObject(project, "efa2boatreservations")?.records).toHaveLength(
      3
    );
    expect(findObject(project, "efa2messages")?.records).toHaveLength(3);

    // Free names were turned into records, so every seat has an id. Only a
    // boat efa knew by name and still on the water keeps its name.
    const entries = findObjects(project, "efa2logbook").flatMap(
      (l) => l.records
    );
    expect(
      entries
        .filter((e) => e.Open !== "true")
        .some((e) =>
          Object.keys(e).some(
            (k) => /Name$/.test(k) && k !== "DestinationVariantName"
          )
        )
    ).toBe(false);
    expect(entries.find((e) => e.BoatName)).toMatchObject({
      BoatName: "Gastboot Wanderer",
      Open: "true",
    });
    expect(
      findObject(project, "efa2boatstatus")!.records.find(
        (s) => s.UnknownBoat === "true"
      )
    ).toMatchObject({ BoatText: "Gastboot Wanderer", EntryNo: "25" });

    // A convertible boat keeps its variants and descriptions.
    const neckar = findObject(project, "efa2boats")!.records.find(
      (b) => b.Name === "Neckar"
    )!;
    expect(neckar.TypeVariant).toBe("1;2");
    expect(neckar.TypeSeats).toBe("4X;4");
    expect(neckar.TypeDescription).toBe("Doppelvierer;Vierer ohne");
    expect(neckar.PurchasePriceCurrency).toBe("EUR");

    // Boats on the water point to their open entry.
    const onTheWater = findObject(project, "efa2boatstatus")!.records.filter(
      (s) => s.CurrentStatus === "ONTHEWATER"
    );
    expect(onTheWater).toHaveLength(2);
    expect(onTheWater.every((s) => s.Logbook === "2026" && s.EntryNo)).toBe(
      true
    );
  });

  test("an export imports back to the same club", async () => {
    const db = await importProject();
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const again = await importProject(
      readEfa2ProjectFromZip(writeEfa2BackupZip(project, now.getTime()))
    );

    for (const table of [
      "boat",
      "boat_configuration",
      "rower",
      "route",
      "outing",
      "outing_crew",
    ]) {
      const [a] = await db.select<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM ${table}`
      );
      const [b] = await again.select<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM ${table}`
      );
      expect([table, Number(b.n)]).toEqual([table, Number(a.n)]);
    }
    const names = async (client: typeof db) =>
      (
        await client.select<{ name: string }[]>(
          "SELECT first_name || ' ' || last_name AS name FROM rower ORDER BY 1"
        )
      ).map((r) => r.name);
    expect(await names(again)).toEqual(await names(db));
  });

  test("exports a club that never used efa", async () => {
    const db = await freshDb();
    await db.execute(
      "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'Hirondelle', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    );
    await db.execute(
      "INSERT INTO boat_configuration (id, boat_id, seats, rigging, coxed, is_default) VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 2, 'scull', 0, 1)"
    );
    await db.execute(
      "INSERT INTO rower (id, first_name, last_name, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', 'Jeanne', 'Martin', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    );
    await db.execute(
      "INSERT INTO outing (id, boat_id, boat_configuration_id, start_date_time, end_date_time, distance_m, created_at, updated_at) VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-05-02T09:00', '2026-05-02T10:30', 10000, '2026-05-02T10:30:00Z', '2026-05-02T10:30:00Z')"
    );
    await db.execute(
      "INSERT INTO outing_crew (outing_id, rower_id, role, position) VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'rower', 0)"
    );

    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(project.name).toBe("Monclub");
    expect(
      project.projectRecords.find((r) => r.Type === "Boathouse")
        ?.CurrentLogbookEfaBase
    ).toBe("2026");
    expect(
      findObject(project, "efa2status")!
        .records.map((s) => s.Type)
        .sort()
    ).toEqual(["GUEST", "OTHER", "USER"]);
    const [entry] = findObjects(project, "efa2logbook")[0].records;
    expect(entry).toMatchObject({
      EntryId: "1",
      Date: "02.05.2026",
      BoatVariant: "1",
      Crew1Id: "33333333-3333-4333-8333-333333333333",
      StartTime: "09:00:00",
      EndTime: "10:30:00",
      Distance: "10 km",
      SessionType: "NORMAL",
    });
    expect(findObject(project, "efa2boats")!.records[0]).toMatchObject({
      TypeSeats: "2X",
      TypeRigging: "SCULL",
      TypeCoxing: "COXLESS",
    });
  });

  test("a person with only a last name is written back as in efa", async () => {
    const project = readFixtureProject();
    const persons = findObject(project, "efa2persons")!;
    persons.records.push({
      Id: "55555555-5555-4555-8555-555555555555",
      LastName: "Solo",
      NameAffix: "jr.",
      ValidFrom: "0",
      InvalidFrom: "9223372036854775807",
    });
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(
      findObject(exported, "efa2persons")!.records.find(
        (p) => p.Id === "55555555-5555-4555-8555-555555555555"
      )
    ).toMatchObject({ LastName: "Solo", NameAffix: "jr." });
    expect(
      findObject(exported, "efa2persons")!.records.find(
        (p) => p.Id === "55555555-5555-4555-8555-555555555555"
      )!.FirstName
    ).toBeUndefined();
  });

  test("imported versions come back as they were", async () => {
    const original = readFixtureProject();
    const db = await importProject();
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    for (const type of [
      "efa2boats",
      "efa2persons",
      "efa2groups",
      "efa2destinations",
    ]) {
      const exported = findObject(project, type)!.records;
      for (const record of findObject(original, type)!.records) {
        expect(
          exported.find(
            (r) => r.Id === record.Id && r.ValidFrom === record.ValidFrom
          )
        ).toEqual(record);
      }
    }
  });

  test("an unchanged club comes back as efa wrote it", async () => {
    const original = readFixtureProject();
    // Values Rowing Beacon cannot hold: no status, a member efa purged.
    delete findObject(original, "efa2persons")!.records.find(
      (p) => p.StatusId && p.InvalidFrom === "9223372036854775807"
    )!.StatusId;
    const group = findObject(original, "efa2groups")!.records.find(
      (g) => g.MemberIdList
    )!;
    group.MemberIdList += ";99999999-9999-4999-8999-999999999999";
    const db = await importProject(structuredClone(original));
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    for (const object of original.objects) {
      const exported = project.objects.find(
        (o) => o.type === object.type && o.name === object.name
      )!;
      for (const record of object.records) {
        // Free names become records (a known limit).
        if (
          object.type === "efa2logbook" &&
          Object.keys(record).some(
            (k) => /Name$/.test(k) && k !== "DestinationVariantName"
          )
        ) {
          continue;
        }
        expect(exported.records).toContainEqual(record);
      }
    }
  });

  test("a partial efa date does not open a new version", async () => {
    const project = readFixtureProject();
    const person = findObject(project, "efa2persons")!.records.find(
      (p) => p.FirstName && p.InvalidFrom === "9223372036854775807"
    )!;
    person.Birthday = "1985";
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const versions = findObject(exported, "efa2persons")!.records.filter(
      (r) => r.Id === person.Id
    );
    expect(versions).toContainEqual(person);
    expect(versions.every((v) => v.InvalidFrom !== String(now.getTime()))).toBe(
      true
    );
  });

  test("an entry without times comes back without times", async () => {
    const project = readFixtureProject();
    const logbook = findObjects(project, "efa2logbook")[0];
    const entry = logbook.records.find((e) => e.Date && e.Open !== "true")!;
    delete entry.StartTime;
    delete entry.EndTime;
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const back = findObjects(exported, "efa2logbook")
      .find((l) => l.name === logbook.name)!
      .records.find((e) => e.EntryId === entry.EntryId)!;
    expect(back.StartTime).toBeUndefined();
    expect(back.EndTime).toBeUndefined();
  });

  test("a change made in Rowing Beacon opens a new version", async () => {
    const original = readFixtureProject();
    const db = await importProject();
    const [{ id }] = await db.select<{ id: string }[]>(
      "SELECT id FROM rower WHERE archived_at IS NULL AND status = 'member' LIMIT 1"
    );
    await db.execute(
      "UPDATE rower SET first_name = 'Renamed', updated_at = '2026-10-19T12:00:00.000Z' WHERE id = $1",
      [id]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const versions = findObject(project, "efa2persons")!
      .records.filter((r) => r.Id === id)
      .sort((a, b) => Number(a.ValidFrom) - Number(b.ValidFrom));
    const before = findObject(original, "efa2persons")!.records.filter(
      (r) => r.Id === id
    );
    expect(versions).toHaveLength(before.length + 1);
    const [previous, latest] = versions.slice(-2);
    expect(previous.InvalidFrom).toBe(String(now.getTime()));
    expect(latest).toMatchObject({
      FirstName: "Renamed",
      ValidFrom: String(now.getTime()),
      InvalidFrom: "9223372036854775807",
    });
  });

  test("a record changed then archived keeps its past version", async () => {
    const original = readFixtureProject();
    const db = await importProject();
    const [{ id }] = await db.select<{ id: string }[]>(
      "SELECT id FROM rower WHERE archived_at IS NULL AND status = 'member' LIMIT 1"
    );
    await db.execute(
      "UPDATE rower SET first_name = 'Renamed', archived_at = '2026-10-19T12:00:00.000Z', updated_at = '2026-10-19T12:00:00.000Z' WHERE id = $1",
      [id]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const before = findObject(original, "efa2persons")!.records.filter(
      (r) => r.Id === id
    );
    const versions = findObject(project, "efa2persons")!
      .records.filter((r) => r.Id === id)
      .sort((a, b) => Number(a.ValidFrom) - Number(b.ValidFrom));
    expect(versions).toHaveLength(before.length + 1);
    const [previous, latest] = versions.slice(-2);
    expect(previous.FirstName).toBe(before[before.length - 1].FirstName);
    expect(previous.InvalidFrom).toBe(latest.ValidFrom);
    expect(latest.FirstName).toBe("Renamed");
    expect(Number(latest.InvalidFrom)).toBeLessThan(Number(EFA2_FOREVER));
  });

  test("a record deleted in efa stays deleted when edited in Rowing Beacon", async () => {
    const original = readFixtureProject();
    const deleted = findObject(original, "efa2persons")!.records.find(
      (p) => p.Deleted === "true"
    )!;
    const db = await importProject();
    await db.execute(
      "UPDATE rower SET email = 'new@example.org', updated_at = '2026-10-19T12:00:00.000Z' WHERE id = $1",
      [deleted.Id]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const versions = findObject(project, "efa2persons")!.records.filter(
      (r) => r.Id === deleted.Id
    );
    expect(versions.at(-1)).toMatchObject({
      Email: "new@example.org",
      Deleted: "true",
      InvalidFrom: deleted.InvalidFrom,
    });
  });

  test("a boat efa only hides keeps its change open-ended", async () => {
    const original = readFixtureProject();
    const hidden = findObject(original, "efa2boatstatus")!.records.find(
      (s) => s.BaseStatus === "HIDE" && s.UnknownBoat !== "true"
    )!;
    const db = await importProject();
    await db.execute(
      "UPDATE boat SET manufacturer = 'Empacher', updated_at = '2026-10-20T12:00:00.000Z' WHERE id = $1",
      [hidden.BoatId]
    );
    const later = new Date("2026-10-21T12:00:00Z");
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now: later,
    });
    const latest = findObject(project, "efa2boats")!
      .records.filter((r) => r.Id === hidden.BoatId)
      .sort((a, b) => Number(a.ValidFrom) - Number(b.ValidFrom))
      .at(-1)!;
    expect(latest).toMatchObject({
      Manufacturer: "Empacher",
      InvalidFrom: EFA2_FOREVER,
    });
    expect(
      findObject(project, "efa2boatstatus")!.records.find(
        (s) => s.BoatId === hidden.BoatId
      )!.BaseStatus
    ).toBe("HIDE");
  });

  test("an end efa planned ahead survives an export after that date", async () => {
    const project = readFixtureProject();
    const person = findObject(project, "efa2persons")!.records.find(
      (p) => p.FirstName && p.InvalidFrom === EFA2_FOREVER && !p.Deleted
    )!;
    const plannedEnd = String(new Date("2027-01-01T00:00:00Z").getTime());
    person.InvalidFrom = plannedEnd;
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now: new Date("2027-02-01T12:00:00Z"),
    });
    expect(
      findObject(exported, "efa2persons")!.records.filter(
        (r) => r.Id === person.Id
      )
    ).toContainEqual(person);
  });

  test("past outings keep their variant when the rig changes in Rowing Beacon", async () => {
    const original = readFixtureProject();
    const neckar = findObject(original, "efa2boats")!.records.find(
      (b) => b.Name === "Neckar"
    )!;
    const pastEntries = findObjects(original, "efa2logbook")
      .flatMap((l) => l.records)
      .filter((e) => e.BoatId === neckar.Id && e.BoatVariant === "2");
    const db = await importProject();
    await db.execute(
      "UPDATE boat_configuration SET archived_at = '2026-10-19T12:00:00.000Z' WHERE id = $1",
      [deriveEfa2Id(`configuration:${neckar.Id}:2`)]
    );
    await db.execute(
      "INSERT INTO boat_configuration (id, boat_id, position, seats, rigging, coxed) VALUES ('new-rig', $1, 1, 4, 'sweep', 1)",
      [neckar.Id]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const exported = findObjects(project, "efa2logbook").flatMap(
      (l) => l.records
    );
    expect(pastEntries.length).toBeGreaterThan(0);
    for (const entry of pastEntries) {
      expect(exported).toContainEqual(entry);
    }
  });

  test("an anonymised person leaves no personal data in the export", async () => {
    const original = readFixtureProject();
    const person = findObject(original, "efa2persons")!.records.find(
      (p) => p.Birthday && p.FirstName && !p.Deleted
    )!;
    const db = await importProject();
    await anonymizeRower(db, person.Id, "Anonyme");
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const versions = findObject(project, "efa2persons")!.records.filter(
      (r) => r.Id === person.Id
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].FirstName).toBe("Anonyme");
    expect(versions[0].Birthday).toBeUndefined();
    const text = JSON.stringify(project);
    expect(text).not.toContain(person.Birthday);
    expect(text).not.toContain(`${person.FirstName} ${person.LastName}`);
  });

  test("a second boathouse comes back as it was", async () => {
    const project = readFixtureProject();
    const second = { Type: "Boathouse", Name: "Zweites Bootshaus", BoathouseId: "2" };
    project.projectRecords.push(second);
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(exported.projectRecords).toContainEqual(second);
    expect(
      exported.projectRecords.filter((r) => r.Type === "Boathouse")
    ).toHaveLength(2);
  });

  test("a boat back from the water loses efa's on-the-water comment", async () => {
    const onWater = findObject(readFixtureProject(), "efa2boatstatus")!
      .records.filter(
        (s) => s.CurrentStatus === "ONTHEWATER" && s.UnknownBoat !== "true"
      );
    const db = await freshDb();
    // Imported two days later: the import closes the outings left open.
    await runEfa2Import(db, readFixtureProject(), {
      backup: () => Promise.resolve(),
      labels: importLabels,
      now: new Date("2026-10-21T12:00:00Z"),
    });
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now: new Date("2026-10-21T12:00:00Z"),
    });
    expect(onWater.length).toBeGreaterThan(0);
    for (const raw of onWater) {
      const status = findObject(project, "efa2boatstatus")!.records.find(
        (s) => s.BoatId === raw.BoatId
      )!;
      expect(status.CurrentStatus).not.toBe("ONTHEWATER");
      expect(status.Comment).toBeUndefined();
    }
  });

  test("anonymising everyone leaves no name in kept efa records", async () => {
    const original = readFixtureProject();
    const persons = findObject(original, "efa2persons")!.records.filter(
      (p) => p.FirstName && p.LastName
    );
    const db = await importProject();
    const ids = new Set(persons.map((p) => p.Id));
    for (const id of ids) await anonymizeRower(db, id, "Anonyme");
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const kept = project.objects
      .filter((o) =>
        [
          "efa2messages",
          "efa2boatdamages",
          "efa2boatreservations",
          "efa2sessiongroups",
          "efa2boatstatus",
        ].includes(o.type)
      )
      .map((o) => JSON.stringify(o.records))
      .join("");
    for (const person of persons) {
      expect(kept).not.toContain(`${person.FirstName} ${person.LastName}`);
      expect(kept).not.toContain(`${person.LastName}, ${person.FirstName}`);
    }
  });

  test("anonymising matches names with accented capitals", async () => {
    const project = readFixtureProject();
    const person = findObject(project, "efa2persons")!.records.find(
      (p) => p.FirstName && p.LastName && !p.Deleted
    )!;
    for (const version of findObject(project, "efa2persons")!.records) {
      if (version.Id !== person.Id) continue;
      version.FirstName = "Élodie";
      version.LastName = "Östberg";
    }
    const message = findObject(project, "efa2messages")!.records[0];
    message.From = "Élodie Östberg";
    message.Text = "Gemeldet von ÖSTBERG, ÉLODIE.";
    const untouched = findObject(project, "efa2messages")!.records[1];
    delete untouched.From;
    const db = await importProject(project);
    await anonymizeRower(db, person.Id, "Anonyme");
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const messages = findObject(exported, "efa2messages")!.records;
    const after = messages.find((m) => m.MessageId === message.MessageId)!;
    expect(after.From).toBe("Anonyme");
    expect(after.Text).toBe("Gemeldet von Anonyme.");
    expect(messages).toContainEqual(untouched);
  });

  test("an expired record stays expired, even hidden, and loses emptied fields", async () => {
    const original = readFixtureProject();
    const now2 = new Date("2026-10-19T12:00:00Z").getTime();
    // Records with one version, so that the expired one is the latest.
    const single = (records: Record<string, string | undefined>[]) =>
      records.filter((r) => records.filter((o) => o.Id === r.Id).length === 1);
    const expiredBoat = single(
      findObject(original, "efa2boats")!.records
    ).find((b) => b.InvalidFrom === EFA2_FOREVER && !b.Deleted)!;
    expiredBoat.InvalidFrom = String(now2 - 86_400_000);
    findObject(original, "efa2boatstatus")!.records.find(
      (s) => s.BoatId === expiredBoat.Id
    )!.BaseStatus = "HIDE";
    const expiredPerson = single(
      findObject(original, "efa2persons")!.records
    ).find((p) => p.InvalidFrom === EFA2_FOREVER && !p.Deleted && p.Email)!;
    expiredPerson.InvalidFrom = String(now2 - 86_400_000);
    const db = await importProject(structuredClone(original));
    await db.execute(
      "UPDATE boat SET manufacturer = 'Empacher', updated_at = '2026-10-19T12:00:00.000Z' WHERE id = $1",
      [expiredBoat.Id]
    );
    await db.execute(
      "UPDATE rower SET email = NULL, updated_at = '2026-10-19T12:00:00.000Z' WHERE id = $1",
      [expiredPerson.Id]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const boatVersions = findObject(project, "efa2boats")!.records.filter(
      (r) => r.Id === expiredBoat.Id
    );
    expect(boatVersions).toHaveLength(1);
    expect(boatVersions[0]).toMatchObject({
      Manufacturer: "Empacher",
      InvalidFrom: expiredBoat.InvalidFrom,
    });
    const person = findObject(project, "efa2persons")!.records.find(
      (r) => r.Id === expiredPerson.Id
    )!;
    expect(person.Email).toBeUndefined();
    expect(person.InvalidFrom).toBe(expiredPerson.InvalidFrom);
  });

  test("a record that ended after its last change comes back unchanged", async () => {
    const original = readFixtureProject();
    const person = findObject(original, "efa2persons")!.records.find(
      (p) => p.FirstName && p.InvalidFrom === EFA2_FOREVER && !p.Deleted
    )!;
    person.InvalidFrom = String(Number(person.LastModified) + 60_000);
    const db = await importProject(structuredClone(original));
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(findObject(project, "efa2persons")!.records).toContainEqual(person);
  });

  test("a member created in Rowing Beacon gets the club's usual status", async () => {
    const project = readFixtureProject();
    const statuses = findObject(project, "efa2status")!.records;
    const persons = findObject(project, "efa2persons")!.records;
    const usual = statuses
      .filter((s) => s.Type === "USER")
      .map((s) => ({
        id: s.Id,
        count: persons.filter(
          (p) => p.StatusId === s.Id && p.InvalidFrom === EFA2_FOREVER
        ).length,
      }))
      .sort((a, b) => b.count - a.count)[0].id;
    // A rarely used status listed first must not be picked.
    const rare = statuses.find((s) => s.Type === "USER" && s.Id !== usual)!;
    statuses.splice(statuses.indexOf(rare), 1);
    statuses.unshift(rare);
    const db = await importProject(project);
    await db.execute(
      "INSERT INTO rower (id, first_name, last_name, status, created_at, updated_at) VALUES ('new-rower', 'Nouvelle', 'Rameuse', 'member', 'x', 'x')"
    );
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(
      findObject(exported, "efa2persons")!.records.find(
        (p) => p.Id === "new-rower"
      )!.StatusId
    ).toBe(usual);
  });

  test("boat status follows Rowing Beacon without inventing a reason", async () => {
    const project = readFixtureProject();
    const statuses = findObject(project, "efa2boatstatus")!.records;
    const damaged = statuses.find(
      (s) => s.BoatId === "cc71e998-9195-443d-bbb4-fcc9b846ef99"
    )!;
    // efa can show a blocking damage while the boat stays AVAILABLE.
    damaged.BaseStatus = "AVAILABLE";
    damaged.CurrentStatus = "AVAILABLE";
    delete damaged.Comment;
    const unavailable = statuses.find(
      (s) =>
        s !== damaged &&
        s.BaseStatus === "AVAILABLE" &&
        s.CurrentStatus === "AVAILABLE" &&
        s.UnknownBoat !== "true"
    )!;
    Object.assign(unavailable, {
      BaseStatus: "NOTAVAILABLE",
      CurrentStatus: "NOTAVAILABLE",
      Comment: "Coque fendue",
    });
    const db = await importProject(structuredClone(project));
    await db.execute("UPDATE boat SET note = NULL WHERE id = $1", [
      unavailable.BoatId,
    ]);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const out = findObject(exported, "efa2boatstatus")!.records;
    expect(out).toContainEqual(damaged);
    expect(
      out.find((s) => s.BoatId === unavailable.BoatId)!.Comment
    ).toBeUndefined();
  });

  test("efa opens the logbook of the export's year", async () => {
    const project = readFixtureProject();
    project.projectRecords.push({
      Type: "Logbook",
      Name: "2027",
      StartDate: "01.01.2027",
      EndDate: "31.12.2027",
    });
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now: new Date("2027-01-03T12:00:00Z"),
    });
    expect(
      exported.projectRecords.find((r) => r.Type === "Boathouse")
    ).toMatchObject({ CurrentLogbookEfaBase: "2027" });
  });

  test("unreadable logbook entries come back as they were", async () => {
    const project = readFixtureProject();
    const entry = { EntryId: "9001", Crew1Name: "Ohne Datum" };
    findObjects(project, "efa2logbook")[0].records.push(entry);
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(
      findObjects(exported, "efa2logbook").flatMap((l) => l.records)
    ).toContainEqual(entry);
  });

  test("empty logbooks and clubwork books come back, and the current one stays", async () => {
    const project = readFixtureProject();
    project.projectRecords.push(
      { Type: "Logbook", Name: "2027", StartDate: "01.01.2027", EndDate: "31.12.2027" },
      { Type: "ClubworkBook", Name: "Vereinsarbeit2027" }
    );
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(findObjects(exported, "efa2logbook").map((l) => l.name)).toContain(
      "2027"
    );
    expect(
      findObjects(exported, "efa2clubwork").map((c) => c.name)
    ).toContain("Vereinsarbeit2027");
    expect(
      exported.projectRecords.find((r) => r.Type === "Boathouse")
    ).toMatchObject({
      CurrentLogbookEfaBase: "2026",
      CurrentLogbookEfaBoathouse: "2026",
    });
  });

  test("a boat put back in service has its blocking damage repaired", async () => {
    const db = await importProject();
    const blocking = findObject(readFixtureProject(), "efa2boatdamages")!
      .records.filter((d) => d.Severity === "NOTUSEABLE" && !d.Fixed)
      .map((d) => d.BoatId);
    await db.execute(
      "UPDATE boat SET is_in_maintenance = 0 WHERE id IN (SELECT value FROM json_each($1))",
      [JSON.stringify(blocking)]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const damages = findObject(project, "efa2boatdamages")!.records;
    expect(blocking.length).toBeGreaterThan(0);
    for (const boatId of blocking) {
      expect(
        damages.find((d) => d.BoatId === boatId && d.Severity === "NOTUSEABLE")
      ).toMatchObject({ Fixed: "true", FixDate: "19.10.2026" });
    }
  });
});
