/* eslint-disable @typescript-eslint/require-await */
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { useSessionsStore } from "../../../_common/store/sessions.store";
import { ErrorWithCode } from "../../../_common/utils/error";
import { isSamePersonName } from "../../../_common/business/crew.rules";
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

    async createGuest(name) {
      // Fresh state: guests created earlier in this departure are included.
      const store = useClubOverviewStore.getState();
      const { rowers } = store.clubOverview;
      const sameName = (rower: { name: string }) =>
        isSamePersonName(rower.name, name);

      // A typed name that is an active member is that member.
      const member = clubOverviewStore
        .getAllRowers()
        .find((rower) => sameName(rower));
      if (member) return member;

      const guest = rowers.find(
        (rower) =>
          rower.status === "guest" && !rower.mergedIntoId && sameName(rower)
      );
      if (guest) {
        if (guest.archivedAt) {
          store.unarchiveRower(guest.id);
        }
        return guest;
      }

      return store.addRower(name, null, null, { status: "guest" });
    },

    async saveSession(payload) {
      return sessionsStore.startSession(payload);
    },
  };

  return repository;
};
