import { generateIncidenId } from "../../../_common/business/incident.rules";
import { isAfter } from "../../../_common/utils/date.utils";
import { asError, asOk, SimpleResult } from "../../../_common/utils/error";
import { isStringEquivalentOfUndefined } from "../../../_common/utils/string.utils";

interface ISessionStoreRepository {
  getOngoingSession(sessionId: string): SimpleResult<
    "FAILED_TO_GET_SESSION",
    {
      id: string;
      boatId: string;
      startDateTime: string;
      estimatedEndDateTime: string;
      routeId: string;
    }
  >;

  removeSession(
    sessionId: string
  ): SimpleResult<"FAILED_TO_REMOVE_SESSION", null>;
}

interface ISessionDatabaseRepository {
  saveSession(session: {
    id: string;
    boatId: string;
    startDateTime: string;
    estimatedEndDateTime: string;
    routeId: string;
    endDateTime: string;
    incidentId: string;
    comment: string;
  }): Promise<SimpleResult<"FAILED_TO_SAVE_SESSION", null>>;
}

interface IIncidentRepository {
  addIncident(incident: {
    id: string;
    message: string;
    sessionId: string;
    datetime: string;
  }): void;
}

class StopSession {
  constructor(
    private readonly sessionStoreRepository: ISessionStoreRepository,
    private readonly sessionDatabaseRepository: ISessionDatabaseRepository,
    private readonly incidentRepository: IIncidentRepository
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
      this.sessionStoreRepository.getOngoingSession(
        stopSessionPayload.sessionId
      );

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

      this.incidentRepository.addIncident(incidentPayload);
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
      }
    );

    if (saveSessionError) {
      return asError({
        code: saveSessionError.code,
      });
    }

    const [removeSessionError] = this.sessionStoreRepository.removeSession(
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
