import { Route } from "../../_common/types/route.type";
import { toISODateFormat } from "../../_common/utils/date.utils";
import { asError, asOk } from "../../_common/utils/error";
import { checkIfNotSameRowersAsSeatsInBoat } from "./Boat.business";
import { IBoathouseRepository } from "./Boathouse.repository.interface";
import {
  SessionToStart,
  isInvalidStartSessionDate,
} from "./SessionToStart.business";
import { getAlreadyOnStartedSessionRowersId } from "./StartedSession.business";

interface Params {
  allowNotSameNbOfRowers: boolean;
  allowToHaveSameRowersAlreadyOnStartedSession: boolean;
}

export class StartSessionUsecase {
  constructor(private readonly boathouseRepository: IBoathouseRepository) {}

  async execute(payload: SessionToStart, params: Params) {
    const [getBoatError, boat] = await this.boathouseRepository.getBoat(
      payload.boatId
    );

    if (getBoatError) {
      return asError({
        code: "BOAT_NOT_FOUND",
        message: `Boat ${payload.boatId} not found`,
      });
    }

    if (isInvalidStartSessionDate(payload)) {
      return asError({
        code: "INVALID_DATETIME",
        details: {
          startDatetime: payload.startDatetime,
          estimatedEndDatetime: payload.estimatedEndDatetime,
        },
      });
    }

    const nbOfRowers = payload.rowersId.length;

    const notSameRowersAsSeatsInBoat = checkIfNotSameRowersAsSeatsInBoat(
      nbOfRowers,
      boat
    );
    if (notSameRowersAsSeatsInBoat && !params.allowNotSameNbOfRowers) {
      return asError({
        code: "BAD_AMOUNT_OF_ROWERS",
        details: {
          nbOfRowers,
          boatRowersQuantity: boat.rowersQuantity,
          boatName: boat.name,
        },
      });
    }

    const [getStartedSessionError, startedSession] =
      await this.boathouseRepository.getStartedSessions();

    if (getStartedSessionError) {
      return asError({
        code: "GET_STARTED_SESSION_REQUEST_ERROR",
      });
    }

    const alreadyOnStartedSessionRowersId = getAlreadyOnStartedSessionRowersId(
      payload.rowersId,
      startedSession
    );

    if (
      alreadyOnStartedSessionRowersId.length > 0 &&
      !params.allowToHaveSameRowersAlreadyOnStartedSession
    ) {
      const [, alreadyOnStartedSessionRowers] =
        await this.boathouseRepository.getRowersById(
          alreadyOnStartedSessionRowersId
        );

      return asError({
        code: "ROWERS_ALREADY_ON_STARTED_SESSION",
        details: {
          alreadyOnSessionRowers: alreadyOnStartedSessionRowers,
        },
      });
    }

    let route: Route | null = null;

    if (payload.routeId) {
      const [getRouteError, _route] = await this.boathouseRepository.getRoute(
        payload.routeId
      );

      if (getRouteError) {
        return asError({
          code: "ROUTE_NOT_FOUND",
        });
      }

      route = _route;
    }

    const [getRowersError, rowers] =
      await this.boathouseRepository.getRowersById(payload.rowersId);

    if (getRowersError) {
      return asError({
        code: "ROWERS_NOT_FOUND",
      });
    }

    const [saveSessionError] = await this.boathouseRepository.saveSession({
      boat: {
        id: payload.boatId,
        name: boat.name,
        rowersQuantity: boat.rowersQuantity,
      },
      route,
      comment: payload.comment,
      rowers,
      estimatedEndDateTime: payload.estimatedEndDatetime
        ? toISODateFormat(payload.estimatedEndDatetime)
        : undefined,
      startDateTime: toISODateFormat(payload.startDatetime),
    });

    if (saveSessionError) {
      return asError({
        code: "SAVE_SESSION_ERROR",
        message: `Error while saving session`,
      });
    }

    return asOk(true);
  }
}
