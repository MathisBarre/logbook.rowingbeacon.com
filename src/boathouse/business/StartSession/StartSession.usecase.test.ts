/* eslint-disable @typescript-eslint/unbound-method */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IStartSessionRepository } from "./StartSession.repository.interface";
import { createInMemoryStartSessionRepository } from "./StartSession.repository.inMemory";
import { StartSessionUsecase } from "./StartSession.usecase";
import { generateIds } from "../../../_common/utils/ids.utils";
import { asError, asOk, TechnicalError } from "../../../_common/utils/error";
import { BoatTypeEnum } from "../../../_common/business/boat.rules";
import { boatLevelConfigStoreCore } from "../../../_common/store/boatLevelConfig.store";
import { toNewGuestOptionId } from "../../../_common/business/crew.rules";
import { AgeCategoryEnum } from "../../../_common/business/ageCategory.rules";

describe("StartSession", () => {
  let repository: IStartSessionRepository;
  let result: Awaited<ReturnType<StartSessionUsecase["execute"]>> | null;

  const [BOAT_ID, ROUTE_ID, ROWER_ID, ROWER_ID_2] = generateIds("test");
  const startDateTimeStr = "2025-01-01T00:00:00.000Z";
  const endDateTimeStr = "2025-01-01T02:00:00.000Z";
  const happyCasePayload = {
    sessionToStart: {
      boatId: BOAT_ID,
      routeId: ROUTE_ID,
      rowersId: [ROWER_ID],
      startDatetime: new Date(startDateTimeStr),
      estimatedEndDatetime: new Date(endDateTimeStr),
      comment: "DUMMY:comment",
    },
    params: {
      ignoreRowersAlreadyOnSessionError: false,
      ignoreRowersNumberError: false,
    },
  };
  const getHappyCaseInMemoryData = () => ({
    routes: [
      {
        id: ROUTE_ID,
        name: "DUMMY:route",
      },
    ],
    boats: [
      {
        id: BOAT_ID,
        name: "DUMMY:boat",
        type: BoatTypeEnum.ONE_ROWER_COXLESS,
      },
    ],
    ongoingSessions: [],
    rowers: [
      {
        id: ROWER_ID,
        name: "DUMMY:rower",
      },
    ],
  });

  const init = () => {
    result = null;
    repository = createInMemoryStartSessionRepository(
      getHappyCaseInMemoryData()
    );
  };

  const boatLevelConfigStore = boatLevelConfigStoreCore.getState();

  const getUsecase = () =>
    new StartSessionUsecase(repository, boatLevelConfigStore);

  describe("when everything is ok (happy path)", () => {
    beforeAll(async () => {
      init();
      vi.spyOn(repository, "saveSession");
      result = await getUsecase().execute(happyCasePayload);
    });

    it("should execute save", () => {
      expect(repository.saveSession).toHaveBeenCalledWith({
        boat: {
          id: BOAT_ID,
          name: "DUMMY:boat",
        },
        route: {
          id: ROUTE_ID,
          name: "DUMMY:route",
        },
        rowers: [
          {
            id: ROWER_ID,
            name: "DUMMY:rower",
            role: "rower",
          },
        ],
        boatConfigurationId: null,
        outingTypeCode: null,
        captainRowerId: null,
        startDateTime: startDateTimeStr,
        estimatedEndDateTime: endDateTimeStr,
        comment: "DUMMY:comment",
      });
    });

    it("return should be success", () => {
      expect(result).toEqual(asOk(true));
    });
  });

  describe("when the payload is invalid", () => {
    beforeAll(async () => {
      init();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          startDatetime: new Date(endDateTimeStr),
          estimatedEndDatetime: new Date(startDateTimeStr),
        },
      });
    });

    it("should return an error", () => {
      expect(result).toEqual(
        asError({
          code: "INVALID_DATETIME",
          details: {
            startDatetime: endDateTimeStr,
            estimatedEndDatetime: startDateTimeStr,
          },
        })
      );
    });
  });

  describe("when invalid rowers quantity", () => {
    beforeAll(async () => {
      init();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: [ROWER_ID, ROWER_ID_2],
        },
      });
    });

    it("return should be error", () => {
      expect(result).toEqual(
        asError({
          code: "BAD_AMOUNT_OF_ROWERS",
          details: {
            boatId: BOAT_ID,
            rowersId: [],
          },
        })
      );
    });
  });

  describe("when invalid rowers quantity, but is ignored", () => {
    beforeAll(async () => {
      init();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: [ROWER_ID, ROWER_ID_2],
        },
        params: {
          ...happyCasePayload.params,
          ignoreRowersNumberError: true,
        },
      });
    });

    it("return should be success", () => {
      expect(result).toEqual(asOk(true));
    });
  });

  describe("when rowers already on session", () => {
    beforeAll(async () => {
      init();
      repository = createInMemoryStartSessionRepository({
        ...getHappyCaseInMemoryData(),
        ongoingSessions: [
          {
            id: "DUMMY:session",
            rowers: [{ id: ROWER_ID, name: "DUMMY:rower" }],
          },
        ],
      });
      result = await getUsecase().execute(happyCasePayload);
    });

    it("return should be error", () => {
      expect(result).toEqual(
        asError({
          code: "ROWERS_ALREADY_ON_STARTED_SESSION",
          details: {
            rowersId: [ROWER_ID],
          },
        })
      );
    });
  });

  describe("when rowers already on session, but is ignored", () => {
    beforeAll(async () => {
      init();
      repository = createInMemoryStartSessionRepository({
        ...getHappyCaseInMemoryData(),
        ongoingSessions: [
          {
            id: "DUMMY:session",
            rowers: [{ id: ROWER_ID, name: "DUMMY:rower" }],
          },
        ],
      });
      result = await getUsecase().execute({
        ...happyCasePayload,
        params: {
          ...happyCasePayload.params,
          ignoreRowersAlreadyOnSessionError: true,
        },
      });
    });

    it("return should be success", () => {
      expect(result).toEqual(asOk(true));
    });
  });

  describe("when technical error", () => {
    beforeAll(async () => {
      init();
      vi.spyOn(repository, "saveSession").mockImplementationOnce(() => {
        throw new Error("DUMMY:error");
      });
      result = await getUsecase().execute(happyCasePayload);
    });

    it("return should be error", () => {
      expect(result).toEqual(
        asError(new TechnicalError(new Error("DUMMY:error")))
      );
    });
  });

  describe("with a cox, a chosen configuration, a guest and a captain", () => {
    const FOUR_SCULL_COXED = {
      id: "conf-4x+",
      seats: 4,
      rigging: "scull" as const,
      coxed: true,
      isDefault: true,
      position: 0,
    };
    const FOUR_SWEEP = {
      id: "conf-4-",
      seats: 4,
      rigging: "sweep" as const,
      coxed: false,
      isDefault: false,
      position: 1,
    };
    const crewRowers = ["r1", "r2", "r3", "r4", "cox"].map((id) => ({
      id,
      name: `DUMMY:${id}`,
    }));

    const setup = () => {
      init();
      repository = createInMemoryStartSessionRepository({
        ...getHappyCaseInMemoryData(),
        boats: [
          {
            id: BOAT_ID,
            name: "DUMMY:boat",
            type: BoatTypeEnum.FOUR_ROWERS_COXED,
            configurations: [FOUR_SCULL_COXED, FOUR_SWEEP],
          },
        ],
        rowers: [...crewRowers],
      });
      vi.spyOn(repository, "saveSession");
    };

    it("counts the cox in the crew of the default configuration", async () => {
      setup();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: ["r1", "r2", "r3", "r4"],
          coxId: "cox",
        },
      });

      expect(result).toEqual(asOk(true));
      const saved = vi.mocked(repository.saveSession).mock.calls[0][0];
      expect(saved.boatConfigurationId).toBe("conf-4x+");
      expect(saved.rowers.map((rower) => [rower.id, rower.role])).toEqual([
        ["r1", "rower"],
        ["r2", "rower"],
        ["r3", "rower"],
        ["r4", "rower"],
        ["cox", "cox"],
      ]);
    });

    it("checks the crew size against the chosen configuration", async () => {
      setup();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: ["r1", "r2", "r3", "r4"],
          coxId: "cox",
          boatConfigurationId: "conf-4-",
        },
      });

      expect(result).toEqual(
        asError({
          code: "BAD_AMOUNT_OF_ROWERS",
          details: {
            nbOfRowers: 5,
            boatRowersQuantity: 4,
            boatName: "DUMMY:boat",
          },
        })
      );
    });

    it("notices rowers filling the cox's place in a coxed boat", async () => {
      setup();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: ["r1", "r2", "r3", "r4", "r5"],
          coxId: null,
          boatConfigurationId: "conf-4+",
        },
      });

      expect(result).toEqual(
        asError({
          code: "BAD_AMOUNT_OF_ROWERS",
          details: {
            nbOfRowers: 5,
            boatRowersQuantity: 4,
            boatName: "DUMMY:boat",
          },
        })
      );
    });

    it("creates a guest for a typed name and keeps them as captain", async () => {
      setup();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: ["r1", "r2", "r3", toNewGuestOptionId("Ana Silva")],
          boatConfigurationId: "conf-4-",
          captainRowerId: toNewGuestOptionId("Ana Silva"),
        },
        params: { ...happyCasePayload.params, requireCaptain: true },
      });

      expect(result).toEqual(asOk(true));
      const saved = vi.mocked(repository.saveSession).mock.calls[0][0];
      const guest = saved.rowers[3];
      expect(guest.name).toBe("Ana Silva");
      expect(saved.captainRowerId).toBe(guest.id);
    });

    it("refuses to start without a captain when one is required", async () => {
      setup();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: ["r1", "r2", "r3", "r4"],
          boatConfigurationId: "conf-4-",
          captainRowerId: "someone-not-in-the-crew",
        },
        params: { ...happyCasePayload.params, requireCaptain: true },
      });

      expect(result).toEqual(asError({ code: "CAPTAIN_REQUIRED" }));
    });

    it("refuses the same person as rower and cox", async () => {
      setup();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: ["r1", "r2", "r3", "r4"],
          coxId: "r1",
        },
        params: { ...happyCasePayload.params, ignoreRowersNumberError: true },
      });

      expect(result).toEqual(asError({ code: "DUPLICATE_CREW_MEMBER" }));
    });

    it("refuses the same guest typed twice", async () => {
      setup();
      result = await getUsecase().execute({
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: [toNewGuestOptionId("Paul"), toNewGuestOptionId(" paul ")],
        },
        params: { ...happyCasePayload.params, ignoreRowersNumberError: true },
      });

      expect(result).toEqual(asError({ code: "DUPLICATE_CREW_MEMBER" }));
    });

    it("refuses a second outing on a boat that is already out", async () => {
      setup();
      const payload = {
        ...happyCasePayload,
        sessionToStart: {
          ...happyCasePayload.sessionToStart,
          rowersId: ["r1", "r2", "r3", "r4"],
          boatConfigurationId: "conf-4-",
        },
      };
      expect(await getUsecase().execute(payload)).toEqual(asOk(true));
      expect(await getUsecase().execute(payload)).toEqual(
        asError({ code: "BOAT_ALREADY_ON_SESSION" })
      );
    });

    it("refuses a boat that is out of service", async () => {
      init();
      repository = createInMemoryStartSessionRepository({
        ...getHappyCaseInMemoryData(),
        boats: [
          {
            id: BOAT_ID,
            name: "DUMMY:boat",
            type: BoatTypeEnum.ONE_ROWER_COXLESS,
            isInMaintenance: true,
          },
        ],
      });
      vi.spyOn(repository, "saveSession");

      result = await getUsecase().execute(happyCasePayload);

      expect(result).toEqual(asError({ code: "BOAT_UNUSABLE" }));
      expect(repository.saveSession).not.toHaveBeenCalled();
    });

    it("never lets a guest or the cox fail the level check", async () => {
      init();
      repository = createInMemoryStartSessionRepository({
        ...getHappyCaseInMemoryData(),
        boats: [
          {
            id: BOAT_ID,
            name: "DUMMY:boat",
            type: BoatTypeEnum.FOUR_ROWERS_COXED,
            configurations: [FOUR_SCULL_COXED],
          },
        ],
        rowers: [
          ...["r1", "r2", "r3"].map((id) => ({
            id,
            name: id,
            category: AgeCategoryEnum.SENIOR,
          })),
          { id: "guest", name: "Ana", status: "guest" as const },
          { id: "cox", name: "Cox" },
        ],
      });
      boatLevelConfigStoreCore.setState({
        boatLevelConfigs: [
          {
            boatId: BOAT_ID,
            minimalRowerCategory: AgeCategoryEnum.SENIOR,
            minimalRowerType: null,
          },
        ],
      });

      try {
        result = await getUsecase().execute({
          ...happyCasePayload,
          sessionToStart: {
            ...happyCasePayload.sessionToStart,
            rowersId: ["r1", "r2", "r3", "guest"],
            coxId: "cox",
          },
        });
      } finally {
        boatLevelConfigStoreCore.setState({ boatLevelConfigs: [] });
      }

      expect(result).toEqual(asOk(true));
    });
  });
});
