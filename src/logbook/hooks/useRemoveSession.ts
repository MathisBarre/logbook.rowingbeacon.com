import { useState } from "react";
import { sessionRepository } from "../SessionRepository";

export const useRemoveSession = () => {
  const [isRemoving, setIsRemoving] = useState(false);

  const removeSession = async (sessionId: string) => {
    setIsRemoving(true);
    try {
      return await sessionRepository.removeSession(sessionId);
    } finally {
      setIsRemoving(false);
    }
  };

  return { isRemoving, removeSession };
};
