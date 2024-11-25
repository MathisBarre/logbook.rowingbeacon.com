import { toast } from "sonner";
import { adminEditModeStore } from "./adminEditMode.store";
import { useClubOverviewStore } from "./clubOverview.store";
import { closeApp, windowPrompt } from "../utils/window.utils";

export const useAdminEditModeSystem = () => {
  const store = adminEditModeStore();
  const onboardingStore = useClubOverviewStore();

  const isAdminPassword = (pswd: string | null) => {
    if (pswd === null) {
      return false;
    }

    return pswd === onboardingStore.clubOverview?.club.password;
  };

  const startAdminEditMode = (pswd: string | null) => {
    if (pswd === null) {
      return;
    }

    if (isAdminPassword(pswd)) {
      store.startAdminEditMode();
    } else {
      wrongAdminPassword();
    }
  };

  const close = (pswd: string | null) => {
    if (pswd === null) {
      return;
    }

    if (isAdminPassword(pswd)) {
      closeApp();
    } else {
      wrongAdminPassword();
    }
  };

  const wrongAdminPassword = () => {
    toast.error("Mot de passe incorrect");
  };

  const allowAdminActions = (pswd: string | null): boolean => {
    if (isAdminPassword(pswd)) {
      return true;
    } else {
      wrongAdminPassword();
      return false;
    }
  };

  return {
    ...store,
    startAdminEditMode,
    alertUserIsNotAdmin: wrongAdminPassword,
    closeApp: close,
    allowAdminActions,
    isAdminPassword,
  };
};

export const askForAdminPassword = () => {
  return windowPrompt("Mot de passe admin");
};
