import { forEnum } from "../utils/utils";
import { generateId } from "../utils/ids.utils";

/**
 * ----- Typing -----
 */

export enum BoatTypeEnum {
  "ONE_ROWER_COXLESS" = "ONE_ROWER_COXLESS",
  "TWO_ROWERS_COXLESS" = "TWO_ROWERS_COXLESS",
  "TWO_ROWERS_COXED" = "TWO_ROWERS_COXED",
  "FOUR_ROWERS_COXLESS" = "FOUR_ROWERS_COXLESS",
  "FOUR_ROWERS_COXED" = "FOUR_ROWERS_COXED",
  "EIGHT_ROWERS_COXED" = "EIGHT_ROWERS_COXED",
  "OTHER" = "OTHER",
}

export interface Boat {
  id: string;
  name: string;
  isInMaintenance?: boolean;
  type?: BoatTypeEnum;
}

/**
 * ----- Business rules -----
 */

export const generateBoatId = () => {
  return generateId("boat");
};

export const isBoatAvailable = (
  boat: Boat,
  ongoingSessions: { boat: { id: string } }[]
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

export const getBoatNumberOfRowers = (type?: BoatTypeEnum) => {
  if (!type) {
    return undefined;
  }

  return forEnum(type, {
    ONE_ROWER_COXLESS: () => 1,
    TWO_ROWERS_COXLESS: () => 2,
    TWO_ROWERS_COXED: () => 3,
    FOUR_ROWERS_COXLESS: () => 4,
    FOUR_ROWERS_COXED: () => 5,
    EIGHT_ROWERS_COXED: () => 9,
    OTHER: () => undefined,
  });
};

export const getTypeLabel = (type: BoatTypeEnum | undefined) => {
  return (
    boathTypeWithLabel.find((t) => t.type === type)?.label || "LABEL_NOT_FOUND"
  );
};

export const boathTypeWithLabel = [
  { type: BoatTypeEnum.ONE_ROWER_COXLESS, label: "1x" },
  { type: BoatTypeEnum.TWO_ROWERS_COXLESS, label: "2x / 2-" },
  { type: BoatTypeEnum.TWO_ROWERS_COXED, label: "2+" },
  { type: BoatTypeEnum.FOUR_ROWERS_COXLESS, label: "4x / 4-" },
  { type: BoatTypeEnum.FOUR_ROWERS_COXED, label: "4+" },
  { type: BoatTypeEnum.EIGHT_ROWERS_COXED, label: "8x / 8+" },
  { type: BoatTypeEnum.OTHER, label: "Autre" },
];
