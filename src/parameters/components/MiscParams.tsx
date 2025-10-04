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
      toast.success(`Données exportées avec succès : ${fileName}`);
    } catch (error) {
      console.error("Erreur lors de l'export :", error);
      toast.error("Erreur lors de l'export des données");
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
          `Données importées : ${result.boats} bateaux, ${result.routes} parcours, ${result.rowers} rameurs`
        );
      }
    } catch (error) {
      console.error("Erreur lors de l'import :", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Erreur lors de l'import des données"
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center font-medium">
          Paramètres divers
        </h1>
      </div>

      <div className="flex-1 relative">
        <div className="p-6 flex flex-col absolute inset-0 overflow-auto">
          <div className="flex flex-col flex-1">
            <section className="flex flex-col flex-1 min-h-0">
              <h1 className="font-bold text-xl mb-1 text-gray-900">
                La note du coach
              </h1>
              <p className="text-gray-500 mb-2">
                Cette note sera affichée en haut de la page
                &quot;Boathouse&quot;
              </p>
              <textarea
                className="flex-1 min-h-32 p-3 border rounded-md focus:ring-2 focus:ring-steel-blue-500 focus:border-steel-blue-500 resize-none bg-gray-50"
                name="coachnote"
                id="coachnote"
                onChange={(e) => {
                  clubOverview.setCoachNote(e.target.value);
                }}
                value={clubOverview.coachNote}
                placeholder="Écrivez votre note ici..."
              />
            </section>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-8">
            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  Importer des données
                </h1>
                <p className="text-gray-500 mb-4">
                  Importez des bateaux, parcours et rameurs depuis un fichier
                  JSON. Les données seront ajoutées aux données existantes.
                </p>
              </div>
              <Button
                type="button"
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onClick={handleImport}
                loading={isImporting}
                className="w-full mt-4"
              >
                Importer des données
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  Exporter des données
                </h1>
                <p className="text-gray-500 mb-4">
                  Exportez tous les bateaux, parcours et rameurs dans un fichier
                  JSON
                </p>
              </div>
              <Button
                type="button"
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onClick={handleExport}
                loading={isExporting}
                className="w-full mt-4"
              >
                Exporter toutes les données
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  Gestion des parcours
                </h1>
                <p className="text-gray-500 mb-4">
                  Gérez les parcours disponibles pour les sorties
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setRouteConfigOpen(true)}
                className="w-full mt-4"
              >
                Configurer les parcours
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  Système de niveau
                </h1>
                <p className="text-gray-500 mb-4">
                  Configurez les seuils d&apos;alerte et de blocage pour chaque
                  type de bateau en fonction du nombre de rameurs qui n&apos;ont
                  pas les critères requis.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setBoatLevelConfigOpen(true)}
                className="w-full mt-4"
              >
                Configurer les niveaux des bateaux
              </Button>
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  Démarrage automatique
                </h1>
                <p className="text-gray-500 mb-4">
                  En activant cette option, RowingBeacon se lancera au démarrage
                  du système
                </p>

                {autoStartState === "pending" && (
                  <div className="flex items-center gap-2 text-gray-500">
                    <ClockIcon className="w-5 h-5 animate-spin" />
                    <p>Chargement...</p>
                  </div>
                )}
                {autoStartState === "activated" && (
                  <div>
                    <p className="text-green-600 font-medium">
                      Le démarrage automatique est activé
                    </p>
                  </div>
                )}
                {autoStartState === "not-activated" && (
                  <div>
                    <p className="text-gray-600 font-medium">
                      Le démarrage automatique est désactivé
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
                  Désactiver le démarrage automatique
                </Button>
              )}
              {autoStartState === "not-activated" && (
                <Button
                  type="button"
                  // eslint-disable-next-line @typescript-eslint/no-misused-promises
                  onClick={enableAutoStart}
                  className="w-full mt-4"
                >
                  Activer le démarrage automatique
                </Button>
              )}
            </section>

            <section className="flex flex-col h-full">
              <div className="flex-1">
                <h1 className="font-bold text-xl mb-1 text-gray-900">
                  Actions sensibles
                </h1>
                <p className="text-gray-500 mb-4">
                  Attention : ces actions peuvent avoir des conséquences
                  irréversibles
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
                Supprimer toutes les données
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
          title="Supprimer toutes les données !"
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
