import { readFinishedOutingDraft } from "./loadOutingDraft";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toNewGuestOptionId } from "../../../_common/business/crew.rules";
import { Rower } from "../../../_common/business/rower.rules";
import { applyMigrations } from "../../../_common/database/migrations";
import {
  findOverlappingOutings,
  insertOuting,
  loadOuting,
  saveBoat,
  saveRoute,
  saveRower,
} from "../../../_common/database/repositories/club.repository";
import {
  ClubBoat,
  ClubRower,
} from "../../../_common/database/repositories/club.types";
import { createTestSqlClient } from "../../../_common/database/testing/nodeSqlClient";
import { ZustandSession } from "../../../_common/store/sessions.store";
import { createInMemoryStartSessionRepository } from "../../../boathouse/business/StartSession/StartSession.repository.inMemory";
import { OutingDraft } from "./outingDraft";
import { SaveOutingUsecase } from "./SaveOuting.usecase";

const configuration = {
  seats: 2,
  rigging: "scull" as const,
  coxed: false,
  position: 0,
};
const boats: ClubBoat[] = [
  {
    id: "b1",
    name: "Marie-Claire",
    configurations: [{ ...configuration, id: "c1", isDefault: true }],
  },
  {
    id: "b2",
    name: "Pierre",
    configurations: [{ ...configuration, id: "c2", isDefault: true }],
  },
];
const rowers: ClubRower[] = ["r1", "r2", "r3"].map((id, index) => ({
  id,
  name: ["Léa Martin", "Paul Durand", "Sam Petit"][index],
  firstName: ["Léa", "Paul", "Sam"][index],
  lastName: ["Martin", "Durand", "Petit"][index],
  status: "member",
}));

const NOW = new Date(2026, 9, 28, 14, 30);

const pastDraft: OutingDraft = {
  boatId: "b1",
  boatConfigurationId: "c1",
  routeId: null,
  outingTypeCode: null,
  rowerIds: ["r1", "r2"],
  coxId: null,
  captainRowerId: "r1",
  startDateTime: "2026-10-28T12:00",
  estimatedEndDateTime: null,
  endDateTime: "2026-10-28T13:30",
  comment: "Belle sortie",
  hasBeenCoached: false,
};

