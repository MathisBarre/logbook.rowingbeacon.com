import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
} from "lucide-react";
import {
  BoatReservation,
  sortReservations,
} from "../_common/business/reservation.rules";
import Button from "../_common/components/Button";
import { useClubOverviewStore } from "../_common/store/clubOverview.store";
import { useReservationStore } from "../_common/store/reservation.store";
import { useNow } from "../_common/utils/useNow";
import { windowConfirm } from "../_common/utils/window.utils";
import { ReservationDialog } from "./components/ReservationDialog";
import { ReservationRow } from "./components/ReservationRow";
import {
  formatReservationWhen,
  getReservationHolder,
  useFormatContext,
} from "./reservations.format";

export const ReservationsScreen = () => {
  const { t } = useTranslation();
  const now = useNow();
  const context = useFormatContext();
  const reservations = useReservationStore((state) => state.reservations);
  const boats = useClubOverviewStore((state) => state.clubOverview.boats);
  const rowers = useClubOverviewStore((state) => state.clubOverview.rowers);

  const [boatFilter, setBoatFilter] = useState("");
  const [isPastOpen, setIsPastOpen] = useState(false);
  const [dialog, setDialog] = useState<{
    reservation: BoatReservation | null;
  } | null>(null);

  const boatNames = useMemo(
    () => new Map(boats.map((boat) => [boat.id, boat.name])),
    [boats]
  );
  const getBoatName = (boatId: string) =>
    boatNames.get(boatId) ?? t("reservations.unknownBoat");

  // Only the boats that have a reservation can be filtered on.
  const filterBoats = [...new Set(reservations.map((item) => item.boatId))]
    .map((id) => ({ id, name: getBoatName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const activeFilter = filterBoats.some((boat) => boat.id === boatFilter)
    ? boatFilter
    : "";

  const { upcoming, past } = sortReservations(
    activeFilter
      ? reservations.filter((item) => item.boatId === activeFilter)
      : reservations,
    now
  );

  const deleteReservation = async (reservation: BoatReservation) => {
    const confirmed = await windowConfirm(
      t("reservations.confirmDelete", {
        boat: getBoatName(reservation.boatId),
        when: formatReservationWhen(reservation, context, now, t),
      })
    );
    if (!confirmed) return;
    useReservationStore.getState().remove(reservation.id);
    toast.success(t("reservations.deleted"));
  };

  const renderRows = (items: BoatReservation[], isPast: boolean) =>
    items.map((reservation) => (
      <ReservationRow
        key={reservation.id}
        reservation={reservation}
        boatName={getBoatName(reservation.boatId)}
        holder={getReservationHolder(reservation, rowers)}
        now={now}
        context={context}
        isPast={isPast}
        onEdit={() => setDialog({ reservation })}
        onDelete={() => void deleteReservation(reservation)}
      />
    ));

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between items-center h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center font-medium">
          <CalendarIcon className="h-4 w-4" />
          {t("reservations.title")}
        </h1>
        <Button
          type="button"
          variant="outlined"
          className="py-1 gap-2"
          onClick={() => setDialog({ reservation: null })}
        >
          <PlusIcon className="h-4 w-4" />
          {t("reservations.new")}
        </Button>
      </div>

      <div className="flex-1 relative">
        <div className="absolute inset-0 overflow-auto flex flex-col">
          {reservations.length === 0 ? (
            <EmptyState onCreate={() => setDialog({ reservation: null })} />
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <label
                  htmlFor="reservations-boat-filter"
                  className="text-sm text-gray-600"
                >
                  {t("reservations.filterByBoat")}
                </label>
                <select
                  id="reservations-boat-filter"
                  className="input !mt-0 !w-auto min-w-48"
                  value={activeFilter}
                  onChange={(event) => setBoatFilter(event.target.value)}
                >
                  <option value="">{t("reservations.allBoats")}</option>
                  {filterBoats.map((boat) => (
                    <option key={boat.id} value={boat.id}>
                      {boat.name}
                    </option>
                  ))}
                </select>
              </div>

              {upcoming.length === 0 && (
                <p className="px-4 py-6 text-gray-500">
                  {t("reservations.noUpcoming")}
                </p>
              )}
              <ul>{renderRows(upcoming, false)}</ul>

              {past.length > 0 && (
                <div className="border-t">
                  <button
                    type="button"
                    aria-expanded={isPastOpen}
                    className="flex items-center gap-1 w-full px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
                    onClick={() => setIsPastOpen(!isPastOpen)}
                  >
                    {isPastOpen ? (
                      <ChevronDownIcon className="h-4 w-4" />
                    ) : (
                      <ChevronRightIcon className="h-4 w-4" />
                    )}
                    {t("reservations.past", { count: past.length })}
                  </button>
                  {isPastOpen && (
                    <ul className="opacity-70">{renderRows(past, true)}</ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ReservationDialog
        isOpen={dialog !== null}
        reservation={dialog?.reservation ?? null}
        defaultBoatId={activeFilter}
        onClose={() => setDialog(null)}
      />
    </div>
  );
};

const EmptyState = ({ onCreate }: { onCreate: () => void }) => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <CalendarIcon className="h-10 w-10 text-steel-blue-300" />
      <p className="text-lg font-medium text-gray-800">
        {t("reservations.emptyTitle")}
      </p>
      <p className="text-gray-600 max-w-xl">{t("reservations.emptyText")}</p>
      <Button type="button" onClick={onCreate} className="gap-2">
        <PlusIcon className="h-4 w-4" />
        {t("reservations.new")}
      </Button>
    </div>
  );
};
