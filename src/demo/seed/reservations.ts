// The boat reservations of the Reservations module scenes, relative to "now" like today's outings:
// one weekly slot running at 09:47, a masters crew about to start, a junior slot, a two-day regatta…
// Written with the Logbook's own saveReservation, checked with its own rules.
import {
  getBoatReservationState,
  getReservationsOverlapping,
  sortReservations,
  validateReservation,
  type BoatReservation,
  type DayOfWeek,
} from "../../_common/business/reservation.rules";
import { saveReservation } from "../../_common/database/repositories/reservation.repository";
import type { SqlClient } from "../../_common/database/sqlClient";
import { addDays, toLocalDateTime, weekdayOf } from "./calendar";
import { ClubStructure, idFor } from "./club";
import type { LocaleContent } from "./content/types";
import type { ReservationScenario } from "./scenario";

/** Boats of the reservations (keys of the club structure). */
export const RESERVED = {
  /** Weekly slot running now: the boathouse badge reads "reserved until 11:00". */
  nowBoat: "2x.C4",
  /** Masters crew starting in a few minutes: the badge reads "reserved at 10:00", the start dialog warns. */
  soonBoat: "2x.C1",
  /** Rower holding the masters slot (member of that double's regular crew). */
  soonHolder: "masters.M0",
  /** The reservation dialog's boat: a quad of the juniors with no reservation yet. */
  formBoat: "4x.Q4",
} as const;

interface PlannedReservation {
  key: string;
  boatKey: string;
  holder:
    | { rowerKey: string }
    | { name: keyof LocaleContent["reservations"]["holders"] };
  reason: keyof LocaleContent["reservations"]["reasons"];
  contact?: boolean;
  /** Days from today for a one-time reservation; for a weekly one, the day of its weekday. */
  when:
    | { once: { from: number; to: number; start: string; end: string } }
    | {
        weekly: {
          dayOffset: number;
          start: string;
          end: string;
          period?: [number, number];
        };
      };
}

const hhmm = (minutes: number) =>
  toLocalDateTime("2000-01-01", minutes).slice(11);

const isoDayOf = (day: string) =>
  (weekdayOf(day) === 0 ? 7 : weekdayOf(day)) as DayOfWeek;

/** The reservations, with the two weekly slots tied to the minute of "now". */
const plan = (nowMinutes: number): PlannedReservation[] => {
  // Running since 09:00 at 09:47; the masters start at the next half hour after 5 minutes (10:00).
  const initiationStart = Math.floor((nowMinutes - 45) / 30) * 30;
  const mastersStart = Math.ceil((nowMinutes + 5) / 30) * 30;
  if (mastersStart + 90 >= 1440)
    throw new Error("The reservations need a start time earlier than 22:00");
  return [
    {
      key: "initiation",
      boatKey: RESERVED.nowBoat,
      holder: { name: "initiation" },
      reason: "initiation",
      when: {
        weekly: {
          dayOffset: 0,
          start: hhmm(initiationStart),
          end: hhmm(initiationStart + 120),
        },
      },
    },
    {
      key: "masters",
      boatKey: RESERVED.soonBoat,
      holder: { rowerKey: RESERVED.soonHolder },
      reason: "masters",
      when: {
        weekly: {
          dayOffset: 0,
          start: hhmm(mastersStart),
          end: hhmm(mastersStart + 90),
        },
      },
    },
    {
      key: "juniors",
      boatKey: "4+.F2",
      holder: { name: "juniors" },
      reason: "juniors",
      // Wednesday evenings until the start of July.
      when: {
        weekly: {
          dayOffset: 4,
          start: "17:30",
          end: "19:00",
          period: [-73, 11],
        },
      },
    },
    {
      key: "competition",
      boatKey: "2-.S1",
      holder: { rowerKey: "comp.M4" },
      reason: "competition",
      when: { weekly: { dayOffset: 5, start: "07:00", end: "08:30" } },
    },
    {
      key: "regatta",
      boatKey: "8+.E1",
      holder: { name: "regatta" },
      reason: "regatta",
      contact: true,
      // Next weekend, from the early morning to the evening after.
      when: { once: { from: 7, to: 8, start: "06:30", end: "19:00" } },
    },
    {
      key: "past-regatta",
      boatKey: "8+.E1",
      holder: { name: "regatta" },
      reason: "regatta",
      contact: true,
      when: { once: { from: -14, to: -13, start: "06:30", end: "19:00" } },
    },
    {
      key: "past-juniors",
      boatKey: "4+.F3",
      holder: { name: "juniors" },
      reason: "juniors",
      // The winter term, over.
      when: {
        weekly: {
          dayOffset: 4,
          start: "17:30",
          end: "19:00",
          period: [-220, -24],
        },
      },
    },
    {
      key: "past-initiation",
      boatKey: "2x.C5",
      holder: { name: "initiation" },
      reason: "initiation",
      when: { once: { from: -35, to: -35, start: "09:00", end: "12:00" } },
    },
  ];
};

