import { useSessionsStore } from "./sessions.store";

export const useIncidentSystem = () => {
  const { session } = useSessionsStore();

  const getBoatNameBySessionId = (sessionId: string) => {
    const foundSession = session.find((s) => s.id === sessionId);
    return foundSession ? foundSession.boat.name : "Nom du bateau inconnu";
  };

  return {
    getBoatNameBySessionId,
  };
};
