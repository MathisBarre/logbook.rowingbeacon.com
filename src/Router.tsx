import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
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
import { ErrorBoundary } from "react-error-boundary";

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
        boathouse: () => (
          <ErrorBoundary key={page} fallback={<ErrorFallback />}>
            <BoathouseScreen />
          </ErrorBoundary>
        ),
        logbook: () => (
          <ErrorBoundary key={page} fallback={<ErrorFallback />}>
            <LogbookScreen />
          </ErrorBoundary>
        ),
        parameters: () => (
          <ErrorBoundary key={page} fallback={<ErrorFallback />}>
            <ParametersScreen />
          </ErrorBoundary>
        ),
        stats: () => (
          <ErrorBoundary key={page} fallback={<ErrorFallback />}>
            <StatsScreen />
          </ErrorBoundary>
        ),
      })}
    </AppTemplate>
  );
}

const ErrorFallback = () => {
  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-4 p-4 h-full">
      <AlertCircleIcon className="w-12 h-12 text-red-500" />
      <p className="text-lg">Une erreur est survenue</p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2"
      >
        <RefreshCwIcon className="w-4 h-4" />
        Recharger la page
      </button>
    </div>
  );
};

const AppTemplate = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="absolute inset-0 flex flex-col p-1 gap-1 h-screen max-h-screen">
      <main className="flex-1 relative">{children}</main>
      <NavigationBar />
    </div>
  );
};
