import { CalendarClockIcon } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { getReservationsOverlapping } from "../../../_common/business/reservation.rules";
import { useModule } from "../../../_common/store/modules.store";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { useReservationStore } from "../../../_common/store/reservation.store";
import { addMinutes } from "../../../_common/utils/date.utils";
import {
  formatOccurrence,
  getReservationHolder,
  useFormatContext,
} from "../../../reservations/reservations.format";

/** The fields of the form the notice reads. */
interface OutingTimeValues {
  selectedRowersOptions: { id: string }[];
  cox: { id: string } | null;
  captainId: string | null;
  startDateTime: string;
  durationValue: string;
  estimatedReturn?: string;
}

/**
 * Reservations module: warns, without blocking, that the chosen boat is
 * reserved during the outing.
 */
export const BoatReservationNotice = ({
  boatId,
  coxed,
}: {
  boatId: string;
  /** A cox picked before switching to a coxless configuration is not crew. */
  coxed: boolean;
}) => {
  const hasReservations = useModule("reservations");
  if (!hasReservations || !boatId) return null;
  return <Notice boatId={boatId} coxed={coxed} />;
};

const Notice = ({ boatId, coxed }: { boatId: string; coxed: boolean }) => {
  const { t } = useTranslation();
  const context = useFormatContext();
  const { control } = useFormContext<OutingTimeValues>();
  const [
    startDateTime,
    durationValue,
    estimatedReturn,
    selectedRowers,
    cox,
    captainId,
  ] = useWatch({
    control,
    name: [
      "startDateTime",
      "durationValue",
      "estimatedReturn",
      "selectedRowersOptions",
      "cox",
      "captainId",
    ],
  });
  const reservations = useReservationStore((state) => state.reservations);
  const rowers = useClubOverviewStore((state) => state.clubOverview.rowers);

  const start = new Date(startDateTime);
  if (isNaN(start.getTime())) return null;

  // Same estimate as the one the outing is saved with.
  const minutes = parseInt(durationValue);
  const end =
    durationValue === "days"
      ? estimatedReturn
        ? new Date(estimatedReturn)
        : undefined
      : minutes
        ? addMinutes(start, minutes)
        : undefined;

  // The holder going out on the boat is not a conflict to warn about.
  const crewIds = new Set<string>(
    [
      ...(selectedRowers ?? []).map((rower) => rower.id),
      coxed ? cox?.id : null,
      captainId,
    ].filter((id): id is string => Boolean(id))
  );
  const overlapping = getReservationsOverlapping(
    reservations,
    boatId,
    start,
    end && !isNaN(end.getTime()) ? end : undefined
  ).filter(
    ({ reservation }) =>
      !reservation.rowerId || !crewIds.has(reservation.rowerId)
  );
  if (overlapping.length === 0) return null;

  return (
    <div
      role="status"
      className="text-xs text-yellow-900 bg-yellow-50 border border-yellow-300 rounded p-2 flex gap-2"
    >
      <CalendarClockIcon className="h-4 w-4 shrink-0 text-yellow-700" />
      <div className="flex flex-col gap-0.5">
        {overlapping.map(({ reservation, occurrence }) => {
          const params = {
            ...formatOccurrence(occurrence, context, start),
            holder: getReservationHolder(reservation, rowers),
            reason: reservation.reason,
          };
          return (
            <p key={`${reservation.id}-${occurrence.start.getTime()}`}>
              {reservation.reason
                ? t("reservations.notice.withReason", params)
                : t("reservations.notice.line", params)}
            </p>
          );
        })}
      </div>
    </div>
  );
};
