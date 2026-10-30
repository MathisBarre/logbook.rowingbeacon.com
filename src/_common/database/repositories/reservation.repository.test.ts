import { beforeEach, describe, expect, it } from "vitest";
import { BoatReservation } from "../../business/reservation.rules";
import { applyMigrations } from "../migrations";
import { createTestSqlClient } from "../testing/nodeSqlClient";
import {
  anonymizeRower,
  deleteAllClubData,
  saveBoat,
  saveRower,
} from "./club.repository";
import { ClubBoat, ClubRower } from "./club.types";
import {
  deleteReservation,
  loadReservations,
  saveReservation,
} from "./reservation.repository";

const boat: ClubBoat = {
  id: "b1",
  name: "Marie-Claire",
  note: "",
  isInMaintenance: false,
  configurations: [
    {
      id: "c1",
      seats: 4,
      rigging: "scull",
      coxed: true,
      isDefault: true,
      position: 0,
    },
  ],
};

const rower: ClubRower = {
  id: "r1",
  name: "Léa Martin",
  firstName: "Léa",
  lastName: "Martin",
  status: "member",
};

const weekly: BoatReservation = {
  id: "res1",
  boatId: "b1",
  recurrence: "weekly",
  startDate: "2026-09-01",
  endDate: null,
  dayOfWeek: 2,
  startTime: "18:00",
  endTime: "20:00",
  rowerId: null,
  personName: "Section compétition",
  reason: "Entraînement",
  contact: "06 12 34 56 78",
};

const once: BoatReservation = {
  id: "res2",
  boatId: "b1",
  recurrence: "once",
  startDate: "2026-10-26",
  endDate: "2026-10-27",
  dayOfWeek: null,
  startTime: "18:00",
  endTime: "08:00",
  rowerId: "r1",
  personName: null,
  reason: null,
  contact: "lea@example.org",
};

