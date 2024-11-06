import BoathouseScreen from "./boathouse/Boathouse.screen";
import { Onboarding } from "./onboarding/Onboarding";
import { useOnboardingStore } from "./onboarding/onboarding.store";

export function Router() {
  const isOnboardingDone = useOnboardingStore((state) => state.isOnboarded);
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);

  if (!isOnboardingDone) {
    return <Onboarding setIsOnboardingDone={setIsOnboardingDone} />;
  }

  return (
    <>
      <BoathouseScreen />
    </>
  );
}
