import { describe, expect, test } from "vitest";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import {
  deleteReservation,
  saveReservation,
} from "../database/repositories/reservation.repository";
import { BoatReservation } from "../business/reservation.rules";
import {
  KATRIN,
  MAIN,
  MOSEL,
  NECKAR,
  NIKLAS,
  projectWithReservations,
  sampleReservations,
  unreadableReservations,
} from "./__fixtures__/reservations";
import { buildEfa2Export } from "./buildEfa2Export";
import { Efa2Project, findObject } from "./efa2Project";
import { Efa2Fields } from "./efa2Xml";
import { deriveEfa2Id, planEfa2Import } from "./planEfa2Import";
import { runEfa2Import } from "./runEfa2Import";

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

const importProject = async (project: Efa2Project) => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  await runEfa2Import(db, structuredClone(project), {
    backup: () => Promise.resolve(),
    labels: importLabels,
    now,
  });
  return db;
};

const exportReservations = async (
  db: Awaited<ReturnType<typeof importProject>>
) => {
  const { project } = await buildEfa2Export(db, { labels: exportLabels, now });
  return {
    project,
    reservations: findObject(project, "efa2boatreservations")!.records,
    sequence: findObject(project, "efa2autoincrement")?.records.find(
      (record) => record.Sequence === "efa2boatreservations"
    ),
  };
};

const reservation = (
  overrides: Partial<BoatReservation> & Pick<BoatReservation, "id">
): BoatReservation => ({
  boatId: MOSEL,
  recurrence: "once",
  startDate: "2026-11-07",
  endDate: "2026-11-07",
  dayOfWeek: null,
  startTime: "09:00",
  endTime: "11:30",
  rowerId: null,
  personName: null,
  reason: null,
  contact: null,
  ...overrides,
});

interface Row {
  id: string;
  boat_id: string;
  recurrence: string;
  start_date: string | null;
  end_date: string | null;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  rower_id: string | null;
  person_name: string | null;
  reason: string | null;
  contact: string | null;
  efa_number: number | null;
}

