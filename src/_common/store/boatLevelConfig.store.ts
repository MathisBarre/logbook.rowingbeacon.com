import { createStore } from "zustand/vanilla";
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
import { enqueueWrite } from "../database/writeQueue";
import {
  deleteBoatLevelConfig,
  saveBoatLevelConfig,
  saveSetting,
} from "../database/repositories/club.repository";

export const SETTING_BOAT_TYPE_LEVEL_CONFIGS = "levels.boatTypeLevelConfigs";

const writeBoatTypeLevelConfigs = (configs: BoatTypeLevelConfigs) => {
  void enqueueWrite("boat type levels", (db) =>
    saveSetting(db, SETTING_BOAT_TYPE_LEVEL_CONFIGS, configs)
  );
};

export interface IBoatLevelConfigStore {
  boatTypeLevelConfigs: BoatTypeLevelConfigs;
  hydrate: (data: {
    boatTypeLevelConfigs: BoatTypeLevelConfigs;
    boatLevelConfigs: BoatLevelConfig[];
  }) => void;
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

export const boatLevelConfigStoreCore = createStore<IBoatLevelConfigStore>()(
  (set, get) => ({
    boatTypeLevelConfigs: DEFAULT_BOAT_TYPE_LEVEL_CONFIGS,
    boatLevelConfigs: [],
    hydrate({ boatTypeLevelConfigs, boatLevelConfigs }) {
      set({ boatTypeLevelConfigs, boatLevelConfigs });
    },
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
      writeBoatTypeLevelConfigs(get().boatTypeLevelConfigs);
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
      const saved = get().getBoatLevelConfig(boatId);
      if (saved) {
        void enqueueWrite("boat level", (db) => saveBoatLevelConfig(db, saved));
      }
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
      void enqueueWrite("boat level", (db) =>
        deleteBoatLevelConfig(db, boatId)
      );
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
      writeBoatTypeLevelConfigs(DEFAULT_BOAT_TYPE_LEVEL_CONFIGS);
    },
  })
);

export const useBoatLevelConfigStore = () => useStore(boatLevelConfigStoreCore);
