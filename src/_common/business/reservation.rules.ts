/**
 * Boat reservations (Reservations module). Dates are local calendar days
 * (YYYY-MM-DD) and times local wall-clock times (HH:MM), as the club reads
 * them on the boathouse screen.
 */

export type ReservationRecurrence = "once" | "weekly";

/** ISO day of week: 1 = Monday … 7 = Sunday. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DAYS_OF_WEEK: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];

export interface BoatReservation {
  id: string;
  boatId: string;
  recurrence: ReservationRecurrence;
  /** once: first day (required). weekly: first day the rule applies, if any. */
  startDate: string | null;
  /** once: last day (required). weekly: last day the rule applies, if any. */
  endDate: string | null;
  /** weekly only. */
  dayOfWeek: DayOfWeek | null;
  startTime: string;
  endTime: string;
  /** The holder: a rower, or a free name (a crew, a group…). */
  rowerId: string | null;
  personName: string | null;
  reason: string | null;
  contact: string | null;
}

export interface ReservationOccurrence {
  start: Date;
  end: Date;
}

/** How long before a reservation the boathouse shows the boat as reserved. */
export const DEFAULT_RESERVATION_LOOKAHEAD_MINUTES = 60;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const atLocal = (date: string, time: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
};

export const toLocalDate = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

export const toLocalTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;

const isoDayOfWeek = (date: Date) =>
  (((date.getDay() + 6) % 7) + 1) as DayOfWeek;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * Occurrences that overlap [from, to), oldest first. With `limit`, the scan
 * stops once that many are found.
 */
export const getOccurrences = (
  reservation: BoatReservation,
  from: Date,
  to: Date,
  limit = Infinity
): ReservationOccurrence[] => {
  if (reservation.recurrence === "once") {
    if (!reservation.startDate || !reservation.endDate) return [];
    const start = atLocal(reservation.startDate, reservation.startTime);
    const end = atLocal(reservation.endDate, reservation.endTime);
    // An inverted slot (only an import can make one) never shows.
    return end > start && start < to && end > from ? [{ start, end }] : [];
  }

  if (!reservation.dayOfWeek) return [];
  const occurrences: ReservationOccurrence[] = [];
  // A weekly slot never spans midnight: start the day before `from` anyway
  // so that a slot still running at `from` is found. The scan is clamped to
  // the reservation's period and jumps a week at a time, so a far-off end
  // date (a typo like 9999) costs nothing.
  let day = addDays(startOfDay(from), -1);
  if (reservation.startDate) {
    const firstDay = atLocal(reservation.startDate, "00:00");
    if (firstDay > day) day = firstDay;
  }
  let last = to;
  if (reservation.endDate) {
    const dayAfterEnd = addDays(atLocal(reservation.endDate, "00:00"), 1);
    if (dayAfterEnd < last) last = dayAfterEnd;
  }
  day = addDays(day, (reservation.dayOfWeek - isoDayOfWeek(day) + 7) % 7);
  for (; day < last && occurrences.length < limit; day = addDays(day, 7)) {
    const date = toLocalDate(day);
    const start = atLocal(date, reservation.startTime);
    const end = atLocal(date, reservation.endTime);
    if (end <= start) continue;
    if (start < to && end > from) occurrences.push({ start, end });
  }
  return occurrences;
};

/** The occurrence running at `now`, else the next one; null once it is over. */
export const getNextOccurrence = (
  reservation: BoatReservation,
  now: Date
): ReservationOccurrence | null => {
  if (reservation.recurrence === "once") {
    return getOccurrences(reservation, now, new Date(8.64e15))[0] ?? null;
  }
  // A weekly reservation comes back within a week of its first day (or of
  // now), unless its end date is past.
  const firstDay = reservation.startDate
    ? atLocal(reservation.startDate, "00:00")
    : null;
  const from = firstDay && firstDay > now ? firstDay : now;
  return (
    getOccurrences(reservation, from, new Date(from.getTime() + 8 * DAY))[0] ??
    null
  );
};

export const isReservationOver = (reservation: BoatReservation, now: Date) =>
  getNextOccurrence(reservation, now) === null;

export type BoatReservationState =
  | {
      state: "reserved";
      reservation: BoatReservation;
      occurrence: ReservationOccurrence;
    }
  | {
      state: "soon";
      reservation: BoatReservation;
      occurrence: ReservationOccurrence;
    };

/**
 * What the boathouse shows for a boat: reserved now, reserved soon (within
 * the lookahead), or nothing.
 */
