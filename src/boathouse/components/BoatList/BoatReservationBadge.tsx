import { useTranslation } from "react-i18next";
import { getBoatReservationState } from "../../../_common/business/reservation.rules";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { useReservationStore } from "../../../_common/store/reservation.store";
import { useNow } from "../../../_common/utils/useNow";
import {
  formatMomentOrTime,
  getReservationHolder,
  useFormatContext,
} from "../../../reservations/reservations.format";

/**
 * Reservations module: a boat reserved now, or soon, says so. It only
 * warns: the boat can still be taken out.
 */
export const BoatReservationBadge = ({ boatId }: { boatId: string }) => {
  const { t } = useTranslation();
  const now = useNow();
  const context = useFormatContext();
  const reservations = useReservationStore((state) => state.reservations);
  const lookaheadMinutes = useReservationStore(
    (state) => state.lookaheadMinutes
  );
  const rowers = useClubOverviewStore((state) => state.clubOverview.rowers);

  const reservationState = getBoatReservationState(
    reservations,
    boatId,
    now,
    lookaheadMinutes
  );
  if (!reservationState) return null;

  const { reservation, occurrence } = reservationState;
  const label =
    reservationState.state === "reserved"
      ? t("reservations.badge.until", {
          time: formatMomentOrTime(occurrence.end, context, now),
        })
      : t("reservations.badge.at", {
          time: formatMomentOrTime(occurrence.start, context, now),
        });
  const holder = t("reservations.reservedBy", {
    holder: getReservationHolder(reservation, rowers),
  });
  const detail = reservation.reason
    ? `${holder} – ${reservation.reason}`
    : holder;

  return (
    <span
      className="bg-yellow-50 border border-yellow-300 text-yellow-900 inline-block px-2 py-1 rounded-full text-xs"
      title={detail}
    >
      {label}
      <span className="sr-only">{` – ${detail}`}</span>
    </span>
  );
};
