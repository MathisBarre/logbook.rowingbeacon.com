import { describe, expect, it } from "vitest";
import {
  BoatReservation,
  DayOfWeek,
  getBoatReservationState,
  getNextOccurrence,
  getOccurrences,
  getReservationsOverlapping,
  isReservationOver,
  reservationsOverlap,
  sortReservations,
  toLocalDate,
  toLocalTime,
  validateReservation,
} from "./reservation.rules";

// 2026-10-26 is a Monday. In Europe, summer time ends on Sunday 2026-10-25.
const at = (day: number, hours = 0, minutes = 0, month = 10) =>
  new Date(2026, month - 1, day, hours, minutes);

const once = (overrides: Partial<BoatReservation> = {}): BoatReservation => ({
  id: "once",
  boatId: "b1",
  recurrence: "once",
  startDate: "2026-10-26",
  endDate: "2026-10-26",
  dayOfWeek: null,
  startTime: "18:00",
  endTime: "20:00",
  rowerId: null,
  personName: "Club J18",
  reason: null,
  contact: null,
  ...overrides,
});

const weekly = (
  dayOfWeek: DayOfWeek,
  overrides: Partial<BoatReservation> = {}
): BoatReservation => ({
  id: "weekly",
  boatId: "b1",
  recurrence: "weekly",
  startDate: null,
  endDate: null,
  dayOfWeek,
  startTime: "18:00",
  endTime: "20:00",
  rowerId: null,
  personName: "Section compétition",
  reason: null,
  contact: null,
  ...overrides,
});

