import { useMemo } from "react";
import {
  BoatReservation,
  DayOfWeek,
  ReservationOccurrence,
  toLocalDate,
} from "../_common/business/reservation.rules";
import { TimeStyle, useLocaleStore } from "../_common/store/locale.store";

export interface FormatContext {
  locale: string;
  timeStyle: TimeStyle;
}

/** The language and 12h/24h choice of the club, for dates and times. */
export const useFormatContext = (): FormatContext => {
  const locale = useLocaleStore((state) => state.locale);
  const timeStyle = useLocaleStore((state) => state.timeStyle);
  return useMemo(
    () => ({ locale: locale ?? "en-US", timeStyle }),
    [locale, timeStyle]
  );
};

/** The holder: the rower's name, else the free name typed. */
export const getReservationHolder = (
  reservation: BoatReservation,
  rowers: { id: string; name: string }[]
) =>
  (reservation.rowerId
    ? rowers.find((rower) => rower.id === reservation.rowerId)?.name
    : undefined) ??
  reservation.personName ??
  "";

/** A local calendar day (YYYY-MM-DD) and wall-clock time (HH:MM). */
export const parseLocalDateTime = (date: string, time = "00:00") => {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
};

export const formatTime = (date: Date, { locale, timeStyle }: FormatContext) =>
  date.toLocaleTimeString(locale, {
    hour: timeStyle === "12h" ? "numeric" : "2-digit",
    minute: "2-digit",
    // h23, not hour12: false, which can render midnight as "24:00".
    hourCycle: timeStyle === "12h" ? "h12" : "h23",
  });

/** "sat. 24 Oct", with the year when it is not the one of `reference`. */
export const formatDay = (
  date: Date,
  { locale }: FormatContext,
  reference: Date
) =>
  date.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === reference.getFullYear() ? undefined : "numeric",
  });

/** "sat. 24 Oct 09:00". */
export const formatMoment = (
  date: Date,
  context: FormatContext,
  reference: Date
) => `${formatDay(date, context, reference)} ${formatTime(date, context)}`;

/** The time alone when `date` falls on the day of `reference`. */
export const formatMomentOrTime = (
  date: Date,
  context: FormatContext,
  reference: Date
) =>
  toLocalDate(date) === toLocalDate(reference)
    ? formatTime(date, context)
    : formatMoment(date, context, reference);

/** "Monday": 2024-01-01 was one. */
export const formatDayOfWeek = (
  dayOfWeek: DayOfWeek,
  { locale }: FormatContext
) =>
  new Date(2024, 0, dayOfWeek).toLocaleDateString(locale, {
    weekday: "long",
  });

/** Time of a weekly slot ("18:00") as read by the club. */
export const formatSlotTime = (time: string, context: FormatContext) =>
  formatTime(parseLocalDateTime("2024-01-01", time), context);

export type TranslateFn = (
  key: string,
  params?: Record<string, unknown>
) => string;

/** One-time: "sat. 24 Oct 09:00 → sun. 25 Oct 16:30"; weekly: "Every Monday…". */
export const formatReservationWhen = (
  reservation: BoatReservation,
  context: FormatContext,
  now: Date,
  t: TranslateFn
) => {
  if (reservation.recurrence === "once") {
    if (!reservation.startDate || !reservation.endDate) return "";
    const start = parseLocalDateTime(
      reservation.startDate,
      reservation.startTime
    );
    const end = parseLocalDateTime(reservation.endDate, reservation.endTime);
    // The same day reads shorter: "sat. 24 Oct 09:00 → 16:30".
    return `${formatMoment(start, context, now)} → ${formatMomentOrTime(
      end,
      context,
      start
    )}`;
  }

  if (!reservation.dayOfWeek) return "";
  return t("reservations.weekly", {
    day: formatDayOfWeek(reservation.dayOfWeek, context),
    start: formatSlotTime(reservation.startTime, context),
    end: formatSlotTime(reservation.endTime, context),
  });
};

/** "from 1 Sep to 30 Nov" for a weekly reservation limited to a period. */
export const formatReservationPeriod = (
  reservation: BoatReservation,
  context: FormatContext,
  now: Date,
  t: TranslateFn
) => {
  if (reservation.recurrence !== "weekly") return null;
  const from = reservation.startDate
    ? formatDay(parseLocalDateTime(reservation.startDate), context, now)
    : null;
  const to = reservation.endDate
    ? formatDay(parseLocalDateTime(reservation.endDate), context, now)
    : null;
  if (from && to) return t("reservations.periodBetween", { from, to });
  if (from) return t("reservations.periodFrom", { from });
  if (to) return t("reservations.periodUntil", { to });
  return null;
};

export const formatOccurrence = (
  occurrence: ReservationOccurrence,
  context: FormatContext,
  reference: Date
) => ({
  from: formatMomentOrTime(occurrence.start, context, reference),
  to: formatMomentOrTime(occurrence.end, context, occurrence.start),
});
