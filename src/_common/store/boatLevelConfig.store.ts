import { create } from "zustand";
import { BoatTypeEnum } from "../types/boat.type";
import { persist } from "zustand/middleware";
import { Rower } from "../types/rower.type";

export const getBoatTypeLevelConfig = (
  boatType: BoatTypeEnum | undefined,
  boatTypeLevelConfigs: BoatTypeLevelConfigs
) => {
  if (boatType === undefined) {
    return defaultBoatTypeLevelConfig;
  }

  if (boatType === BoatTypeEnum.OTHER) {
    return { alert: -1, block: -1 };
  }

  const specificConfig = boatTypeLevelConfigs[boatType];

  return specificConfig;
};

export const isValid = (boatLevelConfig: BoatLevelConfig, rower: Rower) => {
  const { minimalRowerCategory, minimalRowerType } = boatLevelConfig;

  const minimalRowerCategoryOrder =
    findRowerCategoryOrder(minimalRowerCategory);
  const rowerCategoryOrder = findRowerCategoryOrder(rower.category);
  const minimalRowerTypeOrder = findRowerTypeOrder(minimalRowerType);
  const rowerTypeOrder = findRowerTypeOrder(rower.type);

  if (
    minimalRowerCategoryOrder === undefined ||
    rowerCategoryOrder === undefined ||
    minimalRowerTypeOrder === undefined ||
    rowerTypeOrder === undefined
  ) {
    // should not happen but if it happens, we don't want to block the session registration
    return true;
  }

  return (
    rowerCategoryOrder.order >= minimalRowerCategoryOrder.order &&
    rowerTypeOrder.order >= minimalRowerTypeOrder.order
  );
};

const findRowerCategoryOrder = (category: RowerCategoryEnum) => {
  return rowerCategory.find((cat) => cat.category === category);
};

const findRowerTypeOrder = (type: RowerTypeEnum) => {
  return rowerType.find((t) => t.type === type);
};

const defaultBoatTypeLevelConfig = { alert: 1, block: -1 };

interface BoatTypeLevelConfig {
  alert: number;
  block: number;
}

type BoatTypeLevelConfigs = Record<
  Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
  BoatTypeLevelConfig
>;

const defaultBoatTypeLevelConfigs: BoatTypeLevelConfigs = {
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

const rowerType = [
  {
    order: 0,
    type: RowerTypeEnum.RECREATIONAL,
  },
  {
    order: 1,
    type: RowerTypeEnum.COMPETITOR,
  },
] as const;

export enum RowerCategoryEnum {
  J10 = "J10",
  J12 = "J12",
  J14 = "J14",
  J16 = "J16",
  J18 = "J18",
  U23 = "U23",
  SENIOR = "Senior",
}

const rowerCategory = [
  {
    order: 0,
    category: RowerCategoryEnum.J10,
  },
  {
    order: 1,
    category: RowerCategoryEnum.J12,
  },
  {
    order: 2,
    category: RowerCategoryEnum.J14,
  },
  {
    order: 3,
    category: RowerCategoryEnum.J16,
  },
  {
    order: 4,
    category: RowerCategoryEnum.J18,
  },
  {
    order: 5,
    category: RowerCategoryEnum.U23,
  },
  {
    order: 6,
    category: RowerCategoryEnum.SENIOR,
  },
] as const;

interface BoatLevelConfig {
  boatId: string;
  minimalRowerCategory: RowerCategoryEnum;
  minimalRowerType: RowerTypeEnum;
}

export const useBoatLevelConfigStore = create(
  persist<{
    boatTypeLevelConfigs: BoatTypeLevelConfigs;
    boatLevelConfigs: BoatLevelConfig[];
    getBoatTypeLevelConfigs: () => BoatTypeLevelConfigs;
    getBoatLevelConfig: (boatId: string) => BoatLevelConfig | undefined;
    updateBoatLevelConfig: (boatLevelConfig: BoatLevelConfig) => void;
    deleteBoatLevelConfig: (boatId: string) => void;
    addBoatLevelConfig: (boatLevelConfig: BoatLevelConfig) => void;
  }>(
    (set, get) => ({
      boatTypeLevelConfigs: defaultBoatTypeLevelConfigs,
      boatLevelConfigs: [],
      getBoatTypeLevelConfigs: () => {
        return get().boatTypeLevelConfigs;
      },
      getBoatLevelConfig(boatId) {
        return get().boatLevelConfigs.find((boat) => boat.boatId === boatId);
      },
      updateBoatLevelConfig(boatLevelConfig) {
        set((state) => {
          const boatLevelConfigs = state.boatLevelConfigs.filter(
            (boat) => boat.boatId !== boatLevelConfig.boatId
          );
          return {
            ...state,
            boatLevelConfigs: [...boatLevelConfigs, boatLevelConfig],
          };
        });
      },
      deleteBoatLevelConfig(boatId) {
        set((state) => {
          const boatLevelConfigs = state.boatLevelConfigs.filter(
            (boat) => boat.boatId !== boatId
          );
          return {
            ...state,
            boatLevelConfigs,
          };
        });
      },
      addBoatLevelConfig(boatLevelConfig) {
        set((state) => {
          return {
            ...state,
            boatLevelConfigs: [...state.boatLevelConfigs, boatLevelConfig],
          };
        });
      },
    }),
    {
      name: "boatLevelConfigStore",
    }
  )
);
