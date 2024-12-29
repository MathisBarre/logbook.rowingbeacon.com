import { useOnboardingStore } from "../../onboarding/onboarding.store";
import { getDatabase } from "../database/database";
import { DBSessionOnRowers, DBSessions } from "../database/schema";
import { useBoatLevelConfigStore } from "../store/boatLevelConfig.store";
import { useClubOverviewStore } from "../store/clubOverview.store";
import useIncidentStore from "../store/incident.store";
import { useSessionsStore } from "../store/sessions.store";

export const useLogout = () => {
  const sessionStore = useSessionsStore();
  const clubOverviewStore = useClubOverviewStore();
  const incidentStore = useIncidentStore();
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);
  const boatLevelConfigStore = useBoatLevelConfigStore();

  return async () => {
    const { drizzle } = await getDatabase();

    await drizzle.delete(DBSessions);
    await drizzle.delete(DBSessionOnRowers);

    sessionStore.reset();
    clubOverviewStore.reset();
    incidentStore.reset();
    boatLevelConfigStore.reset();

    setIsOnboardingDone(false);
  };
};
