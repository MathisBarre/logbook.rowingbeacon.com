import { describe, test, expect } from "vitest";
import {
  BoatLevelConfig,
  canRowerUseBoat,
  getMinimumValidRowersNeeded,
  getBoatTypeLevelConfig,
} from "./boatLevelConfig.rules";
import { AgeCategoryEnum } from "../business/ageCategory.rules";
import { Rower } from "../business/rower.rules";
import { SeriousnessCategoryEnum } from "../business/seriousness.rules";
import { BoatTypeEnum } from "../business/boat.rules";

describe("canRowerUseBoat", () => {
  test("should allow rower with equal category and type", () => {
    // Arrange
    const boatLevelConfig: BoatLevelConfig = {
      boatId: "boat-1",
      minimalRowerCategory: AgeCategoryEnum.J14,
      minimalRowerType: SeriousnessCategoryEnum.COMPETITOR,
    };

    const rower: Rower = {
      id: "rower-1",
      category: AgeCategoryEnum.J14,
      type: SeriousnessCategoryEnum.COMPETITOR,
      name: "John Doe",
    };

    // Act
    const result = canRowerUseBoat(boatLevelConfig, rower);

    // Assert
    expect(result).toBe(true);
  });

  test("should allow rower with higher category and type", () => {
    // Arrange
    const boatLevelConfig: BoatLevelConfig = {
      boatId: "boat-1",
      minimalRowerCategory: AgeCategoryEnum.J14,
      minimalRowerType: SeriousnessCategoryEnum.RECREATIONAL,
    };

    const rower: Rower = {
      id: "rower-1",
      category: AgeCategoryEnum.SENIOR,
      type: SeriousnessCategoryEnum.COMPETITOR,
      name: "John Doe",
    };

    // Act
    const result = canRowerUseBoat(boatLevelConfig, rower);

    // Assert
    expect(result).toBe(true);
  });

  test("should deny rower with lower category", () => {
    // Arrange
    const boatLevelConfig: BoatLevelConfig = {
      boatId: "boat-1",
      minimalRowerCategory: AgeCategoryEnum.SENIOR,
      minimalRowerType: SeriousnessCategoryEnum.RECREATIONAL,
    };

    const rower: Rower = {
      id: "rower-1",
      category: AgeCategoryEnum.J14,
      type: SeriousnessCategoryEnum.COMPETITOR,
      name: "John Doe",
    };

    // Act
    const result = canRowerUseBoat(boatLevelConfig, rower);

    // Assert
    expect(result).toBe(false);
  });

  test("should deny rower with lower type", () => {
    // Arrange
    const boatLevelConfig: BoatLevelConfig = {
      boatId: "boat-1",
      minimalRowerCategory: AgeCategoryEnum.J14,
      minimalRowerType: SeriousnessCategoryEnum.COMPETITOR,
    };

    const rower: Rower = {
      id: "rower-1",
      category: AgeCategoryEnum.SENIOR,
      type: SeriousnessCategoryEnum.RECREATIONAL,
      name: "John Doe",
    };

    // Act
    const result = canRowerUseBoat(boatLevelConfig, rower);

    // Assert
    expect(result).toBe(false);
  });

  test("should handle null config values", () => {
    // Arrange
    const boatLevelConfig: BoatLevelConfig = {
      boatId: "boat-1",
      minimalRowerCategory: null,
      minimalRowerType: null,
    };

    const rower: Rower = {
      id: "rower-1",
      category: AgeCategoryEnum.J14,
      type: SeriousnessCategoryEnum.RECREATIONAL,
      name: "John Doe",
    };

    // Act
    const result = canRowerUseBoat(boatLevelConfig, rower);

    // Assert
    expect(result).toBe(true);
  });
});

describe("getMinimumValidRowersNeeded", () => {
  test("should return 0 when blockFrom is null", () => {
    // Act
    const result = getMinimumValidRowersNeeded(null, 4);

    // Assert
    expect(result).toBe(0);
  });

  test("should return 0 when numberOfRowers is undefined", () => {
    // Act
    const result = getMinimumValidRowersNeeded(2, undefined);

    // Assert
    expect(result).toBe(0);
  });

  test("should calculate minimum rowers correctly for blockFrom=2 with 4 rowers", () => {
    // Act
    const result = getMinimumValidRowersNeeded(2, 4);

    // Assert
    expect(result).toBe(3); // 4 - (2-1) = 3
  });

  test("should calculate minimum rowers correctly for blockFrom=3 with 8 rowers", () => {
    // Act
    const result = getMinimumValidRowersNeeded(3, 8);

    // Assert
    expect(result).toBe(6); // 8 - (3-1) = 6
  });
});

describe("getBoatTypeLevelConfig", () => {
  test("should return default config for undefined boat type", () => {
    // Act
    const result = getBoatTypeLevelConfig(undefined, {
      [BoatTypeEnum.ONE_ROWER_COXLESS]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.TWO_ROWERS_COXLESS]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.TWO_ROWERS_COXED]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.FOUR_ROWERS_COXLESS]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.FOUR_ROWERS_COXED]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.EIGHT_ROWERS_COXED]: { alertFrom: 2, blockFrom: 4 },
    });

    // Assert
    expect(result).toEqual({ alertFrom: 1, blockFrom: null });
  });

  test("should return null values for OTHER boat type", () => {
    // Act
    const result = getBoatTypeLevelConfig(BoatTypeEnum.OTHER, {
      [BoatTypeEnum.ONE_ROWER_COXLESS]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.TWO_ROWERS_COXLESS]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.TWO_ROWERS_COXED]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.FOUR_ROWERS_COXLESS]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.FOUR_ROWERS_COXED]: { alertFrom: 2, blockFrom: 4 },
      [BoatTypeEnum.EIGHT_ROWERS_COXED]: { alertFrom: 2, blockFrom: 4 },
    });

    // Assert
    expect(result).toEqual({ alertFrom: null, blockFrom: null });
  });

  test("should return specific config for given boat type", () => {
    // Arrange
    const customConfig = {
      [BoatTypeEnum.ONE_ROWER_COXLESS]: { alertFrom: 1, blockFrom: 2 },
      [BoatTypeEnum.TWO_ROWERS_COXLESS]: { alertFrom: 2, blockFrom: 3 },
      [BoatTypeEnum.TWO_ROWERS_COXED]: { alertFrom: 2, blockFrom: 3 },
      [BoatTypeEnum.FOUR_ROWERS_COXLESS]: { alertFrom: 3, blockFrom: 5 },
      [BoatTypeEnum.FOUR_ROWERS_COXED]: { alertFrom: 3, blockFrom: 5 },
      [BoatTypeEnum.EIGHT_ROWERS_COXED]: { alertFrom: 5, blockFrom: 8 },
    };

    // Act
    const result = getBoatTypeLevelConfig(
      BoatTypeEnum.FOUR_ROWERS_COXLESS,
      customConfig
    );

    // Assert
    expect(result).toEqual({ alertFrom: 3, blockFrom: 5 });
  });
});
