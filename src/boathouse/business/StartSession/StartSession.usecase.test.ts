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
      rowers: [],
    });
  };

  const getUsecase = () => new StartSessionUsecase(repository);

  describe("Happy path", () => {
    beforeAll(async () => {
      init();
      vi.spyOn(repository, "saveSession");
      result = await getUsecase().execute(
        {
          boatId: BOAT_ID,
          routeId: ROUTE_ID,
          rowersId: [ROWER_ID],
          startDatetime: new Date("2025-01-01T00:00:00Z"),
          estimatedEndDatetime: new Date("2025-01-01T02:00:00Z"),
          comment: "DUMMY:comment",
        },
        {
          ignoreRowersAlreadyOnSessionError: false,
          ignoreRowersNumberError: false,
        }
      );
    });

    it("should execute save", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repository.saveSession).toHaveBeenCalled();
    });

    it("return should be success", () => {
      expect(result).toEqual(asOk(true));
    });
  });
});
