import { generateIncidenId } from "../../../_common/business/incident.rules";
import useIncidentStore from "../../../_common/store/incident.store";
import { useSessionsStore } from "../../../_common/store/sessions.store";
import {
  getDateTimeWithoutTimezone,
  isAfter,
  toISODateFormat,
} from "../../../_common/utils/date.utils";
import { asError, asOk, SimpleResult } from "../../../_common/utils/error";
import { isStringEquivalentOfUndefined } from "../../../_common/utils/string.utils";
import { getDatabase } from "../../../_common/database/database";
import {
  DBSessionOnRowers,
  DBSessions,
} from "../../../_common/database/schema";
import { toast } from "sonner";
import i18n from "../../../_common/i18n/config";

interface ISessionRepository {
  getOngoingSession(sessionId: string):
    | {
        id: string;
        boat: {
          id: string;
        };
        startDateTime: string;
        estimatedEndDateTime?: string | undefined;
        route: {
          id: string;
        } | null;
        rowers: {
          id: string;
        }[];
      }
    | undefined;

  removeSession(sessionId: string): void;
}

export interface SessionToSave {
  id: string;
  boatId: string;
  startDateTime: string;
  estimatedEndDateTime?: string | undefined;
  routeId?: string | undefined;
  endDateTime: string;
  incidentId: string;
  comment: string;
  rowerIds: string[];
  coached: boolean;
}

interface ISessionDatabaseRepository {
  saveSessions(
    sessions: SessionToSave[]
  ): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>>;
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

    const incidentId = generateIncidenId();

    console.log("session id", ongoingSessionInStore.id);

    const [saveSessionError] =
      await this.sessionDatabaseRepository.saveSessions([
        {
          id: ongoingSessionInStore.id,
          boatId: ongoingSessionInStore.boat.id,
          startDateTime: ongoingSessionInStore.startDateTime,
          estimatedEndDateTime: ongoingSessionInStore.estimatedEndDateTime,
          routeId: ongoingSessionInStore?.route?.id || undefined,
          endDateTime: stopSessionPayload.endDateTime,
          comment: stopSessionPayload.comment,
          incidentId: incidentId,
          rowerIds: ongoingSessionInStore.rowers.map((rower) => rower.id),
          coached: stopSessionPayload.coached,
        },
      ]);

    if (saveSessionError) {
      return asError({
        code: saveSessionError.code,
      });
    }

    if (stopSessionPayload.incident.checked) {
      const emptyMessage = "Aucun détail renseigné";

      const incidentMessage = isStringEquivalentOfUndefined(
        stopSessionPayload.incident.message
      )
        ? emptyMessage
        : stopSessionPayload.incident.message || emptyMessage;

      const incidentPayload = {
        id: incidentId,
        message: incidentMessage,
        sessionId: stopSessionPayload.sessionId,
        datetime: stopSessionPayload.endDateTime,
        boatId: ongoingSessionInStore.boat.id,
      };

      console.log("adding incident", incidentPayload);

      this.incidentStore.addIncident(incidentPayload);
    }

    this.sessionStore.removeSession(stopSessionPayload.sessionId);

    return asOk("success");
  }
}

export class SessionDatabaseRepository implements ISessionDatabaseRepository {
  async saveSessions(
    sessions: SessionToSave[]
  ): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>> {
    const { drizzle } = await getDatabase();
    try {
      const sessionsToSave = sessions.map((session) => ({
        id: session.id,
        boatId: session.boatId,
        startDateTime: getDateTimeWithoutTimezone(session.startDateTime),
        estimatedEndDateTime: session.estimatedEndDateTime
          ? getDateTimeWithoutTimezone(session.estimatedEndDateTime)
          : undefined,
        routeId: session.routeId,
        endDateTime: getDateTimeWithoutTimezone(session.endDateTime),
        incidentId: session.incidentId,
        comment: session.comment,
        hasBeenCoached: session.coached ? "true" : "false",
      }));

      await drizzle.insert(DBSessions).values(sessionsToSave);

      const rowersOnSessionsToSave = sessions.flatMap((session) =>
        session.rowerIds.map((rowerId) => ({
          sessionId: session.id,
          rowerId: rowerId,
        }))
      );

      try {
        if (rowersOnSessionsToSave.length > 0) {
          await drizzle
            .insert(DBSessionOnRowers)
            .values(rowersOnSessionsToSave);
        } else {
          console.log("⚠️ No rowers to save on session");
        }
      } catch (e) {
        console.error("❌ Failed to save rowers on session");
        console.error(e);
        toast.warning(i18n.t("session.noRowersRecorded"));
      }

      console.log("✅ Session(s) saved");

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
