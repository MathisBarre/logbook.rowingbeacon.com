import { toast } from "sonner";
import { adminEditModeStore } from "./adminEditMode.store";
import { useClubOverviewStore } from "./clubOverview.store";
import { closeApp, windowPrompt } from "../utils/window.utils";

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
      wrongAdminPassword();
    }
  };

  const close = (pswd: string | null) => {
    if (pswd === null) {
      return;
    }

    if (pswd === onboardingStore.clubOverview?.club.password) {
      closeApp();
    } else {
      wrongAdminPassword();
    }
  };

  const wrongAdminPassword = () => {
    toast.error("Mot de passe incorrect");
  };

  return {
    ...store,
    startAdminEditMode,
    alertUserIsNotAdmin: wrongAdminPassword,
    closeApp: close,
  };
};

export const askForAdminPassword = () => {
  return windowPrompt("Mot de passe admin");
};
