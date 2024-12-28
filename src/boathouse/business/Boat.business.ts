import { fromBoatTypeToNbOfRowers } from "../../_common/business/boat.rules";
import { Boat } from "../../_common/types/boat.type";

export const checkIfNotSameRowersAsSeatsInBoat = (
  nbOfRowers: number,
  boat: Boat
) => {
  const rowersQuantity = fromBoatTypeToNbOfRowers(boat.type);

  if (rowersQuantity === undefined) {
    return false;
  }

  const goodRowerQuantity = nbOfRowers === rowersQuantity;

  return !goodRowerQuantity;
};
