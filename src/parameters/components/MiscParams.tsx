import Button from "../../_common/components/Button";
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import { DeleteDatas } from "./DeleteDatas";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useAutoStart } from "../hooks/useAutoStart";
import { toast } from "sonner";
import { getErrorMessage } from "../../_common/utils/error";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";
import { millisecondToDayHourMinutes } from "../../_common/utils/time.utils";
import useIncidentStore from "../../_common/store/incident.store";
import { BoatLevelConfigModal } from "./BoatLevelConfigModal";

export const MiscParams = () => {
  const [deleteDataDialogOpen, setDeleteDataDialogOpen] = useState(false);
  const [boatLevelConfigOpen, setBoatLevelConfigOpen] = useState(false);
  const adminEditSystem = useAdminEditModeSystem();
  const clubOverview = useClubOverviewStore();
  const { autoStartState, enableAutoStart, disableAutoStart } = useAutoStart();
  const { count, totalDuration } = useMiscStats();
  const { getIncidents } = useIncidentStore();
  const incidents = getIncidents();

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center">
          Paramètres divers
        </h1>
      </div>

      <div className="flex-1 relative">
        <div className="p-4 flex flex-col gap-8 absolute inset-0 overflow-auto">
          <section>
            <h1 className="font-bold text-xl">Statistiques du club</h1>

            <ul>
              <li>Nombre de sessions : {count}</li>
              <li>
                Temps total passé sur l&apos;eau :{" "}
                {millisecondToDayHourMinutes(totalDuration)}
              </li>
              <li>
                Moyenne temps / sessions :{" "}
                {millisecondToDayHourMinutes(totalDuration / count || 0)}
              </li>
              <li>Nombre d&apos;incidents : {incidents.length}</li>
            </ul>
          </section>

          <section>
            <h1 className="font-bold text-xl">La note du coach</h1>

            <p>
              Cette note sera affichée en haut de la page &quot;Boathouse&quot;
            </p>

            <textarea
              cols={64}
              rows={4}
              className="input resize"
              name="coachnote"
              id="coachnote"
              onChange={(e) => {
                clubOverview.setCoachNote(e.target.value);
              }}
              value={clubOverview.coachNote}
            />
          </section>

          <section>
            <h1 className="font-bold text-xl">Système de niveau</h1>
            <p className="mb-4">
              Configurez les seuils d&apos;alerte et de blocage pour chaque type
              de bateau en fonction du nombre de rameurs qui n&apos;ont pas les
              critères requis.
            </p>
            <Button
              type="button"
              onClick={() => setBoatLevelConfigOpen(true)}
              className="mt-2"
            >
              Configurer les niveaux des bateaux
            </Button>
          </section>

          <section>
            <h1 className="font-bold text-xl">Démarrage automatique</h1>
            <p>
              En activant cette option, RowingBeacon se lancera au démarrage du
              système
            </p>

            {autoStartState === "pending" && <p>Chargement...</p>}
            {autoStartState === "activated" && (
              <>
                <p>
                  Le démarrage automatique est{" "}
                  <span className="font-bold underline">activé</span>
                </p>
                <Button
                  type="button"
                  //eslint-disable-next-line @typescript-eslint/no-misused-promises
                  onClick={disableAutoStart}
                  className="mt-2"
                >
                  Désactiver le démarrage automatique
                </Button>
              </>
            )}
            {autoStartState === "not-activated" && (
              <>
                <p>
                  Le démarrage automatique est{" "}
                  <span className="font-bold underline">désactivé</span>
                </p>

                <Button
                  type="button"
                  // eslint-disable-next-line @typescript-eslint/no-misused-promises
                  onClick={enableAutoStart}
                  className="mt-2"
                >
                  Activer le démarrage automatique
                </Button>
              </>
            )}
          </section>

          <section>
            <h1 className="font-bold text-xl mb-2">Actions sensibles</h1>

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
            >
              Supprimer toutes les données
            </Button>

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
          </section>
        </div>
      </div>

      <BoatLevelConfigModal
        isOpen={boatLevelConfigOpen}
        onOpenChange={setBoatLevelConfigOpen}
      />
    </div>
  );
};

const useMiscStats = () => {
  const [stats, setStats] = useState({ count: 0, totalDuration: 0 });

  useEffect(() => {
    getMiscStats()
      .then(setStats)
      .catch((e) => toast.error(getErrorMessage(e)));
  }, []);

  return stats;
};

const getMiscStats = async (): Promise<{
  count: number;
  totalDuration: number;
}> => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle.select().from(DBSessions);

  const count = sessions.length;
  const totalDuration = sessions.reduce((acc: number, session) => {
    if (!session?.startDateTime || !session?.endDateTime) {
      return acc;
    }

    const start = new Date(session.startDateTime);
    const end = new Date(session.endDateTime);
    const duration = end.getTime() - start.getTime();
    return acc + duration;
  }, 0);

  return { count, totalDuration };
};
