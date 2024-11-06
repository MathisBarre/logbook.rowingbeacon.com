import { toast } from "sonner";
import { adminEditModeStore } from "./adminEditMode.store";
import { useClubOverviewStore } from "./clubOverview.store";

export const useAdminEditModeSystem = () => {
  const store = adminEditModeStore();
  const onboardingStore = useClubOverviewStore();

  const startAdminEditMode = (pswd: string | null) => {
    if (pswd === null) {
      return;
    }

    if (pswd === onboardingStore.clubOverview?.club.password) {
      store.startAdminEditMode();
    } else {
      alertUserIsNotAdmin();
    }
  };

  const alertUserIsNotAdmin = () => {
    toast.error("Mot de passe incorrect");
  };

  return {
    ...store,
    startAdminEditMode,
    alertUserIsNotAdmin,
  };
};
