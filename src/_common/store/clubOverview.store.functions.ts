import { BoatTypeEnum } from "../business/boat.rules";
import { ClubOverviewState } from "./clubOverview.store";

export const updateBoatTypeFn = (
  boats: ClubOverviewState["boats"],
  boatId: string,
  type: BoatTypeEnum
) => {
  const updatedBoats = boats.map((boat) => {
    if (boat.id === boatId) {
      return {
        ...boat,
        type,
      };
    }
    return boat;
  });

  return updatedBoats;
};

export const updateBoatNameFn = (
  boats: ClubOverviewState["boats"],
  boatId: string,
  name: string
) => {
  const updatedBoats = boats.map((boat) => {
    if (boat.id === boatId) {
      return {
        ...boat,
        name,
      };
    }
    return boat;
  });

  return updatedBoats;
};

export const updateBoatNoteFn = (
  boats: ClubOverviewState["boats"],
  boatId: string,
  note: string
) => {
  const updatedBoats = boats.map((boat) => {
    if (boat.id === boatId) {
      return {
        ...boat,
        note,
      };
    }
    return boat;
  });

  return updatedBoats;
};

export const toggleBoatIsInMaintenanceFn = (
  boats: ClubOverviewState["boats"],
  boatId: string
) => {
  const updatedBoats = boats.map((boat) => {
    if (boat.id === boatId) {
      return {
        ...boat,
        isInMaintenance: !boat.isInMaintenance,
      };
    }
    return boat;
  });

  return updatedBoats;
};
