// The demo club's calendar: the studio's fictional club (see seed/), laid
// out around the real "now" instead of the studio's fixed clock, and
// enriched so that every optional module has something to show. Everything
// random here draws from its own generator, so the club the studio seeds
// never depends on it.
import { AgeCategoryEnum } from "../_common/business/ageCategory.rules";
import {
  addDays,
  eachDay,
  parseLocalDateTime,
  seasonOf,
  weekdayOf,
  yearOf,
} from "./seed/calendar";
import { buildClubStructure, SEED } from "./seed/club";
import { planHistory, type PlannedOuting } from "./seed/history";
import { planIncidents } from "./seed/incidents";
import { planTodayAnyTime } from "./seed/ongoing";
import { createRng } from "./seed/prng";
import type { SeedPlan } from "./seed/seedClub";

/** The day the club structure's absolute dates (birth years, maintenance) are written for. */
export const REFERENCE_DAY = "2026-06-20";
/** Days before today the two boats in maintenance went out of service. */
const MAINTENANCE_DAYS_AGO: Record<string, number> = {
  "1x.B6": 12,
  "2x.C6": 21,
};
/** Guests: how many outings each of the pack's visiting rowers took part in. */
const GUEST_OUTINGS = [4, 1, 2, 1, 3];
/** The Captain module has been on for about five months. */
const CAPTAIN_DAYS = 150;

// Not "guest.N": the statistics profile (seed/analyticsHistory.ts) names its
// own guests that way.
export const GUEST_KEYS = GUEST_OUTINGS.map((_, index) => `visitor.${index}`);
export const isGuestKey = (key: string) =>
  key.startsWith("visitor.") || key.startsWith("guest.");

const withYearShift = (date: string, years: number) =>
  `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

/** The third Saturday of a month (and the Sunday after): regatta weekends. */
const regattaWeekend = (year: number, month: number) => {
  let day = `${year}-${String(month).padStart(2, "0")}-01`;
  while (weekdayOf(day) !== 6) day = addDays(day, 1);
  const saturday = addDays(day, 14);
  return [saturday, addDays(saturday, 1)];
};

const daysOf = (from: string, to: string) => new Set(eachDay(from, to));

const typeOutings = (
  outings: PlannedOuting[],
  regattaDays: Set<string>,
  campDays: Set<string>
) => {
  const rng = createRng(`${SEED}:demo:types`);
  for (const outing of outings) {
    if (outing.outingTypeCode === "motorboat") continue;
    if (outing.group === "competition" && regattaDays.has(outing.day)) {
      outing.outingTypeCode = "regatta";
    } else if (
      (outing.group === "competition" || outing.group === "juniors") &&
      campDays.has(outing.day)
    ) {
      outing.outingTypeCode = "training_camp";
    } else if (outing.outingTypeCode === "tour") {
      if (rng.chance(0.25)) outing.outingTypeCode = "club_trip";
    } else if (outing.group === "competition") {
      outing.outingTypeCode = "training";
    } else if (
      outing.hasBeenCoached &&
      (outing.group === "juniors" ||
        outing.group === "adaptive" ||
        rng.chance(0.5))
    ) {
      outing.outingTypeCode = "instruction";
    } else {
      outing.outingTypeCode = "normal";
    }
  }
};

/** Visiting rowers take a seat in a few recent recreational and masters crews. */
const seatGuests = (outings: PlannedOuting[], today: string) => {
  const rng = createRng(`${SEED}:demo:guests`);
  const candidates = outings.filter(
    (outing) =>
      (outing.group === "recreational" || outing.group === "masters") &&
      outing.endMinutes !== null &&
      outing.day >= addDays(today, -100) &&
      outing.crew.filter((member) => member.role === "rower").length >= 2
  );
  const taken = new Set<string>();
  GUEST_OUTINGS.forEach((count, guest) => {
    const days = new Set<string>();
    for (let n = 0; n < count; n++) {
      const free = candidates.filter(
        (outing) => !taken.has(outing.id) && !days.has(outing.day)
      );
      if (free.length === 0) return;
      const outing = rng.pick(free);
      taken.add(outing.id);
      days.add(outing.day);
      const seat = outing.crew.map((m) => m.role).lastIndexOf("rower");
      outing.crew[seat] = { ...outing.crew[seat], rowerKey: GUEST_KEYS[guest] };
    }
  });
};

export const planDemoClub = (now: string): SeedPlan => {
  const { day, minutes } = parseLocalDateTime(now);
  const club = buildClubStructure();

  // Ages and dates follow the real year: a junior stays a junior.
  const shift = yearOf(day) - yearOf(REFERENCE_DAY);
  for (const rower of club.rowers) {
    rower.birthDate = withYearShift(rower.birthDate, shift);
    if (rower.joinedOn) rower.joinedOn = `${seasonOf(day)}-09-13`;
  }
  for (const boat of club.boats) {
    const ago = MAINTENANCE_DAYS_AGO[boat.key];
    if (boat.maintenanceFrom !== null && ago !== undefined) {
      boat.maintenanceFrom = addDays(day, -ago);
    }
  }

  // The season before and the current one.
  const from = `${seasonOf(day) - 1}-08-01`;
  const { outings } = planHistory(club, day, { from });
  const today = planTodayAnyTime(club, day, minutes);
  const incidents = planIncidents(club, outings, day, {
    historyStart: from,
    statsBoatDays: [addDays(day, -120), addDays(day, -300)],
  });

  const all = [...outings, ...today.outings];
  const regattaDays = new Set<string>();
  const campDays = new Set<string>();
  for (let year = yearOf(from); year <= yearOf(day); year++) {
    for (const month of [3, 5, 6, 10]) {
      for (const d of regattaWeekend(year, month)) regattaDays.add(d);
    }
    for (const d of daysOf(`${year}-02-15`, `${year}-02-21`)) campDays.add(d);
    for (const d of daysOf(`${year}-08-25`, `${year}-08-31`)) campDays.add(d);
  }
  typeOutings(all, regattaDays, campDays);
  return {
    club,
    outings: all,
    stopOutingId: "",
    earlyDoubleId: "",
    earlyDoubleBoatKey: "",
    incidents,
  };
};

/**
 * What depends on the final crews, after the statistics profile moved
 * members around: the visiting rowers take their seats (all of them are
 * seen in the crews that stay), then captains are chosen: the cox of an
 * adults' crew, else its oldest adult, never a guest.
 */
export const finishDemoPlan = (plan: SeedPlan, now: string) => {
  const { club, outings: all } = plan;
  const { day } = parseLocalDateTime(now);
  seatGuests(all, day);
  const rng = createRng(`${SEED}:demo:captains`);
  for (const outing of all) {
    if (outing.group === "staff" || outing.crew.length < 2) continue;
    if (outing.day < addDays(day, -CAPTAIN_DAYS)) continue;
    const adults = outing.crew
      .filter((member) => !isGuestKey(member.rowerKey))
      .map((member) => ({
        member,
        spec: club.rowerByKey.get(member.rowerKey)!,
      }))
      .filter(({ spec }) => spec.category === AgeCategoryEnum.SENIOR);
    const cox = adults.find(({ member }) => member.role === "cox");
    const oldest = [...adults].sort((a, b) =>
      a.spec.birthDate.localeCompare(b.spec.birthDate)
    )[0];
    const captain = cox ?? oldest;
    if (captain && rng.chance(0.9)) {
      outing.captainKey = captain.member.rowerKey;
    }
  }
};