describe("reservation repository", () => {
  let db: ReturnType<typeof createTestSqlClient>;

  const efaNumbers = async () =>
    Object.fromEntries(
      (
        await db.select<{ id: string; efa_number: number }[]>(
          "SELECT id, efa_number FROM boat_reservation"
        )
      ).map((row) => [row.id, row.efa_number])
    );

  const insertEfaCounter = (intValue: string) =>
    db.execute(
      `INSERT INTO efa_record (object_type, object_name, record_key, fields)
      VALUES ('efa2autoincrement', 'autoincrement', 'efa2boatreservations', $1)`,
      [
        JSON.stringify({
          Sequence: "efa2boatreservations",
          IntValue: intValue,
        }),
      ]
    );

  beforeEach(async () => {
    db = createTestSqlClient();
    await applyMigrations(db);
    await saveBoat(db, boat);
    await saveRower(db, rower);
  });

  it("loads nothing when there is no reservation", async () => {
    expect(await loadReservations(db)).toEqual([]);
  });

  it("loads what was saved", async () => {
    await saveReservation(db, weekly);
    await saveReservation(db, once);

    const reservations = await loadReservations(db);

    expect(reservations).toHaveLength(2);
    expect(reservations).toContainEqual(weekly);
    expect(reservations).toContainEqual(once);
  });

  it("loads the reservations ordered by start date and time", async () => {
    await saveReservation(db, { ...once, id: "late" });
    await saveReservation(db, { ...once, id: "early", startTime: "06:00" });
    await saveReservation(db, { ...weekly, id: "first" });

    expect((await loadReservations(db)).map((r) => r.id)).toEqual([
      "first",
      "early",
      "late",
    ]);
  });

  it("clears the fields that do not apply to the recurrence", async () => {
    await saveReservation(db, {
      ...weekly,
      id: "w",
      startDate: null,
      endDate: "2026-12-31",
    });
    await saveReservation(db, { ...once, id: "o", dayOfWeek: 3 });

    const reservations = await loadReservations(db);
    const savedWeekly = reservations.find((r) => r.id === "w");
    const savedOnce = reservations.find((r) => r.id === "o");

    expect(savedWeekly).toMatchObject({
      startDate: null,
      endDate: "2026-12-31",
      dayOfWeek: 2,
    });
    expect(savedOnce?.dayOfWeek).toBeNull();
  });

  it("trims texts and stores blanks as null", async () => {
    await saveReservation(db, {
      ...weekly,
      personName: "  Les Vétérans  ",
      reason: "   ",
      contact: "",
    });

    expect((await loadReservations(db))[0]).toMatchObject({
      personName: "Les Vétérans",
      reason: null,
      contact: null,
    });
  });

  it("drops the person name when the holder is a rower", async () => {
    await saveReservation(db, { ...once, personName: "Quelqu'un d'autre" });

    const [saved] = await loadReservations(db);
    expect(saved.rowerId).toBe("r1");
    expect(saved.personName).toBeNull();
  });

  it("updates a reservation in place", async () => {
    await saveReservation(db, weekly);
    await saveReservation(db, {
      ...weekly,
      startTime: "19:00",
      reason: null,
      dayOfWeek: 4,
    });

    const reservations = await loadReservations(db);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      startTime: "19:00",
      reason: null,
      dayOfWeek: 4,
    });
  });

  it("refuses a reservation for an unknown boat", async () => {
    await expect(
      saveReservation(db, { ...weekly, boatId: "nope" })
    ).rejects.toThrow();
  });

  describe("efa2 reservation number", () => {
    it("numbers the first reservation 1", async () => {
      await saveReservation(db, weekly);
      expect(await efaNumbers()).toEqual({ res1: 1 });
    });

    it("numbers the next ones after the highest existing number", async () => {
      await saveReservation(db, weekly);
      await saveReservation(db, once);
      await saveReservation(db, { ...once, id: "res3" });
      expect(await efaNumbers()).toEqual({ res1: 1, res2: 2, res3: 3 });
    });

    it("goes on after the highest imported number, gaps included", async () => {
      await saveReservation(db, weekly);
      await db.execute(
        "UPDATE boat_reservation SET efa_number = 41 WHERE id = 'res1'"
      );
      await saveReservation(db, once);
      expect(await efaNumbers()).toEqual({ res1: 41, res2: 42 });
    });

    it("goes on after efa's own counter when it is ahead", async () => {
      await insertEfaCounter("7");
      await saveReservation(db, weekly);
      await saveReservation(db, once);
      expect(await efaNumbers()).toEqual({ res1: 8, res2: 9 });
    });

    it("ignores efa's counter when a reservation number is ahead", async () => {
      await insertEfaCounter("7");
      await saveReservation(db, weekly);
      await db.execute(
        "UPDATE boat_reservation SET efa_number = 20 WHERE id = 'res1'"
      );
      await saveReservation(db, once);
      expect(await efaNumbers()).toEqual({ res1: 20, res2: 21 });
    });

    it("goes on after the reservations efa kept as they were", async () => {
      const insertKept = (key: string, reservation: string) =>
        db.execute(
          `INSERT INTO efa_record (object_type, object_name, record_key, fields)
          VALUES ('efa2boatreservations', 'boatreservations', $1, $2)`,
          [key, JSON.stringify({ Reservation: reservation })]
        );
      await insertKept("k1", "9");
      await insertKept("k2", "30");
      await saveReservation(db, weekly);
      await saveReservation(db, once);
      expect(await efaNumbers()).toEqual({ res1: 31, res2: 32 });
    });

    it("ignores the counters of other sequences", async () => {
      await db.execute(
        `INSERT INTO efa_record (object_type, object_name, record_key, fields)
        VALUES ('efa2autoincrement', 'autoincrement', 'efa2logbook',
          '{"Sequence":"efa2logbook","IntValue":"500"}')`
      );
      await saveReservation(db, weekly);
      expect(await efaNumbers()).toEqual({ res1: 1 });
    });

    it("reads a counter stored as a long value", async () => {
      await db.execute(
        `INSERT INTO efa_record (object_type, object_name, record_key, fields)
        VALUES ('efa2autoincrement', 'autoincrement', 'efa2boatreservations',
          '{"Sequence":"efa2boatreservations","LongValue":"12"}')`
      );
      await saveReservation(db, weekly);
      expect(await efaNumbers()).toEqual({ res1: 13 });
    });

    it("keeps the number when the reservation is updated", async () => {
      await saveReservation(db, weekly);
      await saveReservation(db, once);
      await insertEfaCounter("50");

      await saveReservation(db, { ...weekly, reason: "Changé" });
      await saveReservation(db, { ...once, startTime: "19:00" });

      expect(await efaNumbers()).toEqual({ res1: 1, res2: 2 });
    });

    it("does not reuse the number of a deleted reservation below the highest", async () => {
      await saveReservation(db, weekly);
      await saveReservation(db, once);
      await deleteReservation(db, "res1");
      await saveReservation(db, { ...once, id: "res3" });
      expect(await efaNumbers()).toEqual({ res2: 2, res3: 3 });
    });
  });

  describe("deleteReservation", () => {
    it("removes the reservation and its efa2 record only", async () => {
      await saveReservation(db, weekly);
      await saveReservation(db, once);
      const insertRecord = (key: string, rbTable: string, rbId: string) =>
        db.execute(
          `INSERT INTO efa_record (object_type, object_name, record_key, rb_table, rb_id, fields)
          VALUES ('efa2boatreservations', 'boatreservations', $1, $2, $3, '{}')`,
          [key, rbTable, rbId]
        );
      await insertRecord("1", "boat_reservation", "res1");
      await insertRecord("2", "boat_reservation", "res2");
      await insertRecord("3", "boat", "res1");

      await deleteReservation(db, "res1");

      expect((await loadReservations(db)).map((r) => r.id)).toEqual(["res2"]);
      const records = await db.select<{ record_key: string }[]>(
        "SELECT record_key FROM efa_record ORDER BY record_key"
      );
      expect(records.map((r) => r.record_key)).toEqual(["2", "3"]);
    });

    it("does nothing for an unknown reservation", async () => {
      await saveReservation(db, weekly);
      await deleteReservation(db, "unknown");
      expect(await loadReservations(db)).toHaveLength(1);
    });
  });

  describe("with the rest of the club data", () => {
    it("anonymizeRower clears the contact of the rower's reservations only", async () => {
      await saveReservation(db, once);
      await saveReservation(db, { ...once, id: "res3", contact: "autre" });
      await saveReservation(db, weekly);

      await anonymizeRower(db, "r1", "Rameur anonyme");

      const reservations = await loadReservations(db);
      const byId = Object.fromEntries(reservations.map((r) => [r.id, r]));
      expect(byId.res2.contact).toBeNull();
      expect(byId.res3.contact).toBeNull();
      expect(byId.res2.rowerId).toBe("r1");
      expect(byId.res1.contact).toBe("06 12 34 56 78");
      expect(byId.res1.personName).toBe("Section compétition");
    });

    it("anonymizeRower blanks the reservations held under their free name", async () => {
      await saveReservation(db, {
        ...weekly,
        personName: "léa martin",
        contact: "06 00 00 00 00",
        reason: "Entraînement de Léa Martin",
      });
      await saveReservation(db, { ...weekly, id: "res4", boatId: "b1" });

      await anonymizeRower(db, "r1", "Rameur anonyme");

      const byId = Object.fromEntries(
        (await loadReservations(db)).map((r) => [r.id, r])
      );
      expect(byId.res1.personName).toBe("Rameur anonyme");
      expect(byId.res1.contact).toBeNull();
      expect(byId.res1.reason).toBe("Entraînement de Rameur anonyme");
      expect(byId.res4.personName).toBe("Section compétition");
      expect(byId.res4.contact).toBe("06 12 34 56 78");
    });

    it("anonymizeRower takes their name out of the reasons of their own reservations", async () => {
      await saveReservation(db, {
        ...once,
        reason: "Entraînement Léa Martin / Paul",
      });

      await anonymizeRower(db, "r1", "Rameur anonyme");

      const [reservation] = await loadReservations(db);
      expect(reservation.rowerId).toBe("r1");
      expect(reservation.reason).toBe("Entraînement Rameur anonyme / Paul");
    });

    it("deleteAllClubData empties the reservations, the boats and the rowers", async () => {
      await saveReservation(db, once);
      await saveReservation(db, weekly);

      await deleteAllClubData(db);

      expect(await loadReservations(db)).toEqual([]);
      expect(await db.select("SELECT id FROM boat")).toEqual([]);
      expect(await db.select("SELECT id FROM rower")).toEqual([]);
    });
  });
});
