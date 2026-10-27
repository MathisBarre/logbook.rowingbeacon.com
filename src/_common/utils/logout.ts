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
import { useSessionsStore } from "../store/sessions.store";
import { useModulesStore } from "../store/modules.store";
import { runBackup } from "../backup/backup.tauri";

export const useLogout = () => {
  const sessionStore = useSessionsStore();
  const clubOverviewStore = useClubOverviewStore();
  const incidentStore = useIncidentStore();
  const setIsOnboardingDone = useOnboardingStore((state) => state.setOnboarded);
  const boatLevelConfigStore = useStore(boatLevelConfigStoreCore);

  return async () => {
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

    sessionStore.reset();
    clubOverviewStore.reset();
    incidentStore.reset();
    boatLevelConfigStore.reset();
    useModulesStore.getState().reset();

    setIsOnboardingDone(false);
  };
};
