import { useState } from "react";
import {
  useSessionsStore,
  ZustandSession,
} from "../_common/store/sessions.store";

import { cn } from "../_common/utils/utils";
import { BoatsList } from "./components/BoatList/BoatList";
import { sortBoatsByAvailability } from "./components/BoatList/BoatList.utils";
import { StartSessionDialog } from "./components/StartSessionDialog/StartSession.Dialog";
import { StopSessionDialog } from "./components/StopSessionDialog/StopSession.Dialog";
import { AllBoatsBackBanner } from "./components/AllBoatsBackBanner";
import { BoathouseInfoStrip } from "./components/BoathouseInfoStrip";
import { useClubOverviewStore } from "../_common/store/clubOverview.store";
import { Boat } from "../_common/business/boat.rules";

import { windowAlert } from "../_common/utils/window.utils";
import { HistoryIcon, WarehouseIcon, WavesIcon, WrenchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OutingEditorDialog } from "../logbook/components/OutingEditor/OutingEditor.Dialog";
import { getEmptyPastOutingDraft } from "../logbook/business/EditOuting/outingDraft.rules";
import type { OutingDraft } from "../logbook/business/EditOuting/outingDraft";

function BoathouseScreen() {
  const { t } = useTranslation();
  const sessionStore = useSessionsStore();
  const { coachNote, clubOverview } = useClubOverviewStore();
  const { availableBoats, boatsInUse, unavailableBoats } = useSortBoats(
    clubOverview.boats,
  );

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

  // Set while the dialog to enter an outing that already happened is open.
  const [pastOutingDraft, setPastOutingDraft] = useState<OutingDraft | null>(
    null
  );

  const onBoatRowClick = (boat: { id: string; name: string }) => {
    setStartSessionOpenWithBoat(boat);
  };

  return (
    <>
      <BoathouseInfoStrip />

      {coachNote && (
        <div
          className=" bg-yellow-100 border border-yellow-700 text-yellow-900 rounded h-9 px-2 flex items-center overflow-hidden z-30 hover:bg-yellow-200 cursor-pointer"
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={async () => {
            await windowAlert(coachNote);
          }}
        >
          <p className="text-nowrap text-ellipsis overflow-hidden">
            <span className="font-semibold">{t("boathouse.coachNote")}</span> :{" "}
            {coachNote}
          </p>
        </div>
      )}

      <div
        className={cn(
          "shadow-md absolute left-0 bottom-0 right-[calc(50%+0.125rem)]",
          coachNote ? "top-[4.5rem]" : "top-8",
        )}
      >
        <BoatsList
          label={t("boathouse.availableBoats")}
          boats={availableBoats}
          onBoatRowClick={onBoatRowClick}
          icon={<WarehouseIcon />}
          headerAction={
            <button
              type="button"
              className="h-8 px-2 flex items-center gap-1 rounded border border-white/30 bg-white/10 hover:bg-white/20 text-sm text-white"
              onClick={() =>
                setPastOutingDraft(getEmptyPastOutingDraft(new Date()))
              }
            >
              <HistoryIcon className="h-4 w-4" />
              {t("outingEditor.pastOuting")}
            </button>
          }
        />
      </div>

      <div
        className={cn(
          "absolute right-0 bottom-0 left-[calc(50%+0.125rem)] flex flex-col gap-1",
          coachNote ? "top-[4.5rem]" : "top-8",
        )}
      >
        <div className="relative shadow-md flex-[2] min-h-0">
          <BoatsList
            label={t("boathouse.boatsInUse")}
            boats={boatsInUse}
            onBoatRowClick={(boat) => {
              const session = sessionStore.findOngoingSessionByBoatId(boat.id);

              setIsStopSessionModalOpen(true);
              setSessionToStop(session);
            }}
            icon={<WavesIcon />}
          />
        </div>

        {unavailableBoats.length > 0 && (
          <div className="relative shadow-md flex-1 min-h-0">
            {/* Boats in maintenance can't be started: rows are not clickable */}
            <BoatsList
              label={t("boathouse.unavailableBoats")}
              boats={unavailableBoats}
              onBoatRowClick={() => undefined}
              icon={<WrenchIcon />}
            />
          </div>
        )}
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

      <OutingEditorDialog
        mode="past"
        initialDraft={pastOutingDraft}
        onClose={() => setPastOutingDraft(null)}
      />

      <StopSessionDialog
        isOpen={isStopSessionModalOpen}
        setIsOpen={setIsStopSessionModalOpen}
        session={sessionToStop}
      />

      <AllBoatsBackBanner />
    </>
  );
}

/** An archived boat still out stays listed so its outing can be finished. */
const useSortBoats = (boats: (Boat & { archivedAt?: string })[]) => {
  const onGoingSessions = useSessionsStore().getOngoingSessions();

  return sortBoatsByAvailability(
    boats,
    onGoingSessions.map((session) => session.boat.id),
  );
};

export default BoathouseScreen;
