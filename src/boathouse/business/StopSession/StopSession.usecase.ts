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

interface ISessionStore {
  getOngoingSession(sessionId: string):
    | {
        id: string;
        boat: {
          id: string;
        };
        startDateTime: string;
        estimatedEndDateTime: string;
        route: {
          id: string;
        };
        rowers: {
          id: string;
        }[];
      }
    | undefined;

  removeSession(sessionId: string): void;
}

interface SessionToSave {
  id: string;
  boatId: string;
  startDateTime: string;
  estimatedEndDateTime: string;
  routeId: string;
  endDateTime: string;
  incidentId: string;
  comment: string;

  rowerIds: string[];
}

interface ISessionDatabaseRepository {
  saveSession(
    session: SessionToSave
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
    private readonly sessionStore: ISessionStore,
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

    const [saveSessionError] = await this.sessionDatabaseRepository.saveSession(
      {
        id: ongoingSessionInStore.id,
        boatId: ongoingSessionInStore.boat.id,
        startDateTime: ongoingSessionInStore.startDateTime,
        estimatedEndDateTime: ongoingSessionInStore.estimatedEndDateTime,
        routeId: ongoingSessionInStore.route.id,
        endDateTime: stopSessionPayload.endDateTime,
        comment: stopSessionPayload.comment,
        incidentId: incidentId,
        rowerIds: ongoingSessionInStore.rowers.map((rower) => rower.id),
      }
    );

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

class SessionDatabaseRepository implements ISessionDatabaseRepository {
  async saveSession(
    session: SessionToSave
  ): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>> {
    const db = await getDatabase();

    try {
      await db.execute(
        /* sql */ `
        INSERT INTO session (
          id,
          boat_id,
          start_date_time,
          estimated_end_date_time,
          route_id,
          end_date_time,
          incident_id,
          comment
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          session.id,
          session.boatId,
          getDateTimeWithoutTimezone(session.startDateTime),
          getDateTimeWithoutTimezone(session.estimatedEndDateTime),
          session.routeId,
          getDateTimeWithoutTimezone(session.endDateTime),
          session.incidentId,
          session.comment,
        ]
      );

      const values = session.rowerIds
        .map((rowerId) => `('${session.id}', '${rowerId}')`)
        .join(", ");

      await db.execute(/* sql */ `
        INSERT INTO session_rowers (
          session_id,
          rower_id
        )
        VALUES ${values}
      `);

      console.log("✅ Session saved");

      return asOk(null);
    } catch (e) {
      console.error("❌ Failed to save session");
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
