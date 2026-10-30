// Today's outings, set by hand around "now" (Saturday 09:47 by default):
// two early crews already back, and the boats on the water that fill the
// boathouse screen, one in each class section. Times are relative to now,
// so another `now` keeps the same picture.
import { BoatClass, ClubStructure, FEATURED, GroupId, idFor } from "./club";
import { isClosedDay, PlannedOuting } from "./history";
import { monthOf } from "./calendar";

interface TodayPlan {
  key: string;
  group: GroupId;
  boatKey: string;
  cls: BoatClass;
  rowers: string[];
  cox?: string;
  /** Minutes before now. */
  startedAgo: number;
  /** Minutes after the start; null for "no estimate". */
  estimate: number | null;
  /** Back already: minutes after the start. */
  backAfter?: number;
  routeSlot: number | null;
  coached?: boolean;
  outingTypeCode?: string;
}

/** 07:30 and 07:45 at the default now (09:47). */
const BACK_ALREADY: TodayPlan[] = [
  {
    key: "early-single",
    group: "masters",
    boatKey: "1x.C3",
    cls: "1x",
    rowers: ["masters.M7"],
    startedAgo: 137,
    estimate: 75,
    backAfter: 80,
    routeSlot: 2,
  },
  {
    key: "early-double",
    group: "competition",
    boatKey: "2x.R2",
    cls: "2x",
    rowers: ["comp.F4", "comp.F5"],
    startedAgo: 122,
    estimate: 75,
    backAfter: 79,
    routeSlot: 3,
    coached: true,
  },
];

/** Started between 08:30 and 09:20 at the default now, in boathouse order. */
const ON_THE_WATER: TodayPlan[] = [
  {
    key: "stop-double",
    group: "masters",
    boatKey: FEATURED.stopBoat,
    cls: "2x",
    rowers: ["masters.M5", "masters.M6"],
    startedAgo: 62,
    estimate: 90,
    routeSlot: 2,
  },
  {
    key: "eight",
    group: "recreational",
    boatKey: "8+.E2",
    cls: "8+",
    rowers: [
      "rec.F9",
      "rec.M10",
      "rec.F10",
      "rec.M11",
      "rec.F11",
      "rec.M12",
      "rec.F12",
      "rec.M13",
    ],
    cox: "staff.coxF",
    startedAgo: 47,
    estimate: 105,
    routeSlot: 3,
  },
  {
    key: "junior-quad",
    group: "juniors",
    boatKey: "4x.Q4",
    cls: "4x",
    rowers: ["jun.J16F0", "jun.J16F1", "jun.J16F2", "jun.J16F3"],
    startedAgo: 32,
    estimate: 80,
    routeSlot: 1,
    coached: true,
  },
  // The coach follows the junior quad: same start, route and return.
  {
    key: "launch",
    group: "staff",
    boatKey: "other.L1",
    cls: "launch",
    rowers: ["staff.coachM"],
    startedAgo: 32,
    estimate: 80,
    routeSlot: 1,
    outingTypeCode: "motorboat",
  },
  {
    key: "racing-single",
    group: "competition",
    boatKey: "1x.R3",
    cls: "1x",
    rowers: ["comp.F6"],
    startedAgo: 77,
    estimate: 90,
    routeSlot: 4,
  },
  {
    key: "adaptive-four",
    group: "adaptive",
    boatKey: "4+.F1",
    cls: "4+",
    rowers: ["adaptive.F0", "adaptive.M0", "adaptive.F1", "adaptive.M1"],
    cox: "staff.coachF",
    startedAgo: 37,
    estimate: 90,
    routeSlot: 2,
  },
  {
    key: "club-single",
    group: "masters",
    boatKey: "1x.C1",
    cls: "1x",
    rowers: ["masters.F6"],
    startedAgo: 27,
    estimate: 60,
    routeSlot: 0,
  },
  {
    key: "pair",
    group: "competition",
    boatKey: "2-.S2",
    cls: "2-",
    rowers: ["comp.M4", "comp.M5"],
    startedAgo: 32,
    estimate: 90,
    routeSlot: 3,
  },
  {
    key: "rec-quad",
    group: "recreational",
    boatKey: "4x.Q5",
    cls: "4x",
    rowers: ["rec.F0", "rec.M0", "rec.F1", "rec.M1"],
    startedAgo: 67,
    estimate: 135,
    routeSlot: 4,
  },
];

export interface Today {
  outings: PlannedOuting[];
  /** Id of the featured double on the water. */
  stopOutingId: string;
  /** Id of the competition double that came back at 09:04 (the outing the editor corrects). */
  earlyDoubleId: string;
  earlyDoubleBoatKey: string;
}

