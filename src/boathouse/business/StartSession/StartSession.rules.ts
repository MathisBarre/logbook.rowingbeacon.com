import {
  Boat,
  BoatTypeEnum,
  getBoatNumberOfRowers,
} from "../../../_common/business/boat.rules";
import { Rower } from "../../../_common/business/rower.rules";
import { BoatTypeLevelConfig } from "../../../_common/store/boatLevelConfig.rules";

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
export interface SessionToStart {
  routeId: string | null;
  boatId: string;
  rowersId: string[];
  startDatetime: Date;
  estimatedEndDatetime?: Date | undefined;
  comment: string;
}

export const isInvalidStartSessionDate = (payload: SessionToStart) => {
  if (!payload.estimatedEndDatetime) {
    return false;
  }

  return payload.startDatetime > payload.estimatedEndDatetime;
};
export interface StartedSession {
  id: string;
  rowers: Rower[];
}

export const getAlreadyOnStartedSessionRowersId = (
  rowersId: string[],
  startedSessions: StartedSession[]
): string[] => {
  return rowersId.filter((rowerId) =>
    startedSessions.some((startedSession) =>
      startedSession.rowers.some((rower) => rower.id === rowerId)
    )
  );
};
export const whatShouldItDo = (
  nbOfInvalidRowers: number,
  boatTypeLevelConfig: BoatTypeLevelConfig
) => {
  let whatToDo: "alert" | "block" | "nothing" = "nothing";

  if (
    boatTypeLevelConfig.alertFrom !== null &&
    nbOfInvalidRowers >= boatTypeLevelConfig.alertFrom
  ) {
    whatToDo = "alert";
  }

  if (
    boatTypeLevelConfig.blockFrom !== null &&
    nbOfInvalidRowers >= boatTypeLevelConfig.blockFrom
  ) {
    whatToDo = "block";
  }

  return whatToDo;
};

export const getNbOfMissingRowers = (
  boatType: BoatTypeEnum | undefined,
  nbOfRowers: number
) => {
  if (boatType === undefined) {
    return 0;
  }

  const boatNumberOfRowers = getBoatNumberOfRowers(boatType);

  if (boatNumberOfRowers === undefined) {
    return 0;
  }

  return Math.max(boatNumberOfRowers - nbOfRowers, 0);
};
