import { useTranslation } from "react-i18next";
import Button from "../../_common/components/Button";
import { useState } from "react";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import { DeleteDatas } from "./DeleteDatas";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useAutoStart } from "../hooks/useAutoStart";
import { BoatLevelConfigModal } from "./BoatLevelConfigModal";
import { RouteConfigModal } from "./RouteConfigModal";
import { ClockIcon } from "@heroicons/react/24/outline";
import { exportAllData, importAllData } from "../../_common/utils/importExport";
import { toast } from "sonner";

export const MiscParams = () => {
  const { t } = useTranslation();
  const [deleteDataDialogOpen, setDeleteDataDialogOpen] = useState(false);
  const [boatLevelConfigOpen, setBoatLevelConfigOpen] = useState(false);
  const [routeConfigOpen, setRouteConfigOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const adminEditSystem = useAdminEditModeSystem();
  const clubOverview = useClubOverviewStore();
  const { autoStartState, enableAutoStart, disableAutoStart } = useAutoStart();

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const fileName = await exportAllData();
      toast.success(t("parameters.dataExportedSuccessfully", { fileName }));
    } catch (error) {
      console.error("Erreur lors de l'export :", error);
      toast.error(t("parameters.errorExportingData"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    try {
      setIsImporting(true);
      const result = await importAllData();
      if (result) {
        toast.success(
          t("parameters.dataImportedSuccessfully", { boats: result.boats, routes: result.routes, rowers: result.rowers })
        );
      }
    } catch (error) {
      console.error("Erreur lors de l'import :", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("parameters.errorImportingData")
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center font-medium">
          {t("parameters.misc")}
        </h1>
      </div>

      <div className="flex-1 relative">
        <div className="p-6 flex flex-col absolute inset-0 overflow-auto">
          <div className="flex flex-col flex-1">
            <section className="flex flex-col flex-1 min-h-0">
              <h1 className="font-bold text-xl mb-1 text-gray-900">
                {t("boathouse.coachNote")}
              </h1>
              <p className="text-gray-500 mb-2">
                {t("parameters.coachNoteDescription")}
              </p>
              <textarea
                className="flex-1 min-h-32 p-3 border rounded-md focus:ring-2 focus:ring-steel-blue-500 focus:border-steel-blue-500 resize-none bg-gray-50"
                name="coachnote"
                id="coachnote"
                onChange={(e) => {
                  clubOverview.setCoachNote(e.target.value);
                }}
                value={clubOverview.coachNote}
                placeholder={t("parameters.coachNotePlaceholder")}
              />
            </section>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-8">
            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  {t("parameters.importData")}
                </h1>
                <p className="text-gray-500 mb-4">
                  {t("parameters.importDataDescription")}
                </p>
              </div>
              <Button
                type="button"
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onClick={handleImport}
                loading={isImporting}
                className="w-full mt-4"
              >
                {t("parameters.importData")}
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  {t("parameters.exportData")}
                </h1>
                <p className="text-gray-500 mb-4">
                  {t("parameters.exportDataDescription")}
                </p>
              </div>
              <Button
                type="button"
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onClick={handleExport}
                loading={isExporting}
                className="w-full mt-4"
              >
                {t("parameters.exportAllData")}
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  {t("parameters.routeManagement")}
                </h1>
                <p className="text-gray-500 mb-4">
                  {t("parameters.routeManagementDescription")}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setRouteConfigOpen(true)}
                className="w-full mt-4"
              >
                {t("parameters.configureRoutes")}
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  {t("parameters.levelSystem")}
                </h1>
                <p className="text-gray-500 mb-4">
                  {t("parameters.levelSystemDescription")}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setBoatLevelConfigOpen(true)}
                className="w-full mt-4"
              >
                {t("parameters.configureBoatLevels")}
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  {t("parameters.autoStart")}
                </h1>
                <p className="text-gray-500 mb-4">
                  {t("parameters.autoStartDescription")}
                </p>

                {autoStartState === "pending" && (
                  <div className="flex items-center gap-2 text-gray-500">
                    <ClockIcon className="w-5 h-5 animate-spin" />
                    <p>{t("common.loading")}</p>
                  </div>
                )}
                {autoStartState === "activated" && (
                  <div>
                    <p className="text-green-600 font-medium">
                      {t("parameters.autoStartEnabled")}
                    </p>
                  </div>
                )}
                {autoStartState === "not-activated" && (
                  <div>
                    <p className="text-gray-600 font-medium">
                      {t("parameters.autoStartDisabled")}
                    </p>
                  </div>
                )}
              </div>
              {autoStartState === "activated" && (
                <Button
                  type="button"
                  // eslint-disable-next-line @typescript-eslint/no-misused-promises
                  onClick={disableAutoStart}
                  className="w-full mt-4"
                >
                  {t("parameters.disableAutoStart")}
                </Button>
              )}
              {autoStartState === "not-activated" && (
                <Button
                  type="button"
                  // eslint-disable-next-line @typescript-eslint/no-misused-promises
                  onClick={enableAutoStart}
                  className="w-full mt-4"
                >
                  {t("parameters.enableAutoStart")}
                </Button>
              )}
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  {t("parameters.sensitiveActions")}
                </h1>
                <p className="text-gray-500 mb-4">
                  {t("parameters.sensitiveActionsWarning")}
                </p>
              </div>
              <Button
                type="button"
                color="danger"
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onClick={async () => {
                  if (!(await adminEditSystem.askForAdminAccess())) {
                    return;
                  }
                  setDeleteDataDialogOpen(true);
                }}
                className="w-full mt-4"
              >
                {t("parameters.deleteAllData")}
              </Button>
            </section>
          </div>
        </div>
      </div>

      <Dialog
        open={deleteDataDialogOpen}
        onOpenChange={(open) => {
          setDeleteDataDialogOpen(open);
        }}
      >
        <DialogContent
          title={t("parameters.deleteAllDataTitle")}
          className="max-w-xl"
        >
          <DeleteDatas />
        </DialogContent>
      </Dialog>

      <BoatLevelConfigModal
        isOpen={boatLevelConfigOpen}
        onOpenChange={setBoatLevelConfigOpen}
      />

      <RouteConfigModal
        isOpen={routeConfigOpen}
        onOpenChange={setRouteConfigOpen}
      />
    </div>
  );
};
