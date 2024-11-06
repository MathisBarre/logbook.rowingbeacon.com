import { describe, it, expect } from "vitest";
import {
  SessionToStart,
  isInvalidStartSessionDate,
} from "./SessionToStart.business";
import { addDays } from "../../_common/utils/date.utils";

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