describe("Reservation business rules", () => {
  describe("local date and time helpers", () => {
    it("formats a date and a time with leading zeros", () => {
      expect(toLocalDate(at(5, 7, 4, 3))).toBe("2026-03-05");
      expect(toLocalTime(at(5, 7, 4, 3))).toBe("07:04");
    });
  });

  describe("getOccurrences", () => {
    it("ignores an inverted slot, which only an import can make", () => {
      expect(
        getOccurrences(
          weekly(1, { startTime: "10:00", endTime: "09:00" }),
          at(19),
          at(30)
        )
      ).toEqual([]);
      expect(
        getOccurrences(
          once({ startTime: "20:00", endTime: "18:00" }),
          at(19),
          at(30)
        )
      ).toEqual([]);
    });

    it("scans a far-off weekly period a week at a time", () => {
      const reservation = weekly(1, {
        startDate: "2026-11-01",
        endDate: "9999-12-31",
      });
      const started = performance.now();
      expect(validateReservation(reservation, [])).toBeNull();
      expect(
        getOccurrences(reservation, at(1, 0, 0, 11), at(17, 0, 0, 11))
      ).toEqual([
        { start: at(2, 18, 0, 11), end: at(2, 20, 0, 11) },
        { start: at(9, 18, 0, 11), end: at(9, 20, 0, 11) },
        { start: at(16, 18, 0, 11), end: at(16, 20, 0, 11) },
      ]);
      expect(performance.now() - started).toBeLessThan(500);
    });

    it("returns the single occurrence of a one-time reservation", () => {
      expect(getOccurrences(once(), at(26), at(27))).toEqual([
        { start: at(26, 18), end: at(26, 20) },
      ]);
    });

    it("handles a one-time reservation spanning several days", () => {
      const reservation = once({
        startDate: "2026-10-24",
        endDate: "2026-10-26",
        startTime: "18:00",
        endTime: "08:00",
      });
      expect(getOccurrences(reservation, at(25, 12), at(25, 13))).toEqual([
        { start: at(24, 18), end: at(26, 8) },
      ]);
      expect(getOccurrences(reservation, at(26, 8), at(27))).toEqual([]);
      expect(getOccurrences(reservation, at(20), at(24, 18))).toEqual([]);
    });

    it("returns nothing for a one-time reservation without dates", () => {
      expect(getOccurrences(once({ startDate: null }), at(1), at(30))).toEqual(
        []
      );
      expect(getOccurrences(once({ endDate: null }), at(1), at(30))).toEqual(
        []
      );
    });

    it("only includes one-time reservations that overlap the window", () => {
      expect(getOccurrences(once(), at(26, 20), at(26, 21))).toEqual([]);
      expect(getOccurrences(once(), at(26, 16), at(26, 18))).toEqual([]);
      expect(getOccurrences(once(), at(26, 19), at(26, 19, 1))).toHaveLength(1);
    });

    it("returns a weekly reservation on its day of week, oldest first", () => {
      const occurrences = getOccurrences(weekly(1), at(19), at(10, 0, 0, 11));
      expect(occurrences).toEqual([
        { start: at(19, 18), end: at(19, 20) },
        { start: at(26, 18), end: at(26, 20) },
        { start: at(2, 18, 0, 11), end: at(2, 20, 0, 11) },
        { start: at(9, 18, 0, 11), end: at(9, 20, 0, 11) },
      ]);
    });

    it("maps Sunday to day 7", () => {
      expect(getOccurrences(weekly(7), at(24), at(27))).toEqual([
        { start: at(25, 18), end: at(25, 20) },
      ]);
    });

    it("ignores days of week that do not match", () => {
      expect(getOccurrences(weekly(2), at(26), at(27))).toEqual([]);
    });

    it("returns nothing for a weekly reservation without a day", () => {
      expect(
        getOccurrences(weekly(1, { dayOfWeek: null }), at(1), at(30))
      ).toEqual([]);
    });

    it("finds a weekly slot still running at `from`", () => {
      const occurrences = getOccurrences(weekly(1), at(26, 19), at(26, 19, 30));
      expect(occurrences).toEqual([{ start: at(26, 18), end: at(26, 20) }]);
    });

    it("does not return a weekly slot that ended before `from`", () => {
      expect(getOccurrences(weekly(1), at(26, 20), at(26, 23))).toEqual([]);
    });

    it("honours the start date of a weekly reservation", () => {
      const reservation = weekly(1, { startDate: "2026-11-02" });
      expect(
        getOccurrences(reservation, at(19), at(10, 0, 0, 11)).map((o) =>
          toLocalDate(o.start)
        )
      ).toEqual(["2026-11-02", "2026-11-09"]);
    });

    it("honours the end date of a weekly reservation, inclusively", () => {
      const reservation = weekly(1, { endDate: "2026-10-26" });
      expect(
        getOccurrences(reservation, at(12), at(10, 0, 0, 11)).map((o) =>
          toLocalDate(o.start)
        )
      ).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    });

    it("honours both bounds of a weekly reservation", () => {
      const reservation = weekly(1, {
        startDate: "2026-10-19",
        endDate: "2026-10-26",
      });
      expect(
        getOccurrences(reservation, at(1), at(1, 0, 0, 12)).map((o) =>
          toLocalDate(o.start)
        )
      ).toEqual(["2026-10-19", "2026-10-26"]);
    });

    it("keeps wall-clock times across the end of summer time", () => {
      // Sunday 2026-10-25 has 25 hours in Europe/Paris.
      const sunday = getOccurrences(
        weekly(7, { startTime: "08:00", endTime: "10:00" }),
        at(18),
        at(1, 0, 0, 11)
      );
      expect(
        sunday.map((o) => [toLocalDate(o.start), toLocalTime(o.start)])
      ).toEqual([
        ["2026-10-18", "08:00"],
        ["2026-10-25", "08:00"],
      ]);
      const monday = getOccurrences(weekly(1), at(25, 12), at(28));
      expect(monday).toEqual([{ start: at(26, 18), end: at(26, 20) }]);
      // A one-time reservation over the change keeps its wall-clock bounds.
      const overnight = once({
        startDate: "2026-10-24",
        endDate: "2026-10-26",
        startTime: "22:00",
        endTime: "06:00",
      });
      expect(getOccurrences(overnight, at(25, 12), at(25, 13))).toEqual([
        { start: at(24, 22), end: at(26, 6) },
      ]);
    });
  });

  describe("getNextOccurrence and isReservationOver", () => {
    it("returns the running occurrence of a one-time reservation", () => {
      expect(getNextOccurrence(once(), at(26, 19))).toEqual({
        start: at(26, 18),
        end: at(26, 20),
      });
      expect(isReservationOver(once(), at(26, 19))).toBe(false);
    });

    it("returns the upcoming occurrence of a one-time reservation", () => {
      expect(getNextOccurrence(once(), at(20))?.start).toEqual(at(26, 18));
    });

    it("is over once the end time has passed", () => {
      expect(getNextOccurrence(once(), at(26, 20))).toBeNull();
      expect(isReservationOver(once(), at(26, 20))).toBe(true);
      expect(isReservationOver(once(), at(27))).toBe(true);
    });

    it("returns the next week for a weekly reservation", () => {
      expect(getNextOccurrence(weekly(1), at(26, 20, 1))?.start).toEqual(
        at(2, 18, 0, 11)
      );
      expect(getNextOccurrence(weekly(3), at(26, 20, 1))?.start).toEqual(
        at(28, 18)
      );
    });

    it("returns the running weekly slot", () => {
      expect(getNextOccurrence(weekly(1), at(26, 18))?.start).toEqual(
        at(26, 18)
      );
    });

    it("never ends for a weekly reservation without end date", () => {
      expect(isReservationOver(weekly(4), at(27))).toBe(false);
      expect(isReservationOver(weekly(4), new Date(2030, 5, 1))).toBe(false);
    });

    it("is over when the end date of a weekly reservation has passed", () => {
      const reservation = weekly(1, { endDate: "2026-10-26" });
      expect(isReservationOver(reservation, at(26, 19))).toBe(false);
      expect(isReservationOver(reservation, at(26, 20))).toBe(true);
      expect(isReservationOver(reservation, at(30))).toBe(true);
    });

    it("is not over while a weekly reservation has not started", () => {
      // Further than a week away: the rule has not started, it is not past.
      const reservation = weekly(1, { startDate: "2027-01-04" });
      expect(getNextOccurrence(reservation, at(26))?.start).toEqual(
        new Date(2027, 0, 4, 18)
      );
      expect(isReservationOver(reservation, at(26))).toBe(false);
      const { upcoming, past } = sortReservations([reservation], at(26));
      expect(upcoming).toEqual([reservation]);
      expect(past).toEqual([]);
    });
  });

  describe("getBoatReservationState", () => {
    const reservations = [once(), once({ id: "other", boatId: "b2" })];

    it("is reserved while the reservation runs", () => {
      const state = getBoatReservationState(reservations, "b1", at(26, 18));
      expect(state?.state).toBe("reserved");
      expect(state?.reservation.id).toBe("once");
      expect(state?.occurrence.end).toEqual(at(26, 20));
      expect(
        getBoatReservationState(reservations, "b1", at(26, 19, 59))?.state
      ).toBe("reserved");
    });

    it("is soon within the lookahead", () => {
      expect(
        getBoatReservationState(reservations, "b1", at(26, 17))?.state
      ).toBe("soon");
      expect(
        getBoatReservationState(reservations, "b1", at(26, 17, 30))?.state
      ).toBe("soon");
    });

    it("is null beyond the lookahead", () => {
      expect(
        getBoatReservationState(reservations, "b1", at(26, 16, 59))
      ).toBeNull();
    });

    it("uses the lookahead it is given", () => {
      expect(
        getBoatReservationState(reservations, "b1", at(26, 16), 120)?.state
      ).toBe("soon");
      expect(
        getBoatReservationState(reservations, "b1", at(26, 17), 30)
      ).toBeNull();
    });

    it("is null once the reservation is over", () => {
      expect(
        getBoatReservationState(reservations, "b1", at(26, 20))
      ).toBeNull();
    });

    it("ignores the reservations of other boats", () => {
      expect(
        getBoatReservationState([once({ boatId: "b2" })], "b1", at(26, 18))
      ).toBeNull();
      expect(getBoatReservationState([], "b1", at(26, 18))).toBeNull();
    });

    it("prefers the reservation running over a later one", () => {
      const state = getBoatReservationState(
        [
          once({ id: "later", startTime: "20:00", endTime: "21:00" }),
          once({ id: "now", startTime: "19:30", endTime: "20:00" }),
        ],
        "b1",
        at(26, 19, 45)
      );
      expect(state?.reservation.id).toBe("now");
      expect(state?.state).toBe("reserved");
    });

    it("works with weekly reservations", () => {
      expect(
        getBoatReservationState([weekly(1)], "b1", at(26, 17, 30))?.state
      ).toBe("soon");
      expect(
        getBoatReservationState([weekly(1)], "b1", at(27, 17, 30))
      ).toBeNull();
    });
  });

  describe("getReservationsOverlapping", () => {
    const reservations = [
      once({ id: "evening" }),
      once({ id: "morning", startTime: "08:00", endTime: "10:00" }),
      once({ id: "elsewhere", boatId: "b2" }),
    ];

    it("finds the reservations that overlap an outing", () => {
      const found = getReservationsOverlapping(
        reservations,
        "b1",
        at(26, 9),
        at(26, 19)
      );
      expect(found.map((item) => item.reservation.id)).toEqual([
        "morning",
        "evening",
      ]);
      expect(found[0].occurrence).toEqual({
        start: at(26, 8),
        end: at(26, 10),
      });
    });

    it("ignores the other boats and the outings that do not overlap", () => {
      expect(
        getReservationsOverlapping(reservations, "b1", at(26, 10), at(26, 18))
      ).toEqual([]);
      expect(
        getReservationsOverlapping(reservations, "b2", at(26, 8), at(26, 9))
      ).toEqual([]);
    });

    it("counts an outing without end as one hour", () => {
      expect(
        getReservationsOverlapping(reservations, "b1", at(26, 17, 30)).map(
          (item) => item.reservation.id
        )
      ).toEqual(["evening"]);
      expect(
        getReservationsOverlapping(reservations, "b1", at(26, 17, 30), null)
      ).toHaveLength(1);
      expect(
        getReservationsOverlapping(reservations, "b1", at(26, 16, 59))
      ).toEqual([]);
      expect(
        getReservationsOverlapping(reservations, "b1", at(26, 17))
      ).toEqual([]);
    });

    it("counts an outing ending before it starts as one hour", () => {
      expect(
        getReservationsOverlapping(
          reservations,
          "b1",
          at(26, 17, 30),
          at(26, 17)
        )
      ).toHaveLength(1);
    });

    it("includes the weekly reservations", () => {
      const found = getReservationsOverlapping(
        [weekly(1)],
        "b1",
        at(26, 19),
        at(26, 21)
      );
      expect(found).toHaveLength(1);
      expect(found[0].occurrence.start).toEqual(at(26, 18));
    });
  });

  describe("reservationsOverlap", () => {
    it("checks a one-time reservation with a far-off end date quickly", () => {
      const started = performance.now();
      expect(
        reservationsOverlap(
          once({ id: "a", endDate: "9999-12-31" }),
          weekly(3, { id: "b" })
        )
      ).toBe(true);
      expect(performance.now() - started).toBeLessThan(100);
    });

    it("detects two weekly reservations on the same day and overlapping times", () => {
      expect(
        reservationsOverlap(
          weekly(1, { id: "a" }),
          weekly(1, { id: "b", startTime: "19:00", endTime: "21:00" })
        )
      ).toBe(true);
    });

    it("does not overlap weekly reservations on different days", () => {
      expect(
        reservationsOverlap(weekly(1, { id: "a" }), weekly(2, { id: "b" }))
      ).toBe(false);
    });

    it("does not overlap touching slots", () => {
      expect(
        reservationsOverlap(
          weekly(1, { id: "a" }),
          weekly(1, { id: "b", startTime: "20:00", endTime: "21:00" })
        )
      ).toBe(false);
      expect(
        reservationsOverlap(
          once({ id: "a" }),
          once({ id: "b", startTime: "20:00", endTime: "21:00" })
        )
      ).toBe(false);
      expect(
        reservationsOverlap(
          once({ id: "a" }),
          weekly(1, { id: "b", startTime: "20:00", endTime: "21:00" })
        )
      ).toBe(false);
    });

    it("does not overlap weekly reservations with disjoint date ranges", () => {
      expect(
        reservationsOverlap(
          weekly(1, { id: "a", endDate: "2026-10-31" }),
          weekly(1, { id: "b", startDate: "2026-11-01" })
        )
      ).toBe(false);
    });

    it("overlaps weekly reservations whose date ranges touch or are open", () => {
      expect(
        reservationsOverlap(
          weekly(1, { id: "a", endDate: "2026-10-26" }),
          weekly(1, { id: "b", startDate: "2026-10-26" })
        )
      ).toBe(true);
      expect(
        reservationsOverlap(
          weekly(1, { id: "a" }),
          weekly(1, {
            id: "b",
            startDate: "2027-01-01",
            endDate: "2027-02-01",
          })
        )
      ).toBe(true);
    });

    it("does not overlap weekly reservations whose shared dates miss their weekday", () => {
      // 2026-11-02 is a Monday: A ends on the Tuesday after, B starts then.
      expect(
        reservationsOverlap(
          weekly(1, { id: "a", endDate: "2026-11-03" }),
          weekly(1, { id: "b", startDate: "2026-11-03" })
        )
      ).toBe(false);
      expect(
        reservationsOverlap(
          weekly(1, { id: "a", endDate: "2026-11-03" }),
          weekly(1, { id: "b", startDate: "2026-11-02" })
        )
      ).toBe(true);
      expect(
        reservationsOverlap(
          weekly(1, {
            id: "a",
            startDate: "2026-11-03",
            endDate: "2026-11-09",
          }),
          weekly(1, { id: "b", startDate: "2026-11-04" })
        )
      ).toBe(true);
    });

    it("detects a one-time reservation on a weekly one", () => {
      const rule = weekly(1, { id: "a" });
      expect(reservationsOverlap(once({ id: "b" }), rule)).toBe(true);
      expect(reservationsOverlap(rule, once({ id: "b" }))).toBe(true);
    });

    it("does not overlap a one-time reservation on another weekday", () => {
      expect(
        reservationsOverlap(once({ id: "b" }), weekly(2, { id: "a" }))
      ).toBe(false);
    });

    it("does not overlap a one-time reservation outside the weekly bounds", () => {
      expect(
        reservationsOverlap(
          once({ id: "b" }),
          weekly(1, { id: "a", endDate: "2026-10-19" })
        )
      ).toBe(false);
      expect(
        reservationsOverlap(
          once({ id: "b" }),
          weekly(1, { id: "a", startDate: "2026-11-02" })
        )
      ).toBe(false);
    });

    it("detects a multi-day one-time reservation on a weekly one", () => {
      expect(
        reservationsOverlap(
          once({
            id: "b",
            startDate: "2026-10-24",
            endDate: "2026-10-28",
            startTime: "09:00",
            endTime: "09:00",
          }),
          weekly(1, { id: "a" })
        )
      ).toBe(true);
    });

    it("detects two overlapping one-time reservations", () => {
      expect(
        reservationsOverlap(
          once({ id: "a" }),
          once({ id: "b", startTime: "19:00", endTime: "22:00" })
        )
      ).toBe(true);
      expect(
        reservationsOverlap(
          once({ id: "a" }),
          once({ id: "b", startDate: "2026-10-27", endDate: "2026-10-27" })
        )
      ).toBe(false);
    });

    it("detects a multi-day reservation covering another one", () => {
      expect(
        reservationsOverlap(
          once({
            id: "a",
            startDate: "2026-10-24",
            endDate: "2026-10-28",
            startTime: "08:00",
            endTime: "08:00",
          }),
          once({ id: "b", startTime: "06:00", endTime: "07:00" })
        )
      ).toBe(true);
    });

    it("does not overlap a reservation with itself", () => {
      expect(reservationsOverlap(once(), once())).toBe(false);
      expect(reservationsOverlap(weekly(1), weekly(1))).toBe(false);
    });

    it("does not overlap reservations of different boats", () => {
      expect(
        reservationsOverlap(once({ id: "a" }), once({ id: "b", boatId: "b2" }))
      ).toBe(false);
    });

    it("ignores a one-time reservation without dates", () => {
      expect(
        reservationsOverlap(
          once({ id: "a", startDate: null }),
          weekly(1, { id: "b" })
        )
      ).toBe(false);
    });
  });

  describe("validateReservation", () => {
    it("accepts a valid one-time and a valid weekly reservation", () => {
      expect(validateReservation(once(), [])).toBeNull();
      expect(validateReservation(weekly(3), [])).toBeNull();
      expect(
        validateReservation(once({ personName: null, rowerId: "r1" }), [])
      ).toBeNull();
    });

    it("requires a boat", () => {
      expect(validateReservation(once({ boatId: "" }), [])).toEqual({
        error: "MISSING_BOAT",
      });
    });

    it("requires a holder", () => {
      expect(validateReservation(once({ personName: null }), [])).toEqual({
        error: "MISSING_HOLDER",
      });
      expect(validateReservation(once({ personName: "   " }), [])).toEqual({
        error: "MISSING_HOLDER",
      });
    });

    it("requires valid times", () => {
      for (const startTime of ["", "8:00", "24:00", "12:60", "ab:cd"]) {
        expect(validateReservation(once({ startTime }), [])).toEqual({
          error: "INVALID_TIME",
        });
      }
      expect(validateReservation(weekly(1, { endTime: "25:00" }), [])).toEqual({
        error: "INVALID_TIME",
      });
    });

    it("requires the dates of a one-time reservation", () => {
      expect(validateReservation(once({ startDate: null }), [])).toEqual({
        error: "MISSING_DATES",
      });
      expect(validateReservation(once({ endDate: null }), [])).toEqual({
        error: "MISSING_DATES",
      });
      expect(validateReservation(once({ endDate: "26/10/2026" }), [])).toEqual({
        error: "MISSING_DATES",
      });
    });

    it("requires the day of a weekly reservation", () => {
      expect(validateReservation(weekly(1, { dayOfWeek: null }), [])).toEqual({
        error: "MISSING_DAY",
      });
    });

    it("rejects a one-time reservation ending before it starts", () => {
      expect(
        validateReservation(once({ startTime: "20:00", endTime: "18:00" }), [])
      ).toEqual({ error: "END_BEFORE_START" });
      expect(
        validateReservation(once({ startTime: "18:00", endTime: "18:00" }), [])
      ).toEqual({ error: "END_BEFORE_START" });
      expect(validateReservation(once({ endDate: "2026-10-25" }), [])).toEqual({
        error: "END_BEFORE_START",
      });
    });

    it("accepts a one-time reservation ending earlier in the day on a later date", () => {
      expect(
        validateReservation(
          once({ endDate: "2026-10-27", startTime: "18:00", endTime: "08:00" }),
          []
        )
      ).toBeNull();
    });

    it("rejects a weekly slot ending before it starts", () => {
      expect(
        validateReservation(
          weekly(1, { startTime: "20:00", endTime: "18:00" }),
          []
        )
      ).toEqual({ error: "END_BEFORE_START" });
      expect(
        validateReservation(
          weekly(1, { startTime: "18:00", endTime: "18:00" }),
          []
        )
      ).toEqual({ error: "END_BEFORE_START" });
    });

    it("rejects a weekly reservation whose end date precedes its start date", () => {
      expect(
        validateReservation(
          weekly(1, { startDate: "2026-11-02", endDate: "2026-10-26" }),
          []
        )
      ).toEqual({ error: "END_BEFORE_START" });
    });

    it("rejects a malformed start or end date of a weekly reservation", () => {
      expect(
        validateReservation(weekly(1, { startDate: "26/10/2026" }), [])
      ).toEqual({ error: "MISSING_DATES" });
      expect(
        validateReservation(weekly(1, { endDate: "2026-10" }), [])
      ).toEqual({ error: "MISSING_DATES" });
    });

    it("rejects a weekly period holding no occurrence of its weekday", () => {
      // Monday 2026-10-26 to Wednesday 2026-10-28 has no Friday.
      expect(
        validateReservation(
          weekly(5, { startDate: "2026-10-26", endDate: "2026-10-28" }),
          []
        )
      ).toEqual({ error: "NO_OCCURRENCE" });
    });

    it("accepts a weekly period holding its weekday, ends included", () => {
      expect(
        validateReservation(
          weekly(1, { startDate: "2026-10-26", endDate: "2026-10-26" }),
          []
        )
      ).toBeNull();
      expect(
        validateReservation(
          weekly(3, { startDate: "2026-10-26", endDate: "2026-10-28" }),
          []
        )
      ).toBeNull();
      expect(
        validateReservation(weekly(5, { startDate: "2026-10-26" }), [])
      ).toBeNull();
    });

    it("reports the conflicting reservation", () => {
      const conflict = weekly(1, { id: "other" });
      expect(validateReservation(once(), [conflict])).toEqual({
        error: "OVERLAPS",
        conflict,
      });
    });

    it("does not conflict with itself or with other boats", () => {
      expect(validateReservation(once(), [once()])).toBeNull();
      expect(
        validateReservation(once(), [weekly(1, { id: "x", boatId: "b2" })])
      ).toBeNull();
    });

    it("reports the first problem before looking at conflicts", () => {
      expect(
        validateReservation(once({ personName: "" }), [weekly(1, { id: "x" })])
      ).toEqual({ error: "MISSING_HOLDER" });
    });
  });

  describe("sortReservations", () => {
    it("puts upcoming reservations first, soonest first, then the past ones, latest first", () => {
      const now = at(26, 19);
      const running = once({ id: "running" });
      const tomorrow = once({
        id: "tomorrow",
        startDate: "2026-10-27",
        endDate: "2026-10-27",
      });
      const weeklyWednesday = weekly(3, { id: "wednesday" });
      const lastWeek = once({
        id: "last-week",
        startDate: "2026-10-19",
        endDate: "2026-10-19",
      });
      const longAgo = once({
        id: "long-ago",
        startDate: "2026-09-01",
        endDate: "2026-09-01",
      });
      const endedWeekly = weekly(1, { id: "ended", endDate: "2026-10-12" });

      const { upcoming, past } = sortReservations(
        [longAgo, tomorrow, endedWeekly, weeklyWednesday, lastWeek, running],
        now
      );
      expect(upcoming.map((r) => r.id)).toEqual([
        "running",
        "tomorrow",
        "wednesday",
      ]);
      expect(past.map((r) => r.id)).toEqual(["last-week", "ended", "long-ago"]);
    });

    it("handles an empty list", () => {
      expect(sortReservations([], at(26))).toEqual({ upcoming: [], past: [] });
    });
  });
});
