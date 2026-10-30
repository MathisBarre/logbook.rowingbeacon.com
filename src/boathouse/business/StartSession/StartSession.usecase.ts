import { IBoatLevelConfigStore } from "../../../_common/store/boatLevelConfig.store";
import {
  canRowerUseBoat,
  getBoatTypeLevelConfig,
} from "../../../_common/store/boatLevelConfig.rules";
import {
  getCrewSizeMismatch,
  getOutingConfiguration,
  whatShouldItDo,
} from "./StartSession.rules";
import { Route } from "../../../_common/business/route.rules";
import { Rower } from "../../../_common/business/rower.rules";
import {
  getNewGuestName,
  hasDuplicateCrewMember,
  isSamePersonName,
} from "../../../_common/business/crew.rules";
import { getLegacyTypeFromConfiguration } from "../../../_common/business/boatConfiguration.rules";
import { toISODateFormat } from "../../../_common/utils/date.utils";
import {
  asError,
  asOk,
  ErrorWithCode,
  TechnicalError,
} from "../../../_common/utils/error";
import {
  SessionToStart,
  isInvalidStartSessionDate,
} from "./StartSession.rules";
import { getAlreadyOnStartedSessionRowersId } from "./StartSession.rules";
import {
  IStartSessionRepository,
  StartSessionBoat,
} from "./StartSession.repository.interface";

interface Params {
  ignoreRowersNumberError: boolean;
  ignoreRowersAlreadyOnSessionError: boolean;
  ignoreRowersLevelError?: boolean;
  /** Captain module option: refuse an outing without a captain. */
  requireCaptain?: boolean;
}

interface Payload {
  sessionToStart: SessionToStart;
  params: Params;
}

