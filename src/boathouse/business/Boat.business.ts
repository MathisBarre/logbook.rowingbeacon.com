import { Boat } from "../../_common/types/boat.type";

export const checkIfNotSameRowersAsSeatsInBoat = (
  nbOfRowers: number,
  boat: Boat
) => {
  if (!boat.rowersQuantity) {
    return false;
  }

  const goodRowerQuantity = nbOfRowers === boat.rowersQuantity;

  return !goodRowerQuantity;
};
