// Two seasons of outings for the fake club, without any text: who rowed
// what, when and where. Comments and incident messages are pack indexes.
import { canRowerUseBoat } from "../../_common/store/boatLevelConfig.rules";
import { AgeCategoryEnum } from "../../_common/business/ageCategory.rules";
import {
  addDays,
  eachDay,
  monthOf,
  seasonOf,
  toLocalDateTime,
  weekdayOf,
} from "./calendar";
import {
  BoatClass,
  BoatSpec,
  CLASS_SHAPES,
  ClubStructure,
  GroupId,
  HISTORY_START,
  RowerSpec,
  SEED,
  idFor,
} from "./club";
import { createRng, Rng } from "./prng";

export interface PlannedCrewMember {
  rowerKey: string;
  role: "rower" | "cox";
}

export interface PlannedOuting {
  key: string;
  id: string;
  group: GroupId;
  boatKey: string;
  cls: BoatClass;
  configurationId: string;
  routeSlot: number | null;
  outingTypeCode: string | null;
  day: string;
  /** Minutes after the day's midnight. */
  startMinutes: number;
  /** Null while on the water. */
  endMinutes: number | null;
  estimatedEndMinutes: number | null;
  distanceM: number | null;
  /** Index in LocaleContent.outingComments (or a scenario text, see ongoing.ts). */
  commentSlot: number | null;
  hasBeenCoached: boolean | null;
  crew: PlannedCrewMember[];
  /** Rower key of the captain (Captain module, demo only). */
  captainKey?: string;
}

export const outingStart = (outing: PlannedOuting) =>
  toLocalDateTime(outing.day, outing.startMinutes);
export const outingEnd = (outing: PlannedOuting) =>
  outing.endMinutes === null
    ? null
    : toLocalDateTime(outing.day, outing.endMinutes);
export const outingEstimatedEnd = (outing: PlannedOuting) =>
  outing.estimatedEndMinutes === null
    ? null
    : toLocalDateTime(outing.day, outing.estimatedEndMinutes);

/** Comments are drawn from the first COMMENT_SLOTS entries of every pack. */
export const COMMENT_SLOTS = 20;

// ----- The club's week -----

