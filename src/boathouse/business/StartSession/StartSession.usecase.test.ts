/* eslint-disable @typescript-eslint/unbound-method */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IStartSessionRepository } from "./StartSession.repository.interface";
import { createInMemoryStartSessionRepository } from "./StartSession.repository.inMemory";
import { StartSessionUsecase } from "./StartSession.usecase";
import { generateIds } from "../../../_common/utils/ids.utils";
import { asError, asOk, TechnicalError } from "../../../_common/utils/error";
import { BoatTypeEnum } from "../../../_common/business/boat.rules";
import { boatLevelConfigStoreCore } from "../../../_common/store/boatLevelConfig.store";

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
          },
        ],
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
});
