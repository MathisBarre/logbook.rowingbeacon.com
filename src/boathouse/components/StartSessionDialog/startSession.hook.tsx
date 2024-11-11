import { useCallback, useState } from "react";
import { useGetZustandBoathouseRepository } from "../../business/Boathouse.repository.zustand";
import { SessionToStart } from "../../business/SessionToStart.business";
import { StartSessionUsecase } from "../../business/StartSession.usecase";

export const useStartSession = (onSessionStarted: () => void) => {
  const [startSessionError, setSubmissionError] = useState<undefined | string>(
    undefined
  );

  const boathouseRepository = useGetZustandBoathouseRepository();
  const [startSessionParams, setStartSessionParams] = useState({
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

  const startSession = useCallback(
    async (startSessionPayload: SessionToStart) => {
      setSubmissionError("");

      const [error] = await new StartSessionUsecase(
        boathouseRepository
      ).execute(startSessionPayload, startSessionParams);

      if (!error) {
        onSessionStarted();
        return;
      }

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

      setSubmissionError(error.message);
    },
    [boathouseRepository]
  );

  const acceptBadAmountOfRowers = useCallback(
    async (startSessionPayload: SessionToStart) => {
      setAlert(null);
      setStartSessionParams((prev) => ({
        ...prev,
        allowNotSameNbOfRowers: true,
      }));
      await startSession(startSessionPayload);
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
  };
};
