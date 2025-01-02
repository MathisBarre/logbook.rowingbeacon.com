import { BoatTypeEnum } from "../types/boat.type";
import { Rower } from "../types/rower.type";

export const whatShouldItDo = (
  nbOfInvalidRowers: number,
  boatTypeLevelConfig: BoatTypeLevelConfig
) => {
  let whatToDo: "alert" | "block" | "nothing" = "nothing";

  if (
    boatTypeLevelConfig.alertFrom !== null &&
    nbOfInvalidRowers >= boatTypeLevelConfig.alertFrom
  ) {
    whatToDo = "alert";
  }

  if (
    boatTypeLevelConfig.blockFrom !== null &&
    nbOfInvalidRowers >= boatTypeLevelConfig.blockFrom
  ) {
    whatToDo = "block";
  }

  return whatToDo;
};

export const getBoatTypeLevelConfig = (
  boatType: BoatTypeEnum | undefined,
  boatTypeLevelConfigs: BoatTypeLevelConfigs
): BoatTypeLevelConfig => {
  if (boatType === undefined) {
    return defaultBoatTypeLevelConfig;
  }

  if (boatType === BoatTypeEnum.OTHER) {
    return { alertFrom: null, blockFrom: null };
  }

  const specificConfig = boatTypeLevelConfigs[boatType];

  return specificConfig;
};

export const canRowerUseBoat = (
  boatLevelConfig: BoatLevelConfig,
  rower: Rower
) => {
  const { minimalRowerCategory, minimalRowerType } = boatLevelConfig;

  const minimalRowerCategoryOrder =
    findRowerCategoryOrder(minimalRowerCategory);
  const rowerCategoryOrder = findRowerCategoryOrder(rower.category);
  const minimalRowerTypeOrder = findRowerTypeOrder(minimalRowerType);
  const rowerTypeOrder = findRowerTypeOrder(rower.type);

  return (
    rowerCategoryOrder >= minimalRowerCategoryOrder &&
    rowerTypeOrder >= minimalRowerTypeOrder
  );
};

export const findRowerCategoryOrder = (
  category: RowerCategoryEnum | null | undefined
) => {
  return rowerCategories.find((cat) => cat.category === category)?.order || 0;
};

export const findRowerTypeOrder = (type: RowerTypeEnum | null | undefined) => {
  return rowerType.find((t) => t.type === type)?.order || 0;
};

export const defaultBoatTypeLevelConfig: BoatTypeLevelConfig = {
  alertFrom: 1,
  blockFrom: null,
};

export interface BoatTypeLevelConfig {
  alertFrom: number | null;
  blockFrom: number | null;
}

export type BoatTypeLevelConfigs = Record<
  Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
  BoatTypeLevelConfig
>;

export const defaultBoatTypeLevelConfigs: BoatTypeLevelConfigs = {
  [BoatTypeEnum.ONE_ROWER_COXLESS]: defaultBoatTypeLevelConfig,
  [BoatTypeEnum.TWO_ROWERS_COXLESS]: defaultBoatTypeLevelConfig,
  [BoatTypeEnum.TWO_ROWERS_COXED]: defaultBoatTypeLevelConfig,
  [BoatTypeEnum.FOUR_ROWERS_COXLESS]: defaultBoatTypeLevelConfig,
  [BoatTypeEnum.FOUR_ROWERS_COXED]: defaultBoatTypeLevelConfig,
  [BoatTypeEnum.EIGHT_ROWERS_COXED]: defaultBoatTypeLevelConfig,
};

export enum RowerTypeEnum {
  RECREATIONAL = "recreational",
  COMPETITOR = "competitor",
}

export const rowerType = [
  {
    order: 0,
    type: null,
    label: null,
  },
  {
    order: 1,
    type: RowerTypeEnum.RECREATIONAL,
    label: "Loisir",
  },
  {
    order: 2,
    type: RowerTypeEnum.COMPETITOR,
    label: "Compétition",
  },
] as const;

export enum RowerCategoryEnum {
  J10 = "J10",
  J12 = "J12",
  J14 = "J14",
  J16 = "J16",
  J18 = "J18",
  SENIOR = "Senior",
}

export const rowerCategories = [
  {
    order: 0,
    category: null,
  },
  {
    order: 1,
    category: RowerCategoryEnum.J10,
  },
  {
    order: 2,
    category: RowerCategoryEnum.J12,
  },
  {
    order: 3,
    category: RowerCategoryEnum.J14,
  },
  {
    order: 4,
    category: RowerCategoryEnum.J16,
  },
  {
    order: 5,
    category: RowerCategoryEnum.J18,
  },
  {
    order: 7,
    category: RowerCategoryEnum.SENIOR,
  },
] as const;

export const sortByCategoryOrder = (
  a: RowerCategoryEnum | undefined,
  b: RowerCategoryEnum | undefined
) => {
  const aOrder = findRowerCategoryOrder(a);
  const bOrder = findRowerCategoryOrder(b);

  return -(aOrder - bOrder);
};

export const sortByTypeOrder = (
  a: RowerTypeEnum | undefined,
  b: RowerTypeEnum | undefined
) => {
  const aOrder = findRowerTypeOrder(a);
  const bOrder = findRowerTypeOrder(b);

  return -(aOrder - bOrder);
};

export interface BoatLevelConfig {
  boatId: string;
  minimalRowerCategory: RowerCategoryEnum | null;
  minimalRowerType: RowerTypeEnum | null;
}
