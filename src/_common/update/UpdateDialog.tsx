import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import Button from "../components/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "../components/Dialog/Dialog";
import { useAdminEditModeSystem } from "../store/adminEditMode.system";
import { useLocaleStore } from "../store/locale.store";
import useNavigationStore from "../store/navigation.store";
import { getChangelogUrl } from "./update.rules";
import { isUpdateBusy, useUpdateStore } from "./update.store";
import { installUpdate, UpdateBackupFailedError } from "./update.tauri";

/** Mounted once for the whole app: the start-up toast opens it too. */
export const UpdateDialog = () => {
  const { t } = useTranslation();
  const { locale } = useLocaleStore();
  const page = useNavigationStore((state) => state.navigation.page);
  const adminEditSystem = useAdminEditModeSystem();
  const { available, phase, percent, dialogOpen, setDialogOpen } =
    useUpdateStore();
  const busy = isUpdateBusy(phase);

  if (!available) return null;

  const install = async () => {
    // The toast also shows in the boathouse: installing stays an admin task.
    // The modal dialog traps the focus: it steps aside for the password.
    if (page !== "parameters") {
      setDialogOpen(false);
      const granted = await adminEditSystem
        .askForAdminAccess()
        .catch(() => false);
      // A check during the password may have withdrawn the version: an open
      // flag left behind would pop the next one up on its own.
      if (!useUpdateStore.getState().available) return;
      setDialogOpen(true);
      if (!granted) return;
    }
    try {
      await installUpdate();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof UpdateBackupFailedError
          ? t("update.backupFailed")
          : t("update.failed")
      );
    }
  };

  return (
    <Dialog
      open={dialogOpen}
      // The app restarts at the end: the dialog stays until then.
      onOpenChange={(open) => !busy && setDialogOpen(open)}
    >
      <DialogContent
        title={t("update.title", { version: available.version })}
        subtitle={t("update.currentVersion", {
          version: available.currentVersion,
        })}
      >
        <div className="flex flex-col gap-3">
          {available.notes && (
            <p className="whitespace-pre-wrap text-gray-900 max-h-64 overflow-auto border rounded p-3 bg-gray-50">
              {available.notes}
            </p>
          )}
          <button
            type="button"
            className="text-steel-blue-700 underline self-start"
            onClick={() => void open(getChangelogUrl(locale))}
          >
            {t("update.changelog")}
          </button>
          <p className="text-gray-500">{t("update.safety")}</p>
          {busy && (
            <p className="text-gray-900 font-medium">
              {phase === "backup"
                ? t("update.backingUp")
                : phase === "install"
                  ? t("update.installing")
                  : percent === null
                    ? t("update.downloading")
                    : t("update.downloadingPercent", { percent })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outlined"
            disabled={busy}
            onClick={() => setDialogOpen(false)}
          >
            {t("update.later")}
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={phase === "checking"}
            onClick={() => void install()}
          >
            {t("update.install")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
