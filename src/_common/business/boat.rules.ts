import { v4 } from "uuid";
import { ZustandSession } from "../store/sessions.store";
import { Boat, BoatTypeEnum } from "../types/boat.type";
import { forEnum } from "../utils/utils";

export const generateBoatId = () => {
  return `boat-${v4()}`;
};

export const isBoatAvailable = (
  boat: Boat,
  ongoingSessions: ZustandSession[]
) => {
  return !ongoingSessions.some((session) => session.boat.id === boat.id);
};

export const getBoatsByType = (boats: Boat[], types: string[]) => {
  return boats.filter((boat) => {
    if (boat.type === undefined) {
      return false;
    }
    return types.includes(boat.type);
  });
};

export const getTypelessBoats = (boats: Boat[]) => {
  return boats.filter((boat) => boat.type === undefined);
};

export const sortBoatsByTypeAndName = (boats: Boat[]) => {
  return [...boats].sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }

    const types = [
      BoatTypeEnum.ONE_ROWER_COXLESS,
      BoatTypeEnum.TWO_ROWERS_COXLESS,
      BoatTypeEnum.TWO_ROWERS_COXED,
      BoatTypeEnum.FOUR_ROWERS_COXLESS,
      BoatTypeEnum.FOUR_ROWERS_COXED,
      BoatTypeEnum.EIGHT_ROWERS_COXED,
      BoatTypeEnum.OTHER,
    ];

    return (
      types.indexOf(a.type || BoatTypeEnum.OTHER) -
      types.indexOf(b.type || BoatTypeEnum.OTHER)
    );
  });
};

export const fromBoatTypeToNbOfRowers = (type?: BoatTypeEnum) => {
  if (!type) {
    return undefined;
  }

  return forEnum(type, {
    ONE_ROWER_COXLESS: () => 1,
    TWO_ROWERS_COXLESS: () => 2,
    TWO_ROWERS_COXED: () => 3,
    FOUR_ROWERS_COXLESS: () => 4,
    FOUR_ROWERS_COXED: () => 5,
    EIGHT_ROWERS_COXED: () => 8,
    OTHER: () => undefined,
  });
};
