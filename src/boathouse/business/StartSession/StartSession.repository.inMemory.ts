import { generateSessionId } from "../../../_common/business/session.rules";
import { Boat } from "../../../_common/business/boat.rules";
import { Route } from "../../../_common/business/route.rules";
import { Rower } from "../../../_common/business/rower.rules";
import { ErrorWithCode } from "../../../_common/utils/error";
import { StartedSession } from "../StartedSession.business";
import { IStartSessionRepository } from "./StartSession.repository.interface";

interface InMemoryRepositoryParams {
  routes?: Route[];
  boats?: Boat[];
  ongoingSessions?: StartedSession[];
  rowers?: Rower[];
}

export const createInMemoryStartSessionRepository = ({
  routes = [],
  boats = [],
  ongoingSessions = [],
  rowers = [],
}: InMemoryRepositoryParams): IStartSessionRepository => {
  const repository: IStartSessionRepository = {
    getRoute(routeId) {
      const result = routes.find((route) => route.id === routeId);

      if (!result) {
        throw new ErrorWithCode({ code: "ROUTE_NOT_FOUND" });
      }

      return Promise.resolve(result);
    },

    getBoat(boatId) {
      const boat = boats.find((boat) => boat.id === boatId);

      if (!boat) {
        throw new ErrorWithCode({ code: "BOAT_NOT_FOUND" });
      }

      return Promise.resolve(boat);
    },

    getStartedSessions() {
      return Promise.resolve(ongoingSessions);
    },

    saveSession(payload) {
      ongoingSessions.push({
        id: generateSessionId(),
        rowers: payload.rowers,
      });

      return Promise.resolve();
    },

    getRowersById(rowersId) {
      return Promise.resolve(
        rowers.filter((rower) => rowersId.includes(rower.id))
      );
    },
  };

  return repository;
};
