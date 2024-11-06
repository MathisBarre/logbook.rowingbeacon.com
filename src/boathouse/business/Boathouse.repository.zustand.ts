import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useSessionsStore } from "../../_common/store/sessions.store";
import { Boat, BoatTypeEnum } from "../../_common/types/boat.type";
import { asError, asOk } from "../../_common/utils/error";
import { forEnum } from "../../_common/utils/utils";
import { IBoathouseRepository } from "./Boathouse.repository.interface";
import { StartedSession } from "./StartedSession.business";

export const useGetZustandBoathouseRepository = () => {
  const sessionsStore = useSessionsStore();
  const clubOverviewStore = useClubOverviewStore();

  const repository: IBoathouseRepository = {
    async getRoute(routeId) {
      const result = clubOverviewStore.getRouteById(routeId);

      if (!result) {
        return asError({
          code: "NOT_FOUND",
        });
      }

      return asOk(result);
    },

    async getBoat(boatId) {
      const result = clubOverviewStore.getBoatById(boatId);

      if (!result) {
        return asError({
          code: "NOT_FOUND",
        });
      }

      const boat: Boat = {
        ...result,
        rowersQuantity: fromBoatTypeToNbOfRowers(result.type),
      };

      return asOk(boat);
    },

    async getStartedSessions() {
      const sessions: StartedSession[] = sessionsStore.getOngoingSessions();

      return asOk(sessions);
    },

    async getRowersById(rowersId) {
      const rowers = clubOverviewStore.getRowersById(rowersId);

      return asOk(rowers);
    },
    async saveSession(payload) {
      sessionsStore.startSession(payload);

      return asOk(null);
    },
  };

  return repository;
};

const fromBoatTypeToNbOfRowers = (type?: BoatTypeEnum) => {
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
