import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
import {
  BoatLevelConfig,
  BoatTypeLevelConfigs,
  defaultBoatTypeLevelConfigs,
  RowerCategoryEnum,
  RowerTypeEnum,
} from "./boatLevelConfig.business";

export interface IBoatLevelConfigStore {
  boatTypeLevelConfigs: BoatTypeLevelConfigs;
  boatLevelConfigs: BoatLevelConfig[];
  getBoatTypeLevelConfigs: () => BoatTypeLevelConfigs;
  getBoatLevelConfig: (boatId: string) => BoatLevelConfig | undefined;
  upsertBoatLevelConfig: (
    boatId: string,
    boatLevelConfig: {
      minimalRowerCategory?: RowerCategoryEnum | null;
      minimalRowerType?: RowerTypeEnum | null;
    }
  ) => void;
  deleteBoatLevelConfig: (boatId: string) => void;
  reset: () => void;
}

export const boatLevelConfigStoreCore = createStore(
  persist<IBoatLevelConfigStore>(
    (set, get) => ({
      boatTypeLevelConfigs: defaultBoatTypeLevelConfigs,
      boatLevelConfigs: [],
      getBoatTypeLevelConfigs: () => {
        return get().boatTypeLevelConfigs;
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
          boatTypeLevelConfigs: defaultBoatTypeLevelConfigs,
          boatLevelConfigs: [],
        });
      },
    }),
    {
      name: "boatLevelConfigStore",
    }
  )
);
