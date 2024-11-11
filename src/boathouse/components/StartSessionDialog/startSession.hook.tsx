import { useCallback, useState } from "react";
import { useGetZustandBoathouseRepository } from "../../business/Boathouse.repository.zustand";
import { SessionToStart } from "../../business/SessionToStart.business";
import { StartSessionUsecase } from "../../business/StartSession.usecase";

interface StartSessionParams {
  allowNotSameNbOfRowers: boolean;
  allowToHaveSameRowersAlreadyOnStartedSession: boolean;
}

export const useStartSession = (onSessionStarted: () => void) => {
  const [startSessionError, setSubmissionError] = useState<undefined | string>(
    undefined
  );

  const boathouseRepository = useGetZustandBoathouseRepository();
  const [_startSessionParams, _setStartSessionParams] =
    useState<StartSessionParams>({
      allowNotSameNbOfRowers: false,
      allowToHaveSameRowersAlreadyOnStartedSession: false,
    });
  const [alert, setAlert] = useState<
    | null
    | {
        code: "BAD_AMOUNT_OF_ROWERS";
        details: {
          nbOfRowers: number;
          boatRowersQuantity: number | undefined;
          boatName: string;
        };
      }
    | {
        code: "ROWERS_ALREADY_ON_STARTED_SESSION";
        details: {
          alreadyOnSessionRowers:
            | {
                id: string;
                name: string;
              }[]
            | null;
        };
      }
  >(null);

  const _startSession = useCallback(
    async (
      startSessionPayload: SessionToStart,
      startSessionParams: StartSessionParams
    ) => {
      console.group("starting session...");
      console.log("startSessionPayload", startSessionPayload);
      console.log("startSessionParams", startSessionParams);
      console.groupEnd();

      setSubmissionError("");

      const [error] = await new StartSessionUsecase(
        boathouseRepository
      ).execute(startSessionPayload, startSessionParams);

      if (!error) {
        onSessionStarted();
        return;
      }

      console.log("error", error);

      if (error.code === "BAD_AMOUNT_OF_ROWERS") {
        return setAlert({
          code: error.code,
          details: error.details,
        });
      }

      if (error.code === "ROWERS_ALREADY_ON_STARTED_SESSION") {
        return setAlert({
          code: error.code,
          details: error.details,
        });
      }

      return setSubmissionError(error.message);
    },
    [boathouseRepository]
  );

  const startSession = useCallback(
    async (startSessionPayload: SessionToStart) => {
      return _startSession(startSessionPayload, _startSessionParams);
    },
    [boathouseRepository]
  );

  const acceptBadAmountOfRowers = useCallback(
    async (startSessionPayload: SessionToStart) => {
      setAlert(null);

      const newStartSessionParams = {
        ..._startSessionParams,
        allowNotSameNbOfRowers: true,
      };

      _setStartSessionParams(newStartSessionParams);
      await _startSession(startSessionPayload, newStartSessionParams);
    },
    []
  );

  const acceptToHaveSameRowersAlreadyOnStartedSession = useCallback(
    async (startSessionPayload: SessionToStart) => {
      setAlert(null);

      const newStartSessionParams = {
        ..._startSessionParams,
        allowToHaveSameRowersAlreadyOnStartedSession: true,
      };

      _setStartSessionParams(newStartSessionParams);
      await _startSession(startSessionPayload, newStartSessionParams);
    },
    []
  );

  const fixInputs = useCallback(async () => {
    setAlert(null);
  }, []);

  return {
    startSession,
    startSessionError,
    alert,
    badAmountOfRowersAlert: alert?.code === "BAD_AMOUNT_OF_ROWERS",
    acceptBadAmountOfRowers,
    fixInputs,
    acceptToHaveSameRowersAlreadyOnStartedSession,
  };
};