export const getBoatReservationState = (
  reservations: BoatReservation[],
  boatId: string,
  now: Date,
  lookaheadMinutes = DEFAULT_RESERVATION_LOOKAHEAD_MINUTES
): BoatReservationState | null => {
  const upcoming = reservations
    .filter((reservation) => reservation.boatId === boatId)
    .flatMap((reservation) =>
      getOccurrences(
        reservation,
        now,
        new Date(now.getTime() + lookaheadMinutes * MINUTE + 1)
      ).map((occurrence) => ({ reservation, occurrence }))
    )
    .sort(
      (a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime()
    );
  const first = upcoming[0];
  if (!first) return null;
  return {
    state: first.occurrence.start <= now ? "reserved" : "soon",
    ...first,
  };
};

/**
 * Reservations of the boat that overlap an outing from `start` to `end`
 * (an outing without an estimated end counts as one hour).
 */
export const getReservationsOverlapping = (
  reservations: BoatReservation[],
  boatId: string,
  start: Date,
  end?: Date | null
) => {
  const until =
    end && end > start ? end : new Date(start.getTime() + 60 * MINUTE);
  return reservations
    .filter((reservation) => reservation.boatId === boatId)
    .flatMap((reservation) =>
      getOccurrences(reservation, start, until).map((occurrence) => ({
        reservation,
        occurrence,
      }))
    )
    .sort(
      (a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime()
    );
};

/** Whether `dayOfWeek` falls in the days both date ranges share. */
const rangesShareDay = (
  a: { from: string | null; to: string | null },
  b: { from: string | null; to: string | null },
  dayOfWeek: DayOfWeek | null
) => {
  const from = [a.from, b.from].filter(Boolean).sort().pop() ?? null;
  const to = [a.to, b.to].filter(Boolean).sort()[0] ?? null;
  if (from && to && from > to) return false;
  // Open on one side: the shared range holds every day of the week.
  if (!from || !to) return true;
  const [year, month, day] = from.split("-").map(Number);
  for (let i = 0; i < 7; i++) {
    const date = new Date(year, month - 1, day + i);
    if (toLocalDate(date) > to) return false;
    if (isoDayOfWeek(date) === dayOfWeek) return true;
  }
  return true;
};

/** Two reservations of the same boat that hold it at the same time. */
export const reservationsOverlap = (a: BoatReservation, b: BoatReservation) => {
  if (a.boatId !== b.boatId || a.id === b.id) return false;

  if (a.recurrence === "weekly" && b.recurrence === "weekly") {
    return (
      a.dayOfWeek === b.dayOfWeek &&
      a.startTime < b.endTime &&
      b.startTime < a.endTime &&
      rangesShareDay(
        { from: a.startDate, to: a.endDate },
        { from: b.startDate, to: b.endDate },
        a.dayOfWeek
      )
    );
  }

  const once = a.recurrence === "once" ? a : b;
  const other = once === a ? b : a;
  if (!once.startDate || !once.endDate) return false;
  // One occurrence is enough: a one-time reservation typed with a far-off
  // end date (9999) would otherwise expand every open-ended weekly one.
  return (
    getOccurrences(
      other,
      atLocal(once.startDate, once.startTime),
      atLocal(once.endDate, once.endTime),
      1
    ).length > 0
  );
};

export type ReservationError =
  | "MISSING_BOAT"
  | "MISSING_HOLDER"
  | "MISSING_DATES"
  | "MISSING_DAY"
  | "INVALID_TIME"
  | "END_BEFORE_START"
  | "NO_OCCURRENCE"
  | "OVERLAPS";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** The first problem of a reservation, checked against the others. */
export const validateReservation = (
  reservation: BoatReservation,
  others: BoatReservation[]
): { error: ReservationError; conflict?: BoatReservation } | null => {
  if (!reservation.boatId) return { error: "MISSING_BOAT" };
  if (!reservation.rowerId && !reservation.personName?.trim())
    return { error: "MISSING_HOLDER" };
  if (
    !TIME_REGEX.test(reservation.startTime) ||
    !TIME_REGEX.test(reservation.endTime)
  )
    return { error: "INVALID_TIME" };

  if (reservation.recurrence === "once") {
    if (
      !reservation.startDate ||
      !reservation.endDate ||
      !DATE_REGEX.test(reservation.startDate) ||
      !DATE_REGEX.test(reservation.endDate)
    )
      return { error: "MISSING_DATES" };
    if (
      `${reservation.endDate}T${reservation.endTime}` <=
      `${reservation.startDate}T${reservation.startTime}`
    )
      return { error: "END_BEFORE_START" };
  } else {
    if (!reservation.dayOfWeek) return { error: "MISSING_DAY" };
    if (reservation.endTime <= reservation.startTime)
      return { error: "END_BEFORE_START" };
    if (
      (reservation.startDate && !DATE_REGEX.test(reservation.startDate)) ||
      (reservation.endDate && !DATE_REGEX.test(reservation.endDate))
    )
      return { error: "MISSING_DATES" };
    if (reservation.startDate && reservation.endDate) {
      if (reservation.endDate < reservation.startDate)
        return { error: "END_BEFORE_START" };
      // A period too short to hold the chosen weekday would never show. The
      // weekday comes back within the first week of the period.
      const firstDay = atLocal(reservation.startDate, "00:00");
      const occurrences = getOccurrences(
        reservation,
        firstDay,
        addDays(firstDay, 7)
      );
      if (occurrences.length === 0) return { error: "NO_OCCURRENCE" };
    }
  }

  const conflict = others.find((other) =>
    reservationsOverlap(reservation, other)
  );
  if (conflict) return { error: "OVERLAPS", conflict };
  return null;
};

/** Upcoming first, then past ones, most recent first. */
export const sortReservations = (
  reservations: BoatReservation[],
  now: Date
) => {
  const withNext = reservations.map((reservation) => ({
    reservation,
    next: getNextOccurrence(reservation, now),
  }));
  const upcoming = withNext
    .filter((item) => item.next)
    .sort((a, b) => a.next!.start.getTime() - b.next!.start.getTime())
    .map((item) => item.reservation);
  const past = withNext
    .filter((item) => !item.next)
    .map((item) => item.reservation)
    .sort((a, b) =>
      `${b.endDate ?? ""}T${b.endTime}`.localeCompare(
        `${a.endDate ?? ""}T${a.endTime}`
      )
    );
  return { upcoming, past };
};
