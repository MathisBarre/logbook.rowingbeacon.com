import { useStore } from "zustand";
import { toast } from "sonner";
import i18n from "../i18n/config";
import {
  SETTING_ONBOARDING_DONE,
  useOnboardingStore,
} from "../../onboarding/onboarding.store";
import { deleteAllV1Backups } from "../database/bootstrap";
import {
  deleteAllClubData,
  saveSetting,
} from "../database/repositories/club.repository";
import { enqueueWrite } from "../database/writeQueue";
import { boatLevelConfigStoreCore } from "../store/boatLevelConfig.store";
import { useClubOverviewStore } from "../store/clubOverview.store";
import useIncidentStore from "../store/incident.store";
import { useDamageStore } from "../store/damage.store";
import { useReservationStore } from "../store/reservation.store";
import { useSessionsStore } from "../store/sessions.store";
import { useModulesStore } from "../store/modules.store";
import { useBoathouseSettingsStore } from "../store/boathouseSettings.store";
import { runBackup } from "../backup/backup.tauri";
import { isDemoMode } from "../../demo/demoMode";
import { resetDemo } from "../../demo/demoSession";
import { clearProposalsInbox } from "../../analytics/repository/proposalsInbox";
import { aiDeleteKey } from "../../analytics/ai/aiClient";
import { AI_PROVIDERS } from "../../analytics/engine/ipc";
import { clearAnalyticsLocalMemory } from "../../analytics/store/localMemory";
import { useAnalyticsSettingsStore } from "../../analytics/store/analyticsSettings.store";
import { useAdminLockStore } from "../../analytics/access/useAnalyticsAdmin";

export interface LogoutOptions {
  /**
   * Also delete the AI keys of this computer (every provider's, and the
   * compatible server's address). They live in the system keychain,
   * outside the club data and its backups, so they are kept unless the
   * user asks (review A, L5).
   */
  deleteAiKey?: boolean;
}

export const useLogout = () => {
  const sessionStore = useSessionsStore();
  const clubOverviewStore = useClubOverviewStore();
  const incidentStore = useIncidentStore();
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);
  const boatLevelConfigStore = useStore(boatLevelConfigStoreCore);

  return async ({ deleteAiKey = false }: LogoutOptions = {}) => {
    // In demo, "delete all data" starts the demo over: no backup, and the
    // real club is never concerned (ADR 0009).
    if (isDemoMode()) {
      await resetDemo();
      return;
    }
    // Deleting everything can be undone from this backup (ADR 0005).
    try {
      await runBackup("before-delete");
    } catch (error) {
      console.error(error);
      toast.error(i18n.t("backup.beforeDeleteFailed"));
      return;
    }
    // Inside the write queue: nothing saved just before can come back.
    // The flag goes with the data, in the same write: an app closed right
    // after must reopen on the onboarding.
    const deleted = await enqueueWrite("delete club data", async (db) => {
      await deleteAllClubData(db);
      await saveSetting(db, SETTING_ONBOARDING_DONE, false);
    });
    if (!deleted) return;
    if (!(await deleteAllV1Backups())) {
      toast.error(i18n.t("database.backupsNotDeleted"));
    }
    // MCP proposals wait in a folder of their own: the next club
    // must not find them in its Explorer.
    if (!(await clearProposalsInbox())) {
      toast.error(i18n.t("database.inboxNotCleared"));
    }
    if (deleteAiKey) {
      const results = await Promise.allSettled(
        AI_PROVIDERS.map((provider) => aiDeleteKey(provider))
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        console.error(failed);
        toast.error(i18n.t("database.aiKeyNotDeleted"));
      }
    }

    sessionStore.reset();
    clubOverviewStore.reset();
    incidentStore.reset();
    useDamageStore.getState().reset();
    useReservationStore.getState().reset();
    boatLevelConfigStore.reset();
    useModulesStore.getState().reset();
    useBoathouseSettingsStore.getState().reset();
    // The Explorer's doc and history live in localStorage, outside the
    // database (review C, 5); the settings rows are deleted already.
    clearAnalyticsLocalMemory();
    useAnalyticsSettingsStore.getState().reset();
    useAdminLockStore.getState().lock();

    setIsOnboardingDone(false);
  };
};
