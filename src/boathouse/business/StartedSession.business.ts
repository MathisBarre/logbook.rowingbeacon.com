import { Rower } from "../../_common/types/rower.type";

export interface StartedSession {
  id: string;
  rowers: Rower[];
}

export const getAlreadyOnStartedSessionRowersId = (
  rowersId: string[],
  startedSessions: StartedSession[]
): string[] => {
  return rowersId.filter((rowerId) =>
    startedSessions.some((startedSession) =>
      startedSession.rowers.some((rower) => rower.id === rowerId)
    )
  );
};
