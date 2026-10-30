import { useState } from "react";
import { useTranslation } from "react-i18next";
import { v4 } from "uuid";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import {
  BoatReservation,
  DAYS_OF_WEEK,
  DayOfWeek,
  ReservationError,
  ReservationRecurrence,
  toLocalDate,
  toLocalTime,
  validateReservation,
} from "../../_common/business/reservation.rules";
import Button from "../../_common/components/Button";
import { Checkbox } from "../../_common/components/Checkbox";
import { Label } from "../../_common/components/Label";
import { SimpleDialog } from "../../_common/components/SimpleDialog";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";
import { useReservationStore } from "../../_common/store/reservation.store";
import { cn } from "../../_common/utils/utils";
import {
  formatDayOfWeek,
  formatReservationWhen,
  getReservationHolder,
  parseLocalDateTime,
  useFormatContext,
} from "../reservations.format";
import { Holder, HolderSelect } from "./HolderSelect";

const CHECKBOX_CLASS =
  "h-5 w-5 border-steel-blue-800 data-[state=checked]:bg-steel-blue-800 data-[state=checked]:text-white";

export const ReservationDialog = ({
  isOpen,
  reservation,
  defaultBoatId,
  onClose,
}: {
  isOpen: boolean;
  /** The reservation to edit; none to create one. */
  reservation: BoatReservation | null;
  defaultBoatId?: string;
  onClose: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <SimpleDialog
      modal={true}
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title={t(
        reservation ? "reservations.editTitle" : "reservations.newTitle"
      )}
    >
      <ReservationForm
        reservation={reservation}
        defaultBoatId={defaultBoatId}
        onClose={onClose}
      />
    </SimpleDialog>
  );
};

interface FormState {
  boatId: string;
  recurrence: ReservationRecurrence;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  dayOfWeek: DayOfWeek;
  hasPeriod: boolean;
  periodStart: string;
  periodEnd: string;
  holder: Holder;
  reason: string;
  contact: string;
}

const dayOfWeekOf = (date: string) =>
  (((parseLocalDateTime(date).getDay() + 6) % 7) + 1) as DayOfWeek;

const getInitialState = (
  reservation: BoatReservation | null,
  defaultBoatId: string
): FormState => {
  if (reservation) {
    const isWeekly = reservation.recurrence === "weekly";
    const today = toLocalDate(new Date());
    const startDate = (!isWeekly && reservation.startDate) || today;
    return {
      boatId: reservation.boatId,
      recurrence: reservation.recurrence,
      startDate,
      startTime: reservation.startTime,
      endDate: (!isWeekly && reservation.endDate) || startDate,
      endTime: reservation.endTime,
      dayOfWeek: reservation.dayOfWeek ?? dayOfWeekOf(startDate),
      hasPeriod:
        isWeekly && Boolean(reservation.startDate || reservation.endDate),
      periodStart: (isWeekly && reservation.startDate) || "",
      periodEnd: (isWeekly && reservation.endDate) || "",
      holder: {
        rowerId: reservation.rowerId,
        personName: reservation.personName ?? "",
      },
      reason: reservation.reason ?? "",
      contact: reservation.contact ?? "",
    };
  }

  // The next full hour, for one hour; a slot never spills over midnight.
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const startDate = toLocalDate(start);
  const endsSameDay = toLocalDate(end) === startDate;
  return {
    boatId: defaultBoatId,
    recurrence: "once",
    startDate,
    startTime: toLocalTime(start),
    endDate: startDate,
    endTime: endsSameDay ? toLocalTime(end) : "23:59",
    dayOfWeek: dayOfWeekOf(startDate),
    hasPeriod: false,
    periodStart: "",
    periodEnd: "",
    holder: { rowerId: null, personName: "" },
    reason: "",
    contact: "",
  };
};

const toReservation = (state: FormState, id: string): BoatReservation => {
  const isWeekly = state.recurrence === "weekly";
  return {
    id,
    boatId: state.boatId,
    recurrence: state.recurrence,
    startDate: isWeekly
      ? state.hasPeriod
        ? state.periodStart || null
        : null
      : state.startDate || null,
    endDate: isWeekly
      ? state.hasPeriod
        ? state.periodEnd || null
        : null
      : state.endDate || null,
    dayOfWeek: isWeekly ? state.dayOfWeek : null,
    startTime: state.startTime,
    endTime: state.endTime,
    rowerId: state.holder.rowerId,
    personName: state.holder.rowerId
      ? null
      : state.holder.personName.trim() || null,
    reason: state.reason.trim() || null,
    contact: state.contact.trim() || null,
  };
};

