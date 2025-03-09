import { describe, it, expect } from "vitest";
import {
  BoatTypeEnum,
  Boat,
  isBoatAvailable,
  getBoatsByType,
  getTypelessBoats,
  sortBoatsByTypeAndName,
  getBoatNumberOfRowers,
  getTypeLabel,
  boathTypeWithLabel,
} from "./boat.rules";

describe("Boat Business Rules", () => {
  // Sample test data to be used across multiple tests
  const mockBoats: Boat[] = [
    { id: "boat_1", name: "Alpha", type: BoatTypeEnum.ONE_ROWER_COXLESS },
    { id: "boat_2", name: "Charlie", type: BoatTypeEnum.TWO_ROWERS_COXLESS },
    { id: "boat_3", name: "Bravo", type: BoatTypeEnum.ONE_ROWER_COXLESS },
    { id: "boat_4", name: "Delta", type: BoatTypeEnum.FOUR_ROWERS_COXED },
    {
      id: "boat_5",
      name: "Echo",
      type: BoatTypeEnum.OTHER,
      isInMaintenance: true,
    },
    { id: "boat_6", name: "Foxtrot", isInMaintenance: false },
  ];

  describe("isBoatAvailable", () => {
    it("should return true when boat is not in any ongoing session", () => {
      // Arrange
      const ongoingSessions = [
        { boat: { id: "boat_2" } },
        { boat: { id: "boat_4" } },
      ];

      // Act
      const result = isBoatAvailable(mockBoats[0], ongoingSessions);

      // Assert
      expect(result).toBe(true);
    });

    it("should return false when boat is in an ongoing session", () => {
      // Arrange
      const ongoingSessions = [
        { boat: { id: "boat_1" } },
        { boat: { id: "boat_4" } },
      ];

      // Act
      const result = isBoatAvailable(mockBoats[0], ongoingSessions);

      // Assert
      expect(result).toBe(false);
    });

    it("should return true with empty ongoing sessions", () => {
      // Arrange
      const ongoingSessions: { boat: { id: string } }[] = [];

      // Act
      const result = isBoatAvailable(mockBoats[0], ongoingSessions);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe("getBoatsByType", () => {
    it("should return boats matching the given types", () => {
      // Arrange
      const types = [
        BoatTypeEnum.ONE_ROWER_COXLESS,
        BoatTypeEnum.FOUR_ROWERS_COXED,
      ];

      // Act
      const result = getBoatsByType(mockBoats, types);

      // Assert
      expect(result).toHaveLength(3);
      expect(result).toContainEqual(mockBoats[0]);
      expect(result).toContainEqual(mockBoats[2]);
      expect(result).toContainEqual(mockBoats[3]);
    });

    it("should return empty array when no boats match the types", () => {
      // Arrange
      const types = [BoatTypeEnum.EIGHT_ROWERS_COXED];

      // Act
      const result = getBoatsByType(mockBoats, types);

      // Assert
      expect(result).toEqual([]);
    });

    it("should exclude boats without a type", () => {
      // Arrange
      const types = [undefined as unknown as string];

      // Act
      const result = getBoatsByType(mockBoats, types);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe("getTypelessBoats", () => {
    it("should return only boats without a type", () => {
      // Act
      const result = getTypelessBoats(mockBoats);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockBoats[5]);
    });

    it("should return empty array when all boats have types", () => {
      // Arrange
      const boatsWithTypes = mockBoats.filter(
        (boat) => boat.type !== undefined
      );

      // Act
      const result = getTypelessBoats(boatsWithTypes);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe("sortBoatsByTypeAndName", () => {
    it("should sort boats by defined type order, then by name", () => {
      // Act
      const result = sortBoatsByTypeAndName(mockBoats);

      // Assert - Check order correctly follows the specified type order and alphabetical names
      expect(result[0]).toBe(mockBoats[0]); // Alpha (ONE_ROWER_COXLESS)
      expect(result[1]).toBe(mockBoats[2]); // Bravo (ONE_ROWER_COXLESS)
      expect(result[2]).toBe(mockBoats[1]); // Charlie (TWO_ROWERS_COXLESS)
      expect(result[3]).toBe(mockBoats[3]); // Delta (FOUR_ROWERS_COXED)
      expect(result[4]).toBe(mockBoats[4]); // Echo (OTHER)
      expect(result[5]).toBe(mockBoats[5]); // Foxtrot (undefined - treated as OTHER)
    });

    it("should sort boats alphabetically when they have the same type", () => {
      // Arrange
      const sameTypeBoats: Boat[] = [
        { id: "boat_1", name: "Zulu", type: BoatTypeEnum.ONE_ROWER_COXLESS },
        { id: "boat_2", name: "Alpha", type: BoatTypeEnum.ONE_ROWER_COXLESS },
        { id: "boat_3", name: "Lima", type: BoatTypeEnum.ONE_ROWER_COXLESS },
      ];

      // Act
      const result = sortBoatsByTypeAndName(sameTypeBoats);

      // Assert
      expect(result[0].name).toBe("Alpha");
      expect(result[1].name).toBe("Lima");
      expect(result[2].name).toBe("Zulu");
    });
  });

  describe("getBoatNumberOfRowers", () => {
    it("should return correct number of rowers for each boat type", () => {
      expect(getBoatNumberOfRowers(BoatTypeEnum.ONE_ROWER_COXLESS)).toBe(1);
      expect(getBoatNumberOfRowers(BoatTypeEnum.TWO_ROWERS_COXLESS)).toBe(2);
      expect(getBoatNumberOfRowers(BoatTypeEnum.TWO_ROWERS_COXED)).toBe(3);
      expect(getBoatNumberOfRowers(BoatTypeEnum.FOUR_ROWERS_COXLESS)).toBe(4);
      expect(getBoatNumberOfRowers(BoatTypeEnum.FOUR_ROWERS_COXED)).toBe(5);
      expect(getBoatNumberOfRowers(BoatTypeEnum.EIGHT_ROWERS_COXED)).toBe(9);
    });

    it("should return undefined for OTHER boat type", () => {
      expect(getBoatNumberOfRowers(BoatTypeEnum.OTHER)).toBeUndefined();
    });

    it("should return undefined when type is undefined", () => {
      expect(getBoatNumberOfRowers(undefined)).toBeUndefined();
    });
  });

  describe("getTypeLabel", () => {
    it("should return correct label for each boat type", () => {
      expect(getTypeLabel(BoatTypeEnum.ONE_ROWER_COXLESS)).toBe("1x");
      expect(getTypeLabel(BoatTypeEnum.TWO_ROWERS_COXLESS)).toBe("2x / 2-");
      expect(getTypeLabel(BoatTypeEnum.TWO_ROWERS_COXED)).toBe("2+");
      expect(getTypeLabel(BoatTypeEnum.FOUR_ROWERS_COXLESS)).toBe("4x / 4-");
      expect(getTypeLabel(BoatTypeEnum.FOUR_ROWERS_COXED)).toBe("4+");
      expect(getTypeLabel(BoatTypeEnum.EIGHT_ROWERS_COXED)).toBe("8x / 8+");
      expect(getTypeLabel(BoatTypeEnum.OTHER)).toBe("Autre");
    });

    it("should return LABEL_NOT_FOUND when type is undefined", () => {
      expect(getTypeLabel(undefined)).toBe("LABEL_NOT_FOUND");
    });
  });

  describe("boathTypeWithLabel", () => {
    it("should contain all boat types with correct labels", () => {
      // Assert
      expect(boathTypeWithLabel).toHaveLength(7);

      // Check each type is present with its correct label
      expect(boathTypeWithLabel).toContainEqual({
        type: BoatTypeEnum.ONE_ROWER_COXLESS,
        label: "1x",
      });
      expect(boathTypeWithLabel).toContainEqual({
        type: BoatTypeEnum.TWO_ROWERS_COXLESS,
        label: "2x / 2-",
      });
      expect(boathTypeWithLabel).toContainEqual({
        type: BoatTypeEnum.TWO_ROWERS_COXED,
        label: "2+",
      });
      expect(boathTypeWithLabel).toContainEqual({
        type: BoatTypeEnum.FOUR_ROWERS_COXLESS,
        label: "4x / 4-",
      });
      expect(boathTypeWithLabel).toContainEqual({
        type: BoatTypeEnum.FOUR_ROWERS_COXED,
        label: "4+",
      });
      expect(boathTypeWithLabel).toContainEqual({
        type: BoatTypeEnum.EIGHT_ROWERS_COXED,
        label: "8x / 8+",
      });
      expect(boathTypeWithLabel).toContainEqual({
        type: BoatTypeEnum.OTHER,
        label: "Autre",
      });
    });
  });
});
