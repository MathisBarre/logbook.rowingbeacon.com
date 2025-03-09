import {
  AgeCategoryEnum,
  findAgeCategoryOrder,
} from "../business/ageCategory.rules";
import { BoatTypeEnum } from "../business/boat.rules";
import { Rower } from "../business/rower.rules";
import {
  findSeriousnessCategoryOrder,
  SeriousnessCategoryEnum,
} from "../business/seriousness.rules";

/**
 * ----- Typing -----
 */

export interface BoatTypeLevelConfig {
  alertFrom: number | null;
  blockFrom: number | null;
}

export type BoatTypeLevelConfigs = Record<
  Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
  BoatTypeLevelConfig
>;

export interface BoatLevelConfig {
  boatId: string;
  minimalRowerCategory: AgeCategoryEnum | null;
  minimalRowerType: SeriousnessCategoryEnum | null;
}

/**
 * ----- Constant -----
 */

export const DEFAULT_BOAT_TYPE_LEVEL_CONFIG: BoatTypeLevelConfig = {
  alertFrom: 1,
  blockFrom: null,
};

export const DEFAULT_BOAT_TYPE_LEVEL_CONFIGS: BoatTypeLevelConfigs = {
  [BoatTypeEnum.ONE_ROWER_COXLESS]: DEFAULT_BOAT_TYPE_LEVEL_CONFIG,
  [BoatTypeEnum.TWO_ROWERS_COXLESS]: DEFAULT_BOAT_TYPE_LEVEL_CONFIG,
  [BoatTypeEnum.TWO_ROWERS_COXED]: DEFAULT_BOAT_TYPE_LEVEL_CONFIG,
  [BoatTypeEnum.FOUR_ROWERS_COXLESS]: DEFAULT_BOAT_TYPE_LEVEL_CONFIG,
  [BoatTypeEnum.FOUR_ROWERS_COXED]: DEFAULT_BOAT_TYPE_LEVEL_CONFIG,
  [BoatTypeEnum.EIGHT_ROWERS_COXED]: DEFAULT_BOAT_TYPE_LEVEL_CONFIG,
};

/**
 * ----- Utils -----
 */

export const getBoatTypeLevelConfig = (
  boatType: BoatTypeEnum | undefined,
  boatTypeLevelConfigs: BoatTypeLevelConfigs
): BoatTypeLevelConfig => {
  if (boatType === undefined) {
    return DEFAULT_BOAT_TYPE_LEVEL_CONFIG;
  }

  if (boatType === BoatTypeEnum.OTHER) {
    return { alertFrom: null, blockFrom: null };
  }

  const specificConfig = boatTypeLevelConfigs[boatType];

  return specificConfig;
};

/**
 * ----- Business rules -----
 */

export const canRowerUseBoat = (
  boatLevelConfig: BoatLevelConfig,
  rower: Rower
) => {
  const { minimalRowerCategory, minimalRowerType } = boatLevelConfig;

  const minimalRowerCategoryOrder = findAgeCategoryOrder(minimalRowerCategory);
  const rowerCategoryOrder = findAgeCategoryOrder(rower.category);
  const minimalRowerTypeOrder = findSeriousnessCategoryOrder(minimalRowerType);
  const rowerTypeOrder = findSeriousnessCategoryOrder(rower.type);

  return (
    rowerCategoryOrder >= minimalRowerCategoryOrder &&
    rowerTypeOrder >= minimalRowerTypeOrder
  );
};

export const getMinimumValidRowersNeeded = (
  blockFrom: number | null,
  numberOfRowers: number | undefined
) => {
  const neverBlock = blockFrom === null;
  const boatWithUnknownNbRowers = numberOfRowers === undefined;

  if (neverBlock || boatWithUnknownNbRowers) {
    return 0;
  }

  return numberOfRowers - (blockFrom - 1);
};
