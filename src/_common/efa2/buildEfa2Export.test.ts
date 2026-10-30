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
const WIKING = "c11f575b-b1e3-41dc-993b-faa89205061e";
const NECKAR = "c11721e8-b73e-4682-8b01-f3cec71fb7a5";
const WESER = "cc71e998-9195-443d-bbb4-fcc9b846ef99";

const freshDb = async () => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  return db;
};

const insertUnavailable = (
  db: Awaited<ReturnType<typeof freshDb>>,
  boatId: string,
  description: string
) =>
  db.execute(
    `INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, created_at, updated_at)
    VALUES ($1, $2, 'unavailable', 'unusable', $3, '2026-10-19T08:00', 'x', 'x')`,
    [`unavailable-${boatId}`, boatId, description]
  );

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
    const second = {
      Type: "Boathouse",
      Name: "Zweites Bootshaus",
      BoathouseId: "2",
    };
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
    const onWater = findObject(
      readFixtureProject(),
      "efa2boatstatus"
    )!.records.filter(
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

  test("an outing on the water corrected where efa's on-the-water text speaks of loses it", async () => {
    const db = await importProject();
    const [ongoing] = await db.select<{ id: string; boat_id: string }[]>(
      "SELECT o.id, o.boat_id FROM outing o JOIN efa_record r ON r.rb_table = 'outing' AND r.rb_id = o.id WHERE o.end_date_time IS NULL AND json_extract(r.fields, '$.BoatId') IS NOT NULL LIMIT 1"
    );
    const statusOf = async () =>
      findObject(
        (await buildEfa2Export(db, { labels: exportLabels, now })).project,
        "efa2boatstatus"
      )!.records.find((s) => s.BoatId === ongoing.boat_id)!;
    expect((await statusOf()).Comment).toBeDefined();

    // The text does not speak of the comment.
    await db.execute("UPDATE outing SET comment = 'Corrigée' WHERE id = $1", [
      ongoing.id,
    ]);
    expect((await statusOf()).Comment).toBeDefined();

    await db.execute(
      "UPDATE outing SET start_date_time = substr(start_date_time, 1, 11) || '06:05' WHERE id = $1",
      [ongoing.id]
    );

    const status = await statusOf();
    expect(status.CurrentStatus).toBe("ONTHEWATER");
    expect(status.Comment).toBeUndefined();
  });

  test("anonymising everyone leaves no name in kept efa records", async () => {
    const original = readFixtureProject();
    const persons = findObject(original, "efa2persons")!.records.filter(
      (p) => p.FirstName && p.LastName
    );
    // A repair credited to a free name, as efa2 writes for a non-member.
    const repaired = findObject(original, "efa2boatdamages")!.records[0];
    repaired.FixedByPersonName = `${persons[0].FirstName} ${persons[0].LastName}`;
    // Reservation reasons name people too, kept records and table rows alike.
    findObject(original, "efa2boatreservations")!.records.forEach(
      (reservation, i) => {
        const person = persons[i % persons.length];
        reservation.Reason = `Training ${person.FirstName} ${person.LastName}`;
      }
    );
    const db = await importProject(original);
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
    const expiredBoat = single(findObject(original, "efa2boats")!.records).find(
      (b) => b.InvalidFrom === EFA2_FOREVER && !b.Deleted
    )!;
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

  test("boat status follows the unavailable entries without inventing a reason", async () => {
    const project = readFixtureProject();
    const statuses = findObject(project, "efa2boatstatus")!.records;
    const damaged = statuses.find(
      (s) => s.BoatId === "cc71e998-9195-443d-bbb4-fcc9b846ef99"
    )!;
    // efa can show a blocking damage while the boat stays AVAILABLE.
    damaged.BaseStatus = "AVAILABLE";
    damaged.CurrentStatus = "AVAILABLE";
    delete damaged.Comment;
    const available = statuses.find(
      (s) =>
        s !== damaged &&
        s.BaseStatus === "AVAILABLE" &&
        s.CurrentStatus === "AVAILABLE" &&
        s.UnknownBoat !== "true"
    )!;
    const db = await importProject(structuredClone(project));
    // An open damage alone does not change the efa status.
    let out = findObject(
      (await buildEfa2Export(db, { labels: exportLabels, now })).project,
      "efa2boatstatus"
    )!.records;
    expect(out).toContainEqual(damaged);

    await insertUnavailable(db, available.BoatId, "Coque fendue");
    out = findObject(
      (await buildEfa2Export(db, { labels: exportLabels, now })).project,
      "efa2boatstatus"
    )!.records;
    expect(out.find((s) => s.BoatId === available.BoatId)).toMatchObject({
      BaseStatus: "NOTAVAILABLE",
      CurrentStatus: "NOTAVAILABLE",
      Comment: "Coque fendue",
      // Dated by the entry, not the export, so a re-import keeps the date.
      LastModified: String(new Date("2026-10-19T08:00").getTime()),
    });
  });

  test("an unavailable entry emptied in Rowing Beacon clears the comment", async () => {
    const db = await importProject();
    await db.execute(
      "UPDATE boat_damage SET description = '' WHERE kind = 'unavailable'"
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const weser = findObject(project, "efa2boatstatus")!.records.find(
      (s) => s.BoatId === WESER
    )!;
    expect(weser).toMatchObject({
      BaseStatus: "NOTAVAILABLE",
      ChangeCount: "3",
    });
    expect(weser.Comment).toBeUndefined();
  });

  test("the newest unavailable entry with a reason gives the comment", async () => {
    const original = readFixtureProject();
    const db = await importProject();
    const exportStatus = async () =>
      findObject(
        (await buildEfa2Export(db, { labels: exportLabels, now })).project,
        "efa2boatstatus"
      )!.records.find((s) => s.BoatId === WESER)!;
    // The untouched import comes back as it was.
    expect(await exportStatus()).toEqual(
      findObject(original, "efa2boatstatus")!.records.find(
        (s) => s.BoatId === WESER
      )
    );

    const add = (id: string, reportedAt: string, description: string) =>
      db.execute(
        `INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, created_at, updated_at)
        VALUES ($1, $2, 'unavailable', 'unusable', $3, $4, 'x', 'x')`,
        [id, WESER, description, reportedAt]
      );
    await add("older", "2020-01-01T08:00", "Plus ancien");
    expect((await exportStatus()).Comment).toBe(
      "Rollsitz defekt – in Reparatur bis Ende Oktober"
    );
    await add("newer", "2030-01-01T08:00", "Plus récent");
    expect((await exportStatus()).Comment).toBe("Plus récent");
    // A newer entry without reason does not hide the older reasons.
    await add("newest", "2031-01-01T08:00", "");
    expect((await exportStatus()).Comment).toBe("Plus récent");
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

  test("an imported outing moved to another year goes to that year's logbook", async () => {
    const db = await importProject();
    const [moved] = await db.select<{ id: string; record_key: string }[]>(
      `SELECT o.id, r.record_key FROM outing o
      JOIN efa_record r ON r.rb_table = 'outing' AND r.rb_id = o.id
      WHERE r.object_name = '2025' AND o.end_date_time IS NOT NULL LIMIT 1`
    );
    await db.execute(
      "UPDATE outing SET start_date_time = '2026-02-03T10:00', end_date_time = '2026-02-03T11:00' WHERE id = $1",
      [moved.id]
    );

    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });

    const entriesOn = (name: string) =>
      findObjects(project, "efa2logbook").find((l) => l.name === name)!.records;
    expect(entriesOn("2025").some((entry) => entry.Date === "03.02.2026")).toBe(
      false
    );
    const entry = entriesOn("2026").find((e) => e.Date === "03.02.2026");
    expect(entry).toBeDefined();
    const entryIds = entriesOn("2026").map((e) => e.EntryId);
    expect(new Set(entryIds).size).toBe(entryIds.length);
  });

  const unknownBoatOuting = deriveEfa2Id("outing:2026:25");
  const unknownBoatStatus = (project: Parameters<typeof findObject>[0]) =>
    findObject(project, "efa2boatstatus")!.records.find(
      (s) => s.UnknownBoat === "true"
    )!;

  test("an ongoing outing on a boat efa only knew by name keeps its status when moved to another year", async () => {
    const db = await importProject();
    await db.execute(
      "UPDATE outing SET start_date_time = '2025-10-19T10:15' WHERE id = $1",
      [unknownBoatOuting]
    );

    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });

    const entry = findObjects(project, "efa2logbook")
      .find((l) => l.name === "2025")!
      .records.find((e) => e.BoatName === "Gastboot Wanderer")!;
    expect(entry.Open).toBe("true");
    expect(unknownBoatStatus(project)).toMatchObject({
      Logbook: "2025",
      EntryNo: entry.EntryId,
      BoatText: "Gastboot Wanderer",
    });
  });

  test("an outing on a boat efa only knew by name, corrected where efa's on-the-water text speaks of, loses it", async () => {
    const db = await importProject();
    const statusOf = async () =>
      unknownBoatStatus(
        (await buildEfa2Export(db, { labels: exportLabels, now })).project
      );
    expect((await statusOf()).Comment).toBeDefined();

    await db.execute("UPDATE outing SET comment = 'Corrigée' WHERE id = $1", [
      unknownBoatOuting,
    ]);
    expect((await statusOf()).Comment).toBeDefined();

    await db.execute("UPDATE outing SET route_id = NULL WHERE id = $1", [
      unknownBoatOuting,
    ]);

    const status = await statusOf();
    expect(status).toMatchObject({
      Logbook: "2026",
      EntryNo: "25",
      CurrentStatus: "ONTHEWATER",
    });
    expect(status.Comment).toBeUndefined();
  });

  test("an outing with another destination loses the old destination's waters", async () => {
    const db = await importProject();
    const withWaters = deriveEfa2Id("outing:2026:19");
    await db.execute(
      "UPDATE efa_record SET fields = json_set(fields, '$.DestinationVariantName', 'Variante') WHERE rb_table = 'outing' AND rb_id = $1",
      [withWaters]
    );
    const entryOf = async () =>
      findObjects(
        (await buildEfa2Export(db, { labels: exportLabels, now })).project,
        "efa2logbook"
      )
        .flatMap((l) => l.records)
        .find((e) => e.Date === "30.03.2026" && e.EntryId === "19")!;
    // Another comment leaves the destination alone.
    await db.execute("UPDATE outing SET comment = 'Corrigée' WHERE id = $1", [
      withWaters,
    ]);
    expect(await entryOf()).toMatchObject({
      DestinationVariantName: "Variante",
      WatersNameList: "Altrhein;Restrhein;<Kanal>;~",
    });

    const [other] = await db.select<{ id: string }[]>(
      "SELECT id FROM route WHERE id NOT IN (SELECT route_id FROM outing WHERE id = $1) LIMIT 1",
      [withWaters]
    );
    await db.execute("UPDATE outing SET route_id = $1 WHERE id = $2", [
      other.id,
      withWaters,
    ]);

    const entry = await entryOf();
    expect(entry.DestinationId).toBe(other.id);
    expect(entry.DestinationVariantName).toBeUndefined();
    expect(entry.WatersIdList).toBeUndefined();
    expect(entry.WatersNameList).toBeUndefined();
  });

  test("a route renamed or added since the import leaves an entry's waters alone", async () => {
    const db = await importProject();
    const withWaters = deriveEfa2Id("outing:2026:19");
    await db.execute(
      "UPDATE efa_record SET fields = json_set(fields, '$.DestinationVariantName', 'Variante') WHERE rb_table = 'outing' AND rb_id = $1",
      [withWaters]
    );
    await db.execute(
      "UPDATE route SET name = 'Renommée' WHERE id = (SELECT route_id FROM outing WHERE id = $1)",
      [withWaters]
    );
    // A route named like every destination efa typed.
    const typed = await db.select<{ name: string }[]>(
      "SELECT DISTINCT json_extract(fields, '$.DestinationName') AS name FROM efa_record WHERE rb_table = 'outing' AND json_extract(fields, '$.DestinationName') IS NOT NULL"
    );
    for (const [index, { name }] of typed.entries()) {
      await db.execute(
        "INSERT INTO route (id, name, created_at, updated_at) VALUES ($1, $2, '2026-10-19', '2026-10-19')",
        [`new-route-${index}`, name]
      );
    }

    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });

    const entries = findObjects(project, "efa2logbook").flatMap(
      (l) => l.records
    );
    expect(
      entries.find((e) => e.Date === "30.03.2026" && e.EntryId === "19")
    ).toMatchObject({
      DestinationVariantName: "Variante",
      WatersNameList: "Altrhein;Restrhein;<Kanal>;~",
    });
    const rawWaters = findObjects(readFixtureProject(), "efa2logbook")
      .flatMap((l) => l.records)
      .filter((e) => e.WatersIdList || e.WatersNameList).length;
    expect(
      entries.filter((e) => e.WatersIdList || e.WatersNameList)
    ).toHaveLength(rawWaters);
  });

  test("an untouched entry dated outside its logbook stays in it", async () => {
    const db = await importProject();
    const outing = deriveEfa2Id("outing:2026:19");
    await db.execute(
      "UPDATE efa_record SET fields = json_set(fields, '$.Date', '31.12.2025') WHERE rb_table = 'outing' AND rb_id = $1",
      [outing]
    );
    await db.execute(
      "UPDATE outing SET start_date_time = '2025-12-31' || substr(start_date_time, 11), end_date_time = '2025-12-31' || substr(end_date_time, 11) WHERE id = $1",
      [outing]
    );

    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });

    const entry = findObjects(project, "efa2logbook")
      .find((l) => l.name === "2026")!
      .records.find((e) => e.EntryId === "19")!;
    expect(entry.Date).toBe("31.12.2025");
    expect(entry.SessionGroupId).toBeDefined();
  });

  test("an outing without destination keeps its waters", async () => {
    const db = await importProject();
    const [noRoute] = await db.select<{ id: string; record_key: string }[]>(
      `SELECT o.id, r.record_key FROM outing o
      JOIN efa_record r ON r.rb_table = 'outing' AND r.rb_id = o.id
      WHERE o.route_id IS NULL AND o.end_date_time IS NOT NULL LIMIT 1`
    );
    await db.execute(
      "UPDATE efa_record SET fields = json_set(fields, '$.WatersNameList', 'Altrhein') WHERE rb_table = 'outing' AND rb_id = $1",
      [noRoute.id]
    );

    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });

    const entries = findObjects(project, "efa2logbook").flatMap(
      (l) => l.records
    );
    expect(entries.filter((e) => e.WatersNameList === "Altrhein")).toHaveLength(
      1
    );
  });

  test("an uncorrected outing on the water keeps efa's on-the-water text when efa typed a name", async () => {
    const db = await importProject();
    const [ongoing] = await db.select<{ id: string; boat_id: string }[]>(
      "SELECT o.id, o.boat_id FROM outing o JOIN efa_record r ON r.rb_table = 'outing' AND r.rb_id = o.id WHERE o.end_date_time IS NULL AND json_extract(r.fields, '$.BoatId') IS NOT NULL LIMIT 1"
    );
    // A name typed in efa is a guest record after the import, written back
    // as an id: the entry differs from efa's without any correction.
    await db.execute(
      "UPDATE efa_record SET fields = json_set(fields, '$.Crew9Name', 'Gast') WHERE rb_table = 'outing' AND rb_id = $1",
      [ongoing.id]
    );

    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });

    const status = findObject(project, "efa2boatstatus")!.records.find(
      (s) => s.BoatId === ongoing.boat_id
    )!;
    expect(status.CurrentStatus).toBe("ONTHEWATER");
    expect(status.Comment).toBeDefined();
  });

  test("an outing moved to another logbook leaves its session group", async () => {
    const db = await importProject();
    const grouped = deriveEfa2Id("outing:2026:19");
    const groupOf = async () => {
      const { project } = await buildEfa2Export(db, {
        labels: exportLabels,
        now,
      });
      return findObjects(project, "efa2logbook")
        .flatMap((l) => l.records)
        .find((e) => e.Distance === "85 km")!;
    };
    expect((await groupOf()).SessionGroupId).toBeDefined();

    await db.execute(
      "UPDATE outing SET start_date_time = '2025-03-30T08:45', end_date_time = '2025-03-30T09:15' WHERE id = $1",
      [grouped]
    );

    const moved = await groupOf();
    expect(moved.Date).toBe("30.03.2025");
    expect(moved.SessionGroupId).toBeUndefined();
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
      {
        Type: "Logbook",
        Name: "2027",
        StartDate: "01.01.2027",
        EndDate: "31.12.2027",
      },
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
    expect(findObjects(exported, "efa2clubwork").map((c) => c.name)).toContain(
      "Vereinsarbeit2027"
    );
    expect(
      exported.projectRecords.find((r) => r.Type === "Boathouse")
    ).toMatchObject({
      CurrentLogbookEfaBase: "2026",
      CurrentLogbookEfaBoathouse: "2026",
    });
  });

  test("a boat put back in service is available again, its damage stays open", async () => {
    const db = await importProject();
    await db.execute(
      "UPDATE boat_damage SET fixed_at = '2026-10-19T08:00' WHERE kind = 'unavailable' AND boat_id = $1",
      [WESER]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const status = findObject(project, "efa2boatstatus")!.records.find(
      (s) => s.BoatId === WESER
    )!;
    expect(status).toMatchObject({
      BaseStatus: "AVAILABLE",
      CurrentStatus: "AVAILABLE",
      ChangeCount: "3",
    });
    expect(status.Comment).toBeUndefined();
    const damage = findObject(project, "efa2boatdamages")!.records.find(
      (d) => d.BoatId === WESER
    )!;
    expect(damage.Fixed).toBeUndefined();
  });

  test("unavailable entries are not exported as damages", async () => {
    const db = await importProject();
    await insertUnavailable(db, NECKAR, "Au chantier");
    const { project, report } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(findObject(project, "efa2boatdamages")!.records).toHaveLength(3);
    expect(report.damagesExported).toBe(3);
  });

  test("a damage repaired in Rowing Beacon is fixed in efa", async () => {
    const original = readFixtureProject();
    const db = await importProject();
    const rower = findObject(original, "efa2persons")!.records[0].Id;
    await db.execute(
      `UPDATE boat_damage SET fixed_at = '2026-10-19T08:30', fixed_by_rower_id = $2,
        repair_note = 'Neuer Rollsitz', repair_cost = 120.5, updated_at = '2026-10-19T08:31:00.000Z'
      WHERE id = $1`,
      [deriveEfa2Id(`damage:${WESER}:2`), rower]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const before = findObject(original, "efa2boatdamages")!.records;
    const after = findObject(project, "efa2boatdamages")!.records;
    const repaired = after.find((d) => d.BoatId === WESER)!;
    expect(repaired).toEqual({
      ...before.find((d) => d.BoatId === WESER),
      Fixed: "true",
      FixDate: "19.10.2026",
      FixTime: "08:30:00",
      FixedByPersonId: rower,
      Notes: "Neuer Rollsitz",
      RepairCosts: "120.5",
      ChangeCount: "2",
      LastModified: String(Date.parse("2026-10-19T08:31:00.000Z")),
    });
    // The other reports are the very same records.
    for (const damage of before.filter((d) => d.BoatId !== WESER)) {
      expect(after).toContainEqual(damage);
    }
  });

  test("a damage reopened in Rowing Beacon loses its repair in efa", async () => {
    const original = readFixtureProject();
    const db = await importProject();
    await db.execute(
      "UPDATE boat_damage SET fixed_at = NULL, fixed_by_rower_id = NULL, repair_note = NULL, repair_cost = NULL WHERE id = $1",
      [deriveEfa2Id(`damage:${WIKING}:1`)]
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const reopened = findObject(project, "efa2boatdamages")!.records.find(
      (d) => d.BoatId === WIKING
    )!;
    const raw = findObject(original, "efa2boatdamages")!.records.find(
      (d) => d.BoatId === WIKING
    )!;
    expect(Object.keys(reopened).sort()).toEqual(
      Object.keys(raw)
        .filter(
          (key) =>
            !["Fixed", "FixDate", "FixTime", "FixedByPersonId", "Notes", "RepairCosts"].includes(key)
        )
        .sort()
    );
    expect(reopened.ChangeCount).toBe("2");
  });

  const exportedDamage = async (
    db: Awaited<ReturnType<typeof freshDb>>,
    boatId: string,
    exportNow = now
  ) =>
    findObject(
      (await buildEfa2Export(db, { labels: exportLabels, now: exportNow }))
        .project,
      "efa2boatdamages"
    )!.records.find((d) => d.BoatId === boatId)!;
  const rawDamageOf = (
    project: ReturnType<typeof readFixtureProject>,
    boatId: string
  ) =>
    findObject(project, "efa2boatdamages")!.records.find(
      (d) => d.BoatId === boatId
    )!;

  test("a person reference to a merged rower is not a change", async () => {
    const original = readFixtureProject();
    const raw = rawDamageOf(original, WIKING);
    const db = await importProject();
    const [target] = await db.select<{ id: string }[]>(
      "SELECT id FROM rower WHERE id NOT IN ($1, $2) LIMIT 1",
      [raw.ReportedByPersonId, raw.FixedByPersonId]
    );
    await db.execute(
      "UPDATE rower SET merged_into_id = $1 WHERE id IN ($2, $3)",
      [target.id, raw.ReportedByPersonId, raw.FixedByPersonId]
    );
    expect(await exportedDamage(db, WIKING)).toEqual(raw);
  });

  test("a reporter set in Rowing Beacon replaces the name efa had", async () => {
    const original = readFixtureProject();
    const raw = rawDamageOf(original, WESER);
    expect(raw.ReportedByPersonName).toBeDefined();
    const db = await importProject();
    const rower = findObject(original, "efa2persons")!.records[0].Id;
    await db.execute(
      "UPDATE boat_damage SET reported_by_rower_id = $2 WHERE id = $1",
      [deriveEfa2Id(`damage:${WESER}:2`), rower]
    );
    const damage = await exportedDamage(db, WESER);
    expect(damage.ReportedByPersonId).toBe(rower);
    expect(damage.ReportedByPersonName).toBeUndefined();
    expect(damage.ChangeCount).toBe("2");
  });

  test("a fixer set or removed in Rowing Beacon replaces the name efa had", async () => {
    const original = readFixtureProject();
    const raw = rawDamageOf(original, WIKING);
    delete raw.FixedByPersonId;
    raw.FixedByPersonName = "Max Muster";
    const rower = findObject(original, "efa2persons")!.records[0].Id;

    const fixed = await importProject(structuredClone(original));
    await fixed.execute(
      "UPDATE boat_damage SET fixed_by_rower_id = $2 WHERE id = $1",
      [deriveEfa2Id(`damage:${WIKING}:1`), rower]
    );
    const withFixer = await exportedDamage(fixed, WIKING);
    expect(withFixer.FixedByPersonId).toBe(rower);
    expect(withFixer.FixedByPersonName).toBeUndefined();

    const reopened = await importProject(structuredClone(original));
    await reopened.execute(
      "UPDATE boat_damage SET fixed_at = NULL, repair_note = NULL, repair_cost = NULL WHERE id = $1",
      [deriveEfa2Id(`damage:${WIKING}:1`)]
    );
    const damage = await exportedDamage(reopened, WIKING);
    for (const key of [
      "Fixed",
      "FixDate",
      "FixTime",
      "FixedByPersonId",
      "FixedByPersonName",
    ]) {
      expect(damage[key]).toBeUndefined();
    }
  });

  test("a damage without any date comes back unchanged whenever it is exported", async () => {
    const original = readFixtureProject();
    for (const key of ["ReportDate", "ReportTime", "LastModified"]) {
      delete rawDamageOf(original, WESER)[key];
    }
    for (const key of ["FixDate", "FixTime", "LastModified"]) {
      delete rawDamageOf(original, WIKING)[key];
    }
    const db = await importProject(structuredClone(original));
    const later = new Date("2026-11-02T09:30:00Z");
    expect(await exportedDamage(db, WESER, later)).toEqual(
      rawDamageOf(original, WESER)
    );
    expect(await exportedDamage(db, WIKING, later)).toEqual(
      rawDamageOf(original, WIKING)
    );

    // Reopening still removes the fix.
    await db.execute("UPDATE boat_damage SET fixed_at = NULL WHERE id = $1", [
      deriveEfa2Id(`damage:${WIKING}:1`),
    ]);
    const reopened = await exportedDamage(db, WIKING, later);
    expect(reopened.Fixed).toBeUndefined();
    expect(reopened.ChangeCount).toBe("2");
  });

  test("an incident turned into a damage is not counted as left out", async () => {
    const db = await importProject();
    const insertIncident = (id: string) =>
      db.execute(
        "INSERT INTO incident (id, boat_id, message, occurred_at, created_at) VALUES ($1, $2, 'Choc', '2026-10-19T08:00', 'x')",
        [id, NECKAR]
      );
    await insertIncident("left-out");
    await insertIncident("turned");
    await db.execute(
      `INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, incident_id, created_at, updated_at)
      VALUES ('from-incident', $1, 'damage', 'usable', 'Choc', '2026-10-19T08:00', 'turned', 'x', '2026-10-19T08:00:00.000Z')`,
      [NECKAR]
    );
    const { report } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(report.incidentsNotExported).toBe(1);
  });

  test("a damage reported in Rowing Beacon gets the next numbers and moves the counter", async () => {
    const db = await importProject();
    const [{ rb_id: outingId, fields }] = await db.select<
      { rb_id: string; fields: string }[]
    >(
      "SELECT rb_id, fields FROM efa_record WHERE rb_table = 'outing' ORDER BY record_key LIMIT 1"
    );
    const insert = (
      id: string,
      reportedAt: string,
      extra: Record<string, string | number | null> = {}
    ) =>
      db.execute(
        `INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at,
          reported_by_rower_id, outing_id, fixed_at, repair_cost, created_at, updated_at)
        VALUES ($1, $2, 'damage', $3, $4, $5, $6, $7, $8, $9, '2026-10-19T09:00:00.000Z', '2026-10-19T09:00:00.000Z')`,
        [
          id,
          NECKAR,
          extra.severity ?? "limited",
          extra.description ?? "Dolle verbogen",
          reportedAt,
          extra.rower ?? null,
          extra.outing ?? null,
          extra.fixedAt ?? null,
          extra.cost ?? null,
        ]
      );
    const rower = (
      await db.select<{ id: string }[]>("SELECT id FROM rower LIMIT 1")
    )[0].id;
    await anonymizeRower(db, rower, "Anonyme");
    // Inserted out of order: the numbers follow the date of the report.
    await insert("zz-late", "2026-10-18T16:45", { rower, outing: outingId });
    await insert("aa-early", "2026-10-17T10:00", {
      severity: "unusable",
      fixedAt: "2026-10-18T09:15",
      cost: 8,
    });

    const { project, report } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    const damages = findObject(project, "efa2boatdamages")!.records;
    expect(report.damagesExported).toBe(5);
    expect(damages).toHaveLength(5);
    expect(damages.find((d) => d.Damage === "4")).toEqual({
      BoatId: NECKAR,
      Damage: "4",
      Description: "Dolle verbogen",
      Severity: "NOTUSEABLE",
      Fixed: "true",
      ReportDate: "17.10.2026",
      ReportTime: "10:00:00",
      FixDate: "18.10.2026",
      FixTime: "09:15:00",
      RepairCosts: "8",
      ChangeCount: "1",
      LastModified: String(Date.parse("2026-10-19T09:00:00.000Z")),
    });
    const late = damages.find((d) => d.Damage === "5")!;
    expect(late).toMatchObject({
      Severity: "LIMITEDUSEABLE",
      ReportDate: "18.10.2026",
      ReportTime: "16:45:00",
      ReportedByPersonId: rower,
      LogbookText: `#${(JSON.parse(fields) as { EntryId: string }).EntryId}`,
    });
    expect(Object.keys(late).some((key) => key.endsWith("Name"))).toBe(false);

    // efa's counter holds the last number it issued.
    const counter = findObject(project, "efa2autoincrement")!.records.find(
      (r) => r.Sequence === "efa2boatdamages"
    )!;
    expect(counter).toMatchObject({ IntValue: "5", ChangeCount: "4" });

    // The same data gives the same numbers on the next export.
    const again = await buildEfa2Export(db, { labels: exportLabels, now });
    expect(findObject(again.project, "efa2boatdamages")!.records).toEqual(
      damages
    );
  });

  test("damage numbers start after the counter even when it is ahead of the reports", async () => {
    const project = readFixtureProject();
    findObject(project, "efa2autoincrement")!.records.find(
      (r) => r.Sequence === "efa2boatdamages"
    )!.IntValue = "7";
    const db = await importProject(project);
    await db.execute(
      `INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, created_at, updated_at)
      VALUES ('new', $1, 'damage', 'usable', 'Kratzer', '2026-10-19T08:00', 'x', '2026-10-19T08:00:00.000Z')`,
      [NECKAR]
    );
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(
      findObject(exported, "efa2boatdamages")!.records.find(
        (d) => d.Description === "Kratzer"
      )!.Damage
    ).toBe("8");
    expect(
      findObject(exported, "efa2autoincrement")!.records.find(
        (r) => r.Sequence === "efa2boatdamages"
      )!.IntValue
    ).toBe("8");
  });

  test("a backdated damage entered later does not renumber earlier ones", async () => {
    const db = await importProject();
    const add = (id: string, reportedAt: string, createdAt: string) =>
      db.execute(
        `INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, created_at, updated_at)
        VALUES ($1, $2, 'damage', 'usable', $1, $3, $4, $4)`,
        [id, NECKAR, reportedAt, createdAt]
      );
    const numberOf = async (description: string) =>
      findObject(
        (await buildEfa2Export(db, { labels: exportLabels, now })).project,
        "efa2boatdamages"
      )!.records.find((d) => d.Description === description)!.Damage;
    await add("first", "2026-10-18T08:00", "2026-10-18T08:00:00.000Z");
    const before = await numberOf("first");

    await add("backdated", "2026-10-01T08:00", "2026-10-19T08:00:00.000Z");

    expect(await numberOf("first")).toBe(before);
    expect(Number(await numberOf("backdated"))).toBe(Number(before) + 1);
  });

  test("a club that never used efa gets a damage counter", async () => {
    const db = await freshDb();
    await db.execute(
      "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'Hirondelle', 'x', 'x')"
    );
    await db.execute(
      `INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, created_at, updated_at)
      VALUES ('d1', '11111111-1111-4111-8111-111111111111', 'damage', 'unusable', 'Coque fendue', '2026-10-19T08:00', 'x', '2026-10-19T08:00:00.000Z')`
    );
    const { project } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(findObject(project, "efa2boatdamages")!.records).toMatchObject([
      { Damage: "1", Severity: "NOTUSEABLE", Description: "Coque fendue" },
    ]);
    expect(findObject(project, "efa2autoincrement")!.records).toMatchObject([
      { Sequence: "efa2boatdamages", IntValue: "1", ChangeCount: "1" },
    ]);
  });
});
