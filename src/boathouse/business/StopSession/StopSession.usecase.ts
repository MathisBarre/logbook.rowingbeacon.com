import { generateIncidenId } from "../../../_common/business/incident.rules";
import useIncidentStore from "../../../_common/store/incident.store";
import { useSessionsStore } from "../../../_common/store/sessions.store";
import { isAfter } from "../../../_common/utils/date.utils";
import { asError, asOk, SimpleResult } from "../../../_common/utils/error";
import { isStringEquivalentOfUndefined } from "../../../_common/utils/string.utils";
import { getDatabase } from "../../../_common/database/database";

interface ISessionStore {
  getOngoingSession(sessionId: string): SimpleResult<
    "FAILED_TO_GET_SESSION",
    {
      id: string;
      boatId: string;
      startDateTime: string;
      estimatedEndDateTime: string;
      routeId: string;
      rowerIds: string[];
    }
  >;

  removeSession(
    sessionId: string
  ): SimpleResult<"FAILED_TO_REMOVE_SESSION", null>;
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
      message: string;
    };
  }) {
    const [getSessionError, ongoingSessionInStore] =
      this.sessionStore.getOngoingSession(stopSessionPayload.sessionId);

    if (getSessionError) {
      return asError({
        code: getSessionError.code,
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
      };

      console.log("adding incident", incidentPayload);

      this.incidentStore.addIncident(incidentPayload);
    }

    const [saveSessionError] = await this.sessionDatabaseRepository.saveSession(
      {
        id: ongoingSessionInStore.id,
        boatId: ongoingSessionInStore.boatId,
        startDateTime: ongoingSessionInStore.startDateTime,
        estimatedEndDateTime: ongoingSessionInStore.estimatedEndDateTime,
        routeId: ongoingSessionInStore.routeId,
        endDateTime: stopSessionPayload.endDateTime,
        comment: stopSessionPayload.comment,
        incidentId: incidentId,
        rowerIds: ongoingSessionInStore.rowerIds
      }
    );

    if (saveSessionError) {
      return asError({
        code: saveSessionError.code,
      });
    }

    const [removeSessionError] = this.sessionStore.removeSession(
      stopSessionPayload.sessionId
    );

    if (removeSessionError) {
      return asError({
        code: removeSessionError.code,
      });
    }

    return asOk("success");
  }
}

class SessionDatabaseRepository implements ISessionDatabaseRepository {
  async saveSession(
    session: SessionToSave
  ): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>> {
    try {
      const db = await getDatabase();

      await db.execute(/* sql */ `
        ROLLBACK;
        BEGIN TRANSACTION;
      `);

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
          session.startDateTime,
          session.estimatedEndDateTime,
          session.routeId,
          session.endDateTime,
          session.incidentId,
          session.comment,
        ]
      );

      const values = session.rowerIds
        .map((rowerId) => `(${session.id}, ${rowerId})`)
        .join(", ");

      await db.execute(/* sql */ `
        INSERT INTO session_rowers (
          session_id,
          rower_id
        )
        VALUES ${values}
      `);

      await db.execute(/* sql */ `
        COMMIT;
      `);

      return asOk(null);
    } catch (e) {
      console.error(e);
      return asError({
        code: "FAILED_TO_SAVE_SESSION",
      });
  }
}

const useGetStopSession = () => {
  const sessionStore = useSessionsStore();
  const incidentStore = useIncidentStore();

  const sessionDatabaseRepository = new SessionDatabaseRepository();

  return new StopSession(
    sessionStore,
    sessionDatabaseRepository,
    incidentStore
  );
};