const ReservationForm = ({
  reservation,
  defaultBoatId,
  onClose,
}: {
  reservation: BoatReservation | null;
  defaultBoatId?: string;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const context = useFormatContext();
  const boats = useClubOverviewStore((state) => state.clubOverview.boats);
  const rowers = useClubOverviewStore((state) => state.clubOverview.rowers);
  const reservations = useReservationStore((state) => state.reservations);

  // Active boats only; the boat of the reservation being edited stays listed.
  const selectableBoats = boats
    .filter((boat) => !boat.archivedAt || boat.id === reservation?.boatId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const [state, setState] = useState(() =>
    getInitialState(
      reservation,
      // A default boat that cannot be chosen would show another one.
      selectableBoats.some((boat) => boat.id === defaultBoatId)
        ? (defaultBoatId ?? "")
        : ""
    )
  );
  const [problem, setProblem] = useState<{
    error: ReservationError;
    conflict?: BoatReservation;
  } | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(Boolean(reservation?.contact));

  const update = (changes: Partial<FormState>) => {
    setState((current) => ({ ...current, ...changes }));
    setProblem(null);
  };

  // The boat being edited may no longer exist: it is still the saved one.
  const isBoatListed =
    !state.boatId || selectableBoats.some((boat) => boat.id === state.boatId);

  const submit = () => {
    const draft = toReservation(state, reservation?.id ?? v4());
    const others = reservations.filter((other) => other.id !== draft.id);
    const found = validateReservation(draft, others);
    if (found) {
      setProblem(found);
      return;
    }
    useReservationStore.getState().save(draft);
    toast.success(t("reservations.saved"));
    onClose();
  };

  const conflictText = (conflict: BoatReservation) =>
    t("reservations.errors.OVERLAPS", {
      holder: getReservationHolder(conflict, rowers),
      when: formatReservationWhen(conflict, context, new Date(), t),
    });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="reservation-boat">{t("reservations.boat")}</Label>
        <select
          id="reservation-boat"
          className="input"
          value={state.boatId}
          onChange={(event) => update({ boatId: event.target.value })}
        >
          <option value="" disabled>
            {t("reservations.chooseBoat")}
          </option>
          {!isBoatListed && (
            <option value={state.boatId}>
              {t("reservations.unknownBoat")}
            </option>
          )}
          {selectableBoats.map((boat) => (
            <option key={boat.id} value={boat.id}>
              {boat.name}
            </option>
          ))}
        </select>
      </div>

      <div
        role="group"
        aria-label={t("reservations.recurrence")}
        className="inline-flex self-start rounded border border-gray-400 overflow-hidden"
      >
        {(["once", "weekly"] as const).map((recurrence) => (
          <button
            key={recurrence}
            type="button"
            aria-pressed={state.recurrence === recurrence}
            className={cn(
              "px-4 py-1.5 text-sm font-medium",
              state.recurrence === recurrence
                ? "bg-steel-blue-700 text-white"
                : "bg-white text-steel-blue-800 hover:bg-gray-100"
            )}
            onClick={() =>
              update({
                recurrence,
                // A weekly slot starts on the day of the chosen date.
                ...(recurrence === "weekly" &&
                state.recurrence === "once" &&
                state.startDate
                  ? { dayOfWeek: dayOfWeekOf(state.startDate) }
                  : {}),
              })
            }
          >
            {t(`reservations.recurrences.${recurrence}`)}
          </button>
        ))}
      </div>

      {state.recurrence === "once" ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-1">
              <Label htmlFor="reservation-start-date">
                {t("reservations.startDate")}
              </Label>
              <input
                id="reservation-start-date"
                className="input"
                type="date"
                value={state.startDate}
                onChange={(event) => {
                  const startDate = event.target.value;
                  // The end follows the start unless it was set further on.
                  const followsStart =
                    !state.endDate ||
                    state.endDate === state.startDate ||
                    state.endDate < startDate;
                  update({
                    startDate,
                    ...(followsStart ? { endDate: startDate } : {}),
                  });
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="reservation-start-time">
                {t("reservations.startTime")}
              </Label>
              <input
                id="reservation-start-time"
                className="input"
                type="time"
                value={state.startTime}
                onChange={(event) => update({ startTime: event.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-1">
              <Label htmlFor="reservation-end-date">
                {t("reservations.endDate")}
              </Label>
              <input
                id="reservation-end-date"
                className="input"
                type="date"
                min={state.startDate || undefined}
                value={state.endDate}
                onChange={(event) => update({ endDate: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="reservation-end-time">
                {t("reservations.endTime")}
              </Label>
              <input
                id="reservation-end-time"
                className="input"
                type="time"
                value={state.endTime}
                onChange={(event) => update({ endTime: event.target.value })}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-6">
            <div className="flex flex-col gap-1">
              <Label htmlFor="reservation-day">{t("reservations.day")}</Label>
              <select
                id="reservation-day"
                className="input"
                value={state.dayOfWeek}
                onChange={(event) =>
                  update({ dayOfWeek: Number(event.target.value) as DayOfWeek })
                }
              >
                {DAYS_OF_WEEK.map((day) => (
                  <option key={day} value={day}>
                    {formatDayOfWeek(day, context)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="reservation-start-time">
                {t("reservations.startTime")}
              </Label>
              <input
                id="reservation-start-time"
                className="input"
                type="time"
                value={state.startTime}
                onChange={(event) => update({ startTime: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="reservation-end-time">
                {t("reservations.endTime")}
              </Label>
              <input
                id="reservation-end-time"
                className="input"
                type="time"
                value={state.endTime}
                onChange={(event) => update({ endTime: event.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="reservation-has-period"
              className={CHECKBOX_CLASS}
              checked={state.hasPeriod}
              onCheckedChange={(checked) =>
                update({ hasPeriod: checked === true })
              }
            />
            <label
              htmlFor="reservation-has-period"
              className="text-sm cursor-pointer"
            >
              {t("reservations.onlyDuringPeriod")}
            </label>
          </div>

          {state.hasPeriod && (
            <div className="grid grid-cols-2 gap-6">
              <div className="flex flex-col gap-1">
                <Label htmlFor="reservation-period-start">
                  {t("reservations.periodStart")}
                </Label>
                <input
                  id="reservation-period-start"
                  className="input"
                  type="date"
                  value={state.periodStart}
                  onChange={(event) =>
                    update({ periodStart: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="reservation-period-end">
                  {t("reservations.periodEnd")}
                </Label>
                <input
                  id="reservation-period-end"
                  className="input"
                  type="date"
                  min={state.periodStart || undefined}
                  value={state.periodEnd}
                  onChange={(event) =>
                    update({ periodEnd: event.target.value })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="reservation-holder">{t("reservations.holder")}</Label>
        <HolderSelect
          id="reservation-holder"
          value={state.holder}
          onChange={(holder) => update({ holder })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="reservation-reason">
          {t("reservations.reason")}{" "}
          <span className="text-gray-500 font-normal">
            ({t("common.optional")})
          </span>
        </Label>
        <input
          id="reservation-reason"
          className="input"
          type="text"
          placeholder={t("reservations.reasonPlaceholder")}
          value={state.reason}
          onChange={(event) => update({ reason: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={isMoreOpen}
          className="flex items-center gap-1 self-start text-sm text-steel-blue-700 hover:underline"
          onClick={() => setIsMoreOpen(!isMoreOpen)}
        >
          {isMoreOpen ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
          {t("reservations.moreOptions")}
        </button>
        {isMoreOpen && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="reservation-contact">
              {t("reservations.contact")}
            </Label>
            <input
              id="reservation-contact"
              className="input"
              type="text"
              placeholder={t("reservations.contactPlaceholder")}
              value={state.contact}
              onChange={(event) => update({ contact: event.target.value })}
            />
          </div>
        )}
      </div>

      {problem && (
        <p
          role="alert"
          className="text-sm text-error-800 bg-error-50 border border-error-200 rounded p-2"
        >
          {problem.error === "OVERLAPS" && problem.conflict
            ? conflictText(problem.conflict)
            : t(`reservations.errors.${problem.error}`)}
        </p>
      )}

      <div className="flex gap-6">
        <Button
          type="button"
          variant="outlined"
          className="flex-1"
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" className="flex-1">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
};
