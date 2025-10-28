import { toast } from "sonner";
import { adminEditModeStore } from "./adminEditMode.store";
import { useClubOverviewStore } from "./clubOverview.store";
import { closeApp, windowPrompt } from "../utils/window.utils";
import { hashPassword, verifyPassword } from "../utils/password";
import i18n from "../i18n/config";

export const useAdminEditModeSystem = () => {
  const store = adminEditModeStore();
  const onboardingStore = useClubOverviewStore();

  const setAdminPassword = (pswd: string) => {
    return onboardingStore.setHashedPassword(hashPassword(pswd));
  };

  const isAdminPassword = (pswd: string | null) => {
    if (pswd === null) {
      return false;
    }

    return verifyPassword(pswd, onboardingStore.clubOverview?.club.password);
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
      return closeApp();
    } else {
      wrongAdminPassword();
    }
  };

  const wrongAdminPassword = () => {
    toast.error(i18n.t("admin.incorrectPassword"));
  };

  const askForAdminAccess = async (pswd?: string | null): Promise<boolean> => {
    if (pswd === undefined) {
      pswd = await askForAdminPassword();
    }

    if (pswd === null) {
      return false;
    }

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
    askForAdminAccess,
    isAdminPassword,
    setAdminPassword,
  };
};

export const askForAdminPassword = () => {
  return windowPrompt(i18n.t("admin.password"));
};
