import { generateIncidenId } from "../../../_common/business/incident.rules";
import useIncidentStore from "../../../_common/store/incident.store";
import { useSessionsStore } from "../../../_common/store/sessions.store";
import { isAfter, toISODateFormat } from "../../../_common/utils/date.utils";
import { asError, asOk, SimpleResult } from "../../../_common/utils/error";
import { isStringEquivalentOfUndefined } from "../../../_common/utils/string.utils";
import { getDatabase } from "../../../_common/database/database";
import {
  finishOuting,
  insertOuting,
} from "../../../_common/database/repositories/club.repository";
import {
  enqueueWrite,
  flushWrites,
} from "../../../_common/database/writeQueue";
import { OngoingOuting } from "../../../_common/database/repositories/club.types";
import i18n from "../../../_common/i18n/config";

interface ISessionRepository {
  getOngoingSession(sessionId: string): OngoingOuting | undefined;

  removeSession(sessionId: string): void;
}

export interface SessionToSave {
  id: string;
  boatId: string;
  startDateTime: string;
  estimatedEndDateTime?: string | undefined;
  routeId?: string | undefined;
  endDateTime: string;
  comment: string;
  rowerIds: string[];
  coached: boolean;
}

interface ISessionDatabaseRepository {
  finishSession(payload: {
    outing: OngoingOuting;
    endDateTime: string;
    comment: string;
    coached: boolean;
    distanceM?: number | null;
  }): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>>;
}

interface IIncidentStore {
  addIncident(incident: {
    id: string;
    message: string;
    sessionId: string;
    datetime: string;
    boatId: string;
  }): void;
}

class StopSession {
  constructor(
    private readonly sessionStore: ISessionRepository,
    private readonly sessionDatabaseRepository: ISessionDatabaseRepository,
    private readonly incidentStore: IIncidentStore
  ) {}

  async execute(stopSessionPayload: {
    sessionId: string;
    endDateTime: string;
    comment: string;
    incident: {
      checked: boolean;
      message: string | undefined;
    };
    coached: boolean;
    distanceM?: number | null;
  }): Promise<
    SimpleResult<
      | "ONGOING_SESSION_NOT_FOUND"
      | "END_DATE_BEFORE_START_DATE"
      | "FAILED_TO_SAVE_SESSION",
      string
    >
  > {
    stopSessionPayload = {
      ...stopSessionPayload,
      endDateTime: toISODateFormat(stopSessionPayload.endDateTime),
    };

    const ongoingSessionInStore = this.sessionStore.getOngoingSession(
      stopSessionPayload.sessionId
    );

    if (ongoingSessionInStore === undefined) {
      return asError({
        code: "ONGOING_SESSION_NOT_FOUND",
      });
    }

    if (
      ongoingSessionInStore?.startDateTime &&
      isAfter(
        new Date(ongoingSessionInStore?.startDateTime),
        new Date(stopSessionPayload.endDateTime)
      )
    ) {
      return asError({
        code: "END_DATE_BEFORE_START_DATE",
      });
    }

    const [saveSessionError] =
      await this.sessionDatabaseRepository.finishSession({
        outing: ongoingSessionInStore,
        endDateTime: stopSessionPayload.endDateTime,
        comment: stopSessionPayload.comment,
        coached: stopSessionPayload.coached,
        distanceM: stopSessionPayload.distanceM,
      });

    if (saveSessionError) {
      return asError({
        code: saveSessionError.code,
      });
    }

    if (stopSessionPayload.incident.checked) {
      const emptyMessage = i18n.t("session.noIncidentDetails");

      const incidentMessage = isStringEquivalentOfUndefined(
        stopSessionPayload.incident.message
      )
        ? emptyMessage
        : stopSessionPayload.incident.message || emptyMessage;

      const incidentPayload = {
        id: generateIncidenId(),
        message: incidentMessage,
        sessionId: stopSessionPayload.sessionId,
        datetime: stopSessionPayload.endDateTime,
        boatId: ongoingSessionInStore.boat.id,
      };

      this.incidentStore.addIncident(incidentPayload);
    }

    this.sessionStore.removeSession(stopSessionPayload.sessionId);

    return asOk("success");
  }
}

export class SessionDatabaseRepository implements ISessionDatabaseRepository {
  async finishSession(payload: {
    outing: OngoingOuting;
    endDateTime: string;
    comment: string;
    coached: boolean;
    distanceM?: number | null;
  }): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>> {
    // Through the write queue, so that a reload after another failed write
    // cannot read the outing as still ongoing.
    const saved = await enqueueWrite(
      "finish outing",
      async (db) => {
        const finished = await finishOuting(db, {
          id: payload.outing.id,
          endDateTime: payload.endDateTime,
          comment: payload.comment,
          hasBeenCoached: payload.coached,
          distanceM: payload.distanceM,
        });

        // The departure was never saved: record the whole outing now rather
        // than losing it.
        if (!finished) {
          const { outing } = payload;
          await insertOuting(db, {
            id: outing.id,
            boatId: outing.boat.id,
            boatConfigurationId: outing.boatConfigurationId,
            routeId: outing.route?.id ?? null,
            outingTypeCode: outing.outingTypeCode,
            captainRowerId: outing.captainRowerId,
            startDateTime: outing.startDateTime,
            estimatedEndDateTime: outing.estimatedEndDateTime ?? null,
            endDateTime: payload.endDateTime,
            distanceM: payload.distanceM ?? null,
            comment: payload.comment,
            hasBeenCoached: payload.coached,
            crew: outing.rowers.map((rower) => ({
              rowerId: rower.id,
              role: rower.role,
            })),
          });
        }
      },
      { quiet: true }
    );
    if (!saved) return asError({ code: "FAILED_TO_SAVE_SESSION" });
    return asOk(null);
  }

  /** Inserts finished outings at once (demo data). */
  async saveSessions(
    sessions: SessionToSave[]
  ): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>> {
    try {
      const { db } = await getDatabase();
      // Boats and rowers created just before (demo) must be written first.
      await flushWrites();
      for (const session of sessions) {
        await insertOuting(db, {
          id: session.id,
          boatId: session.boatId,
          routeId: session.routeId,
          startDateTime: session.startDateTime,
          estimatedEndDateTime: session.estimatedEndDateTime,
          endDateTime: session.endDateTime,
          comment: session.comment,
          hasBeenCoached: session.coached,
          crew: session.rowerIds.map((rowerId) => ({
            rowerId,
            role: "rower" as const,
          })),
        });
      }
      return asOk(null);
    } catch (e) {
      console.error("❌ Failed to save session(s)");
      console.error(e);
      return asError({
        code: "FAILED_TO_SAVE_SESSION",
      });
    }
  }
}

export const useGetStopSession = () => {
  const sessionStore = useSessionsStore();
  const incidentStore = useIncidentStore();

  const sessionDatabaseRepository = new SessionDatabaseRepository();

  return new StopSession(
    sessionStore,
    sessionDatabaseRepository,
    incidentStore
  );
};
