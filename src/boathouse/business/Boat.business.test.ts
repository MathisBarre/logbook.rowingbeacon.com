import { describe, it, expect } from "vitest";
import { checkIfNotSameRowersAsSeatsInBoat } from "./Boat.business";
import { Boat } from "../../_common/types/boat.type";

describe("Boat Business Logic", () => {
  const ROWER_QUANTITY = 4;

  const boat: Boat = {
    id: "1",
    name: "Test Boat",
    rowersQuantity: ROWER_QUANTITY,
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
