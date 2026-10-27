import {
  Boat,
  getBoatNumberOfRowers,
} from "../../../_common/business/boat.rules";
import { Rower } from "../../../_common/business/rower.rules";
import {
  BoatConfiguration,
  getCrewSize,
  getDefaultConfiguration,
} from "../../../_common/business/boatConfiguration.rules";
import { BoatTypeLevelConfig } from "../../../_common/store/boatLevelConfig.rules";

/**
 * Crew size expected in the boat, cox included: from the chosen
 * configuration, else from the legacy boat type.
 */
export const getExpectedCrewSize = (
  boat: Boat & { configurations?: BoatConfiguration[] },
  boatConfigurationId?: string | null
) => {
  const configuration = getOutingConfiguration(boat, boatConfigurationId);

  return configuration
    ? getCrewSize(configuration)
    : getBoatNumberOfRowers(boat.type);
};

export const getOutingConfiguration = (
  boat: { configurations?: BoatConfiguration[] },
  boatConfigurationId?: string | null
) => {
  const configurations = boat.configurations ?? [];

  return (
    configurations.find(
      (configuration) => configuration.id === boatConfigurationId
    ) ?? getDefaultConfiguration(configurations)
  );
};

export const checkIfNotSameRowersAsSeatsInBoat = (
  crewSize: number,
  boat: Boat & { configurations?: BoatConfiguration[] },
  boatConfigurationId?: string | null
) => {
  const expectedCrewSize = getExpectedCrewSize(boat, boatConfigurationId);

  if (expectedCrewSize === undefined) {
    return false;
  }

  return crewSize !== expectedCrewSize;
};
export interface SessionToStart {
  routeId: string | null;
  boatId: string;
  /** Rowing seats; may hold new guest option ids (crew.rules). */
  rowersId: string[];
  coxId?: string | null;
  boatConfigurationId?: string | null;
  outingTypeCode?: string | null;
  captainRowerId?: string | null;
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
  boat?: { id: string };
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
