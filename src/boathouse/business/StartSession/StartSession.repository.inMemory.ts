import { generateSessionId } from "../../../_common/business/session.rules";
import { Route } from "../../../_common/business/route.rules";
import { Rower } from "../../../_common/business/rower.rules";
import { ErrorWithCode } from "../../../_common/utils/error";
import { StartedSession } from "./StartSession.rules";
import {
  IStartSessionRepository,
  StartSessionBoat,
} from "./StartSession.repository.interface";

interface InMemoryRepositoryParams {
  routes?: Route[];
  boats?: StartSessionBoat[];
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
        boat: { id: payload.boat.id },
      });

      return Promise.resolve();
    },

    createGuest(name) {
      const guest = { id: `guest-${rowers.length + 1}`, name };
      rowers.push(guest);
      return Promise.resolve(guest);
    },

    findPersonByName(name) {
      return Promise.resolve(rowers.find((rower) => rower.name === name));
    },

    getRowersById(rowersId) {
      return Promise.resolve(
        rowers.filter((rower) => rowersId.includes(rower.id))
      );
    },
  };

  return repository;
};
