import { Route } from "../../_common/types/route.type";
import { toISODateFormat } from "../../_common/utils/date.utils";
import { asError, asOk, TechnicalError } from "../../_common/utils/error";
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
    try {
      if (isInvalidStartSessionDate(payload)) {
        return asError({
          code: "INVALID_DATETIME",
          details: {
            startDatetime: payload.startDatetime,
            estimatedEndDatetime: payload.estimatedEndDatetime,
          },
        });
      }

      const boat = await this.boathouseRepository.getBoat(payload.boatId);

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

      const startedSession =
        await this.boathouseRepository.getStartedSessions();

      const alreadyOnStartedSessionRowersId =
        getAlreadyOnStartedSessionRowersId(payload.rowersId, startedSession);

      if (
        alreadyOnStartedSessionRowersId.length > 0 &&
        !params.allowToHaveSameRowersAlreadyOnStartedSession
      ) {
        const alreadyOnStartedSessionRowers =
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

      // save session

      let route: Route | null = null;

      if (payload.routeId) {
        const _route = await this.boathouseRepository.getRoute(payload.routeId);

        route = _route;
      }

      const rowers = await this.boathouseRepository.getRowersById(
        payload.rowersId
      );

      await this.boathouseRepository.saveSession({
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

      return asOk(true);
    } catch (error) {
      return asError(new TechnicalError(error));
    }
  }
}