describe("import of efa2 reservations", () => {
  test("turns the three types into reservations", async () => {
    const db = await importProject(projectWithReservations());
    const rows = await db.select<Row[]>("SELECT * FROM boat_reservation");
    expect(rows).toHaveLength(3);
    const byNumber = (n: number) => rows.find((r) => r.efa_number === n)!;

    expect(byNumber(1)).toMatchObject({
      id: deriveEfa2Id(`reservation:${MOSEL}:1`),
      boat_id: MOSEL,
      recurrence: "once",
      start_date: "2026-10-24",
      end_date: "2026-10-25",
      day_of_week: null,
      start_time: "09:00",
      end_time: "16:30",
      rower_id: NIKLAS,
      person_name: null,
      reason: "Herbstregatta Heilbronn",
      contact: "0621 123456",
    });
    // WEEKLY: a day and times, no dates.
    expect(byNumber(2)).toMatchObject({
      boat_id: MAIN,
      recurrence: "weekly",
      start_date: null,
      end_date: null,
      day_of_week: 1,
      start_time: "18:00",
      end_time: "20:00",
      rower_id: KATRIN,
      reason: "Montagsvierer",
      contact: null,
    });
    // WEEKLY_LIMITED: weekly between two dates, held by a free name.
    expect(byNumber(3)).toMatchObject({
      boat_id: NECKAR,
      recurrence: "weekly",
      start_date: "2026-04-01",
      end_date: "2026-10-31",
      day_of_week: 3,
      rower_id: null,
      person_name: "Trainingsgruppe Junioren",
    });
  });

  test("links each reservation to its efa record and counts it", async () => {
    const project = projectWithReservations();
    const plan = planEfa2Import({ project, labels: importLabels, now });
    expect(plan.report.reservations).toBe(3);
    expect(plan.expected.boat_reservation).toBe(3);
    expect(plan.report.keptWithoutScreen.efa2boatreservations).toBeUndefined();

    const db = await importProject(project);
    const linked = await db.select<{ rb_id: string; fields: string }[]>(
      "SELECT rb_id, fields FROM efa_record WHERE rb_table = 'boat_reservation'"
    );
    expect(linked).toHaveLength(3);
    for (const { rb_id, fields } of linked) {
      const record = JSON.parse(fields) as Efa2Fields;
      expect(rb_id).toBe(
        deriveEfa2Id(`reservation:${record.BoatId}:${record.Reservation}`)
      );
    }
  });

  test("a holder is a rower by id, else a free name, never a new guest", async () => {
    const reservations = [
      ...sampleReservations(),
      // A person efa no longer has: the name stays.
      {
        BoatId: MOSEL,
        Reservation: "4",
        Type: "ONETIME",
        DateFrom: "01.11.2026",
        DateTo: "01.11.2026",
        TimeFrom: "10:00:00",
        TimeTo: "12:00:00",
        PersonId: "00000000-0000-4000-8000-0000000000bb",
        PersonName: "Gerd Gast",
      },
      // Nobody: the reservation is still imported.
      {
        BoatId: MOSEL,
        Reservation: "5",
        Type: "ONETIME",
        DateFrom: "02.11.2026",
        DateTo: "02.11.2026",
        TimeFrom: "10:00:00",
        TimeTo: "12:00:00",
      },
    ];
    const withoutReservations = await importProject(
      projectWithReservations([])
    );
    const [{ before }] = await withoutReservations.select<{ before: number }[]>(
      "SELECT COUNT(*) AS before FROM rower"
    );
    const db = await importProject(projectWithReservations(reservations));
    const [{ after }] = await db.select<{ after: number }[]>(
      "SELECT COUNT(*) AS after FROM rower"
    );
    expect(Number(after)).toBe(Number(before));

    const rows = await db.select<Row[]>("SELECT * FROM boat_reservation");
    expect(rows.find((r) => r.efa_number === 4)).toMatchObject({
      rower_id: null,
      person_name: "Gerd Gast",
    });
    expect(rows.find((r) => r.efa_number === 5)).toMatchObject({
      rower_id: null,
      person_name: null,
    });
  });

  test("records that cannot be read stay in efa_record, unlinked", async () => {
    const project = projectWithReservations([
      ...sampleReservations(),
      ...unreadableReservations(),
    ]);
    const plan = planEfa2Import({ project, labels: importLabels, now });
    expect(plan.report.reservations).toBe(3);
    expect(plan.report.keptWithoutScreen.efa2boatreservations).toBe(3);

    const db = await importProject(project);
    const [{ rows }] = await db.select<{ rows: number }[]>(
      "SELECT COUNT(*) AS rows FROM boat_reservation"
    );
    expect(Number(rows)).toBe(3);
    const kept = await db.select<{ rb_table: string | null }[]>(
      "SELECT rb_table FROM efa_record WHERE object_type = 'efa2boatreservations'"
    );
    expect(kept).toHaveLength(6);
    expect(kept.filter((row) => row.rb_table === null)).toHaveLength(3);
  });

  test("a schedule the app cannot show (overnight slot, 24:00) stays as an efa record", () => {
    const project = projectWithReservations([
      ...sampleReservations(),
      {
        BoatId: MOSEL,
        Reservation: "7",
        Type: "WEEKLY",
        DayOfWeek: "FRIDAY",
        TimeFrom: "22:00:00",
        TimeTo: "06:00:00",
        PersonName: "Nachtfahrt",
      },
      {
        BoatId: NECKAR,
        Reservation: "8",
        Type: "ONETIME",
        DateFrom: "01.11.2026",
        DateTo: "01.11.2026",
        TimeFrom: "10:00:00",
        TimeTo: "24:00:00",
        PersonName: "Bis Mitternacht",
      },
    ]);
    const plan = planEfa2Import({ project, labels: importLabels, now });
    expect(plan.report.reservations).toBe(3);
    expect(plan.report.keptWithoutScreen.efa2boatreservations).toBe(2);
  });

  test("past reservations are imported, the last of a repeated key wins", async () => {
    const past = {
      BoatId: MOSEL,
      Reservation: "7",
      Type: "ONETIME",
      DateFrom: "10.03.2025",
      DateTo: "10.03.2025",
      TimeFrom: "08:00:00",
      TimeTo: "09:00:00",
      PersonName: "Avant",
    };
    const db = await importProject(
      projectWithReservations([
        past,
        { ...past, PersonName: "Après", TimeTo: "10:00:00" },
      ])
    );
    const rows = await db.select<Row[]>("SELECT * FROM boat_reservation");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      start_date: "2025-03-10",
      end_time: "10:00",
      person_name: "Après",
    });
  });

  test("a weekly reservation with a far date has no bound on that side", async () => {
    const db = await importProject(
      projectWithReservations([
        {
          BoatId: MOSEL,
          Reservation: "1",
          Type: "WEEKLY_LIMITED",
          DateFrom: "01.01.1970",
          DateTo: "31.12.2026",
          DayOfWeek: "SUNDAY",
          TimeFrom: "09:00:00",
          TimeTo: "10:00:00",
        },
      ])
    );
    const [row] = await db.select<Row[]>("SELECT * FROM boat_reservation");
    expect(row).toMatchObject({
      start_date: null,
      end_date: "2026-12-31",
      day_of_week: 7,
    });
  });

  test("turns the Reservations module on only when one was imported", async () => {
    const modulesOf = (project: Efa2Project) =>
      planEfa2Import({ project, labels: importLabels, now }).modules;
    expect(modulesOf(projectWithReservations())).toContain("reservations");
    expect(modulesOf(projectWithReservations([]))).not.toContain(
      "reservations"
    );
    // Nothing readable: the module stays off.
    expect(
      modulesOf(projectWithReservations(unreadableReservations()))
    ).not.toContain("reservations");

    const db = await importProject(projectWithReservations());
    const [{ value }] = await db.select<{ value: string }[]>(
      "SELECT value FROM setting WHERE key = 'modules.enabled'"
    );
    expect(JSON.parse(value)).toContain("reservations");
  });
});

