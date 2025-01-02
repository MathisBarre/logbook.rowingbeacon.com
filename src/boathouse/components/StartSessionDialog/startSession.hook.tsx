import { useCallback, useState } from "react";
import { SessionToStart } from "../../business/SessionToStart.business";
import { useGetZustandStartSessionRepository } from "../../business/StartSession/StartSession.repository.zustand";
import { StartSessionUsecase } from "../../business/StartSession/StartSession.usecase";
import { boatLevelConfigStoreCore } from "../../../_common/store/boatLevelConfig.store";
import { useStore } from "zustand";

interface StartSessionParams {
  ignoreRowersNumberError: boolean;
  ignoreRowersAlreadyOnSessionError: boolean;
}

export const useStartSession = (onSessionStarted: () => void) => {
  const [startSessionError, setSubmissionError] = useState<undefined | string>(
    undefined
  );

  const boathouseRepository = useGetZustandStartSessionRepository();
  const boatLevelConfigStore = useStore(boatLevelConfigStoreCore);

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
      setSubmissionError("");

      const [error] = await new StartSessionUsecase(
        boathouseRepository,
        boatLevelConfigStore
      ).execute({
        params: startSessionParams,
        sessionToStart: startSessionPayload,
      });

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

      return setSubmissionError(error.message);
    },
    [boathouseRepository]
  );

  const startSession = useCallback(
    async (startSessionPayload: SessionToStart) => {
      return _startSession(startSessionPayload, {
        ignoreRowersNumberError: false,
        ignoreRowersAlreadyOnSessionError: false,
      });
    },
    [boathouseRepository]
  );

  const acceptBadAmountOfRowers = useCallback(
    async (startSessionPayload: SessionToStart) => {
      setAlert(null);

      await _startSession(startSessionPayload, {
        ignoreRowersNumberError: true,
        ignoreRowersAlreadyOnSessionError: false,
      });
    },
    []
  );

  const acceptToHaveSameRowersAlreadyOnStartedSession = useCallback(
    async (startSessionPayload: SessionToStart) => {
      setAlert(null);

      await _startSession(startSessionPayload, {
        ignoreRowersNumberError: true,
        ignoreRowersAlreadyOnSessionError: true,
      });
    },
    []
  );

  const fixInputs = useCallback(() => {
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
