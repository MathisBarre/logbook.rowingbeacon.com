import { useEffect, useState } from "react";
import { SessionHistory } from "../sessions/SessionHistory.screen";
import {
  useSessionsStore,
  ZustandSession,
} from "../_common/store/sessions.store";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/16/solid";
import { version } from "../../package.json";

import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../_common/store/adminEditMode.system";
import { cn } from "../_common/utils/utils";
import { BoatsList } from "./components/BoatList/BoatList";
import { StartSessionDialog } from "./components/StartSessionDialog/StartSession.Dialog";
import { StopSessionDialog } from "./components/StopSessionDialog/StopSession.Dialog";
import { useClubOverviewStore } from "../_common/store/clubOverview.store";
import { Boat } from "../_common/types/boat.type";
import { toast } from "sonner";
import { ArrowLeftIcon } from "lucide-react";
import { RoutesCrudDialog } from "./components/RoutesCrudDialog/RoutesCrud.Dialog";
import { RowersCrudDialog } from "./components/RowersCrudDialog/RowersCrud.Dialog";

import Button from "../_common/components/Button";
import { SimpleAlertDialog } from "../_common/components/SimpleAlertDialog";
import { windowAlert, windowPrompt } from "../_common/utils/window.utils";

function BoathouseScreen() {
  const sessionStore = useSessionsStore();
  const { clubOverview, addBoat, coachNote, setCoachNote } =
    useClubOverviewStore();
  const { availableBoats, boatsInUse } = useSortBoats(clubOverview.boats || []);
  const adminEditSystem = useAdminEditModeSystem();

  const [startSessionOpenWithBoat, setStartSessionOpenWithBoat] = useState<
    | false
    | {
        id: string;
        name: string;
      }
  >(false);

  const [isStopSessionModalOpen, setIsStopSessionModalOpen] = useState(false);
  const [sessionToStop, setSessionToStop] = useState<
    undefined | ZustandSession
  >(undefined);
  const [isRoutesCrudDialogOpen, setIsRoutesCrudDialogOpen] = useState(false);
  const [isRowersCrudDialogOpen, setIsRowersCrudDialogOpen] = useState(false);

  const onBoatRowClick = (boat: { id: string; name: string }) => {
    setStartSessionOpenWithBoat(boat);
  };

  const [displayHistory, setDisplayHistory] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        adminEditSystem.stopAdminEditMode();
      }
    };

    document.addEventListener("keydown", handleEscape, {
      passive: true,
    });

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const [isLogoutAlertOpen, setIsLogoutAlertOpen] = useState(false);

  if (!displayHistory) {
    return (
      <>
        {coachNote && (
          <div
            className="inset-1 absolute bg-yellow-100 border border-yellow-700 text-yellow-900 rounded h-9 px-2 flex items-center overflow-hidden z-30 hover:bg-yellow-200 cursor-pointer"
            onClick={async () => {
              await windowAlert(coachNote);
            }}
          >
            <p className="text-nowrap text-ellipsis overflow-hidden">
              <span className="font-semibold">Note du coach</span> : {coachNote}
            </p>
          </div>
        )}
        <div className="h-screen absolute inset-0">
          <div
            className={cn(
              "absolute inset-1 bottom-11 right-1/2 shadow-md z-30 mr-1",
              coachNote && "top-11"
            )}
          >
            <BoatsList
              label="Bateaux disponibles"
              boats={availableBoats}
              onBoatRowClick={onBoatRowClick}
            />
          </div>
          <div
            className={cn(
              "absolute inset-1 bottom-11 left-1/2 shadow-md ",
              coachNote && "top-11"
            )}
          >
            <BoatsList
              label="Bateaux en cours d'utilisation"
              boats={boatsInUse}
              onBoatRowClick={(boat) => {
                const session = sessionStore.findOngoingSessionByBoatId(
                  boat.id
                );

                setIsStopSessionModalOpen(true);
                setSessionToStop(session);
              }}
            />
          </div>

          {adminEditSystem.isInAdminEditMode && (
            <>
              <div className="absolute right-1 left-1 px-2 bottom-1 h-8 flex items-center bg-blue-50 border-blue-300 border rounded shadow-md gap-4 z-30">
                <p className="text-blue-500 text-sm font-bold">MODE ÉDITION</p>
                <div className="w-[1px] h-4 bg-blue-300" />

                <button
                  className="text-sm underline font-medium"
                  onClick={async () => {
                    const newBoatName = await windowPrompt("Nom du bateau");
                    if (!newBoatName) {
                      return toast.error("Nom de bateau invalide");
                    }

                    addBoat(newBoatName);
                    toast.success("Bateau ajouté");
                  }}
                >
                  Ajouter un bateau
                </button>

                <div className="w-[1px] h-4 bg-blue-300" />

                <button
                  onClick={() => {
                    setIsRowersCrudDialogOpen(true);
                  }}
                  className="text-sm underline font-medium"
                >
                  Ajouter ou modifier un rameur
                </button>

                <div className="w-[1px] h-4 bg-blue-300" />

                <button
                  className="text-sm underline font-medium"
                  onClick={() => {
                    setIsRoutesCrudDialogOpen(true);
                  }}
                >
                  Ajouter ou modifier un parcours
                </button>

                <div className="w-[1px] h-4 bg-blue-300" />

                <button
                  className="text-sm underline font-medium"
                  onClick={async () => {
                    const newNote =
                      (
                        await windowPrompt("Note du coach", coachNote)
                      )?.trim() || "";

                    setCoachNote(newNote || "");

                    if (newNote.length === 0) {
                      return toast.info("Note supprimée");
                    }

                    toast.success("Note ajoutée");
                  }}
                >
                  Ajouter ou modifier la note du coach
                </button>

                <div className="w-[1px] h-4 bg-blue-300" />

                <button
                  className="text-sm underline text-error-700"
                  onClick={adminEditSystem.toggleAdminEditMode}
                >
                  Quitter le mode édition
                </button>
              </div>

              <div className="absolute top-1/2 left-1/2 bg-white p-2 shadow rounded flex gap-2 transform -translate-y-1/2 translate-x-2 z-30">
                <ArrowLeftIcon />
                <p>Survolez un bateau pour voir les options d'édition</p>
              </div>

              <div className="absolute inset-0 bg-black opacity-60 z-20"></div>
            </>
          )}

          <div className="absolute right-0 left-0 pl-1 bottom-1 h-8 flex justify-end gap-1">
            <div className="flex items-center gap-3 bg-blue-900 text-white pl-1 pr-3 rounded">
              <div className="flex flex-col justify-center">
                <span className="text-sm leading-3 font-medium">
                  RowingBeacon
                </span>
                <span className="text-xs leading-3">Logbook</span>
              </div>
              <div className="font-medium text-sm">v{version}</div>
            </div>
            <button
              className="px-6 rounded text-sm font-medium shadow-md bg-white text-error-800 hover:bg-gray-50 border-error-900"
              onClick={() => {
                setIsLogoutAlertOpen(true);
              }}
            >
              <ArrowLeftStartOnRectangleIcon className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                adminEditSystem.startAdminEditMode(await askForAdminPassword());
              }}
              className="px-6 rounded text-sm font-medium shadow-md bg-white text-steel-blue-800 hover:bg-gray-50 "
            >
              Mode édition
            </button>

            <button
              onClick={() => {
                setDisplayHistory(true);
              }}
              className="flex-1 rounded text-sm font-medium shadow-md bg-white text-steel-blue-800 hover:bg-gray-50 border-steel-blue-900  mr-1"
            >
              Consulter l'historique des sorties
            </button>
          </div>
        </div>

        <StartSessionDialog
          defaultBoat={
            startSessionOpenWithBoat
              ? startSessionOpenWithBoat
              : {
                  id: "",
                  name: "",
                }
          }
          isOpen={Boolean(startSessionOpenWithBoat)}
          setIsOpen={setStartSessionOpenWithBoat}
        />

        <StopSessionDialog
          isOpen={isStopSessionModalOpen}
          setIsOpen={setIsStopSessionModalOpen}
          session={sessionToStop}
        />

        <RoutesCrudDialog
          isOpen={isRoutesCrudDialogOpen}
          setIsOpen={setIsRoutesCrudDialogOpen}
        />

        <RowersCrudDialog
          isOpen={isRowersCrudDialogOpen}
          setIsOpen={setIsRowersCrudDialogOpen}
        />

        <SimpleAlertDialog
          title="Fermer l'application ?"
          description="Vous allez fermer l'application. Aucune donnée ne sera perdue."
          isOpen={isLogoutAlertOpen}
          cancelElement={
            <Button
              variant="primary"
              type="button"
              onClick={() => {
                setIsLogoutAlertOpen(false);
              }}
            >
              Annuler
            </Button>
          }
          confirmElement={
            <Button
              color="danger"
              type="button"
              onClick={async () => {
                setIsLogoutAlertOpen(false);
                adminEditSystem.closeApp(await askForAdminPassword());
              }}
            >
              Fermer l'application
            </Button>
          }
        />
      </>
    );
  }

  return (
    <SessionHistory
      goBack={() => {
        setDisplayHistory(false);
      }}
    />
  );
}

const useSortBoats = (boats: Boat[]) => {
  const onGoingSessions = useSessionsStore().getOngoingSessions();

  const boatsInUse = boats.filter((boat) => {
    return onGoingSessions.some((session) => session.boat.id === boat.id);
  });

  const availableBoats = boats.filter((boat) => {
    return !boatsInUse.some((boatInUse) => boatInUse.id === boat.id);
  });

  return { availableBoats, boatsInUse };
};

export default BoathouseScreen;
