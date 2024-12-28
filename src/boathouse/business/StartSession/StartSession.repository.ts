/* eslint-disable @typescript-eslint/require-await */
import { fromBoatTypeToNbOfRowers } from "../../../_common/business/boat.rules";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { useSessionsStore } from "../../../_common/store/sessions.store";
import { Boat } from "../../../_common/types/boat.type";
import { ErrorWithCode } from "../../../_common/utils/error";
import { IStartSessionRepository } from "./StartSession.usecase";

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
      const result = clubOverviewStore.getBoatById(boatId);

      if (!result) {
        throw new ErrorWithCode({ code: "BOAT_NOT_FOUND" });
      }

      const boat: Boat = {
        ...result,
        rowersQuantity: fromBoatTypeToNbOfRowers(result.type),
      };

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
