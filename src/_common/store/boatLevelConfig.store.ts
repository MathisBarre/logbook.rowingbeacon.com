import { BoatTypeEnum } from "../types/boat.type";

export const getBoatLevelConfig = (
  boatType: BoatTypeEnum | undefined,
  boatLevelConfig: BoatLevelConfig
) => {
  if (boatType === undefined) {
    return defaultBoatLevelConfig;
  }

  if (boatType === BoatTypeEnum.OTHER) {
    return { alert: -1, block: -1 };
  }

  const specificConfig = boatLevelConfig[boatType];

  return specificConfig;
};

export const defaultBoatLevelConfig = { alert: 1, block: -1 };

type BoatLevelConfig = Record<
  Exclude<BoatTypeEnum, BoatTypeEnum.OTHER>,
  {
    alert: number;
    block: number;
  }
>;

const boatLevelDefaultConfig: BoatLevelConfig = {
  [BoatTypeEnum.ONE_ROWER_COXLESS]: defaultBoatLevelConfig,
  [BoatTypeEnum.TWO_ROWERS_COXLESS]: defaultBoatLevelConfig,
  [BoatTypeEnum.TWO_ROWERS_COXED]: defaultBoatLevelConfig,
  [BoatTypeEnum.FOUR_ROWERS_COXLESS]: defaultBoatLevelConfig,
  [BoatTypeEnum.FOUR_ROWERS_COXED]: defaultBoatLevelConfig,
  [BoatTypeEnum.EIGHT_ROWERS_COXED]: defaultBoatLevelConfig,
};

export const useBoatLevelConfigStore = () => {
  const getBoatLevelConfig = () => {
    return boatLevelDefaultConfig;
  };

  return {
    getBoatLevelConfig,
  };
};
