import { useOnboardingStore } from "../../onboarding/onboarding.store";
import { useClubOverviewStore } from "../store/clubOverview.store";
import { useSessionsStore } from "../store/sessions.store";

export const useLogout = () => {
  const sessionStore = useSessionsStore();
  const clubOverviewStore = useClubOverviewStore();
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);

  return () => {
    sessionStore.reset();
    clubOverviewStore.reset();
    setIsOnboardingDone(false);
  };
};
