/* eslint-disable @typescript-eslint/require-await */
import { fromBoatTypeToNbOfRowers } from "../../_common/business/boat.rules";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useSessionsStore } from "../../_common/store/sessions.store";
import { Boat } from "../../_common/types/boat.type";
import { asError, asOk } from "../../_common/utils/error";
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
