import { PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BoatReservation,
  getNextOccurrence,
} from "../../_common/business/reservation.rules";
import {
  FormatContext,
  formatDay,
  formatReservationPeriod,
  formatReservationWhen,
} from "../reservations.format";

export const ReservationRow = ({
  reservation,
  boatName,
  holder,
  now,
  context,
  isPast,
  onEdit,
  onDelete,
}: {
  reservation: BoatReservation;
  boatName: string;
  holder: string;
  now: Date;
  context: FormatContext;
  isPast: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const next = isPast ? null : getNextOccurrence(reservation, now);
  const isRunning = next !== null && next.start <= now;
  const period = formatReservationPeriod(reservation, context, now, t);
  const when = formatReservationWhen(reservation, context, now, t);

  return (
    <li className="flex items-start gap-4 px-4 py-3 border-b hover:bg-gray-50">
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium text-gray-900 tracking-tighter">
            {boatName}
          </span>
          {isRunning && (
            <span className="bg-yellow-50 border border-yellow-300 text-yellow-900 px-2 py-0.5 rounded-full text-xs">
              {t("reservations.inProgress")}
            </span>
          )}
        </div>
        <p className="text-gray-800">
          {when}
          {period && <span className="text-gray-500"> · {period}</span>}
        </p>
        {reservation.recurrence === "weekly" && next && !isRunning && (
          <p className="text-xs text-gray-500">
            {t("reservations.nextOn", {
              date: formatDay(next.start, context, now),
            })}
          </p>
        )}
        <p className="text-sm text-gray-700">
          {holder}
          {reservation.reason && (
            <span className="text-gray-500"> – {reservation.reason}</span>
          )}
        </p>
        {reservation.contact && (
          <p className="text-xs text-gray-500">{reservation.contact}</p>
        )}
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          className="p-2 rounded text-steel-blue-800 hover:bg-steel-blue-100"
          title={t("common.edit")}
          aria-label={`${t("common.edit")} – ${boatName} ${when}`}
          onClick={onEdit}
        >
          <PencilIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="p-2 rounded text-error-700 hover:bg-error-100"
          title={t("common.delete")}
          aria-label={`${t("common.delete")} – ${boatName} ${when}`}
          onClick={onDelete}
        >
          <Trash2Icon className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
};
