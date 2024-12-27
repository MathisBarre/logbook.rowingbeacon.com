import { BoatTypeEnum } from "../types/boat.type";

const boatLevelDefaultConfig: Record<
  Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
  {
    alert: number;
    block: number;
  }
> = {
  [BoatTypeEnum.ONE_ROWER_COXLESS]: { alert: 1, block: -1 },
  [BoatTypeEnum.TWO_ROWERS_COXLESS]: { alert: 1, block: -1 },
  [BoatTypeEnum.TWO_ROWERS_COXED]: { alert: 1, block: -1 },
  [BoatTypeEnum.FOUR_ROWERS_COXLESS]: { alert: 1, block: -1 },
  [BoatTypeEnum.FOUR_ROWERS_COXED]: { alert: 1, block: -1 },
  [BoatTypeEnum.EIGHT_ROWERS_COXED]: { alert: 1, block: -1 },
};

export const useBoatLevelConfigStore = () => {
  const getBoatLevelConfig = () => {
    return boatLevelDefaultConfig;
  };

  return {
    getBoatLevelConfig,
  };
};
