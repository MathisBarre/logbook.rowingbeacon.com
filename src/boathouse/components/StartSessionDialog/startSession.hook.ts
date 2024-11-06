import { useCallback, useState } from "react";
import { useGetZustandBoathouseRepository } from "../../business/Boathouse.repository.zustand";
import { SessionToStart } from "../../business/SessionToStart.business";
import { StartSessionUsecase } from "../../business/StartSession.usecase";
import { windowConfirm } from "../../../_common/utils/window.utils";

export const useStartSession = (onSessionStarted: () => void) => {
  const [startSessionError, setSubmissionError] = useState<undefined | string>(
    undefined
  );

  const boathouseRepository = useGetZustandBoathouseRepository();
  const [startSessionParams, setStartSessionParams] = useState({
    allowNotSameNbOfRowers: false,
    allowToHaveSameRowersAlreadyOnStartedSession: false,
  });

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

      if (
        error.code === "BAD_AMOUNT_OF_ROWERS" &&
        await windowConfirm(
          `Vous avez renseigné ${error.details.nbOfRowers} rameur(s) alors que le bateau ${error.details.boatName} n'a que ${error.details.boatRowersQuantity} rameur(s). Souhaitez-vous continuer ?`
        )
      ) {
        setStartSessionParams((prev) => ({
          ...prev,
          allowNotEnoughRowers: true,
        }));

        return startSession(startSessionPayload);
      }

      if (
        error.code === "ROWERS_ALREADY_ON_STARTED_SESSION" &&
        await windowConfirm(
          `Certains rameurs ont déjà commencé une autre sortie. Souhaitez-vous continuer ?`
        )
      ) {
        setStartSessionParams((prev) => ({
          ...prev,
          allowToHaveSameRowersAlreadyOnStartedSession: true,
        }));

        return startSession(startSessionPayload);
      }

      setSubmissionError(error.message);
    },
    [boathouseRepository]
  );

  return { startSession, startSessionError };
};
