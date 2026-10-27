import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../migrations";
import { createTestSqlClient } from "../testing/nodeSqlClient";
import {
  anonymizeRower,
  deleteAllClubData,
  deleteOuting,
  finishOuting,
  insertIncident,
  insertOuting,
  loadClubData,
  saveBoat,
  saveRoute,
  saveRower,
  saveSetting,
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
});
