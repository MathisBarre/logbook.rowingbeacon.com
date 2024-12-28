import { beforeAll, describe, expect, it, vi } from "vitest";
import { IStartSessionRepository } from "./StartSession.repository.interface";
import { createInMemoryStartSessionRepository } from "./StartSession.repository.inMemory";
import { StartSessionUsecase } from "./StartSession.usecase";

import { generateIds } from "../../../_common/utils/ids.utils";
import { asOk } from "../../../_common/utils/error";

describe("StartSession", () => {
  let repository: IStartSessionRepository;
  let result: Awaited<ReturnType<StartSessionUsecase["execute"]>> | null;

  const [BOAT_ID, ROUTE_ID, ROWER_ID] = generateIds("test");
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

  const init = () => {
    result = null;

    repository = createInMemoryStartSessionRepository({
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
  };

  const getUsecase = () => new StartSessionUsecase(repository);

  describe("Happy path", () => {
    beforeAll(async () => {
      init();
      vi.spyOn(repository, "saveSession");
      result = await getUsecase().execute(happyCasePayload);
    });

    it("should execute save", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
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
});
