import { fromBoatTypeToNbOfRowers } from "../../../_common/business/boat.rules";
import { IBoatLevelConfigStore } from "../../../_common/store/boatLevelConfig.store";
import {
  canRowerUseBoat,
  getBoatTypeLevelConfig,
  whatShouldItDo,
} from "../../../_common/store/boatLevelConfig.business";
import { Route } from "../../../_common/types/route.type";
import { toISODateFormat } from "../../../_common/utils/date.utils";
import {
  asError,
  asOk,
  ErrorWithCode,
  TechnicalError,
} from "../../../_common/utils/error";
import { checkIfNotSameRowersAsSeatsInBoat } from "./../Boat.business";
import {
  SessionToStart,
  isInvalidStartSessionDate,
} from "./../SessionToStart.business";
import { getAlreadyOnStartedSessionRowersId } from "./../StartedSession.business";
import { IStartSessionRepository } from "./StartSession.repository.interface";

interface Params {
  ignoreRowersNumberError: boolean;
  ignoreRowersAlreadyOnSessionError: boolean;
  ignoreRowersLevelError?: boolean;
}

interface Payload {
  sessionToStart: SessionToStart;
  params: Params;
}

export class StartSessionUsecase {
  constructor(
    private readonly startSessionRepository: IStartSessionRepository,
    private readonly boatLevelConfigStore: IBoatLevelConfigStore
  ) {}

  async execute(payload: Payload) {
    try {
      const sessionToStart = payload.sessionToStart;
      const {
        ignoreRowersAlreadyOnSessionError, //
        ignoreRowersNumberError,
        ignoreRowersLevelError = false,
      } = payload.params;

      const InvalidPayloadError = this.getInvalidPayloadError(sessionToStart);

      if (InvalidPayloadError) {
        return asError(InvalidPayloadError);
      }

      const RowersNumberError = await this.getRowersNumberError(sessionToStart);

      if (!ignoreRowersNumberError && RowersNumberError) {
        return asError(RowersNumberError);
      }

      const AlreadyOnSessionError = await this.getAlreadyOnSessionError(
        sessionToStart
      );

      if (!ignoreRowersAlreadyOnSessionError && AlreadyOnSessionError) {
        return asError(AlreadyOnSessionError);
      }

      const RowersLevelError = await this.getRowersLevelError(sessionToStart);

      if (!ignoreRowersLevelError && RowersLevelError) {
        return asError(RowersLevelError);
      }

      await this.saveSession(sessionToStart);

      return asOk(true);
    } catch (error) {
      return asError(new TechnicalError(error));
    }
  }

  private getInvalidPayloadError(payload: SessionToStart) {
    if (isInvalidStartSessionDate(payload)) {
      return new ErrorWithCode({
        code: "INVALID_DATETIME",
        details: {
          startDatetime: payload.startDatetime,
          estimatedEndDatetime: payload.estimatedEndDatetime,
        },
      });
    }
  }

  private async getRowersNumberError(payload: SessionToStart) {
    const nbOfRowers = payload.rowersId.length;

    const boat = await this.startSessionRepository.getBoat(payload.boatId);

    const notSameRowersAsSeatsInBoat = checkIfNotSameRowersAsSeatsInBoat(
      nbOfRowers,
      boat
    );

    if (notSameRowersAsSeatsInBoat) {
      return new ErrorWithCode({
        code: "BAD_AMOUNT_OF_ROWERS",
        details: {
          nbOfRowers,
          boatRowersQuantity: fromBoatTypeToNbOfRowers(boat.type),
          boatName: boat.name,
        },
      });
    }
  }

  private async getAlreadyOnSessionError(payload: SessionToStart) {
    const startedSession =
      await this.startSessionRepository.getStartedSessions();

    const alreadyOnStartedSessionRowersId = getAlreadyOnStartedSessionRowersId(
      payload.rowersId,
      startedSession
    );

    if (alreadyOnStartedSessionRowersId.length > 0) {
      const alreadyOnStartedSessionRowers =
        await this.startSessionRepository.getRowersById(
          alreadyOnStartedSessionRowersId
        );

      return new ErrorWithCode({
        code: "ROWERS_ALREADY_ON_STARTED_SESSION",
        details: {
          alreadyOnSessionRowers: alreadyOnStartedSessionRowers,
        },
      });
    }
  }

  private async saveSession(payload: SessionToStart) {
    const boat = await this.startSessionRepository.getBoat(payload.boatId);

    let route: Route | null = null;

    if (payload.routeId) {
      const _route = await this.startSessionRepository.getRoute(
        payload.routeId
      );

      route = _route;
    }

    const rowers = await this.startSessionRepository.getRowersById(
      payload.rowersId
    );

    if (rowers.length === 0) {
      throw new ErrorWithCode({
        code: "NO_ROWERS",
        details: {
          rowersId: payload.rowersId,
        },
      });
    }

    await this.startSessionRepository.saveSession({
      boat: {
        id: payload.boatId,
        name: boat.name,
      },
      route,
      comment: payload.comment,
      rowers,
      estimatedEndDateTime: payload.estimatedEndDatetime
        ? toISODateFormat(payload.estimatedEndDatetime)
        : undefined,
      startDateTime: toISODateFormat(payload.startDatetime),
    });
  }

  private async getRowersLevelError(payload: SessionToStart) {
    const boat = await this.startSessionRepository.getBoat(payload.boatId);
    const rowers = await this.startSessionRepository.getRowersById(
      payload.rowersId
    );
    const boatLevelConfig = this.boatLevelConfigStore.getBoatLevelConfig(
      boat.id
    );

    if (!boatLevelConfig) {
      return;
    }

    let nbOfInvalidRowers = 0;
    for (const rower of rowers) {
      if (!canRowerUseBoat(boatLevelConfig, rower)) {
        nbOfInvalidRowers++;
      }
    }

    const boatTypeLevelConfigs =
      this.boatLevelConfigStore.getBoatTypeLevelConfigs();
    const boatTypeMinimalCorrectRowerConfig = getBoatTypeLevelConfig(
      boat.type,
      boatTypeLevelConfigs
    );

    const whatToDo = whatShouldItDo(
      nbOfInvalidRowers,
      boatTypeMinimalCorrectRowerConfig
    );

    if (whatToDo !== "nothing") {
      return new ErrorWithCode({
        code: "INVALID_ROWERS_LEVEL",
        details: {
          nbOfInvalidRowers,
          whatToDo,
        },
      });
    }
  }
}
