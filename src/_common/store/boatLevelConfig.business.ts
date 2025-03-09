import { BoatTypeEnum } from "../business/boat.rules";
import { Rower } from "../business/rower.rules";

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

  const minimalRowerCategoryOrder = findAgeCategoryOrder(minimalRowerCategory);
  const rowerCategoryOrder = findAgeCategoryOrder(rower.category);
  const minimalRowerTypeOrder = findSeriousnessCategoryOrder(minimalRowerType);
  const rowerTypeOrder = findSeriousnessCategoryOrder(rower.type);

  return (
    rowerCategoryOrder >= minimalRowerCategoryOrder &&
    rowerTypeOrder >= minimalRowerTypeOrder
  );
};

export const findAgeCategoryOrder = (
  ageCategory: AgeCategoryEnum | null | undefined
) => {
  return ageCategories.find((cat) => cat.category === ageCategory)?.order || 0;
};

export const findSeriousnessCategoryOrder = (
  seriousnessCategory: SeriousnessCategoryEnum | null | undefined
) => {
  return (
    seriousnessCategories.find((t) => t.type === seriousnessCategory)?.order ||
    0
  );
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

export enum SeriousnessCategoryEnum {
  RECREATIONAL = "recreational",
  COMPETITOR = "competitor",
}

export const getSeriousnessTypeTranslation = (
  type: SeriousnessCategoryEnum | null | undefined
) => {
  return seriousnessCategories.find((t) => t.type === type)?.label || type;
};

export const seriousnessCategories = [
  {
    order: 0,
    type: null,
    label: null,
  },
  {
    order: 1,
    type: SeriousnessCategoryEnum.RECREATIONAL,
    label: "Loisir",
  },
  {
    order: 2,
    type: SeriousnessCategoryEnum.COMPETITOR,
    label: "Compétiteur",
  },
] as const;

export enum AgeCategoryEnum {
  J10 = "J10",
  J12 = "J12",
  J14 = "J14",
  J16 = "J16",
  J18 = "J18",
  SENIOR = "Senior",
}

export const ageCategories = [
  {
    order: 0,
    category: null,
  },
  {
    order: 1,
    category: AgeCategoryEnum.J10,
  },
  {
    order: 2,
    category: AgeCategoryEnum.J12,
  },
  {
    order: 3,
    category: AgeCategoryEnum.J14,
  },
  {
    order: 4,
    category: AgeCategoryEnum.J16,
  },
  {
    order: 5,
    category: AgeCategoryEnum.J18,
  },
  {
    order: 7,
    category: AgeCategoryEnum.SENIOR,
  },
] as const;

export const sortByAgeCategoryOrder = (
  a: AgeCategoryEnum | undefined,
  b: AgeCategoryEnum | undefined
) => {
  const aOrder = findAgeCategoryOrder(a);
  const bOrder = findAgeCategoryOrder(b);

  return -(aOrder - bOrder);
};

export const sortByTypeOrder = (
  a: SeriousnessCategoryEnum | undefined,
  b: SeriousnessCategoryEnum | undefined
) => {
  const aOrder = findSeriousnessCategoryOrder(a);
  const bOrder = findSeriousnessCategoryOrder(b);

  return -(aOrder - bOrder);
};

export interface BoatLevelConfig {
  boatId: string;
  minimalRowerCategory: AgeCategoryEnum | null;
  minimalRowerType: SeriousnessCategoryEnum | null;
}
