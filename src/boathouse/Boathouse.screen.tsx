import { useState } from "react";
import {
  useSessionsStore,
  ZustandSession,
} from "../_common/store/sessions.store";

import { cn } from "../_common/utils/utils";
import { BoatsList } from "./components/BoatList/BoatList";
import { StartSessionDialog } from "./components/StartSessionDialog/StartSession.Dialog";
import { StopSessionDialog } from "./components/StopSessionDialog/StopSession.Dialog";
import { useClubOverviewStore } from "../_common/store/clubOverview.store";
import { Boat } from "../_common/types/boat.type";

import { windowAlert } from "../_common/utils/window.utils";
import { WarehouseIcon, WavesIcon } from "lucide-react";

function BoathouseScreen() {
  const sessionStore = useSessionsStore();
  const { coachNote, getAllBoats } = useClubOverviewStore();
  const boats = getAllBoats();
  const { availableBoats, boatsInUse } = useSortBoats(boats || []);

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

  const onBoatRowClick = (boat: { id: string; name: string }) => {
    setStartSessionOpenWithBoat(boat);
  };

  return (
    <>
      {coachNote && (
        <div
          className=" bg-yellow-100 border border-yellow-700 text-yellow-900 rounded h-9 px-2 flex items-center overflow-hidden z-30 hover:bg-yellow-200 cursor-pointer"
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={async () => {
            await windowAlert(coachNote);
          }}
        >
          <p className="text-nowrap text-ellipsis overflow-hidden">
            <span className="font-semibold">Note du coach</span> : {coachNote}
          </p>
        </div>
      )}

      <div
        className={cn(
          "shadow-md absolute left-0 bottom-0 right-[calc(50%+0.125rem)]",
          coachNote ? "top-10" : "top-0"
        )}
      >
        <BoatsList
          label="Bateaux disponibles"
          boats={availableBoats}
          onBoatRowClick={onBoatRowClick}
          icon={<WarehouseIcon />}
        />
      </div>

      <div
        className={cn(
          "shadow-md absolute right-0 bottom-0 left-[calc(50%+0.125rem)]",
          coachNote ? "top-10" : "top-0"
        )}
      >
        <BoatsList
          label="Bateaux en cours d'utilisation"
          boats={boatsInUse}
          onBoatRowClick={(boat) => {
            const session = sessionStore.findOngoingSessionByBoatId(boat.id);

            setIsStopSessionModalOpen(true);
            setSessionToStop(session);
          }}
          icon={<WavesIcon />}
        />
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
    </>
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
