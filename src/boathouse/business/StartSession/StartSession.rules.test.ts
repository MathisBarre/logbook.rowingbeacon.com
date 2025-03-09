import { describe, it, expect } from "vitest";
import { Boat, BoatTypeEnum } from "../../../_common/business/boat.rules";
import {
  checkIfNotSameRowersAsSeatsInBoat,
  getAlreadyOnStartedSessionRowersId,
  isInvalidStartSessionDate,
  SessionToStart,
  StartedSession,
} from "./StartSession.rules";
import { addDays } from "../../../_common/utils/date.utils";
import { Rower } from "../../../_common/business/rower.rules";

describe("Boat Business Logic", () => {
  const BOAT_TYPE = BoatTypeEnum.FOUR_ROWERS_COXLESS;
  const ROWER_QUANTITY = 4;

  const boat: Boat = {
    id: "1",
    name: "Test Boat",
    type: BOAT_TYPE,
  };

  describe("notSameRowersAsSeatsInBoat", () => {
    it("should return true when there are fewer rowers than required", () => {
      expect(checkIfNotSameRowersAsSeatsInBoat(ROWER_QUANTITY - 1, boat)).toBe(
        true
      );
    });

    it("should return false when there are the same number of rowers as required", () => {
      expect(checkIfNotSameRowersAsSeatsInBoat(ROWER_QUANTITY, boat)).toBe(
        false
      );
    });

    it("should return true when there are more rowers than required", () => {
      expect(checkIfNotSameRowersAsSeatsInBoat(ROWER_QUANTITY + 1, boat)).toBe(
        true
      );
    });
  });
});
describe("SessionToStart", () => {
  const baseDate = new Date();

  const baseSession: SessionToStart = {
    boatId: "1",
    rowersId: ["1", "2"],
    startDatetime: baseDate,
    estimatedEndDatetime: baseDate,
    routeId: "1",
    comment: "comment",
  };

  describe("isInvalidStartSessionDate", () => {
    it("should return true when start date is after estimated end date", () => {
      const session: SessionToStart = {
        ...baseSession,
        startDatetime: addDays(baseDate, 1),
      };

      expect(isInvalidStartSessionDate(session)).toBe(true);
    });

    it("should return false when start date is before estimated end date", () => {
      const session: SessionToStart = {
        ...baseSession,
        startDatetime: addDays(baseDate, -1),
      };

      expect(isInvalidStartSessionDate(session)).toBe(false);
    });

    it("should return false when start date equals estimated end date", () => {
      const session: SessionToStart = {
        ...baseSession,
      };

      expect(isInvalidStartSessionDate(session)).toBe(false);
    });
  });
});
describe("getRowersAlreadyOnStartedSession", () => {
  it("should return empty array when no rowers are on session", () => {
    const rowers: string[] = ["rower1", "rower2"];
    const startedSessions: StartedSession[] = [];

    const result = getAlreadyOnStartedSessionRowersId(rowers, startedSessions);

    expect(result).toEqual([]);
  });

  it("should return rowers that are already on session", () => {
    const rowers: string[] = ["rower1", "rower2", "rower3"];
    const startedSessions = [
      {
        id: "session1",
        rowers: [
          { id: "rower1", name: "Rower 1" } as Rower,
          { id: "rower2", name: "Rower 2" } as Rower,
        ],
      },
    ];

    const result = getAlreadyOnStartedSessionRowersId(rowers, startedSessions);

    expect(result).toEqual(["rower1", "rower2"]);
  });

  it("should handle multiple sessions", () => {
    const rowers: string[] = ["rower1", "rower2", "rower3"];
    const startedSessions = [
      {
        id: "session1",
        rowers: [{ id: "rower1", name: "Rower 1" } as Rower],
      },
      {
        id: "session2",
        rowers: [{ id: "rower3", name: "Rower 3" } as Rower],
      },
    ];

    const result = getAlreadyOnStartedSessionRowersId(rowers, startedSessions);

    expect(result).toEqual(["rower1", "rower3"]);
  });
});