describe("SaveOuting", () => {
  let db: ReturnType<typeof createTestSqlClient>;
  let ongoingSessions: ZustandSession[];
  let writeSucceeds: boolean;
  let requireCaptain: boolean;

  const createGuest = vi.fn();

  const getUsecase = () => {
    const repository = createInMemoryStartSessionRepository({
      boats,
      rowers: rowers.map(({ id, name }) => ({ id, name })),
      routes: [{ id: "route1", name: "Amont" }],
    });
    repository.createGuest = (name) =>
      Promise.resolve(
        (createGuest(name) as Rower | undefined) ?? { id: "guest-1", name }
      );

    return new SaveOutingUsecase({
      repository,
      sessions: {
        getOngoingSessions: () => ongoingSessions,
        getOngoingSession: (id) => ongoingSessions.find((s) => s.id === id),
        updateSession: (outing) => {
          ongoingSessions = ongoingSessions.map((s) =>
            s.id === outing.id ? outing : s
          );
        },
      },
      database: {
        write: async (_label, write) => {
          if (!writeSucceeds) return false;
          await write(db);
          return true;
        },
        findOverlaps: (query) => findOverlappingOutings(db, query),
        loadFinished: (outingId) => readFinishedOutingDraft(db, outingId),
      },
      requireCaptain: () => requireCaptain,
      now: () => NOW,
      generateId: () => "new-outing",
    });
  };

  const storedOutingIds = async () =>
    (await db.select<{ id: string }[]>("SELECT id FROM outing")).map(
      (row) => row.id
    );

  beforeEach(async () => {
    db = createTestSqlClient();
    await applyMigrations(db);
    for (const boat of boats) await saveBoat(db, boat);
    for (const rower of rowers) await saveRower(db, rower);
    await saveRoute(db, { id: "route1", name: "Amont" });
    ongoingSessions = [];
    writeSucceeds = true;
    requireCaptain = false;
    createGuest.mockClear();
  });

  describe("an outing entered after the fact", () => {
    it("saves it under a new id, with its end", async () => {
      const result = await getUsecase().execute({
        mode: "past",
        draft: { ...pastDraft, distanceM: 7000 },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "saved", outingId: "new-outing" });
      expect(await loadOuting(db, "new-outing")).toEqual({
        id: "new-outing",
        boatId: "b1",
        boatConfigurationId: "c1",
        routeId: null,
        outingTypeCode: null,
        captainRowerId: "r1",
        startDateTime: "2026-10-28T12:00",
        estimatedEndDateTime: null,
        endDateTime: "2026-10-28T13:30",
        distanceM: 7000,
        comment: "Belle sortie",
        hasBeenCoached: false,
        crew: [
          { rowerId: "r1", role: "rower" },
          { rowerId: "r2", role: "rower" },
        ],
      });
    });

    it("stores the default configuration when none is chosen, as a departure does", async () => {
      await getUsecase().execute({
        mode: "past",
        draft: { ...pastDraft, boatConfigurationId: null },
        acceptWarnings: false,
      });

      expect((await loadOuting(db, "new-outing"))?.boatConfigurationId).toBe(
        "c1"
      );
    });

    it("refuses an invalid draft without writing", async () => {
      const result = await getUsecase().execute({
        mode: "past",
        draft: { ...pastDraft, endDateTime: null },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "END_REQUIRED" });
      expect(await storedOutingIds()).toEqual([]);
    });

    it("applies the captain option", async () => {
      requireCaptain = true;

      const result = await getUsecase().execute({
        mode: "past",
        draft: { ...pastDraft, captainRowerId: null },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "CAPTAIN_REQUIRED" });
    });

    it("asks to confirm a wrong amount of rowers, then saves when accepted", async () => {
      const draft = { ...pastDraft, rowerIds: ["r1"] };

      const asked = await getUsecase().execute({
        mode: "past",
        draft,
        acceptWarnings: false,
      });
      expect(asked).toEqual({
        status: "warnings",
        warnings: [
          {
            code: "BAD_AMOUNT_OF_ROWERS",
            nbOfRowers: 1,
            boatRowersQuantity: 2,
            boatName: "Marie-Claire",
          },
        ],
      });
      expect(await storedOutingIds()).toEqual([]);

      const accepted = await getUsecase().execute({
        mode: "past",
        draft,
        acceptWarnings: true,
      });
      expect(accepted.status).toBe("saved");
      expect(await storedOutingIds()).toEqual(["new-outing"]);
    });

    it("warns about the boat and the rowers already out at that time", async () => {
      await insertOuting(db, {
        id: "other",
        boatId: "b1",
        startDateTime: "2026-10-28T11:00",
        endDateTime: "2026-10-28T12:30",
        crew: [{ rowerId: "r3", role: "rower" }],
      });
      await insertOuting(db, {
        id: "other2",
        boatId: "b2",
        startDateTime: "2026-10-28T13:00",
        endDateTime: "2026-10-28T14:00",
        crew: [{ rowerId: "r2", role: "rower" }],
      });

      const result = await getUsecase().execute({
        mode: "past",
        draft: pastDraft,
        acceptWarnings: false,
      });

      expect(result).toEqual({
        status: "warnings",
        warnings: [
          { code: "BOAT_OVERLAP", boatName: "Marie-Claire" },
          { code: "ROWERS_OVERLAP", rowerNames: ["Paul Durand"] },
        ],
      });
    });

    it("warns about an ongoing outing of the same rowers", async () => {
      await insertOuting(db, {
        id: "ongoing",
        boatId: "b2",
        startDateTime: "2026-10-28T09:00",
        crew: [{ rowerId: "r1", role: "rower" }],
      });

      const result = await getUsecase().execute({
        mode: "past",
        draft: pastDraft,
        acceptWarnings: false,
      });

      expect(result).toEqual({
        status: "warnings",
        warnings: [{ code: "ROWERS_OVERLAP", rowerNames: ["Léa Martin"] }],
      });
    });

    it("creates the guests of typed names and maps the captain to them", async () => {
      const guest = toNewGuestOptionId("Ana Silva");
      // The guest record is not in the database in this test.
      await saveRower(db, {
        id: "guest-1",
        name: "Ana Silva",
        firstName: "Ana",
        lastName: "Silva",
        status: "guest",
      });

      const result = await getUsecase().execute({
        mode: "past",
        draft: { ...pastDraft, rowerIds: ["r1", guest], captainRowerId: guest },
        acceptWarnings: false,
      });

      expect(result.status).toBe("saved");
      expect(createGuest).toHaveBeenCalledWith("Ana Silva");
      const stored = await loadOuting(db, "new-outing");
      expect(stored?.captainRowerId).toBe("guest-1");
      expect(stored?.crew).toEqual([
        { rowerId: "r1", role: "rower" },
        { rowerId: "guest-1", role: "rower" },
      ]);
    });

    it("creates no guest while warnings are waiting for an answer", async () => {
      await getUsecase().execute({
        mode: "past",
        draft: {
          ...pastDraft,
          rowerIds: [toNewGuestOptionId("Ana Silva")],
        },
        acceptWarnings: false,
      });

      expect(createGuest).not.toHaveBeenCalled();
    });

    it("refuses a typed name that turns out to be a rower already picked", async () => {
      // The typed name is the member Paul Durand, who is picked as well.
      createGuest.mockReturnValueOnce(rowers[1]);

      const result = await getUsecase().execute({
        mode: "past",
        draft: {
          ...pastDraft,
          rowerIds: ["r2", toNewGuestOptionId("paul  durand")],
        },
        acceptWarnings: false,
      });

      expect(result).toEqual({
        status: "error",
        error: "DUPLICATE_CREW_MEMBER",
      });
      expect(await storedOutingIds()).toEqual([]);
    });

    it("refuses a typed member already picked before creating any guest", async () => {
      const result = await getUsecase().execute({
        mode: "past",
        draft: {
          ...pastDraft,
          rowerIds: ["r2", toNewGuestOptionId("Paul Durand")],
        },
        acceptWarnings: true,
      });

      expect(result).toEqual({
        status: "error",
        error: "DUPLICATE_CREW_MEMBER",
      });
      expect(createGuest).not.toHaveBeenCalled();
    });

    it("refuses a typed member already picked before asking about warnings", async () => {
      await insertOuting(db, {
        id: "other",
        boatId: "b1",
        startDateTime: "2026-10-28T11:00",
        endDateTime: "2026-10-28T12:30",
        crew: [{ rowerId: "r1", role: "rower" }],
      });

      const result = await getUsecase().execute({
        mode: "past",
        draft: {
          ...pastDraft,
          rowerIds: ["r2", toNewGuestOptionId("Paul Durand")],
        },
        acceptWarnings: false,
      });

      expect(result).toEqual({
        status: "error",
        error: "DUPLICATE_CREW_MEMBER",
      });
    });

    it("warns about a typed name that is a member already out", async () => {
      await insertOuting(db, {
        id: "other",
        boatId: "b2",
        startDateTime: "2026-10-28T11:00",
        endDateTime: "2026-10-28T12:30",
        crew: [{ rowerId: "r1", role: "rower" }],
      });

      const result = await getUsecase().execute({
        mode: "past",
        draft: {
          ...pastDraft,
          rowerIds: ["r2", toNewGuestOptionId("Léa Martin")],
          captainRowerId: "r2",
        },
        acceptWarnings: false,
      });

      expect(result).toEqual({
        status: "warnings",
        warnings: [{ code: "ROWERS_OVERLAP", rowerNames: ["Léa Martin"] }],
      });
    });

    it("reports a write that failed", async () => {
      writeSucceeds = false;

      const result = await getUsecase().execute({
        mode: "past",
        draft: pastDraft,
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "FAILED_TO_SAVE" });
    });

    it("reports a technical failure instead of throwing", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const result = await getUsecase().execute({
        mode: "past",
        draft: { ...pastDraft, boatId: "unknown" },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "FAILED_TO_SAVE" });
      consoleError.mockRestore();
    });
  });

  describe("a finished outing", () => {
    beforeEach(async () => {
      await insertOuting(db, {
        id: "o1",
        boatId: "b1",
        boatConfigurationId: "c1",
        startDateTime: "2026-10-27T08:00",
        endDateTime: "2026-10-27T09:30",
        distanceM: 8000,
        crew: [
          { rowerId: "r1", role: "rower" },
          { rowerId: "r2", role: "rower" },
        ],
      });
    });

    it("corrects it and keeps the seats of an unchanged crew", async () => {
      await db.execute("UPDATE outing_crew SET position = position + 4");

      const result = await getUsecase().execute({
        mode: "finished",
        draft: {
          ...pastDraft,
          id: "o1",
          startDateTime: "2026-10-27T08:00",
          endDateTime: "2026-10-27T10:00",
          comment: "Corrigée",
        },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "saved", outingId: "o1" });
      const stored = await loadOuting(db, "o1");
      expect(stored).toMatchObject({
        endDateTime: "2026-10-27T10:00",
        comment: "Corrigée",
        distanceM: 8000,
      });
      const positions = await db.select<{ position: number }[]>(
        "SELECT position FROM outing_crew ORDER BY position"
      );
      expect(positions.map((row) => row.position)).toEqual([4, 5]);
    });

    it("keeps a configuration archived since, without counting its seats", async () => {
      await db.execute(
        "INSERT INTO boat_configuration (id, boat_id, position, seats, rigging, coxed, is_default, archived_at) VALUES ('c-old', 'b1', 1, 4, 'scull', 0, 0, '2026-10-01T00:00:00.000Z')"
      );
      await db.execute(
        "UPDATE outing SET boat_configuration_id = 'c-old' WHERE id = 'o1'"
      );

      const result = await getUsecase().execute({
        mode: "finished",
        draft: {
          ...pastDraft,
          id: "o1",
          boatConfigurationId: "c-old",
          rowerIds: ["r1"],
          startDateTime: "2026-10-27T08:00",
          endDateTime: "2026-10-27T09:30",
          comment: "Corrigée",
        },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "saved", outingId: "o1" });
      expect((await loadOuting(db, "o1"))?.boatConfigurationId).toBe("c-old");
    });

    it("does not warn about overlapping itself", async () => {
      const result = await getUsecase().execute({
        mode: "finished",
        draft: {
          ...pastDraft,
          id: "o1",
          startDateTime: "2026-10-27T08:00",
          endDateTime: "2026-10-27T09:30",
        },
        acceptWarnings: false,
      });

      expect(result.status).toBe("saved");
    });

    it("reports an outing that is not in the database", async () => {
      const result = await getUsecase().execute({
        mode: "finished",
        draft: { ...pastDraft, id: "missing" },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "OUTING_NOT_FOUND" });
    });

    it("reports a draft without an id", async () => {
      const result = await getUsecase().execute({
        mode: "finished",
        draft: pastDraft,
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "OUTING_NOT_FOUND" });
    });

    it("may be corrected onto a boat that is out", async () => {
      ongoingSessions = [
        {
          id: "ongoing",
          boat: { id: "b2", name: "Pierre" },
          route: null,
          rowers: [],
          startDateTime: "2026-10-28T09:00",
          comment: "",
          endDateTime: null,
        },
      ];

      const result = await getUsecase().execute({
        mode: "finished",
        draft: {
          ...pastDraft,
          id: "o1",
          boatId: "b2",
          boatConfigurationId: "c2",
          startDateTime: "2026-10-27T08:00",
          endDateTime: "2026-10-27T09:30",
        },
        acceptWarnings: false,
      });

      expect(result.status).toBe("saved");
    });
  });

  describe("an ongoing outing", () => {
    const startDateTime = new Date(2026, 9, 28, 9, 0).toISOString();
    const ongoingDraft: OutingDraft = {
      ...pastDraft,
      id: "o1",
      startDateTime: "2026-10-28T09:00",
      endDateTime: null,
      estimatedEndDateTime: "2026-10-28T11:00",
      comment: "",
      hasBeenCoached: null,
    };
    const ongoingSession: ZustandSession = {
      id: "o1",
      boat: { id: "b1", name: "Marie-Claire" },
      route: null,
      boatConfigurationId: "c1",
      captainRowerId: "r1",
      startDateTime,
      comment: "",
      endDateTime: null,
      rowers: [
        { id: "r1", name: "Léa Martin", role: "rower" },
        { id: "r2", name: "Paul Durand", role: "rower" },
      ],
    };

    beforeEach(async () => {
      ongoingSessions = [ongoingSession];
      await insertOuting(db, {
        id: "o1",
        boatId: "b1",
        boatConfigurationId: "c1",
        captainRowerId: "r1",
        startDateTime,
        crew: [
          { rowerId: "r1", role: "rower" },
          { rowerId: "r2", role: "rower" },
        ],
      });
    });

    it("corrects the database and the ongoing list, and stays ongoing", async () => {
      const result = await getUsecase().execute({
        mode: "ongoing",
        draft: {
          ...ongoingDraft,
          boatId: "b2",
          boatConfigurationId: "c2",
          routeId: "route1",
          rowerIds: ["r3", "r2"],
          captainRowerId: "r3",
          comment: "Vent",
        },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "saved", outingId: "o1" });
      expect(await loadOuting(db, "o1")).toMatchObject({
        boatId: "b2",
        routeId: "route1",
        endDateTime: null,
        estimatedEndDateTime: "2026-10-28T11:00",
        comment: "Vent",
        captainRowerId: "r3",
        crew: [
          { rowerId: "r3", role: "rower" },
          { rowerId: "r2", role: "rower" },
        ],
      });
      expect(ongoingSessions).toEqual([
        {
          id: "o1",
          boat: { id: "b2", name: "Pierre" },
          route: { id: "route1", name: "Amont" },
          boatConfigurationId: "c2",
          outingTypeCode: null,
          captainRowerId: "r3",
          startDateTime,
          estimatedEndDateTime: new Date(2026, 9, 28, 11, 0).toISOString(),
          comment: "Vent",
          endDateTime: null,
          rowers: [
            { id: "r3", name: "Sam Petit", role: "rower" },
            { id: "r2", name: "Paul Durand", role: "rower" },
          ],
        },
      ]);
    });

    it("puts the ongoing list back when the write fails", async () => {
      writeSucceeds = false;

      const result = await getUsecase().execute({
        mode: "ongoing",
        draft: { ...ongoingDraft, comment: "Vent" },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "FAILED_TO_SAVE" });
      expect(ongoingSessions).toEqual([ongoingSession]);
    });

    it("puts the ongoing list back when the outing is not in the database", async () => {
      await db.execute("DELETE FROM outing");

      const result = await getUsecase().execute({
        mode: "ongoing",
        draft: { ...ongoingDraft, comment: "Vent" },
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "OUTING_NOT_FOUND" });
      expect(ongoingSessions).toEqual([ongoingSession]);
    });

    it("reports an outing that is no longer ongoing", async () => {
      ongoingSessions = [];

      const result = await getUsecase().execute({
        mode: "ongoing",
        draft: ongoingDraft,
        acceptWarnings: false,
      });

      expect(result).toEqual({ status: "error", error: "OUTING_NOT_FOUND" });
    });

    it("refuses a boat that is on another ongoing outing", async () => {
      ongoingSessions = [
        ongoingSession,
        { ...ongoingSession, id: "o2", boat: { id: "b2", name: "Pierre" } },
      ];

      const result = await getUsecase().execute({
        mode: "ongoing",
        draft: { ...ongoingDraft, boatId: "b2" },
        acceptWarnings: false,
      });

      expect(result).toEqual({
        status: "error",
        error: "BOAT_ALREADY_ON_SESSION",
      });
    });

    it("warns about rowers who are on another ongoing outing", async () => {
      await insertOuting(db, {
        id: "o2",
        boatId: "b2",
        startDateTime: new Date(2026, 9, 28, 10, 0).toISOString(),
        crew: [{ rowerId: "r3", role: "rower" }],
      });

      const result = await getUsecase().execute({
        mode: "ongoing",
        draft: { ...ongoingDraft, rowerIds: ["r1", "r3"] },
        acceptWarnings: false,
      });

      expect(result).toEqual({
        status: "warnings",
        warnings: [{ code: "ROWERS_OVERLAP", rowerNames: ["Sam Petit"] }],
      });
      expect(ongoingSessions).toEqual([ongoingSession]);
    });
  });
});
