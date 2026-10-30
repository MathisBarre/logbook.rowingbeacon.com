import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { NavigationBar } from "./_common/components/NavigationBar";
import useNavigationStore from "./_common/store/navigation.store";
import { useAdminShortcut } from "./_common/utils/adminShortcut";
import { useAdminEditModeSystem } from "./_common/store/adminEditMode.system";
import { forEnum } from "./_common/utils/utils";
import BoathouseScreen from "./boathouse/Boathouse.screen";
import { LogbookScreen } from "./logbook/Logbook.screen";
import { OnboardingScreen } from "./onboarding/Onboarding.screen";
import { useOnboardingStore } from "./onboarding/onboarding.store";
import { ParametersScreen } from "./parameters/Parameters.screen";
import { StatsScreen } from "./stats/Stats.screen";
import { ReservationsScreen } from "./reservations/Reservations.screen";
import { useModule } from "./_common/store/modules.store";
import { ErrorBoundary } from "react-error-boundary";
import { useLocaleStore } from "./_common/store/locale.store";
import { LocaleSelectionScreen } from "./localeSelection/LocaleSelection.screen";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { bootstrapClubData } from "./_common/database/bootstrap";
import { startAutoBackups } from "./_common/backup/backup.tauri";
import { startUpdateChecks } from "./_common/update/update.tauri";
import { UpdateDialog } from "./_common/update/UpdateDialog";
import Loading from "./_common/components/Loading";
import { getErrorMessage } from "./_common/utils/error";
import { changeLanguage } from "./_common/i18n/config";
import { useTranslation } from "react-i18next";
import { DemoBanner } from "./demo/DemoBanner";
import { DemoGuideDialog } from "./demo/DemoGuideDialog";
import { DemoLoadingScreen } from "./demo/DemoLoadingScreen";
import { exitDemo } from "./demo/demoSession";
import {
  getDemoExitLabelKey,
  isDemoMode,
  readDemoState,
} from "./demo/demoMode";

export function Router() {
  const { locale } = useLocaleStore();
  const isOnboardingDone = useOnboardingStore((state) => state.isOnboarded);
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);
  const {
    navigation: { page },
    setPage,
  } = useNavigationStore();

  // Turning the module off while on its page: back to the boathouse.
  const hasReservations = useModule("reservations");
  useEffect(() => {
    if (page === "reservations" && !hasReservations) setPage("boathouse");
  }, [page, hasReservations]);

  const adminEditSystem = useAdminEditModeSystem();
  // Same password as the Parameters button: the shortcut is no back door.
  useAdminShortcut(() => {
    // Only once the club is set up: there is no admin password before.
    if (page === "parameters" || bootstrap.status !== "ready") return;
    if (!locale || !isOnboardingDone) return;
    void adminEditSystem.askForAdminAccess().then((granted) => {
      if (granted) setPage("parameters");
    });
  });

  // Initialize language from store on mount
  useEffect(() => {
    if (locale) {
      changeLanguage(locale);
    }
  }, [locale]);

  const bootstrap = useClubDataBootstrap();
  // Read at the first render: the flag is cleared once the seed has run.
  const [isSeedingDemo] = useState(() => readDemoState().seedPending);

  if (bootstrap.status === "loading") {
    if (isSeedingDemo) return <DemoLoadingScreen />;
    return (
      <div className="h-screen flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  if (bootstrap.status === "error") {
    return <BootstrapErrorScreen message={bootstrap.message} />;
  }

  // Show locale selection first if not set
  if (!locale) {
    return <LocaleSelectionScreen onComplete={() => {}} />;
  }

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
        reservations: () =>
          hasReservations ? (
            <ErrorBoundary key={page} fallback={<ErrorFallback />}>
              <ReservationsScreen />
            </ErrorBoundary>
          ) : null,
      })}
    </AppTemplate>
  );
}

type BootstrapState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

let bootstrapPromise: ReturnType<typeof bootstrapClubData> | null = null;
let migrationToastShown = false;

/** Loads club data from SQLite once, before any screen renders. */
const useClubDataBootstrap = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    bootstrapPromise ??= bootstrapClubData();
    bootstrapPromise
      .then((migration) => {
        // Once per launch, whatever re-renders or language changes follow.
        if (migration.status === "migrated" && !migrationToastShown) {
          migrationToastShown = true;
          toast.success(
            t("migration.done", { location: migration.backupLocation }),
            { duration: 15000 }
          );
          if (migration.skipped > 0) {
            toast.warning(
              t("migration.skipped", {
                count: migration.skipped,
                location: migration.backupLocation,
              }),
              { duration: 30000 }
            );
          }
        }
        setState({ status: "ready" });
        // Does nothing in demo mode (ADR 0009).
        startAutoBackups();
        startUpdateChecks();
      })
      .catch((error) => {
        console.error(error);
        setState({ status: "error", message: getErrorMessage(error) });
      });
  }, []);

  return state;
};

const BootstrapErrorScreen = ({ message }: { message: string }) => {
  const { t } = useTranslation();
  const demo = readDemoState();
  const [isLeaving, setIsLeaving] = useState(false);
  return (
    <div className="h-screen flex items-center justify-center flex-col gap-4 p-4">
      <AlertCircleIcon className="w-12 h-12 text-red-500" />
      <p className="text-lg">
        {t(demo.active ? "demo.errors.seedFailed" : "migration.failed")}
      </p>
      <p className="text-sm text-gray-500 max-w-xl text-center">{message}</p>
      <div className="flex gap-2">
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2"
        >
          <RefreshCwIcon className="w-4 h-4" />
          {t(demo.active ? "demo.errors.retry" : "error.reload")}
        </button>
        {demo.active && (
          // A demo that cannot start must never lock the club out.
          <button
            disabled={isLeaving}
            onClick={() => {
              setIsLeaving(true);
              void exitDemo().then((left) => {
                if (!left) setIsLeaving(false);
              });
            }}
            className="px-4 py-2 bg-steel-blue-700 hover:bg-steel-blue-800 text-white rounded-lg disabled:opacity-50"
          >
            {t(getDemoExitLabelKey(demo.hadRealClub))}
          </button>
        )}
      </div>
    </div>
  );
};

const ErrorFallback = () => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-4 p-4 h-full">
      <AlertCircleIcon className="w-12 h-12 text-red-500" />
      <p className="text-lg">{t("error.generic")}</p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2"
      >
        <RefreshCwIcon className="w-4 h-4" />
        {t("error.reload")}
      </button>
    </div>
  );
};

const AppTemplate = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="absolute inset-0 flex flex-col p-1 gap-1 h-screen max-h-screen">
      {isDemoMode() && <DemoBanner />}
      <main className="flex-1 relative">{children}</main>
      <NavigationBar />
      <UpdateDialog />
      {isDemoMode() && <DemoGuideDialog />}
    </div>
  );
};
