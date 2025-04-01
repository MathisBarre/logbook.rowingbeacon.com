import { NavigationBar } from "./_common/components/NavigationBar";
import useNavigationStore from "./_common/store/navigation.store";
import { useAdminShortcut } from "./_common/utils/adminShortcut";
import { forEnum } from "./_common/utils/utils";
import BoathouseScreen from "./boathouse/Boathouse.screen";
import { LogbookScreen } from "./logbook/Logbook.screen";
import { OnboardingScreen } from "./onboarding/Onboarding.screen";
import { useOnboardingStore } from "./onboarding/onboarding.store";
import { ParametersScreen } from "./parameters/Parameters.screen";
import { StatsScreen } from "./stats/Stats.screen";
export function Router() {
  const isOnboardingDone = useOnboardingStore((state) => state.isOnboarded);
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);
  const {
    navigation: { page },
    setPage,
  } = useNavigationStore();

  useAdminShortcut(() => {
    setPage("parameters");
  });

  if (!isOnboardingDone) {
    return (
      <OnboardingScreen
        setIsOnboardingDone={setIsOnboardingDone}
        setPage={setPage}
      />
    );
  }

  return (
    <AppTemplate>
      {forEnum(page, {
        boathouse: () => <BoathouseScreen />,
        logbook: () => <LogbookScreen />,
        parameters: () => <ParametersScreen />,
        stats: () => <StatsScreen />,
      })}
    </AppTemplate>
  );
}

const AppTemplate = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="absolute inset-0 flex flex-col p-1 gap-1 h-screen max-h-screen">
      <main className="flex-1 relative">{children}</main>
      <NavigationBar />
    </div>
  );
};
