/* eslint-disable @typescript-eslint/no-misused-promises */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import Button from "../../_common/components/Button";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { BackupFile } from "../../_common/backup/backup.rules";
import {
  getBackupFolder,
  getBackups,
  restoreFromFile,
  runBackup,
} from "../../_common/backup/backup.tauri";
import { useBackupStore } from "../../_common/backup/backup.store";
import {
  NewerBackupError,
  NotABackupError,
  RestoreFailedError,
} from "../../_common/backup/backup.service";
import { windowAlert } from "../../_common/utils/window.utils";
import { Efa2Project } from "../../_common/efa2/efa2Project";
import {
  exportEfa2Project,
  efa2ReadErrorMessage,
  pickEfa2Project,
} from "../../_common/efa2/efa2.tauri";
import { Efa2ImportDialog } from "./Efa2ImportDialog";

const VISIBLE_BACKUPS = 20;

const formatDateTime = (value: string, locale: string) =>
  new Date(value).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const DataParams = () => {
  const { t, i18n } = useTranslation();
  const backupStore = useBackupStore();
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [backupFolder, setBackupFolder] = useState("");
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [toRestore, setToRestore] = useState<{
    path: string;
    label: string;
  } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [project, setProject] = useState<Efa2Project | null>(null);
  const [isReadingProject, setIsReadingProject] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBackupFolder(await getBackupFolder());
      setBackups(await getBackups());
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, backupStore.lastBackupAt]);

  const backupNow = async () => {
    try {
      setIsBackingUp(true);
      await runBackup("manual");
      toast.success(t("backup.done"));
    } catch (error) {
      console.error(error);
      toast.error(t("backup.failed"));
    } finally {
      setIsBackingUp(false);
    }
  };

  const chooseExternalFolder = async () => {
    const folder = await open({ multiple: false, directory: true });
    if (typeof folder === "string") {
      backupStore.setExternalFolder(folder);
      toast.success(t("backup.externalFolderSet"));
    }
  };

  const chooseFileToRestore = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      defaultPath: backupFolder || undefined,
      filters: [{ name: "Rowing Beacon", extensions: ["db"] }],
    });
    if (typeof path === "string") {
      setToRestore({ path, label: path });
    }
  };

  const restore = async () => {
    if (!toRestore) return;
    try {
      setIsRestoring(true);
      await restoreFromFile(toRestore.path);
    } catch (error) {
      console.error(error);
      if (error instanceof RestoreFailedError) {
        // The database was closed to drop the failed transaction: restart.
        // The dialog closes first: its focus trap would hold the alert.
        setToRestore(null);
        await windowAlert(t("backup.restoreFailed"));
        window.location.reload();
        return;
      }
      toast.error(
        error instanceof NewerBackupError
          ? t("backup.newerBackup")
          : error instanceof NotABackupError
            ? t("backup.notABackup")
            : t("backup.restoreNotStarted")
      );
      setIsRestoring(false);
      setToRestore(null);
    }
  };

  const readProject = async (source: "zip" | "folder") => {
    try {
      setIsReadingProject(true);
      const picked = await pickEfa2Project(source);
      if (picked) setProject(picked);
    } catch (error) {
      console.error(error);
      toast.error(efa2ReadErrorMessage(error));
    } finally {
      setIsReadingProject(false);
    }
  };

  const exportProject = async () => {
    try {
      setIsExporting(true);
      const result = await exportEfa2Project();
      if (!result) return;
      const { path, report } = result;
      toast.success(t("efa2.exported", { path }));
      if (report.incidentsNotExported > 0) {
        toast.info(
          t("efa2.incidentsNotExported", {
            count: report.incidentsNotExported,
          })
        );
      }
      if (report.crewsCut > 0) {
        toast.info(t("efa2.crewsCut", { count: report.crewsCut }));
      }
    } catch (error) {
      console.error(error);
      toast.error(t("efa2.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center font-medium">
          {t("backup.dataTitle")}
        </h1>
      </div>

      <div className="p-6 flex flex-col gap-10">
        <section className="flex flex-col gap-3">
          <h2 className="font-bold text-xl text-gray-900">
            {t("backup.title")}
          </h2>
          <p className="text-gray-500">{t("backup.description")}</p>
          <p className="text-gray-900">
            {backupStore.lastBackupAt
              ? t("backup.lastBackup", {
                  date: formatDateTime(backupStore.lastBackupAt, i18n.language),
                })
              : t("backup.noBackupYet")}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button type="button" onClick={backupNow} loading={isBackingUp}>
              {t("backup.backupNow")}
            </Button>
            <Button
              type="button"
              variant="outlined"
              onClick={chooseFileToRestore}
            >
              {t("backup.restoreFromFile")}
            </Button>
          </div>

          <div className="border rounded p-4 flex flex-col gap-2">
            <h3 className="font-semibold text-gray-900">
              {t("backup.externalTitle")}
            </h3>
            {backupStore.externalFolder ? (
              <p className="text-gray-700 text-sm break-all">
                {t("backup.externalFolder", {
                  folder: backupStore.externalFolder,
                })}
              </p>
            ) : (
              <p className="text-yellow-900 text-sm flex gap-2 items-center">
                <TriangleAlertIcon className="h-4 w-4 shrink-0" />
                {t("backup.externalReminder")}
              </p>
            )}
            {backupStore.externalCopyFailedAt && (
              <p className="text-error-800 text-sm flex gap-2 items-center">
                <TriangleAlertIcon className="h-4 w-4 shrink-0" />
                {t("backup.externalCopyFailed")}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outlined"
                onClick={chooseExternalFolder}
              >
                {backupStore.externalFolder
                  ? t("backup.changeExternalFolder")
                  : t("backup.chooseExternalFolder")}
              </Button>
              {backupStore.externalFolder && (
                <Button
                  type="button"
                  variant="text"
                  onClick={() => backupStore.setExternalFolder(null)}
                >
                  {t("backup.stopExternalCopy")}
                </Button>
              )}
            </div>
          </div>

          {backups.length > 0 && (
            <table className="w-full text-sm">
              <tbody>
                {backups.slice(0, VISIBLE_BACKUPS).map((backup) => (
                  <tr key={backup.fileName} className="border-b">
                    <td className="py-2">
                      {formatDateTime(backup.createdAt, i18n.language)}
                    </td>
                    <td className="py-2 text-gray-500">
                      {t(`backup.kind.${backup.kind}`)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        variant="text"
                        onClick={async () => {
                          setToRestore({
                            path: await join(backupFolder, backup.fileName),
                            label: formatDateTime(
                              backup.createdAt,
                              i18n.language
                            ),
                          });
                        }}
                      >
                        {t("backup.restore")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {backupFolder && (
            <p className="text-xs text-gray-400 break-all">
              {t("backup.folder", { folder: backupFolder })}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-bold text-xl text-gray-900">{t("efa2.title")}</h2>
          <p className="text-gray-500">{t("efa2.description")}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold text-gray-900">
                {t("efa2.importTitle")}
              </h3>
              <p className="text-gray-500 text-sm flex-1">
                {t("efa2.importDescription")}
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  onClick={() => readProject("zip")}
                  loading={isReadingProject}
                >
                  {t("efa2.chooseZip")}
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => readProject("folder")}
                  loading={isReadingProject}
                >
                  {t("efa2.chooseFolder")}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold text-gray-900">
                {t("efa2.exportTitle")}
              </h3>
              <p className="text-gray-500 text-sm flex-1">
                {t("efa2.exportDescription")}
              </p>
              <div>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={exportProject}
                  loading={isExporting}
                >
                  {t("efa2.export")}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={toRestore !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isRestoring) setToRestore(null);
        }}
      >
        <DialogContent title={t("backup.restoreTitle")}>
          <div className="flex flex-col gap-4">
            <p className="break-all">
              {t("backup.restoreConfirm", { backup: toRestore?.label ?? "" })}
            </p>
            <p className="text-gray-500 text-sm">{t("backup.restoreSafety")}</p>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="text"
                disabled={isRestoring}
                onClick={() => setToRestore(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                color="danger"
                onClick={restore}
                loading={isRestoring}
              >
                {t("backup.restore")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Efa2ImportDialog
        project={project}
        onClose={() => setProject(null)}
        onImported={() => window.location.reload()}
      />
    </div>
  );
};
