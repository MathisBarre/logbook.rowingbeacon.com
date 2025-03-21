import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
import {
  BoatLevelConfig,
  BoatTypeLevelConfigs,
  DEFAULT_BOAT_TYPE_LEVEL_CONFIGS,
  BoatTypeLevelConfig,
} from "./boatLevelConfig.rules";
import { SeriousnessCategoryEnum } from "../business/seriousness.rules";
import { AgeCategoryEnum } from "../business/ageCategory.rules";
import { BoatTypeEnum } from "../business/boat.rules";
import { useStore } from "zustand";

export interface IBoatLevelConfigStore {
  boatTypeLevelConfigs: BoatTypeLevelConfigs;
  updateBoatTypeLevelConfigs: (
    boatType: Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
    boatTypeLevelConfig: BoatTypeLevelConfig
  ) => void;
  boatLevelConfigs: BoatLevelConfig[];
  getBoatTypeLevelConfigs: () => BoatTypeLevelConfigs;
  getBoatLevelConfig: (boatId: string) => BoatLevelConfig | undefined;
  upsertBoatLevelConfig: (
    boatId: string,
    boatLevelConfig: {
      minimalRowerCategory?: AgeCategoryEnum | null;
      minimalRowerType?: SeriousnessCategoryEnum | null;
    }
  ) => void;
  deleteBoatLevelConfig: (boatId: string) => void;
  reset: () => void;
  resetBoatTypeLevelConfigs: () => void;
}

export const boatLevelConfigStoreCore = createStore(
  persist<IBoatLevelConfigStore>(
    (set, get) => ({
      boatTypeLevelConfigs: DEFAULT_BOAT_TYPE_LEVEL_CONFIGS,
      boatLevelConfigs: [],
      getBoatTypeLevelConfigs: () => {
        return get().boatTypeLevelConfigs;
      },
      updateBoatTypeLevelConfigs(boatType, boatTypeLevelConfig) {
        set((state) => {
          return {
            ...state,
            boatTypeLevelConfigs: {
              ...state.boatTypeLevelConfigs,
              [boatType]: boatTypeLevelConfig,
            },
          };
        });
      },
      getBoatLevelConfig(boatId) {
        return get().boatLevelConfigs.find((boat) => boat.boatId === boatId);
      },
      upsertBoatLevelConfig(boatId, boatLevelConfig) {
        set((state) => {
          const currentBoatLevelConfig = state.boatLevelConfigs.find(
            (boat) => boat.boatId === boatId
          );

          if (!currentBoatLevelConfig) {
            return {
              ...state,
              boatLevelConfigs: [
                ...state.boatLevelConfigs,
                {
                  boatId,
                  minimalRowerCategory:
                    boatLevelConfig.minimalRowerCategory || null,
                  minimalRowerType: boatLevelConfig.minimalRowerType || null,
                },
              ],
            };
          }

          const boatLevelConfigsWithoutCurrent = state.boatLevelConfigs.filter(
            (boat) => boat.boatId !== boatId
          );

          const newBoatLevelConfig = {
            ...currentBoatLevelConfig,
            ...boatLevelConfig,
          };

          return {
            ...state,
            boatLevelConfigs: [
              ...boatLevelConfigsWithoutCurrent,
              newBoatLevelConfig,
            ],
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
      reset() {
        set({
          boatTypeLevelConfigs: DEFAULT_BOAT_TYPE_LEVEL_CONFIGS,
          boatLevelConfigs: [],
        });
      },
      resetBoatTypeLevelConfigs() {
        set((state) => ({
          ...state,
          boatTypeLevelConfigs: DEFAULT_BOAT_TYPE_LEVEL_CONFIGS,
        }));
      },
    }),
    {
      name: "boatLevelConfigStore",
    }
  )
);

export const useBoatLevelConfigStore = () => useStore(boatLevelConfigStoreCore);