/** Writes the reservations and says which ones the scenes open. */
export const seedReservations = async (
  db: SqlClient,
  {
    club,
    content,
    day,
    minutes,
    rowerNames,
    boatNames,
  }: {
    club: ClubStructure;
    content: LocaleContent;
    /** Today, "YYYY-MM-DD". */
    day: string;
    minutes: number;
    rowerNames: (key: string) => string;
    boatNames: (key: string) => string;
  }
): Promise<ReservationScenario> => {
  const texts = content.reservations;
  const written: BoatReservation[] = [];

  for (const item of plan(minutes)) {
    const boat = club.boatByKey.get(item.boatKey);
    if (!boat)
      throw new Error(
        `Unknown boat ${item.boatKey} in reservation ${item.key}`
      );
    const rower =
      "rowerKey" in item.holder
        ? club.rowerByKey.get(item.holder.rowerKey)
        : undefined;
    if ("rowerKey" in item.holder && !rower)
      throw new Error(`Unknown rower ${item.holder.rowerKey}`);

    const base = {
      id: idFor("reservation", item.key),
      boatId: boat.id,
      rowerId: rower?.id ?? null,
      personName:
        "name" in item.holder ? texts.holders[item.holder.name] : null,
      reason: texts.reasons[item.reason],
      contact: item.contact ? texts.regattaContact : null,
    };
    const reservation: BoatReservation =
      "once" in item.when
        ? {
            ...base,
            recurrence: "once",
            startDate: addDays(day, item.when.once.from),
            endDate: addDays(day, item.when.once.to),
            dayOfWeek: null,
            startTime: item.when.once.start,
            endTime: item.when.once.end,
          }
        : {
            ...base,
            recurrence: "weekly",
            startDate: item.when.weekly.period
              ? addDays(day, item.when.weekly.period[0])
              : null,
            endDate: item.when.weekly.period
              ? addDays(day, item.when.weekly.period[1])
              : null,
            dayOfWeek: isoDayOf(addDays(day, item.when.weekly.dayOffset)),
            startTime: item.when.weekly.start,
            endTime: item.when.weekly.end,
          };

    const problem = validateReservation(reservation, written);
    if (problem)
      throw new Error(`Reservation ${item.key} is invalid: ${problem.error}`);
    await saveReservation(db, reservation);
    written.push(reservation);
  }

  // The scenes' promises, checked against the Logbook's own rules.
  const now = new Date(...nowParts(day, minutes));
  const nowBoat = club.boatByKey.get(RESERVED.nowBoat)!;
  const soonBoat = club.boatByKey.get(RESERVED.soonBoat)!;
  const formBoat = club.boatByKey.get(RESERVED.formBoat)!;
  if (getBoatReservationState(written, nowBoat.id, now)?.state !== "reserved") {
    throw new Error(`${RESERVED.nowBoat} must be reserved now`);
  }
  if (getBoatReservationState(written, soonBoat.id, now)?.state !== "soon") {
    throw new Error(`${RESERVED.soonBoat} must be reserved soon`);
  }
  if (written.some((reservation) => reservation.boatId === formBoat.id)) {
    throw new Error(`${RESERVED.formBoat} must have no reservation`);
  }
  // A 90 minute outing on the soon boat, as the start dialog's scene estimates it.
  const outingEnd = new Date(now.getTime() + 90 * 60_000);
  if (
    getReservationsOverlapping(written, soonBoat.id, now, outingEnd).length ===
    0
  ) {
    throw new Error(
      `An outing now on ${RESERVED.soonBoat} must overlap its reservation`
    );
  }
  const { upcoming, past } = sortReservations(written, now);

  // The reservation dialog: the Tuesdays of the autumn term.
  const periodStart = nextWeekday(addDays(day, 80), 2);
  return {
    form: {
      boatId: formBoat.id,
      boatName: boatNames(RESERVED.formBoat),
      dayOfWeek: 2,
      startTime: "17:30",
      endTime: "19:00",
      periodStart,
      periodEnd: addDays(periodStart, 14 * 7),
      holder: texts.holders.juniors,
      reason: texts.reasons.juniors,
    },
    badges: {
      now: { boatId: nowBoat.id, boatName: boatNames(RESERVED.nowBoat) },
      soon: { boatId: soonBoat.id, boatName: boatNames(RESERVED.soonBoat) },
    },
    notice: {
      boatId: soonBoat.id,
      boatName: boatNames(RESERVED.soonBoat),
      holder: rowerNames(RESERVED.soonHolder),
      seats: 2,
    },
    counts: { upcoming: upcoming.length, past: past.length },
  };
};

/** The first day on or after `from` that is this ISO weekday (1 = Monday). */
const nextWeekday = (from: string, isoDay: number) => {
  let day = from;
  while (isoDayOf(day) !== isoDay) day = addDays(day, 1);
  return day;
};

/** Local calendar arguments for `new Date(year, month, day, hours, minutes)`. */
const nowParts = (
  day: string,
  minutes: number
): [number, number, number, number, number] => {
  const [year, month, date] = day.split("-").map(Number);
  return [year, month - 1, date, Math.floor(minutes / 60), minutes % 60];
};
