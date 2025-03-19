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
import { BoatLevelConfigModal } from "./BoatLevelConfigModal";
import { ClockIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { DateRangePicker } from "../../_common/components/DateRangePicker";
import {
  DateRange,
  getThisMonth,
  getThisWeek,
} from "../../_common/utils/date.utils";

const StatCard = ({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
}) => {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-4">
      <div className="p-3 bg-steel-blue-50 rounded-lg">
        <Icon className="w-6 h-6 text-steel-blue-600" />
      </div>
      <div>
        <h3 className="text-sm text-gray-500 font-medium">{title}</h3>
        <p className="text-xl font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );
};

export const MiscParams = () => {
  const [deleteDataDialogOpen, setDeleteDataDialogOpen] = useState(false);
  const [boatLevelConfigOpen, setBoatLevelConfigOpen] = useState(false);
  const adminEditSystem = useAdminEditModeSystem();
  const clubOverview = useClubOverviewStore();
  const { autoStartState, enableAutoStart, disableAutoStart } = useAutoStart();
  const { count, totalDuration } = useMiscStats();

  const [date, setDate] = useState<DateRange>({
    from: new Date(),
    to: new Date(),
  });

  const presets = [
    {
      id: "this-week",
      label: "Cette semaine",
      dateRange: getThisWeek(),
    },
    {
      id: "this-month",
      label: "Ce mois",
      dateRange: getThisMonth(),
    },
  ];

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center font-medium">
          Paramètres divers
        </h1>
      </div>

      <div className="flex-1 relative">
        <div className="p-6 flex flex-col absolute inset-0 overflow-auto">
          <section className="pb-8">
            <div className="flex justify-between items-center">
              <h1 className="font-bold text-xl mb-2 text-gray-900">
                Statistiques du club
              </h1>
              <DateRangePicker
                className="mb-4"
                date={date}
                onDateChange={setDate}
                presets={presets}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                title="Sessions"
                value={count.toString()}
                icon={UserGroupIcon}
              />
              <StatCard
                title="Temps total sur l'eau"
                value={millisecondToDayHourMinutes(totalDuration)}
                icon={ClockIcon}
              />
              <StatCard
                title="Moyenne temps / session"
                value={millisecondToDayHourMinutes(totalDuration / count || 0)}
                icon={ClockIcon}
              />
            </div>
          </section>

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
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
