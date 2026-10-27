import { useCallback, useRef, useState } from "react";
import { SessionToStart } from "../../business/StartSession/StartSession.rules";
import { useGetZustandStartSessionRepository } from "../../business/StartSession/StartSession.repository.zustand";
import { StartSessionUsecase } from "../../business/StartSession/StartSession.usecase";
import { boatLevelConfigStoreCore } from "../../../_common/store/boatLevelConfig.store";
import { useStore } from "zustand";
import i18n from "../../../_common/i18n/config";
import {
  isModuleEnabled,
  useModulesStore,
} from "../../../_common/store/modules.store";

interface StartSessionParams {
  ignoreRowersNumberError: boolean;
  ignoreRowersAlreadyOnSessionError: boolean;
  ignoreRowersLevelError: boolean;
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
    | {
        code: "INVALID_ROWERS_LEVEL";
        details: {
          nbOfInvalidRowers: number;
          whatToDo: "alert" | "block";
        };
      }
  >(null);

  // A second click while saving must not start a second outing.
  const isStarting = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const _startSession = useCallback(
    async (
      startSessionPayload: SessionToStart,
      startSessionParams: StartSessionParams
    ) => {
      if (isStarting.current) return;
      isStarting.current = true;
      setIsSubmitting(true);
      try {
        await runStartSession(startSessionPayload, startSessionParams);
      } finally {
        isStarting.current = false;
        setIsSubmitting(false);
      }
    },
    [boathouseRepository]
  );

  const runStartSession = useCallback(
    async (
      startSessionPayload: SessionToStart,
      startSessionParams: StartSessionParams
    ) => {
      setSubmissionError("");

      const [error] = await new StartSessionUsecase(
        boathouseRepository,
        boatLevelConfigStore
      ).execute({
        params: {
          ...startSessionParams,
          requireCaptain:
            isModuleEnabled("captain") &&
            useModulesStore.getState().captainRequired,
        },
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

      if (error.code === "INVALID_ROWERS_LEVEL") {
        return setAlert({
          code: error.code,
          details: error.details,
        });
      }

      if (error.code === "CAPTAIN_REQUIRED") {
        return setSubmissionError(error.code);
      }

      if (error.code === "INVALID_DATETIME") {
        return setSubmissionError(i18n.t("session.returnBeforeStart"));
      }

      if (error.code === "BOAT_ALREADY_ON_SESSION") {
        return setSubmissionError(i18n.t("session.boatAlreadyOnSession"));
      }

      if (error.code === "DUPLICATE_CREW_MEMBER") {
        return setSubmissionError(i18n.t("session.duplicateCrewMember"));
      }

      if (error.message.includes("OUTING_NOT_SAVED")) {
        return setSubmissionError(i18n.t("session.notSaved"));
      }

      console.error("❌ Failed to start session", error);
      return setSubmissionError(i18n.t("session.notSaved"));
    },
    [boathouseRepository]
  );

  const startSession = useCallback(
    async (startSessionPayload: SessionToStart) => {
      return _startSession(startSessionPayload, {
        ignoreRowersNumberError: false,
        ignoreRowersAlreadyOnSessionError: false,
        ignoreRowersLevelError: false,
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
        ignoreRowersLevelError: false,
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
        ignoreRowersLevelError: false,
      });
    },
    []
  );

  const acceptToHaveInvalidRowersLevel = useCallback(
    async (startSessionPayload: SessionToStart) => {
      setAlert(null);

      await _startSession(startSessionPayload, {
        ignoreRowersNumberError: true,
        ignoreRowersAlreadyOnSessionError: true,
        ignoreRowersLevelError: true,
      });
    },
    []
  );

  const fixInputs = useCallback(() => {
    setAlert(null);
  }, []);

  const clearStartSessionError = useCallback(() => {
    setSubmissionError("");
  }, []);

  return {
    startSession,
    isSubmitting,
    startSessionError,
    clearStartSessionError,
    alert,
    fixInputs,
    acceptBadAmountOfRowers,
    acceptToHaveSameRowersAlreadyOnStartedSession,
    acceptToHaveInvalidRowersLevel,
  };
};