describe("export of efa2 reservations", () => {
  test("an unchanged club gets its reservation records back identical", async () => {
    const input = [...sampleReservations(), ...unreadableReservations()];
    const db = await importProject(projectWithReservations(input));
    const { reservations, sequence } = await exportReservations(db);
    expect(reservations).toEqual(input);
    // The counter (6, above the unreadable records) is not touched.
    expect(sequence).toMatchObject({ IntValue: "6", ChangeCount: "3" });
  });

  test("the counter record comes back untouched when nothing is above it", async () => {
    const project = projectWithReservations();
    const original = structuredClone(
      findObject(project, "efa2autoincrement")!.records
    );
    const db = await importProject(project);
    const { project: exported } = await buildEfa2Export(db, {
      labels: exportLabels,
      now,
    });
    expect(findObject(exported, "efa2autoincrement")!.records).toEqual(
      original
    );
  });

  test("reservations made in Rowing Beacon are written as one-time and weekly", async () => {
    const db = await importProject(projectWithReservations());
    await saveReservation(
      db,
      reservation({
        id: "rb-once",
        boatId: MOSEL,
        startDate: "2026-11-07",
        endDate: "2026-11-08",
        startTime: "9:00",
        endTime: "11:30",
        rowerId: NIKLAS,
        personName: "ignored",
        reason: "Régate",
        contact: "06 00 00 00 00",
      })
    );
    await saveReservation(
      db,
      reservation({
        id: "rb-weekly",
        boatId: MAIN,
        recurrence: "weekly",
        startDate: null,
        endDate: null,
        dayOfWeek: 7,
        startTime: "07:30",
        endTime: "09:00",
        personName: "Groupe loisirs",
      })
    );
    await saveReservation(
      db,
      reservation({
        id: "rb-limited",
        boatId: NECKAR,
        recurrence: "weekly",
        startDate: "2026-12-01",
        endDate: "2027-03-31",
        dayOfWeek: 2,
        startTime: "12:00",
        endTime: "13:00",
      })
    );

    const { reservations, sequence } = await exportReservations(db);
    expect(reservations).toHaveLength(6);
    // efa's three first, then ours in the order they were numbered.
    expect(reservations.slice(0, 3)).toEqual(sampleReservations());

    const [once, weekly, limited] = reservations.slice(3);
    expect(once).toEqual({
      BoatId: MOSEL,
      Reservation: "4",
      Type: "ONETIME",
      DateFrom: "07.11.2026",
      DateTo: "08.11.2026",
      TimeFrom: "09:00:00",
      TimeTo: "11:30:00",
      PersonId: NIKLAS,
      Reason: "Régate",
      Contact: "06 00 00 00 00",
      ChangeCount: "1",
      LastModified: expect.any(String) as string,
    });
    expect(weekly).toMatchObject({
      BoatId: MAIN,
      Reservation: "5",
      Type: "WEEKLY",
      DayOfWeek: "SUNDAY",
      TimeFrom: "07:30:00",
      TimeTo: "09:00:00",
      PersonName: "Groupe loisirs",
    });
    expect(weekly.PersonId).toBeUndefined();
    expect(weekly.DateFrom).toBeUndefined();
    expect(weekly.DateTo).toBeUndefined();
    expect(limited).toMatchObject({
      Reservation: "6",
      Type: "WEEKLY_LIMITED",
      DateFrom: "01.12.2026",
      DateTo: "31.03.2027",
      DayOfWeek: "TUESDAY",
    });

    // efa must not hand out 4, 5 or 6 again.
    expect(sequence).toMatchObject({ IntValue: "6", ChangeCount: "4" });
  });

  test("a weekly reservation with one bound gets a far date on the other side", async () => {
    const db = await importProject(projectWithReservations());
    await saveReservation(
      db,
      reservation({
        id: "since",
        recurrence: "weekly",
        startDate: "2026-11-01",
        endDate: null,
        dayOfWeek: 4,
      })
    );
    await saveReservation(
      db,
      reservation({
        id: "until",
        recurrence: "weekly",
        startDate: null,
        endDate: "2026-12-31",
        dayOfWeek: 5,
      })
    );
    const { project, reservations } = await exportReservations(db);
    expect(reservations.find((r) => r.Reservation === "4")).toMatchObject({
      Type: "WEEKLY_LIMITED",
      DateFrom: "01.11.2026",
      DateTo: "31.12.2999",
      DayOfWeek: "THURSDAY",
    });
    expect(reservations.find((r) => r.Reservation === "5")).toMatchObject({
      Type: "WEEKLY_LIMITED",
      DateFrom: "01.01.1970",
      DateTo: "31.12.2026",
      DayOfWeek: "FRIDAY",
    });

    // Imported back, the far dates are no bound again.
    const again = await importProject(project);
    const rows = await again.select<Row[]>(
      "SELECT * FROM boat_reservation WHERE efa_number IN (4, 5) ORDER BY efa_number"
    );
    expect(rows.map((r) => [r.start_date, r.end_date])).toEqual([
      ["2026-11-01", null],
      [null, "2026-12-31"],
    ]);
  });

  test("an edited reservation keeps efa's other fields and counts the change", async () => {
    const db = await importProject(projectWithReservations());
    const id = deriveEfa2Id(`reservation:${MAIN}:2`);
    await saveReservation(
      db,
      reservation({
        id,
        boatId: MAIN,
        recurrence: "weekly",
        startDate: null,
        endDate: null,
        dayOfWeek: 1,
        startTime: "18:30",
        endTime: "20:00",
        // The holder is now a free name instead of Katrin.
        rowerId: null,
        personName: "Équipe vétérans",
        reason: "Montagsvierer",
      })
    );
    const { reservations, sequence } = await exportReservations(db);
    const [first, second, third] = sampleReservations();
    expect(reservations).toHaveLength(3);
    expect(reservations).toContainEqual(first);
    expect(reservations).toContainEqual(second);

    const edited = reservations.find((r) => r.Reservation === "2")!;
    expect(edited).toEqual({
      BoatId: MAIN,
      Reservation: "2",
      Type: "WEEKLY",
      DayOfWeek: "MONDAY",
      TimeFrom: "18:30:00",
      // efa's own text, the time did not change.
      TimeTo: third.TimeTo,
      PersonName: "Équipe vétérans",
      Reason: "Montagsvierer",
      ChangeCount: "2",
      LastModified: expect.any(String) as string,
    });
    expect(edited.LastModified).not.toBe(third.LastModified);
    // Numbers did not move.
    expect(sequence).toMatchObject({ IntValue: "3", ChangeCount: "3" });
  });

  test("a reservation moved to another day is rewritten, an unread field survives", async () => {
    const records = sampleReservations();
    records[1].Colour = "red";
    const db = await importProject(projectWithReservations(records));
    const [row] = await db.select<Row[]>(
      "SELECT * FROM boat_reservation WHERE efa_number = 1"
    );
    await saveReservation(
      db,
      reservation({
        id: row.id,
        boatId: MOSEL,
        // Made weekly in Rowing Beacon.
        recurrence: "weekly",
        startDate: "2026-10-24",
        endDate: "2026-12-31",
        dayOfWeek: 6,
        startTime: "09:00",
        endTime: "16:30",
        rowerId: NIKLAS,
      })
    );
    const { reservations } = await exportReservations(db);
    expect(reservations.find((r) => r.Reservation === "1")).toMatchObject({
      Type: "WEEKLY_LIMITED",
      DateFrom: "24.10.2026",
      DateTo: "31.12.2026",
      DayOfWeek: "SATURDAY",
      PersonId: NIKLAS,
      Colour: "red",
      ChangeCount: "2",
    });
  });

  test("a reservation deleted in Rowing Beacon does not come back", async () => {
    const input = [...sampleReservations(), ...unreadableReservations()];
    const db = await importProject(projectWithReservations(input));
    await deleteReservation(db, deriveEfa2Id(`reservation:${MOSEL}:1`));
    const { reservations, sequence } = await exportReservations(db);
    expect(reservations.map((r) => r.Reservation)).toEqual([
      "3",
      "2",
      "4",
      "5",
      "6",
    ]);
    // The number is not given out again.
    expect(sequence).toMatchObject({ IntValue: "6" });
  });

  test("creates the counter when efa's file has none", async () => {
    const project = projectWithReservations([]);
    project.objects = project.objects.filter(
      (object) => object.type !== "efa2autoincrement"
    );
    const db = await importProject(project);
    expect(
      findObject((await exportReservations(db)).project, "efa2autoincrement")!
        .records
    ).toEqual([]);

    await saveReservation(db, reservation({ id: "first", personName: "Moi" }));
    await saveReservation(db, reservation({ id: "second", personName: "Toi" }));
    const { reservations, sequence } = await exportReservations(db);
    expect(reservations.map((r) => r.Reservation)).toEqual(["1", "2"]);
    expect(sequence).toEqual({
      Sequence: "efa2boatreservations",
      IntValue: "2",
      ChangeCount: "1",
      LastModified: expect.any(String) as string,
    });
  });

  test("a reservation without number gets the next one", async () => {
    const db = await importProject(projectWithReservations());
    await db.execute(
      "INSERT INTO boat_reservation (id, boat_id, recurrence, start_date, end_date, start_time, end_time, person_name, created_at, updated_at) VALUES ('no-number', $1, 'once', '2026-11-01', '2026-11-01', '10:00', '11:00', 'Moi', 'x', '2026-10-01T00:00:00Z')",
      [MOSEL]
    );
    const { reservations, sequence } = await exportReservations(db);
    expect(reservations.find((r) => r.PersonName === "Moi")).toMatchObject({
      Reservation: "4",
    });
    expect(sequence).toMatchObject({ IntValue: "4" });
  });

  test("an export imports back to the same reservations", async () => {
    const db = await importProject(projectWithReservations());
    await saveReservation(
      db,
      reservation({ id: "rb-once", personName: "Moi", reason: "Test" })
    );
    const { project } = await exportReservations(db);
    const again = await importProject(project);
    const columns =
      "boat_id, recurrence, start_date, end_date, day_of_week, start_time, end_time, rower_id, person_name, reason, contact, efa_number";
    const rows = (client: typeof db) =>
      client.select<Row[]>(
        `SELECT ${columns} FROM boat_reservation ORDER BY efa_number`
      );
    expect(await rows(again)).toEqual(await rows(db));
  });
});