const toOuting = (
  club: ClubStructure,
  plan: TodayPlan,
  day: string,
  nowMinutes: number
): PlannedOuting => {
  const boat = club.boatByKey.get(plan.boatKey);
  if (!boat) throw new Error(`Unknown boat ${plan.boatKey}`);
  const configuration = boat.configurations.find((c) => c.cls === plan.cls);
  if (!configuration)
    throw new Error(`${plan.boatKey} cannot be rowed as ${plan.cls}`);
  for (const key of [...plan.rowers, ...(plan.cox ? [plan.cox] : [])]) {
    if (!club.rowerByKey.has(key)) throw new Error(`Unknown rower ${key}`);
  }
  const start = nowMinutes - plan.startedAgo;
  const route = plan.routeSlot === null ? null : club.routes[plan.routeSlot];
  const end = plan.backAfter === undefined ? null : start + plan.backAfter;
  const key = `${day}@${plan.key}`;
  return {
    key,
    id: idFor("outing", key),
    group: plan.group,
    boatKey: plan.boatKey,
    cls: plan.cls,
    configurationId: configuration.id,
    routeSlot: plan.routeSlot,
    outingTypeCode: plan.outingTypeCode ?? null,
    day,
    startMinutes: start,
    endMinutes: end,
    estimatedEndMinutes: plan.estimate === null ? null : start + plan.estimate,
    // Distances and coaching are entered when the outing ends.
    distanceM: end === null ? null : (route?.distanceM ?? null),
    commentSlot: null,
    hasBeenCoached: end === null ? null : (plan.coached ?? false),
    crew: [
      ...plan.rowers.map((rowerKey) => ({ rowerKey, role: "rower" as const })),
      ...(plan.cox ? [{ rowerKey: plan.cox, role: "cox" as const }] : []),
    ],
  };
};

export const planToday = (
  club: ClubStructure,
  day: string,
  nowMinutes: number,
  which: "all" | "one" = "all"
): Today => {
  // "one": only the featured double stays out, so ending it brings every boat back.
  const afloat =
    which === "all"
      ? ON_THE_WATER
      : ON_THE_WATER.filter((plan) => plan.key === "stop-double");
  const outings = [...BACK_ALREADY, ...afloat].map((plan) =>
    toOuting(club, plan, day, nowMinutes)
  );

  // Nobody and no boat twice on the water, and the start dialog's quad and
  // crew must be free (the app would refuse the outing otherwise).
  const onWater = outings.filter((outing) => outing.endMinutes === null);
  const busyRowers = onWater.flatMap((outing) =>
    outing.crew.map((member) => member.rowerKey)
  );
  const busyBoats = onWater.map((outing) => outing.boatKey);
  if (new Set(busyRowers).size !== busyRowers.length)
    throw new Error("A rower is in two outings on the water");
  if (new Set(busyBoats).size !== busyBoats.length)
    throw new Error("A boat is in two outings on the water");
  for (const key of FEATURED.startCrew) {
    if (busyRowers.includes(key))
      throw new Error(`${key} must be free for the start dialog`);
  }
  if (busyBoats.includes(FEATURED.startBoat))
    throw new Error("The start dialog's quad is on the water");
  for (const boat of club.boats) {
    if (boat.level && busyBoats.includes(boat.key)) {
      throw new Error(
        `${boat.key} has a level pill: keep it in the available list`
      );
    }
    if (boat.maintenanceFrom && busyBoats.includes(boat.key)) {
      throw new Error(
        `${boat.key} is in maintenance and cannot be on the water`
      );
    }
  }

  const stop = outings.find((outing) => outing.key === `${day}@stop-double`);
  if (!stop) throw new Error("The featured double is missing");
  const early = outings.find((outing) => outing.key === `${day}@early-double`);
  if (!early) throw new Error("The early double is missing");
  return {
    outings,
    stopOutingId: stop.id,
    earlyDoubleId: early.id,
    earlyDoubleBoatKey: early.boatKey,
  };
};

/** Minutes after midnight between which crews go out, by month (daylight). */
const rowingHours = (day: string) => {
  const month = monthOf(day);
  if (month >= 4 && month <= 9) return { from: 7 * 60, to: 20 * 60 };
  if (month === 3 || month === 10) return { from: 7 * 60 + 30, to: 18 * 60 };
  return { from: 8 * 60 + 30, to: 16 * 60 + 30 };
};

/** The demo has no scene to correct the early double. */
const NO_EARLY_DOUBLE = { earlyDoubleId: "", earlyDoubleBoatKey: "" };

/**
 * Today's outings for any clock (the demo runs on the real time): the same
 * picture as `planToday`, laid out ending at "now" while the club is rowing.
 * Before the first crews could have started, on a closed day or at night,
 * nobody has been out yet; after the day's last hour every crew is back, none
 * of them past "now". No outing starts in the future or ends after now.
 */
export const planTodayAnyTime = (
  club: ClubStructure,
  day: string,
  nowMinutes: number
): Today => {
  const hours = rowingHours(day);
  if (isClosedDay(day) || nowMinutes < hours.from) {
    return { outings: [], stopOutingId: "", ...NO_EARLY_DOUBLE };
  }
  const anchor = Math.min(nowMinutes, hours.to);
  const outings = [...BACK_ALREADY, ...ON_THE_WATER]
    .map((plan) => toOuting(club, plan, day, anchor))
    .filter((outing) => outing.startMinutes >= hours.from)
    .map((outing) => {
      if (outing.endMinutes !== null || nowMinutes <= anchor) return outing;
      // Still out at the end of the day's hours: back before now.
      const planned = outing.estimatedEndMinutes ?? outing.startMinutes + 60;
      const endMinutes = Math.min(planned, nowMinutes - 3);
      const route =
        outing.routeSlot === null ? null : club.routes[outing.routeSlot];
      return {
        ...outing,
        endMinutes,
        distanceM: route?.distanceM ?? null,
        hasBeenCoached: outing.hasBeenCoached ?? false,
      };
    });
  return { outings, stopOutingId: "", ...NO_EARLY_DOUBLE };
};