/** Crew ids in seat order, cox last. */
const getCrewIds = (payload: SessionToStart) => [
  ...payload.rowersId,
  ...(payload.coxId ? [payload.coxId] : []),
];

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
        requireCaptain = false,
      } = payload.params;

      const InvalidPayloadError = this.getInvalidPayloadError(
        sessionToStart,
        requireCaptain
      );

      if (InvalidPayloadError) {
        return asError(InvalidPayloadError);
      }

      const startedSessions =
        await this.startSessionRepository.getStartedSessions();
      if (
        startedSessions.some(
          (session) => session.boat?.id === sessionToStart.boatId
        )
      ) {
        return asError({ code: "BOAT_ALREADY_ON_SESSION" });
      }

      // Checked again here: the boat may have been put out of service since
      // the dialog opened.
      const boat = await this.startSessionRepository.getBoat(
        sessionToStart.boatId
      );
      if (boat.isInMaintenance) {
        return asError({ code: "BOAT_UNUSABLE" });
      }

      const RowersNumberError = await this.getRowersNumberError(sessionToStart);

      if (!ignoreRowersNumberError && RowersNumberError) {
        return asError(RowersNumberError);
      }

      const AlreadyOnSessionError =
        await this.getAlreadyOnSessionError(sessionToStart);

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

  private getInvalidPayloadError(
    payload: SessionToStart,
    requireCaptain: boolean
  ) {
    if (isInvalidStartSessionDate(payload)) {
      return new ErrorWithCode({
        code: "INVALID_DATETIME",
        details: {
          startDatetime: payload.startDatetime,
          estimatedEndDatetime: payload.estimatedEndDatetime,
        },
      });
    }

    if (hasDuplicateCrewMember(getCrewIds(payload))) {
      return new ErrorWithCode({ code: "DUPLICATE_CREW_MEMBER" });
    }

    const hasCaptainInCrew =
      !!payload.captainRowerId &&
      getCrewIds(payload).includes(payload.captainRowerId);

    if (requireCaptain && !hasCaptainInCrew) {
      return new ErrorWithCode({ code: "CAPTAIN_REQUIRED" });
    }
  }

  private async getRowersNumberError(payload: SessionToStart) {
    const boat = await this.startSessionRepository.getBoat(payload.boatId);
    const mismatch = getCrewSizeMismatch(boat, {
      nbOfRowers: payload.rowersId.length,
      hasCox: !!payload.coxId,
      boatConfigurationId: payload.boatConfigurationId,
    });

    if (mismatch) {
      return new ErrorWithCode({
        code: "BAD_AMOUNT_OF_ROWERS",
        details: { ...mismatch, boatName: boat.name },
      });
    }
  }

  private async getAlreadyOnSessionError(payload: SessionToStart) {
    const startedSession =
      await this.startSessionRepository.getStartedSessions();

    const crewIds = getCrewIds(payload);
    const alreadyOnStartedSessionRowersId = getAlreadyOnStartedSessionRowersId(
      crewIds,
      startedSession
    );

    // A typed guest name is the guest already out under that name.
    const guestsAlreadyOut = crewIds.flatMap((id) => {
      const guestName = getNewGuestName(id);
      if (guestName === null) return [];
      return startedSession
        .flatMap((session) => session.rowers)
        .filter((rower) => isSamePersonName(rower.name, guestName))
        .slice(0, 1);
    });

    if (alreadyOnStartedSessionRowersId.length > 0 || guestsAlreadyOut.length) {
      const alreadyOnStartedSessionRowers = [
        ...(await this.startSessionRepository.getRowersById(
          alreadyOnStartedSessionRowersId
        )),
        ...guestsAlreadyOut,
      ];

      return new ErrorWithCode({
        code: "ROWERS_ALREADY_ON_STARTED_SESSION",
        details: {
          alreadyOnSessionRowers: alreadyOnStartedSessionRowers,
        },
      });
    }
  }

  /** Registered rowers for ids, guests created for typed names, in order. */
  private async resolveCrewMembers(ids: string[]) {
    const registered = await this.startSessionRepository.getRowersById(
      ids.filter((id) => getNewGuestName(id) === null)
    );
    const members = new Map<string, Rower>();

    for (const id of ids) {
      const guestName = getNewGuestName(id);
      const member =
        guestName === null
          ? registered.find((rower) => rower.id === id)
          : await this.startSessionRepository.createGuest(guestName);

      if (member) {
        members.set(id, member);
      }
    }

    return members;
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

    const members = await this.resolveCrewMembers(getCrewIds(payload));

    if (members.size === 0) {
      throw new ErrorWithCode({
        code: "NO_ROWERS",
        details: {
          rowersId: payload.rowersId,
        },
      });
    }

    const rowers = [
      ...payload.rowersId.map((id) => ({ id, role: "rower" as const })),
      ...(payload.coxId ? [{ id: payload.coxId, role: "cox" as const }] : []),
    ].flatMap(({ id, role }) => {
      const member = members.get(id);
      return member ? [{ ...member, role }] : [];
    });

    const captainRowerId = payload.captainRowerId
      ? (members.get(payload.captainRowerId)?.id ?? null)
      : null;

    await this.startSessionRepository.saveSession({
      boat: {
        id: payload.boatId,
        name: boat.name,
      },
      route,
      comment: payload.comment,
      rowers,
      boatConfigurationId:
        getOutingConfiguration(boat, payload.boatConfigurationId)?.id ?? null,
      outingTypeCode: payload.outingTypeCode ?? null,
      captainRowerId,
      estimatedEndDateTime: payload.estimatedEndDatetime
        ? toISODateFormat(payload.estimatedEndDatetime)
        : undefined,
      startDateTime: toISODateFormat(payload.startDatetime),
    });
  }

  private getLevelBoatType(
    boat: StartSessionBoat,
    boatConfigurationId?: string | null
  ) {
    const configuration = getOutingConfiguration(boat, boatConfigurationId);

    return configuration
      ? getLegacyTypeFromConfiguration(configuration)
      : boat.type;
  }

  /**
   * Only rowing seats are checked: the cox is not, and a guest never counts
   * as an invalid rower (they have no level to check).
   */
  private async getRowersLevelError(payload: SessionToStart) {
    const boat = await this.startSessionRepository.getBoat(payload.boatId);
    const rowers = await this.startSessionRepository.getRowersById(
      payload.rowersId.filter((id) => getNewGuestName(id) === null)
    );
    const boatLevelConfig = this.boatLevelConfigStore.getBoatLevelConfig(
      boat.id
    );

    if (!boatLevelConfig) {
      return;
    }

    let nbOfInvalidRowers = 0;
    for (const rower of rowers) {
      if (
        rower.status !== "guest" &&
        !canRowerUseBoat(boatLevelConfig, rower)
      ) {
        nbOfInvalidRowers++;
      }
    }

    const seats = getOutingConfiguration(
      boat,
      payload.boatConfigurationId
    )?.seats;
    if (seats !== undefined && seats !== null) {
      nbOfInvalidRowers += Math.max(seats - payload.rowersId.length, 0);
    }

    const boatTypeLevelConfigs =
      this.boatLevelConfigStore.getBoatTypeLevelConfigs();
    const boatTypeMinimalCorrectRowerConfig = getBoatTypeLevelConfig(
      this.getLevelBoatType(boat, payload.boatConfigurationId),
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
