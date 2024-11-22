import { useOnboardingStore } from "../../onboarding/onboarding.store";
import { getDatabase } from "../database/database";
import { useClubOverviewStore } from "../store/clubOverview.store";
import useIncidentStore from "../store/incident.store";
import { useSessionsStore } from "../store/sessions.store";

export const useLogout = () => {
  const sessionStore = useSessionsStore();
  const clubOverviewStore = useClubOverviewStore();
  const incidentStore = useIncidentStore();
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);

  return async () => {
    const db = await getDatabase();

    db.execute("DELETE FROM session");
    db.execute("DELETE FROM session_rowers");

    sessionStore.reset();
    clubOverviewStore.reset();
    incidentStore.reset();
    setIsOnboardingDone(false);
  };
};
