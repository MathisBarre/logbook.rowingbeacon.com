/* eslint-disable @typescript-eslint/require-await */
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { useSessionsStore } from "../../../_common/store/sessions.store";
import { ErrorWithCode } from "../../../_common/utils/error";
import { IStartSessionRepository } from "./StartSession.repository.interface";

export const useGetZustandStartSessionRepository = () => {
  const sessionsStore = useSessionsStore();
  const clubOverviewStore = useClubOverviewStore();

  const repository: IStartSessionRepository = {
    async getRoute(routeId) {
      const result = clubOverviewStore.getRouteById(routeId);

      if (!result) {
        throw new ErrorWithCode({ code: "ROUTE_NOT_FOUND" });
      }

      return result;
    },

    async getBoat(boatId) {
      const boat = clubOverviewStore.getBoatById(boatId);

      if (!boat) {
        throw new ErrorWithCode({ code: "BOAT_NOT_FOUND" });
      }

      return boat;
    },

    async getStartedSessions() {
      return sessionsStore.getOngoingSessions();
    },

    async getRowersById(rowersId) {
      return clubOverviewStore.getRowersById(rowersId);
    },

    async saveSession(payload) {
      return sessionsStore.startSession(payload);
    },
  };

  return repository;
};