interface Slot {
  key: string;
  days: number[];
  /** Start window, minutes after midnight. */
  from: number;
  to: number;
  group: GroupId;
  /** Crews launched on an ordinary day at a multiplier of 1. */
  crews: number;
  classes?: Partial<Record<BoatClass, number>>;
  /** Weekday evening session, shortened by winter darkness. */
  evening?: boolean;
  members?: (rower: RowerSpec) => boolean;
  /** Long recreational row on Sundays from spring to early autumn. */
  tour?: boolean;
  /** A coach follows in the launch. */
  launch?: string;
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const SUN = 0,
  MON = 1,
  TUE = 2,
  WED = 3,
  THU = 4,
  FRI = 5,
  SAT = 6;

const isJ14 = (rower: RowerSpec) => rower.category === AgeCategoryEnum.J14;
const isJ16Plus = (rower: RowerSpec) =>
  rower.category === AgeCategoryEnum.J16 ||
  rower.category === AgeCategoryEnum.J18;

const SLOTS: Slot[] = [
  {
    key: "early",
    days: [MON, TUE, WED, THU, FRI],
    from: h(6, 50),
    to: h(7, 20),
    group: "masters",
    crews: 0.8,
    classes: { "1x": 0.75, "2x": 0.25 },
  },
  {
    key: "mon-comp",
    days: [MON],
    from: h(18),
    to: h(18, 30),
    group: "competition",
    crews: 3,
    evening: true,
  },
  {
    key: "mon-rec",
    days: [MON],
    from: h(18),
    to: h(18, 40),
    group: "recreational",
    crews: 1.4,
    evening: true,
    classes: { "1x": 0.25, "2x": 0.4, "4x": 0.35 },
  },
  {
    key: "tue-adaptive",
    days: [TUE],
    from: h(17, 45),
    to: h(18),
    group: "adaptive",
    crews: 0.8,
    evening: true,
  },
  {
    key: "tue-masters",
    days: [TUE],
    from: h(18),
    to: h(18, 30),
    group: "masters",
    crews: 2.2,
    evening: true,
  },
  {
    key: "tue-rec",
    days: [TUE],
    from: h(18, 15),
    to: h(18, 45),
    group: "recreational",
    crews: 1.6,
    evening: true,
    classes: { "2x": 0.3, "4x": 0.4, "4+": 0.3 },
  },
  {
    key: "wed-j14",
    days: [WED],
    from: h(14),
    to: h(14, 15),
    group: "juniors",
    crews: 1.6,
    members: isJ14,
    classes: { "1x": 0.3, "2x": 0.3, "4x": 0.2, "4+": 0.2 },
  },
  {
    key: "wed-j16",
    days: [WED],
    from: h(14, 30),
    to: h(14, 45),
    group: "juniors",
    crews: 3.4,
    members: isJ16Plus,
    classes: { "1x": 0.15, "2x": 0.25, "4x": 0.35, "8+": 0.25 },
    launch: "staff.coachM",
  },
  {
    key: "wed-comp",
    days: [WED],
    from: h(18),
    to: h(18, 30),
    group: "competition",
    crews: 3,
    evening: true,
  },
  {
    key: "wed-rec",
    days: [WED],
    from: h(18, 15),
    to: h(18, 45),
    group: "recreational",
    crews: 1,
    evening: true,
  },
  {
    key: "thu-comp",
    days: [THU],
    from: h(18),
    to: h(18, 30),
    group: "competition",
    crews: 3,
    evening: true,
  },
  {
    key: "thu-masters",
    days: [THU],
    from: h(18),
    to: h(18, 30),
    group: "masters",
    crews: 2.2,
    evening: true,
  },
  {
    key: "thu-rec",
    days: [THU],
    from: h(18, 15),
    to: h(18, 45),
    group: "recreational",
    crews: 1,
    evening: true,
  },
  {
    key: "fri-comp",
    days: [FRI],
    from: h(17, 45),
    to: h(18, 15),
    group: "competition",
    crews: 1.2,
    evening: true,
  },
  {
    key: "fri-rec",
    days: [FRI],
    from: h(18),
    to: h(18, 45),
    group: "recreational",
    crews: 1.5,
    evening: true,
  },
  {
    key: "sat-comp",
    days: [SAT],
    from: h(8),
    to: h(8, 30),
    group: "competition",
    crews: 3.2,
    launch: "staff.coachF",
  },
  {
    key: "sat-masters",
    days: [SAT],
    from: h(8, 30),
    to: h(9, 15),
    group: "masters",
    crews: 2,
  },
  {
    key: "sat-rec",
    days: [SAT],
    from: h(8, 45),
    to: h(9, 45),
    group: "recreational",
    crews: 6,
  },
  {
    key: "sat-j16",
    days: [SAT],
    from: h(9, 30),
    to: h(10),
    group: "juniors",
    crews: 3.5,
    members: isJ16Plus,
    launch: "staff.coachM",
  },
  {
    key: "sat-j14",
    days: [SAT],
    from: h(10),
    to: h(10, 15),
    group: "juniors",
    crews: 1.5,
    members: isJ14,
    classes: { "1x": 0.25, "2x": 0.3, "4x": 0.2, "4+": 0.25 },
  },
  {
    key: "sat-adaptive",
    days: [SAT],
    from: h(10),
    to: h(10, 30),
    group: "adaptive",
    crews: 1.5,
  },
  {
    key: "sat-pm-juniors",
    days: [SAT],
    from: h(14),
    to: h(14, 30),
    group: "juniors",
    crews: 1.5,
    members: isJ16Plus,
  },
  {
    key: "sun-comp",
    days: [SUN],
    from: h(8),
    to: h(8, 30),
    group: "competition",
    crews: 3,
  },
  {
    key: "sun-masters",
    days: [SUN],
    from: h(8, 30),
    to: h(9),
    group: "masters",
    crews: 3.8,
  },
  {
    key: "sun-rec",
    days: [SUN],
    from: h(9),
    to: h(10),
    group: "recreational",
    crews: 5,
  },
  {
    key: "sun-tour",
    days: [SUN],
    from: h(8, 30),
    to: h(9),
    group: "recreational",
    crews: 0.35,
    tour: true,
    classes: { "4x": 0.5, "4+": 0.5 },
  },
];

const CLASS_MIX: Record<GroupId, Partial<Record<BoatClass, number>>> = {
  competition: {
    "1x": 0.34,
    "2x": 0.14,
    "2-": 0.12,
    "4x": 0.18,
    "4-": 0.08,
    "8+": 0.14,
  },
  masters: { "1x": 0.32, "2x": 0.32, "4x": 0.3, "8+": 0.06 },
  recreational: { "1x": 0.12, "2x": 0.22, "4x": 0.28, "4+": 0.2, "8+": 0.18 },
  juniors: { "1x": 0.15, "2x": 0.25, "4x": 0.35, "4+": 0.1, "8+": 0.15 },
  adaptive: { "2x": 0.4, "4+": 0.6 },
  staff: {},
};

/** Route slots (4, 6, 8, 12, 16 km) by group. */
const ROUTE_WEIGHTS: Record<GroupId, number[]> = {
  competition: [0, 0.05, 0.15, 0.45, 0.35],
  masters: [0.05, 0.15, 0.4, 0.3, 0.1],
  recreational: [0.15, 0.3, 0.35, 0.17, 0.03],
  juniors: [0.1, 0.3, 0.35, 0.2, 0.05],
  adaptive: [0.5, 0.4, 0.1, 0, 0],
  staff: [1, 0, 0, 0, 0],
};
const J14_ROUTE_WEIGHTS = [0.45, 0.4, 0.15, 0, 0];

const COACHED: Record<GroupId, number> = {
  competition: 0.75,
  masters: 0.2,
  recreational: 0.08,
  juniors: 0.9,
  adaptive: 0.65,
  staff: 0,
};

/** Crews prefer one gender; this weighs a member of the other one. */
const MIXED_WEIGHT: Record<GroupId, number> = {
  competition: 0.05,
  masters: 0.3,
  recreational: 0.8,
  juniors: 0.1,
  adaptive: 1,
  staff: 1,
};

const SPEED_KMH: Record<BoatClass, number> = {
  "1x": 9,
  "2x": 9.6,
  "2-": 9.2,
  "4x": 10.2,
  "4-": 10,
  "4+": 8.6,
  "8+": 10.8,
  launch: 12,
};
const GROUP_PACE: Record<GroupId, number> = {
  competition: 1.12,
  masters: 1,
  recreational: 0.82,
  juniors: 0.9,
  adaptive: 0.7,
  staff: 1,
};

// ----- The club's year -----

/**
 * Crews by month. The stats curve aims at Aug .9, Sep 1.15, Oct 1, Nov .65,
 * Dec .5, Jan .7, Feb .8, Mar 1.1, Apr 1.25, May 1.3, Jun 1.25, Jul .6 of an
 * average month; these factors are corrected for the group, evening and
 * closure effects below so that the totals land there.
 */
const MONTH_FACTOR: Record<number, number> = {
  8: 1.08,
  9: 1.05,
  10: 0.99,
  11: 0.57,
  12: 0.62,
  1: 0.74,
  2: 0.96,
  3: 1.03,
  4: 1.2,
  5: 1.19,
  6: 1.23,
  7: 0.6,
};
/** Scales every slot to about 3000 outings a season. */
const CREW_SCALE = 1.28;
/** Weekday evenings in the dark: fewer crews, more on weekends. */
const EVENING_FACTOR: Record<number, number> = {
  10: 0.8,
  11: 0.45,
  12: 0.35,
  1: 0.4,
  2: 0.6,
  3: 0.85,
};
const WEEKEND_BOOST: Record<number, number> = {
  11: 1.25,
  12: 1.3,
  1: 1.3,
  2: 1.15,
};

const GROUP_MONTH_FACTOR: Partial<Record<GroupId, Record<number, number>>> = {
  juniors: { 7: 0.45, 8: 0.2, 4: 1.1, 5: 1.15, 6: 1.1 },
  competition: { 7: 0.75, 8: 0.55, 4: 1.1, 5: 1.1 },
  recreational: { 7: 1.15, 8: 1.15 },
  adaptive: { 8: 0.5 },
};

/** The current season grew by about 10 %. */
const SEASON_FACTOR: Record<number, number> = { 2024: 1, 2025: 1.14 };

/** School holidays (juniors row less). */
const SCHOOL_HOLIDAYS: [string, string][] = [
  ["2024-10-19", "2024-11-03"],
  ["2025-02-15", "2025-03-02"],
  ["2025-04-12", "2025-04-27"],
  ["2025-10-18", "2025-11-02"],
  ["2026-02-14", "2026-03-01"],
  ["2026-04-11", "2026-04-26"],
];

/** Closed: Christmas break and floods. */
const CLOSED: [string, string][] = [
  ["2024-12-24", "2025-01-01"],
  ["2025-01-27", "2025-01-31"],
  ["2025-12-24", "2026-01-01"],
  ["2026-02-11", "2026-02-15"],
];
/** Quiet days around Christmas. */
const QUIET: [string, string][] = [
  ["2024-12-21", "2024-12-23"],
  ["2025-01-02", "2025-01-04"],
  ["2025-12-20", "2025-12-23"],
  ["2026-01-02", "2026-01-04"],
];

// The calendar goes on after the studio's fixed clock (the demo runs on the
// real date): the same Christmas break and school holidays every year.
// The studio's history ends in June 2026, before the first of these.
for (let year = 2026; year <= 2040; year++) {
  CLOSED.push([`${year}-12-24`, `${year + 1}-01-01`]);
  QUIET.push([`${year}-12-20`, `${year}-12-23`]);
  QUIET.push([`${year + 1}-01-02`, `${year + 1}-01-04`]);
  SCHOOL_HOLIDAYS.push([`${year}-10-17`, `${year}-11-01`]);
  SCHOOL_HOLIDAYS.push([`${year + 1}-02-13`, `${year + 1}-02-28`]);
  SCHOOL_HOLIDAYS.push([`${year + 1}-04-10`, `${year + 1}-04-25`]);
}

const within = (day: string, ranges: [string, string][]) =>
  ranges.some(([from, to]) => from <= day && day <= to);

/** The club is closed this day (Christmas break, floods). */
export const isClosedDay = (day: string) => within(day, CLOSED);

// ----- Generation -----

type Busy = Map<string, [number, number][]>;

const isFree = (busy: Busy, key: string, from: number, to: number) =>
  !(busy.get(key) ?? []).some(([start, end]) => from < end && start < to);

const occupy = (busy: Busy, key: string, from: number, to: number) => {
  const list = busy.get(key) ?? [];
  list.push([from, to]);
  busy.set(key, list);
};

/** Gap kept between two outings of the same rower or boat. */
const ROWER_GAP = 20;
const BOAT_GAP = 10;

const toLevelRower = (rower: RowerSpec) => ({
  id: rower.id,
  name: rower.key,
  category: rower.category,
  type: rower.type,
});

export const canRow = (boat: BoatSpec, rower: RowerSpec) =>
  !boat.level ||
  canRowerUseBoat({ boatId: boat.id, ...boat.level }, toLevelRower(rower));

const hasClass = (boat: BoatSpec, cls: BoatClass) =>
  boat.configurations.some((configuration) => configuration.cls === cls);

const configurationOf = (boat: BoatSpec, cls: BoatClass) => {
  const configuration = boat.configurations.find((c) => c.cls === cls);
  if (!configuration) throw new Error(`${boat.key} cannot be rowed as ${cls}`);
  return configuration;
};

const isInService = (boat: BoatSpec, day: string) =>
  boat.maintenanceFrom === null || day < boat.maintenanceFrom;

const hasJoined = (rower: RowerSpec, day: string) =>
  rower.joinedOn === null || rower.joinedOn <= day;

const weightedPick = <T>(
  rng: Rng,
  items: T[],
  weight: (item: T) => number
): T | null => {
  const index = rng.weightedIndex(items.map(weight));
  return index < 0 ? null : items[index];
};

const stochasticRound = (rng: Rng, value: number) => {
  const whole = Math.floor(value);
  return whole + (rng.chance(value - whole) ? 1 : 0);
};

/** The estimate a rower picks in the start dialog (15-minute steps, up to 3 h). */
const estimateOf = (rng: Rng, duration: number) => {
  const guess = duration + rng.int(-12, 12);
  const step = Math.min(180, Math.max(45, Math.round(guess / 15) * 15));
  return step;
};

export interface History {
  outings: PlannedOuting[];
  /** Crews the schedule asked for; the others found no boat or rowers. */
  attempted: number;
}

interface Context {
  club: ClubStructure;
  rng: Rng;
  outings: PlannedOuting[];
  /** Outings already planned today, for unique keys. */
  dayIndex: number;
}

interface CrewRequest {
  day: string;
  slot: Slot;
  cls: BoatClass;
  start: number;
  rowerBusy: Busy;
  boatBusy: Busy;
}

const routeFor = (rng: Rng, slot: Slot, group: GroupId) => {
  if (slot.tour) return rng.chance(0.5) ? 4 : null;
  if (rng.chance(0.07)) return null;
  const weights =
    slot.members === isJ14 ? J14_ROUTE_WEIGHTS : ROUTE_WEIGHTS[group];
  return rng.weightedIndex(weights);
};

const durationFor = (
  rng: Rng,
  cls: BoatClass,
  group: GroupId,
  distanceM: number | null,
  tour: boolean
) => {
  if (tour) return rng.int(150, 235);
  if (distanceM === null) return rng.int(55, 100);
  const rowing = (distanceM / 1000 / (SPEED_KMH[cls] * GROUP_PACE[group])) * 60;
  const drills =
    group === "competition" || group === "juniors"
      ? rng.int(12, 28)
      : rng.int(4, 16);
  return Math.round(Math.min(118, Math.max(48, rowing + drills)));
};

const distanceFor = (
  rng: Rng,
  routeDistanceM: number | null,
  tour: boolean
) => {
  if (tour) return rng.int(18, 32) * 1000;
  if (routeDistanceM === null) return null;
  if (rng.chance(0.7)) return routeDistanceM;
  return Math.round((routeDistanceM * rng.float(0.9, 1.25)) / 100) * 100;
};

/** Members of the slot who can sit in this boat now, weighted later. */
const availableMembers = (
  ctx: Context,
  request: CrewRequest,
  boat: BoatSpec,
  end: number,
  taken: Set<string>
) =>
  ctx.club.rowers.filter(
    (rower) =>
      rower.group === request.slot.group &&
      (!request.slot.members || request.slot.members(rower)) &&
      hasJoined(rower, request.day) &&
      !taken.has(rower.key) &&
      isFree(
        request.rowerBusy,
        rower.key,
        request.start - ROWER_GAP,
        end + ROWER_GAP
      ) &&
      canRow(boat, rower)
  );

const pickMembers = (
  ctx: Context,
  request: CrewRequest,
  boat: BoatSpec,
  end: number,
  count: number,
  crew: RowerSpec[]
) => {
  const taken = new Set(crew.map((rower) => rower.key));
  while (crew.length < count) {
    const candidates = availableMembers(ctx, request, boat, end, taken);
    const first = crew[0];
    const pick = weightedPick(ctx.rng, candidates, (rower) => {
      let weight = rower.activity;
      if (first && rower.gender !== first.gender)
        weight *= MIXED_WEIGHT[request.slot.group];
      if (
        first &&
        first.group === "juniors" &&
        rower.category !== first.category
      )
        weight *= 0.5;
      return weight;
    });
    if (!pick) return false;
    crew.push(pick);
    taken.add(pick.key);
  }
  return true;
};

const pickCox = (
  ctx: Context,
  request: CrewRequest,
  end: number,
  crew: RowerSpec[]
) => {
  const weekday = weekdayOf(request.day);
  const taken = new Set(crew.map((rower) => rower.key));
  const candidates = ctx.club.coxes[request.slot.group].filter(
    (cox) =>
      (!cox.days || cox.days.includes(weekday)) &&
      !taken.has(cox.rowerKey) &&
      isFree(
        request.rowerBusy,
        cox.rowerKey,
        request.start - ROWER_GAP,
        end + ROWER_GAP
      )
  );
  const pick = weightedPick(ctx.rng, candidates, (cox) => cox.weight);
  return pick ? (ctx.club.rowerByKey.get(pick.rowerKey) ?? null) : null;
};

const freeBoats = (ctx: Context, request: CrewRequest, end: number) =>
  ctx.club.boats.filter(
    (boat) =>
      hasClass(boat, request.cls) &&
      boat.groups.includes(request.slot.group) &&
      isInService(boat, request.day) &&
      isFree(
        request.boatBusy,
        boat.key,
        request.start - BOAT_GAP,
        end + BOAT_GAP
      )
  );

/** Plans one crew; null when no boat or not enough rowers are free. */
const planCrew = (ctx: Context, request: CrewRequest): PlannedOuting | null => {
  const { rng, club } = ctx;
  const { slot, cls, day, start } = request;
  const group = slot.group;
  const shape = CLASS_SHAPES[cls];
  const seats = shape.seats ?? 1;

  const routeSlot = routeFor(rng, slot, group);
  const route = routeSlot === null ? null : club.routes[routeSlot];
  const distanceM = distanceFor(
    rng,
    route?.distanceM ?? null,
    Boolean(slot.tour)
  );
  const duration = durationFor(
    rng,
    cls,
    group,
    slot.tour ? null : distanceM,
    Boolean(slot.tour)
  );
  const end = start + duration;

  const boats = freeBoats(ctx, request, end);
  if (boats.length === 0) return null;

  let boat: BoatSpec | null = null;
  const crew: RowerSpec[] = [];

  // A regular crew, when it is free.
  const pods = rng.shuffle(
    club.pods.filter((pod) => pod.group === group && pod.classes.includes(cls))
  );
  for (const pod of pods) {
    if (!rng.chance(pod.use)) continue;
    const members = pod.members
      .filter((member) => rng.chance(member.presence))
      .map((member) => club.rowerByKey.get(member.rowerKey)!)
      .filter(
        (rower) =>
          (!slot.members || slot.members(rower)) &&
          hasJoined(rower, day) &&
          isFree(
            request.rowerBusy,
            rower.key,
            start - ROWER_GAP,
            end + ROWER_GAP
          )
      );
    if (members.length < Math.ceil(seats / 2)) continue;
    const podBoat = boats.find((b) => b.key === pod.boatKey);
    const boatChoice = podBoat && rng.chance(0.85) ? podBoat : rng.pick(boats);
    const eligible = members.filter((rower) => canRow(boatChoice, rower));
    if (eligible.length < Math.ceil(seats / 2)) continue;
    boat = boatChoice;
    crew.push(...eligible.slice(0, seats));
    break;
  }

  if (!boat && cls === "1x") {
    // A sculler first, then their usual single when it is free.
    const candidates = club.rowers.filter(
      (rower) =>
        rower.group === group &&
        (!slot.members || slot.members(rower)) &&
        hasJoined(rower, day) &&
        isFree(
          request.rowerBusy,
          rower.key,
          start - ROWER_GAP,
          end + ROWER_GAP
        ) &&
        boats.some((b) => canRow(b, rower))
    );
    const sculler = weightedPick(rng, candidates, (rower) => rower.activity);
    if (!sculler) return null;
    const usual = boats.find((b) => b.key === sculler.singleKey);
    boat =
      usual && rng.chance(0.8)
        ? usual
        : rng.pick(boats.filter((b) => canRow(b, sculler)));
    crew.push(sculler);
  }

  if (!boat) {
    boat = rng.pick(boats);
  }

  if (!pickMembers(ctx, request, boat, end, seats, crew)) return null;

  const members: PlannedCrewMember[] = crew.map((rower) => ({
    rowerKey: rower.key,
    role: "rower",
  }));
  if (shape.coxed) {
    const cox = pickCox(ctx, request, end, crew);
    if (!cox) return null;
    members.push({ rowerKey: cox.key, role: "cox" });
  }

  for (const member of members)
    occupy(request.rowerBusy, member.rowerKey, start, end);
  occupy(request.boatBusy, boat.key, start, end);

  const key = `${day}#${ctx.dayIndex++}`;
  return {
    key,
    id: idFor("outing", key),
    group,
    boatKey: boat.key,
    cls,
    configurationId: configurationOf(boat, cls).id,
    routeSlot,
    outingTypeCode: slot.tour ? "tour" : null,
    day,
    startMinutes: start,
    endMinutes: end,
    estimatedEndMinutes: rng.chance(slot.tour ? 0.5 : 0.85)
      ? start + estimateOf(rng, duration)
      : null,
    distanceM,
    commentSlot: rng.chance(slot.tour ? 0.6 : 0.15)
      ? rng.int(0, COMMENT_SLOTS - 1)
      : null,
    hasBeenCoached: slot.tour ? false : rng.chance(COACHED[group]),
    crew: members,
  };
};

const planLaunch = (
  ctx: Context,
  day: string,
  coachKey: string,
  crews: PlannedOuting[],
  rowerBusy: Busy,
  boatBusy: Busy
): PlannedOuting | null => {
  const launch = ctx.club.boats.find((boat) => hasClass(boat, "launch"));
  if (!launch || crews.length < 2) return null;
  const start =
    Math.min(...crews.map((crew) => crew.startMinutes)) - ctx.rng.int(0, 6);
  const end =
    Math.max(...crews.map((crew) => crew.endMinutes ?? crew.startMinutes)) +
    ctx.rng.int(0, 8);
  if (!isFree(rowerBusy, coachKey, start - ROWER_GAP, end + ROWER_GAP))
    return null;
  if (!isFree(boatBusy, launch.key, start - BOAT_GAP, end + BOAT_GAP))
    return null;
  occupy(rowerBusy, coachKey, start, end);
  occupy(boatBusy, launch.key, start, end);
  const key = `${day}#${ctx.dayIndex++}`;
  return {
    key,
    id: idFor("outing", key),
    group: "staff",
    boatKey: launch.key,
    cls: "launch",
    configurationId: configurationOf(launch, "launch").id,
    routeSlot: null,
    outingTypeCode: "motorboat",
    day,
    startMinutes: start,
    endMinutes: end,
    estimatedEndMinutes: null,
    distanceM: null,
    commentSlot: null,
    hasBeenCoached: false,
    crew: [{ rowerKey: coachKey, role: "rower" }],
  };
};

/** How many crews a slot launches on that day, before the weather. */
const expectedCrews = (slot: Slot, day: string) => {
  const month = monthOf(day);
  const weekday = weekdayOf(day);
  let expected =
    slot.crews *
    CREW_SCALE *
    MONTH_FACTOR[month] *
    (SEASON_FACTOR[seasonOf(day)] ?? 1.14);
  expected *= GROUP_MONTH_FACTOR[slot.group]?.[month] ?? 1;
  if (slot.evening) expected *= EVENING_FACTOR[month] ?? 1;
  if (weekday === SAT || weekday === SUN) expected *= WEEKEND_BOOST[month] ?? 1;
  if (slot.group === "juniors" && within(day, SCHOOL_HOLIDAYS))
    expected *= 0.55;
  if (slot.tour && (month < 4 || month > 9)) expected = 0;
  if (within(day, QUIET)) expected *= 0.4;
  return expected;
};

/**
 * Every finished outing from HISTORY_START to the day before `untilDay`
 * (today's outings are planned by ongoing.ts).
 */
export const planHistory = (
  club: ClubStructure,
  untilDay: string,
  { from = HISTORY_START }: { from?: string } = {}
): History => {
  const rng = createRng(`${SEED}:history`);
  const ctx: Context = { club, rng, outings: [], dayIndex: 0 };
  let attempted = 0;
  const lastDay = addDays(untilDay, -1);

  for (const day of eachDay(from, lastDay)) {
    ctx.dayIndex = 0;
    // Drawn every day, closed or not, so that a change of calendar does
    // not reshuffle the rest of the history.
    const weatherDraw = rng.next();
    const weatherScale = rng.float(0.88, 1.12);
    if (within(day, CLOSED)) continue;
    const weather =
      weatherDraw < 0.03 ? 0 : weatherDraw < 0.12 ? 0.45 : weatherScale;
    const weekday = weekdayOf(day);
    const rowerBusy: Busy = new Map();
    const boatBusy: Busy = new Map();

    const slots = SLOTS.filter((slot) => slot.days.includes(weekday)).sort(
      (a, b) => a.from - b.from
    );
    for (const slot of slots) {
      const count = stochasticRound(rng, expectedCrews(slot, day) * weather);
      const crews: PlannedOuting[] = [];
      const mix = slot.classes ?? CLASS_MIX[slot.group];
      const classes = Object.keys(mix) as BoatClass[];
      attempted += count;
      for (let i = 0; i < count; i++) {
        const cls = classes[rng.weightedIndex(classes.map((c) => mix[c] ?? 0))];
        const start = slot.from + rng.int(0, slot.to - slot.from);
        const outing = planCrew(ctx, {
          day,
          slot,
          cls,
          start,
          rowerBusy,
          boatBusy,
        });
        if (outing) crews.push(outing);
      }
      if (slot.launch && rng.chance(0.6)) {
        const launch = planLaunch(
          ctx,
          day,
          slot.launch,
          crews,
          rowerBusy,
          boatBusy
        );
        if (launch) crews.push(launch);
      }
      ctx.outings.push(...crews);
    }
  }

  ctx.outings.sort((a, b) =>
    a.day === b.day ? a.startMinutes - b.startMinutes : a.day < b.day ? -1 : 1
  );
  return { outings: ctx.outings, attempted };
};

/**
 * Keeps a rower's rowing outings between `from` and `to` (days, included)
 * at `max`: a free clubmate of the same group takes their seat in the
 * others. Makes the featured rower's numbers independent of the noise.
 */
export const capRowerOutings = (
  club: ClubStructure,
  outings: PlannedOuting[],
  rowerKey: string,
  { from, to, max }: { from: string; to: string; max: number }
) => {
  const rng = createRng(`${SEED}:cap:${rowerKey}`);
  const rower = club.rowerByKey.get(rowerKey);
  if (!rower) throw new Error(`Unknown rower ${rowerKey}`);
  const theirs = outings.filter(
    (outing) =>
      outing.day >= from &&
      outing.day <= to &&
      outing.crew.some(
        (member) => member.rowerKey === rowerKey && member.role === "rower"
      )
  );
  const byDay = new Map<string, PlannedOuting[]>();
  for (const outing of outings) {
    if (outing.day < from || outing.day > to) continue;
    byDay.set(outing.day, [...(byDay.get(outing.day) ?? []), outing]);
  }

  let excess = theirs.length - max;
  for (const outing of rng.shuffle(theirs)) {
    if (excess <= 0) break;
    const boat = club.boatByKey.get(outing.boatKey)!;
    const end = outing.endMinutes ?? outing.startMinutes;
    const sameDay = byDay.get(outing.day) ?? [];
    const isBusy = (key: string) =>
      sameDay.some(
        (other) =>
          other.crew.some((member) => member.rowerKey === key) &&
          outing.startMinutes - ROWER_GAP <
            (other.endMinutes ?? other.startMinutes) &&
          other.startMinutes < end + ROWER_GAP
      );
    const candidates = club.rowers.filter(
      (other) =>
        other.group === rower.group &&
        other.gender === rower.gender &&
        other.key !== rowerKey &&
        hasJoined(other, outing.day) &&
        canRow(boat, other) &&
        !isBusy(other.key)
    );
    const substitute = weightedPick(rng, candidates, (other) => other.activity);
    if (!substitute) continue;
    outing.crew = outing.crew.map((member) =>
      member.rowerKey === rowerKey
        ? { ...member, rowerKey: substitute.key }
        : member
    );
    excess--;
  }
};

/**
 * Has a few rowers cox other crews now and then: each takes the cox seat
 * of exactly `count` finished outings of `groups` between `from` and `to`
 * (days, included), when free. Crews with a `keep` rower keep their cox, so
 * that rower's figures (and partners) do not move.
 */
export const lendCoxes = (
  outings: PlannedOuting[],
  quotas: Record<string, number>,
  {
    from,
    to,
    groups,
    keep,
  }: { from: string; to: string; groups: GroupId[]; keep: string[] }
) => {
  const rng = createRng(`${SEED}:lent-coxes`);
  const lenders = new Set(Object.keys(quotas));
  const byDay = new Map<string, PlannedOuting[]>();
  for (const outing of outings) {
    if (outing.day < from || outing.day > to) continue;
    byDay.set(outing.day, [...(byDay.get(outing.day) ?? []), outing]);
  }

  for (const [rowerKey, count] of Object.entries(quotas)) {
    const isBusy = (outing: PlannedOuting) =>
      (byDay.get(outing.day) ?? []).some(
        (other) =>
          other.crew.some((member) => member.rowerKey === rowerKey) &&
          outing.startMinutes - ROWER_GAP <
            (other.endMinutes ?? other.startMinutes) &&
          other.startMinutes <
            (outing.endMinutes ?? outing.startMinutes) + ROWER_GAP
      );
    const candidates = outings.filter(
      (outing) =>
        outing.day >= from &&
        outing.day <= to &&
        outing.endMinutes !== null &&
        groups.includes(outing.group) &&
        outing.crew.some(
          (member) => member.role === "cox" && !lenders.has(member.rowerKey)
        ) &&
        !outing.crew.some((member) => keep.includes(member.rowerKey))
    );
    let left = count;
    for (const outing of rng.shuffle(candidates)) {
      if (left === 0) break;
      if (isBusy(outing)) continue;
      outing.crew = outing.crew.map((member) =>
        member.role === "cox" ? { ...member, rowerKey } : member
      );
      left--;
    }
    if (left > 0)
      throw new Error(
        `${rowerKey} could only cox ${count - left} of ${count} outings`
      );
  }
};
