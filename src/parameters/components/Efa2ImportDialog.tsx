/* eslint-disable @typescript-eslint/no-misused-promises */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Button from "../../_common/components/Button";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { Efa2Project } from "../../_common/efa2/efa2Project";
import {
  importEfa2Project,
  previewEfa2Import,
} from "../../_common/efa2/efa2.tauri";
import { Efa2BackupFailedError } from "../../_common/efa2/runEfa2Import";
import { windowAlert } from "../../_common/utils/window.utils";

/**
 * Shows what an efa2 project holds before it replaces the club data
 * (ADR 0004), then imports it.
 */
export const Efa2ImportDialog = ({
  project,
  onClose,
  onImported,
  confirmLabel,
  beforeImport,
}: {
  project: Efa2Project | null;
  onClose: () => void;
  onImported: () => void;
  confirmLabel?: string;
  /** Runs right before the import, e.g. to save onboarding choices. */
  /** Resolves with false when the import must not start (already reported). */
  beforeImport?: () => Promise<boolean>;
}) => {
  const { t } = useTranslation();
  const [isImporting, setIsImporting] = useState(false);
  const report = useMemo(
    () => (project ? previewEfa2Import(project) : null),
    [project]
  );

  const kept = report
    ? Object.entries(report.keptWithoutScreen).filter(([, count]) => count > 0)
    : [];

  const runImport = async () => {
    if (!project) return;
    try {
      setIsImporting(true);
      if ((await beforeImport?.()) === false) {
        setIsImporting(false);
        return;
      }
      await importEfa2Project(project);
      onImported();
    } catch (error) {
      console.error(error);
      if (error instanceof Efa2BackupFailedError) {
        toast.error(t("efa2.backupFailed"));
        setIsImporting(false);
        return;
      }
      // The database was closed to drop the failed transaction: restart.
      // The dialog closes first: its focus trap would hold the alert.
      onClose();
      await windowAlert(t("efa2.importFailed"));
      window.location.reload();
    }
  };

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isImporting) onClose();
      }}
    >
      <DialogContent
        title={t("efa2.previewTitle", { name: project?.name ?? "" })}
        className="max-w-2xl"
      >
        {report && (
          <div className="flex flex-col gap-4">
            <ul className="list-disc pl-5 text-gray-900">
              <li>{t("efa2.preview.boats", { count: report.boats })}</li>
              <li>{t("efa2.preview.rowers", { count: report.rowers })}</li>
              <li>{t("efa2.preview.routes", { count: report.routes })}</li>
              <li>
                {t("efa2.preview.outings", {
                  count: report.outings,
                  logbooks: report.logbooks.join(", "),
                })}
              </li>
              {report.ongoingOutings > 0 && (
                <li>
                  {t("efa2.preview.ongoing", { count: report.ongoingOutings })}
                </li>
              )}
              {report.closedOpenOutings > 0 && (
                <li>
                  {t("efa2.preview.closedOpen", {
                    count: report.closedOpenOutings,
                  })}
                </li>
              )}
              {report.guests > 0 && (
                <li>{t("efa2.preview.guests", { count: report.guests })}</li>
              )}
              {report.unreadableEntries > 0 && (
                <li>
                  {t("efa2.preview.unreadableEntries", {
                    count: report.unreadableEntries,
                  })}
                </li>
              )}
              {report.ambiguousNames > 0 && (
                <li>
                  {t("efa2.preview.ambiguousNames", {
                    count: report.ambiguousNames,
                  })}
                </li>
              )}
              {report.externalBoats > 0 && (
                <li>
                  {t("efa2.preview.externalBoats", {
                    count: report.externalBoats,
                  })}
                </li>
              )}
              {report.openDamages > 0 && (
                <li>
                  {t("efa2.preview.openDamages", {
                    count: report.openDamages,
                  })}
                </li>
              )}
              {report.fixedDamages > 0 && (
                <li>
                  {t("efa2.preview.fixedDamages", {
                    count: report.fixedDamages,
                  })}
                </li>
              )}
              {report.unavailableBoats > 0 && (
                <li>
                  {t("efa2.preview.unavailableBoats", {
                    count: report.unavailableBoats,
                  })}
                </li>
              )}
              {report.reservations > 0 && (
                <li>
                  {t("efa2.preview.reservations", {
                    count: report.reservations,
                  })}
                </li>
              )}
            </ul>
            {kept.length > 0 && (
              <div className="text-sm text-gray-600">
                <p>{t("efa2.preview.keptIntro")}</p>
                <p>
                  {kept
                    .map(
                      ([type, count]) =>
                        `${t(`efa2.objects.${type}`, { defaultValue: type })} (${count})`
                    )
                    .join(", ")}
                </p>
              </div>
            )}
            <p className="text-error-800 font-medium">
              {t("efa2.replaceWarning")}
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="text"
                disabled={isImporting}
                onClick={onClose}
              >
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={runImport} loading={isImporting}>
                {confirmLabel ?? t("efa2.confirmImport")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
