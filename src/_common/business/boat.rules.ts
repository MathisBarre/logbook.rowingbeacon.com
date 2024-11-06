import { v4 } from "uuid";
import { ZustandSession } from "../store/sessions.store";
import { Boat } from "../types/boat.type";

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
