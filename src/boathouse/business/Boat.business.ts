import { getBoatNumberOfRowers } from "../../_common/business/boat.rules";
import { Boat } from "../../_common/business/boat.rules";

export const checkIfNotSameRowersAsSeatsInBoat = (
  nbOfRowers: number,
  boat: Boat
) => {
  const rowersQuantity = getBoatNumberOfRowers(boat.type);

  if (rowersQuantity === undefined) {
    return false;
  }

  const goodRowerQuantity = nbOfRowers === rowersQuantity;

  return !goodRowerQuantity;
};
