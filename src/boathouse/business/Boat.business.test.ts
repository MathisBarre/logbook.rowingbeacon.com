import { describe, it, expect } from "vitest";
import { checkIfNotSameRowersAsSeatsInBoat } from "./Boat.business";
import { Boat, BoatTypeEnum } from "../../_common/business/boat.rules";

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
