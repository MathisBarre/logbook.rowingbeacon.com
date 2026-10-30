import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../migrations";
import { createTestSqlClient } from "../testing/nodeSqlClient";
import {
  anonymizeRower,
  deleteAllClubData,
  deleteOuting,
  finishOuting,
  findOverlappingOutings,
  insertIncident,
  insertOuting,
  loadClubData,
  loadOuting,
  saveBoat,
  saveBoatDamage,
  saveRoute,
  saveRower,
  saveSetting,
  updateOuting,
} from "./club.repository";
import { ClubBoat, ClubRower } from "./club.types";

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
    {
      id: "c2",
      seats: 4,
      rigging: "sweep",
      coxed: false,
      isDefault: false,
      position: 1,
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

describe("club repository", () => {
  let db: ReturnType<typeof createTestSqlClient>;

  beforeEach(async () => {
    db = createTestSqlClient();
    await applyMigrations(db);
    await saveBoat(db, boat);
    await saveRower(db, rower);
    await saveRoute(db, { id: "route1", name: "Amont", distanceM: 8000 });
  });

  it("loads what was saved", async () => {
    const data = await loadClubData(db);

    expect(data.boats).toHaveLength(1);
    expect(data.boats[0].configurations.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(data.boats[0].type).toBe("FOUR_ROWERS_COXED");
    expect(data.rowers[0].name).toBe("Léa Martin");
    expect(data.routes[0].distanceM).toBe(8000);
  });

  it("records changes in the history and archives removed configurations", async () => {
    await saveRower(db, { ...rower, lastName: "Bernard", name: "Léa Bernard" });
    await saveBoat(db, { ...boat, configurations: [boat.configurations[0]] });

    const history = await db.select<
      { field: string; old_value: string; new_value: string }[]
    >(
      "SELECT field, old_value, new_value FROM change_log WHERE entity = 'rower'"
    );
    expect(history).toEqual([
      { field: "last_name", old_value: "Martin", new_value: "Bernard" },
    ]);

    const data = await loadClubData(db);
    expect(data.rowers[0].name).toBe("Léa Bernard");
    expect(data.boats[0].configurations.map((c) => c.id)).toEqual(["c1"]);
    const archived = await db.select<{ archived_at: string | null }[]>(
      "SELECT archived_at FROM boat_configuration WHERE id = 'c2'"
    );
    expect(archived[0].archived_at).not.toBeNull();
  });

  it("keeps ongoing outings in the database until they are finished", async () => {
    await insertOuting(db, {
      id: "o1",
      boatId: "b1",
      boatConfigurationId: "c1",
      routeId: "route1",
      startDateTime: "2026-10-18T08:00:00.000Z",
      comment: "",
      crew: [{ rowerId: "r1", role: "cox" }],
    });

    let data = await loadClubData(db);
    expect(data.ongoingOutings).toHaveLength(1);
    expect(data.ongoingOutings[0].rowers).toEqual([
      { id: "r1", name: "Léa Martin", role: "cox" },
    ]);
    expect(data.ongoingOutings[0].route?.name).toBe("Amont");

    await finishOuting(db, {
      id: "o1",
      endDateTime: "2026-10-18T09:30:00.000Z",
      comment: "RAS",
      hasBeenCoached: true,
    });
    await insertIncident(db, {
      id: "i1",
      boatId: "b1",
      sessionId: "o1",
      message: "Dame",
      datetime: "2026-10-18T09:30:00.000Z",
    });

    data = await loadClubData(db);
    expect(data.ongoingOutings).toHaveLength(0);
    expect(data.incidents[0].sessionId).toBe("o1");

    await deleteOuting(db, "o1");
    data = await loadClubData(db);
    expect(data.incidents[0].sessionId).toBe("");
  });

  it("deletes club data but keeps the v1 migration marker", async () => {
    await saveSetting(db, "migration.v1", { status: "migrated" });
    await saveSetting(db, "club.coachNote", "Vent");
    await db.execute(
      "INSERT INTO session (id, boat_id) VALUES ('s1', 'b1'); INSERT INTO session_rowers (session_id, rower_id) VALUES ('s1', 'r1');"
    );

    await deleteAllClubData(db);

    const data = await loadClubData(db);
    expect(data.boats).toHaveLength(0);
    const v1 = await db.select<unknown[]>("SELECT * FROM session");
    expect(v1).toHaveLength(0);
    expect(Object.keys(data.settings)).toEqual(["migration.v1"]);
  });

  it("reports an outing missing from the database instead of finishing nothing", async () => {
    const finished = await finishOuting(db, {
      id: "missing",
      endDateTime: "2026-10-18T09:30:00.000Z",
      comment: null,
      hasBeenCoached: null,
    });
    expect(finished).toBe(false);
  });

  it("keeps the distance when none is given and clears it on null", async () => {
    await insertOuting(db, {
      id: "o1",
      boatId: "b1",
      startDateTime: "2026-10-18T08:00:00.000Z",
      distanceM: 8000,
      crew: [{ rowerId: "r1", role: "rower" }],
    });
    const distance = async () =>
      (
        await db.select<{ distance_m: number | null }[]>(
          "SELECT distance_m FROM outing WHERE id = 'o1'"
        )
      )[0].distance_m;

    await finishOuting(db, {
      id: "o1",
      endDateTime: "2026-10-18T09:30:00.000Z",
      comment: null,
      hasBeenCoached: null,
    });
    expect(await distance()).toBe(8000);

    await finishOuting(db, {
      id: "o1",
      endDateTime: "2026-10-18T09:30:00.000Z",
      comment: null,
      hasBeenCoached: null,
      distanceM: null,
    });
    expect(await distance()).toBeNull();
  });

  it("never leaves an outing without its crew", async () => {
    await expect(
      insertOuting(db, {
        id: "o1",
        boatId: "b1",
        startDateTime: "2026-10-18T08:00:00.000Z",
        crew: [
          { rowerId: "r1", role: "rower" },
          { rowerId: "unknown", role: "rower" },
        ],
      })
    ).rejects.toThrow();

    const outings = await db.select<unknown[]>("SELECT id FROM outing");
    const crew = await db.select<unknown[]>("SELECT * FROM outing_crew");
    expect(outings).toHaveLength(0);
    expect(crew).toHaveLength(0);
  });

  describe("correcting an outing", () => {
    const baseOuting = {
      id: "o1",
      boatId: "b1",
      boatConfigurationId: "c1",
      routeId: "route1",
      startDateTime: "2026-10-18T08:00",
      endDateTime: "2026-10-18T09:30",
      comment: "RAS",
      hasBeenCoached: false,
      captainRowerId: "r1",
      crew: [
        { rowerId: "r1", role: "rower" as const },
        { rowerId: "r2", role: "rower" as const },
        { rowerId: "r3", role: "cox" as const },
      ],
    };
    const history = () =>
      db.select<
        { field: string; old_value: string | null; new_value: string | null }[]
      >(
        "SELECT field, old_value, new_value FROM change_log WHERE entity = 'outing' AND entity_id = 'o1' ORDER BY id"
      );
    const storedCrew = () =>
      db.select<{ rower_id: string; role: string; position: number }[]>(
        "SELECT rower_id, role, position FROM outing_crew WHERE outing_id = 'o1' ORDER BY position"
      );

    beforeEach(async () => {
      await saveRower(db, {
        ...rower,
        id: "r2",
        name: "Paul Durand",
        firstName: "Paul",
        lastName: "Durand",
      });
      await saveRower(db, {
        ...rower,
        id: "r3",
        name: "Sam Petit",
        firstName: "Sam",
        lastName: "Petit",
      });
      await saveBoat(db, {
        ...boat,
        id: "b2",
        name: "Pierre",
        configurations: [],
      });
      await insertOuting(db, baseOuting);
    });

    it("reports a missing outing instead of correcting nothing", async () => {
      expect(await updateOuting(db, { ...baseOuting, id: "missing" })).toBe(
        false
      );
    });

    it("updates every column and records the changes in the history", async () => {
      const updated = await updateOuting(db, {
        ...baseOuting,
        boatId: "b2",
        boatConfigurationId: null,
        routeId: null,
        startDateTime: "2026-10-18T08:15",
        endDateTime: "2026-10-18T10:00",
        comment: "Vent",
        hasBeenCoached: true,
        captainRowerId: "r2",
        distanceM: 9000,
      });
      expect(updated).toBe(true);

      const stored = await loadOuting(db, "o1");
      expect(stored).toMatchObject({
        boatId: "b2",
        boatConfigurationId: null,
        routeId: null,
        startDateTime: "2026-10-18T08:15",
        endDateTime: "2026-10-18T10:00",
        comment: "Vent",
        hasBeenCoached: true,
        captainRowerId: "r2",
        distanceM: 9000,
      });

      const fields = (await history()).map((row) => row.field).sort();
      expect(fields).toEqual(
        [
          "boat_configuration_id",
          "boat_id",
          "captain_rower_id",
          "comment",
          "distance_m",
          "end_date_time",
          "has_been_coached",
          "route_id",
          "start_date_time",
        ].sort()
      );
      expect(
        (await history()).find((row) => row.field === "comment")
      ).toMatchObject({ old_value: "RAS", new_value: "Vent" });
      const [{ updated_at }] = await db.select<{ updated_at: string }[]>(
        "SELECT updated_at FROM outing WHERE id = 'o1'"
      );
      expect(updated_at > "2026-10-28").toBe(true);
    });

    it("logs nothing when nothing changed", async () => {
      await updateOuting(db, baseOuting);
      expect(await history()).toEqual([]);
    });

    it("keeps the stored distance unless one is given", async () => {
      await updateOuting(db, { ...baseOuting, distanceM: 8000 });
      await updateOuting(db, { ...baseOuting, comment: "Autre" });
      expect((await loadOuting(db, "o1"))?.distanceM).toBe(8000);

      await updateOuting(db, { ...baseOuting, distanceM: null });
      expect((await loadOuting(db, "o1"))?.distanceM).toBeNull();
    });

    it("keeps the seats of an unchanged crew", async () => {
      // Seats kept by an efa import, gaps included.
      await db.execute(
        "UPDATE outing_crew SET position = CASE rower_id WHEN 'r1' THEN 2 WHEN 'r2' THEN 5 ELSE 9 END WHERE outing_id = 'o1'"
      );

      await updateOuting(db, { ...baseOuting, comment: "Autre" });

      expect((await storedCrew()).map((m) => m.position)).toEqual([2, 5, 9]);
      expect((await history()).map((row) => row.field)).toEqual(["comment"]);
    });

    it("rewrites a changed crew and logs it", async () => {
      await updateOuting(db, {
        ...baseOuting,
        crew: [
          { rowerId: "r2", role: "rower" },
          { rowerId: "r1", role: "rower" },
        ],
      });

      expect(await storedCrew()).toEqual([
        { rower_id: "r2", role: "rower", position: 0 },
        { rower_id: "r1", role: "rower", position: 1 },
      ]);
      const [crewChange] = (await history()).filter(
        (row) => row.field === "crew"
      );
      expect(JSON.parse(crewChange.old_value ?? "")).toEqual([
        { rowerId: "r1", role: "rower" },
        { rowerId: "r2", role: "rower" },
        { rowerId: "r3", role: "cox" },
      ]);
      expect(JSON.parse(crewChange.new_value ?? "")).toEqual([
        { rowerId: "r2", role: "rower" },
        { rowerId: "r1", role: "rower" },
      ]);
    });

    it("keeps the efa seats of the rowers who stay and fills a free seat", async () => {
      await db.execute(
        "UPDATE outing_crew SET position = CASE rower_id WHEN 'r1' THEN 2 WHEN 'r2' THEN 5 ELSE 0 END WHERE outing_id = 'o1'"
      );

      await updateOuting(db, {
        ...baseOuting,
        crew: [
          { rowerId: "r3", role: "rower" },
          { rowerId: "r2", role: "rower" },
        ],
      });

      expect(await storedCrew()).toEqual([
        { rower_id: "r3", role: "rower", position: 1 },
        { rower_id: "r2", role: "rower", position: 5 },
      ]);
    });

    it("seats an efa crew in the editor's order when rowers are swapped", async () => {
      await db.execute(
        "UPDATE outing_crew SET position = CASE rower_id WHEN 'r1' THEN 1 WHEN 'r2' THEN 2 ELSE 0 END WHERE outing_id = 'o1'"
      );

      await updateOuting(db, {
        ...baseOuting,
        crew: [
          { rowerId: "r2", role: "rower" },
          { rowerId: "r1", role: "rower" },
          { rowerId: "r3", role: "cox" },
        ],
      });

      expect(await storedCrew()).toEqual([
        { rower_id: "r3", role: "cox", position: 0 },
        { rower_id: "r2", role: "rower", position: 1 },
        { rower_id: "r1", role: "rower", position: 2 },
      ]);
    });

    it("seats a rower added between two efa seats after the one before", async () => {
      await db.execute(
        "UPDATE outing_crew SET position = CASE rower_id WHEN 'r1' THEN 1 WHEN 'r2' THEN 2 ELSE 0 END WHERE outing_id = 'o1'"
      );

      await updateOuting(db, {
        ...baseOuting,
        crew: [
          { rowerId: "r1", role: "rower" },
          { rowerId: "r3", role: "rower" },
          { rowerId: "r2", role: "rower" },
        ],
      });

      expect((await storedCrew()).map((m) => m.rower_id)).toEqual([
        "r1",
        "r3",
        "r2",
      ]);
    });

    it("keeps the other cox of an imported crew when the one shown stays", async () => {
      await db.execute(
        "UPDATE outing_crew SET role = 'cox', position = 0 WHERE outing_id = 'o1' AND rower_id = 'r2'"
      );

      await updateOuting(db, {
        ...baseOuting,
        comment: "Autre",
        crew: [
          { rowerId: "r1", role: "rower" },
          { rowerId: "r3", role: "cox" },
        ],
      });

      expect(
        (await storedCrew())
          .filter((m) => m.role === "cox")
          .map((m) => m.rower_id)
          .sort()
      ).toEqual(["r2", "r3"]);
      expect((await history()).map((row) => row.field)).toEqual(["comment"]);
    });

    it("drops the names efa typed in the entry once the crew changes", async () => {
      await db.execute(
        `INSERT INTO efa_record (object_type, object_name, record_key, rb_table, rb_id, fields)
        VALUES ('efa2logbook', '2026', '1', 'outing', 'o1', '{"EntryId":"1","Crew1Name":"Léa Martin","AllCrewNames":"Léa Martin, Paul Durand"}')`
      );

      await updateOuting(db, { ...baseOuting, comment: "Autre" });
      const fields = async () =>
        JSON.parse(
          (
            await db.select<{ fields: string }[]>(
              "SELECT fields FROM efa_record WHERE rb_id = 'o1'"
            )
          )[0].fields
        ) as Record<string, string>;
      expect((await fields()).Crew1Name).toBe("Léa Martin");

      await updateOuting(db, {
        ...baseOuting,
        crew: [{ rowerId: "r2", role: "rower" }],
      });
      expect(await fields()).toEqual({ EntryId: "1" });
    });

    it("does not reopen an outing finished meanwhile", async () => {
      expect(
        await updateOuting(
          db,
          { ...baseOuting, endDateTime: null },
          { onlyIfOngoing: true }
        )
      ).toBe(false);
      expect((await loadOuting(db, "o1"))?.endDateTime).toBe(
        "2026-10-18T09:30"
      );
    });

    it("does not end an outing that is still ongoing", async () => {
      await updateOuting(db, { ...baseOuting, endDateTime: null });

      expect(await updateOuting(db, baseOuting, { onlyIfFinished: true })).toBe(
        false
      );
      expect((await loadOuting(db, "o1"))?.endDateTime).toBeNull();
    });

    it("sees a changed role as a changed crew", async () => {
      await updateOuting(db, {
        ...baseOuting,
        crew: [
          { rowerId: "r1", role: "rower" },
          { rowerId: "r2", role: "cox" },
          { rowerId: "r3", role: "rower" },
        ],
      });

      expect((await storedCrew()).map((m) => m.role)).toEqual([
        "rower",
        "cox",
        "rower",
      ]);
    });

    it("puts the outing back as it was when the new crew cannot be saved", async () => {
      await db.execute("UPDATE outing_crew SET position = position + 3");

      await expect(
        updateOuting(db, {
          ...baseOuting,
          comment: "Autre",
          crew: [
            { rowerId: "r2", role: "rower" },
            { rowerId: "unknown", role: "rower" },
          ],
        })
      ).rejects.toThrow();

      expect(await storedCrew()).toEqual([
        { rower_id: "r1", role: "rower", position: 3 },
        { rower_id: "r2", role: "rower", position: 4 },
        { rower_id: "r3", role: "cox", position: 5 },
      ]);
      expect((await loadOuting(db, "o1"))?.comment).toBe("RAS");
      expect(await history()).toEqual([]);
    });

    it("loads an outing with its crew in seat order, or null", async () => {
      expect(await loadOuting(db, "missing")).toBeNull();
      expect(await loadOuting(db, "o1")).toEqual({
        id: "o1",
        boatId: "b1",
        boatConfigurationId: "c1",
        routeId: "route1",
        outingTypeCode: null,
        captainRowerId: "r1",
        startDateTime: "2026-10-18T08:00",
        estimatedEndDateTime: null,
        endDateTime: "2026-10-18T09:30",
        distanceM: null,
        comment: "RAS",
        hasBeenCoached: false,
        crew: baseOuting.crew,
      });
    });
  });

  describe("overlapping outings", () => {
    const query = {
      boatId: "b1",
      rowerIds: ["r1"],
      startDateTime: "2026-10-18T09:00",
      endDateTime: "2026-10-18T10:00" as string | null,
    };

    beforeEach(async () => {
      await saveRower(db, {
        ...rower,
        id: "r2",
        name: "Paul Durand",
        firstName: "Paul",
        lastName: "Durand",
      });
      await saveBoat(db, {
        ...boat,
        id: "b2",
        name: "Pierre",
        configurations: [],
      });
    });

    const insertAt = (
      id: string,
      boatId: string,
      rowerId: string,
      start: string,
      end: string | null
    ) =>
      insertOuting(db, {
        id,
        boatId,
        startDateTime: start,
        endDateTime: end,
        crew: [{ rowerId, role: "rower" }],
      });

    it("finds the same boat and the same rowers on an intersecting outing", async () => {
      await insertAt(
        "sameBoat",
        "b1",
        "r2",
        "2026-10-18T09:30",
        "2026-10-18T11:00"
      );
      await insertAt(
        "sameRower",
        "b2",
        "r1",
        "2026-10-18T08:00",
        "2026-10-18T09:15"
      );
      await insertAt(
        "both",
        "b1",
        "r1",
        "2026-10-18T09:20",
        "2026-10-18T09:40"
      );
      await insertAt(
        "other",
        "b2",
        "r2",
        "2026-10-18T09:00",
        "2026-10-18T10:00"
      );

      const overlaps = await findOverlappingOutings(db, query);

      expect(overlaps).toEqual([
        {
          outingId: "sameRower",
          boatId: "b2",
          startDateTime: "2026-10-18T08:00",
          endDateTime: "2026-10-18T09:15",
          boatOverlaps: false,
          rowerIds: ["r1"],
        },
        expect.objectContaining({
          outingId: "both",
          boatOverlaps: true,
          rowerIds: ["r1"],
        }),
        expect.objectContaining({
          outingId: "sameBoat",
          boatOverlaps: true,
          rowerIds: [],
        }),
      ]);
    });

    it("does not count outings that end when this one starts or start when it ends", async () => {
      await insertAt(
        "before",
        "b1",
        "r1",
        "2026-10-18T08:00",
        "2026-10-18T09:00"
      );
      await insertAt(
        "after",
        "b1",
        "r1",
        "2026-10-18T10:00",
        "2026-10-18T11:00"
      );
      await insertAt(
        "earlier",
        "b1",
        "r1",
        "2026-10-17T08:00",
        "2026-10-17T09:00"
      );

      expect(await findOverlappingOutings(db, query)).toEqual([]);
    });

    it("treats an ongoing outing as open-ended", async () => {
      await insertAt("ongoing", "b1", "r1", "2026-10-18T07:00", null);

      expect(
        (await findOverlappingOutings(db, query)).map((o) => o.outingId)
      ).toEqual(["ongoing"]);
      // Ended before the ongoing one started.
      expect(
        await findOverlappingOutings(db, {
          ...query,
          startDateTime: "2026-10-18T06:00",
          endDateTime: "2026-10-18T06:30",
        })
      ).toEqual([]);
    });

    it("checks an ongoing outing against everything that ends after its start", async () => {
      await insertAt(
        "finished",
        "b1",
        "r1",
        "2026-10-18T08:00",
        "2026-10-18T09:30"
      );
      await insertAt("old", "b1", "r1", "2026-10-17T08:00", "2026-10-17T09:30");
      await insertAt("ongoing", "b2", "r1", "2026-10-18T07:00", null);

      const overlaps = await findOverlappingOutings(db, {
        ...query,
        endDateTime: null,
      });

      expect(overlaps.map((o) => o.outingId)).toEqual(["ongoing", "finished"]);
    });

    it("leaves out the outing being corrected", async () => {
      await insertAt("o1", "b1", "r1", "2026-10-18T09:00", "2026-10-18T10:00");

      expect(
        await findOverlappingOutings(db, { ...query, excludeOutingId: "o1" })
      ).toEqual([]);
    });

    it("works without rowers", async () => {
      await insertAt("o1", "b2", "r1", "2026-10-18T09:00", "2026-10-18T10:00");

      expect(
        await findOverlappingOutings(db, { ...query, rowerIds: [] })
      ).toEqual([]);
    });
  });

  it("anonymises a rower and purges their history", async () => {
    await saveRower(db, {
      ...rower,
      lastName: "Bernard",
      name: "Léa Bernard",
      email: "lea@example.org",
      licenseNumber: "123",
    });
    await insertOuting(db, {
      id: "o1",
      boatId: "b1",
      startDateTime: "2026-10-18T08:00:00.000Z",
      endDateTime: "2026-10-18T09:00:00.000Z",
      crew: [{ rowerId: "r1", role: "rower" }],
    });

    await anonymizeRower(db, "r1", "Ancien membre");

    const [row] = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM rower WHERE id = 'r1'"
    );
    expect(row.first_name).toBe("Ancien membre");
    expect(row.last_name).toBe("");
    expect(row.email).toBeNull();
    expect(row.license_number).toBeNull();
    expect(row.anonymized_at).not.toBeNull();
    const history = await db.select<unknown[]>(
      "SELECT * FROM change_log WHERE entity_id = 'r1'"
    );
    expect(history).toHaveLength(0);
    const crew = await db.select<unknown[]>(
      "SELECT * FROM outing_crew WHERE rower_id = 'r1'"
    );
    expect(crew).toHaveLength(1);
  });

  it("removes the rower's name from damage texts and their history", async () => {
    await saveBoatDamage(db, {
      id: "d1",
      boatId: "b1",
      kind: "damage",
      severity: "limited",
      description: "Siège cassé par Léa Martin",
      reportedAt: "2026-10-18T08:00:00.000Z",
      reportedByRowerId: null,
      outingId: null,
      incidentId: null,
      fixedAt: null,
      fixedByRowerId: null,
      repairNote: "Vu avec martin, léa",
      repairCost: null,
    });
    await saveBoatDamage(db, {
      id: "d2",
      boatId: "b1",
      kind: "unavailable",
      severity: "unusable",
      description: "Hivernage",
      reportedAt: "2026-10-18T08:00:00.000Z",
      reportedByRowerId: null,
      outingId: null,
      incidentId: null,
      fixedAt: null,
      fixedByRowerId: null,
      repairNote: null,
      repairCost: null,
    });

    await anonymizeRower(db, "r1", "Ancien membre");

    const damages = await db.select<
      { id: string; description: string; repair_note: string | null }[]
    >("SELECT id, description, repair_note FROM boat_damage ORDER BY id");
    expect(damages).toEqual([
      {
        id: "d1",
        description: "Siège cassé par Ancien membre",
        repair_note: "Vu avec Ancien membre",
      },
      { id: "d2", description: "Hivernage", repair_note: null },
    ]);
    const history = await db.select<unknown[]>(
      "SELECT * FROM change_log WHERE entity = 'boat_damage' AND entity_id = 'd1'"
    );
    expect(history).toHaveLength(0);
  });

  it("leaves a longer name in a damage text and keeps that damage's history", async () => {
    await saveBoatDamage(db, {
      id: "d3",
      boatId: "b1",
      kind: "damage",
      severity: "usable",
      description: "Rayure signalée par Léa Martinez",
      reportedAt: "2026-10-18T08:00:00.000Z",
      reportedByRowerId: null,
      outingId: null,
      incidentId: null,
      fixedAt: null,
      fixedByRowerId: null,
      repairNote: null,
      repairCost: null,
    });
    const historyBefore = await db.select<unknown[]>(
      "SELECT * FROM change_log WHERE entity = 'boat_damage' AND entity_id = 'd3'"
    );

    await anonymizeRower(db, "r1", "Ancien membre");

    const [damage] = await db.select<{ description: string }[]>(
      "SELECT description FROM boat_damage WHERE id = 'd3'"
    );
    expect(damage.description).toBe("Rayure signalée par Léa Martinez");
    const historyAfter = await db.select<unknown[]>(
      "SELECT * FROM change_log WHERE entity = 'boat_damage' AND entity_id = 'd3'"
    );
    expect(historyAfter).toHaveLength(historyBefore.length);
  });
});
