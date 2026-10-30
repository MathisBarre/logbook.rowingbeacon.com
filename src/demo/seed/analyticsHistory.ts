// The opt-in `analytics` seed profile, structure only (no text): what the
// club needs on top of the landing club so that every report of
// Statistiques has something to say. Applied to the landing plan only when
// a scene asks for it, so the landing images never change.
//
// - A third season (2023-24), copied from 2024-25 one year earlier and a
//   little smaller, so that retention, survival and season-on-season
//   reports have a past.
// - Turnover: members who joined in autumn 2024 take over from former
//   members (archived since), a few regulars stopped coming this season
//   (inactive members), two of this season's newcomers gave up early.
// - Guests in recreational crews, outing types (training, regattas, a
//   training camp, instruction for beginners, club trips).
import { AgeCategoryEnum } from "../../_common/business/ageCategory.rules";
import { SeriousnessCategoryEnum } from "../../_common/business/seriousness.rules";
import { addDays, monthOf, seasonOf, weekdayOf } from "./calendar";
import {
  BoatClass,
  BoatSpec,
  ClubStructure,
  GroupId,
  RowerSpec,
  SEED,
  idFor,
} from "./club";
import { canRow, PlannedOuting } from "./history";
import { createRng, Rng } from "./prng";

/** A person the landing club does not have: former member or guest. */
export interface ExtraRower {
  spec: RowerSpec;
  status: "member" | "guest";
  /** Occasional members leave no birth date (member profile coverage). */
  birthDateKnown: boolean;
  /** ISO time of the archiving (former members), null otherwise. */
  archivedAt: string | null;
}

/** An old boat kept in the boathouse and rarely taken out ("Bateaux peu ou pas utilisés"). */
export interface ExtraBoat {
  spec: BoatSpec;
  /** Builder code painted on the hull, the same in every language (the fleet names fill LocaleContent.boatNames). */
  name: string;
  buildYear: number;
}

export interface AnalyticsHistory {
  /** Former members and guests, in a stable order (named apart, see analytics.ts). */
  extraRowers: ExtraRower[];
  extraBoats: ExtraBoat[];
  /** Regular members who stopped coming this season, with their last outing day. */
  stoppedRowers: { rowerKey: string; lastDay: string }[];
  /** First day of the oldest season on record. */
  historyStart: string;
}

/** The copied season starts one year (52 weeks, same weekdays) before the landing history. */
const SHIFT_DAYS = -364;
/** The club was smaller then. */
const EARLIER_SEASON_KEEP = 0.9;
const ROWER_GAP = 20;

const JOINERS = 16;
/** Former members still rowing the first weeks of last season, before their successor came. */
const OVERLAPPING_FORMER_MEMBERS = 2;
/** Stopped during last season / during this one. */
const REGULARS_WHO_STOPPED_LAST_SEASON = 3;
const REGULARS_WHO_STOPPED = 3;
const JOINERS_WHO_STOPPED = 2;
const NEWCOMERS_WHO_STOPPED = 2;
const GUESTS = 20;
/** Members who come a few times a season (rower frequency, coverage). */
const OCCASIONAL_MEMBERS = 10;

const { SENIOR } = AgeCategoryEnum;
const { RECREATIONAL } = SeriousnessCategoryEnum;

const pad = (value: number) => String(value).padStart(2, "0");

const hasRower = (outing: PlannedOuting, rowerKey: string) =>
  outing.crew.some((member) => member.rowerKey === rowerKey);

const overlaps = (a: PlannedOuting, b: PlannedOuting) => {
  const aEnd = a.endMinutes ?? a.startMinutes;
  const bEnd = b.endMinutes ?? b.startMinutes;
  return a.startMinutes - ROWER_GAP < bEnd && b.startMinutes < aEnd + ROWER_GAP;
};

const indexByDay = (outings: PlannedOuting[]) => {
  const byDay = new Map<string, PlannedOuting[]>();
  for (const outing of outings) {
    const list = byDay.get(outing.day);
    if (list) list.push(outing);
    else byDay.set(outing.day, [outing]);
  }
  return byDay;
};

/** True when `rowerKey` rows another outing of that day at the same time. */
const isBusy = (
  byDay: Map<string, PlannedOuting[]>,
  outing: PlannedOuting,
  rowerKey: string
) =>
  (byDay.get(outing.day) ?? []).some(
    (other) =>
      other !== outing && hasRower(other, rowerKey) && overlaps(outing, other)
  );

const replaceMember = (outing: PlannedOuting, from: string, to: string) => {
  outing.crew = outing.crew.map((member) =>
    member.rowerKey === from ? { ...member, rowerKey: to } : member
  );
};

/** Keys whose figures or scenes the landing club relies on: never moved. */
const protectedKeys = (
  club: ClubStructure,
  outings: PlannedOuting[],
  today: string,
  keep: string[]
) => {
  const keys = new Set<string>(keep);
  for (const rower of club.rowers) {
    if (rower.group === "staff" || rower.joinedOn !== null) keys.add(rower.key);
  }
  for (const list of Object.values(club.coxes)) {
    for (const cox of list) keys.add(cox.rowerKey);
  }
  for (const outing of outings) {
    if (outing.day >= today)
      for (const member of outing.crew) keys.add(member.rowerKey);
  }
  return keys;
};

const birthDateNear = (rng: Rng, birthDate: string, years: number) =>
  `${Number(birthDate.slice(0, 4)) - years}-${pad(rng.int(1, 12))}-${pad(rng.int(1, 28))}`;

const formerMemberOf = (
  rng: Rng,
  joiner: RowerSpec,
  index: number
): RowerSpec => {
  const key = `alumni.${index}`;
  return {
    ...joiner,
    key,
    id: idFor("rower", key),
    // Same group, category and level: they rowed the boats the joiner rows now.
    birthDate: birthDateNear(
      rng,
      joiner.birthDate,
      joiner.group === "juniors" ? 1 : rng.int(-6, 6)
    ),
    joinedOn: null,
    firstNameSlot: -1,
    lastNameSlot: -1,
  };
};

const occasionalSpec = (rng: Rng, index: number): RowerSpec => ({
  ...guestSpec(rng, index),
  key: `occasional.${index}`,
  id: idFor("rower", `occasional.${index}`),
  activity: 1,
});

const guestSpec = (rng: Rng, index: number): RowerSpec => {
  const key = `guest.${index}`;
  return {
    key,
    id: idFor("rower", key),
    group: "recreational",
    gender: index % 2 === 0 ? "female" : "male",
    category: SENIOR,
    type: RECREATIONAL,
    birthDate: `${rng.int(1962, 2001)}-${pad(rng.int(1, 12))}-${pad(rng.int(1, 28))}`,
    // A few regular guests (partners of members, visiting rowers), the others once or twice.
    activity: index < 3 ? 4 : index < 6 ? 1.5 : 0.6,
    joinedOn: null,
    firstNameSlot: -1,
    lastNameSlot: -1,
    singleKey: null,
  };
};

/** Seasons on record, as their start years (the oldest is the copied one). */
const seasonsOf = (today: string) => {
  const current = seasonOf(today);
  return [current - 2, current - 1, current];
};

/** Saturdays and Sundays of regattas: competition crews race, juniors too. */
const regattaDays = (today: string) =>
  seasonsOf(today).flatMap((season) =>
    [
      [season, 9, 3],
      [season, 10, 2],
      [season + 1, 3, 3],
      [season + 1, 4, 4],
      [season + 1, 5, 2],
      [season + 1, 6, 1],
    ].map(([year, month, weekendIndex]) => {
      // The n-th Saturday of the month.
      let day = `${year}-${pad(month)}-01`;
      while (weekdayOf(day) !== 6) day = addDays(day, 1);
      return addDays(day, 7 * (weekendIndex - 1));
    })
  );

/** Training camp: the second week of April (Monday to Friday). */
const trainingCampDays = (today: string) =>
  seasonsOf(today).flatMap((season) => {
    let monday = `${season + 1}-04-08`;
    while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
    return [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset));
  });

const pickKeys = <T>(rng: Rng, candidates: readonly T[], count: number): T[] =>
  rng.shuffle(candidates).slice(0, count);

/** Old boats: class, how many outings they take over in each season (oldest first). */
const OLD_BOATS: {
  key: string;
  cls: BoatClass;
  groups: GroupId[];
  perSeason: [number, number, number];
  buildYear: number;
  name: string;
}[] = [
  {
    key: "2x.old",
    name: "Stämpfli 2x 1",
    cls: "2x",
    groups: ["recreational"],
    perSeason: [9, 4, 2],
    buildYear: 1994,
  },
  {
    key: "1x.old",
    name: "Kaschper 1x",
    cls: "1x",
    groups: ["recreational"],
    perSeason: [5, 2, 1],
    buildYear: 1989,
  },
];

/**
 * Applies the profile to the landing plan (mutates `outings` crews and
 * types, adds the copied season, removes nothing that has an incident).
 * Returns the new outing list and the extra people to write.
 */
export const planAnalyticsHistory = ({
  club,
  outings,
  today,
  incidentOutingIds,
  keep,
}: {
  club: ClubStructure;
  outings: PlannedOuting[];
  today: string;
  /** Outings with an incident: never removed. */
  incidentOutingIds: Set<string>;
  /** Rowers whose landing figures must not move (featured rower, lent coxes…). */
  keep: string[];
}): { outings: PlannedOuting[]; history: AnalyticsHistory } => {
  const rng = createRng(`${SEED}:analytics`);
  const current = seasonOf(today);
  const previousStart = `${current - 1}-08-01`;
  const currentStart = `${current}-08-01`;
  const historyStart = addDays(previousStart, SHIFT_DAYS);
  const shielded = protectedKeys(club, outings, today, keep);

  const eligible = (group: GroupId[]) =>
    club.rowers.filter(
      (rower) => group.includes(rower.group) && !shielded.has(rower.key)
    );

  // ----- Turnover in autumn of last season -----
  const joiners = pickKeys(
    rng,
    eligible(["recreational", "masters", "competition", "juniors"]),
    JOINERS
  );
  const formerMembers = joiners.map((joiner, index) =>
    formerMemberOf(rng, joiner, index)
  );
  const joinDays = new Map(
    joiners.map((joiner, index) => [
      joiner.key,
      index < OVERLAPPING_FORMER_MEMBERS
        ? addDays(previousStart, rng.int(20, 75))
        : previousStart,
    ])
  );
  const formerOf = new Map(
    joiners.map((joiner, index) => [joiner.key, formerMembers[index]])
  );

  for (const outing of outings) {
    if (outing.day < previousStart || outing.day >= currentStart) continue;
    for (const joiner of joiners) {
      if (
        hasRower(outing, joiner.key) &&
        outing.day < joinDays.get(joiner.key)!
      ) {
        replaceMember(outing, joiner.key, formerOf.get(joiner.key)!.key);
      }
    }
  }

  // ----- The copied season -----
  const earlier: PlannedOuting[] = [];
  for (const outing of outings) {
    if (outing.day < previousStart || outing.day >= currentStart) continue;
    const day = addDays(outing.day, SHIFT_DAYS);
    if (day >= previousStart) continue;
    if (!rng.chance(EARLIER_SEASON_KEEP)) continue;
    const key = `analytics-${day}#${outing.key}`;
    earlier.push({
      ...outing,
      key,
      id: idFor("outing", key),
      day,
      // Joiners were not there yet: their former counterpart rowed instead.
      crew: outing.crew.map((member) => {
        const former = formerOf.get(member.rowerKey);
        return former ? { ...member, rowerKey: former.key } : member;
      }),
    });
  }

  let all = [...earlier, ...outings];
  const extraByKey = new Map(formerMembers.map((rower) => [rower.key, rower]));
  const rowerOf = (key: string) =>
    club.rowerByKey.get(key) ?? extraByKey.get(key);

  // ----- Members who stopped coming -----
  const stoppers: { rower: RowerSpec; lastDay: string }[] = [];
  const joinerKeys = new Set(joiners.map((joiner) => joiner.key));
  const regulars = eligible(["recreational", "masters", "competition"]).filter(
    (rower) => !joinerKeys.has(rower.key)
  );
  for (const [index, rower] of pickKeys(
    rng,
    regulars,
    REGULARS_WHO_STOPPED_LAST_SEASON + REGULARS_WHO_STOPPED
  ).entries()) {
    stoppers.push({
      rower,
      lastDay:
        index < REGULARS_WHO_STOPPED_LAST_SEASON
          ? addDays(previousStart, rng.int(150, 330))
          : addDays(currentStart, rng.int(75, 255)),
    });
  }
  for (const rower of pickKeys(
    rng,
    joiners.filter((joiner) => joiner.group !== "juniors"),
    JOINERS_WHO_STOPPED
  )) {
    stoppers.push({ rower, lastDay: addDays(currentStart, rng.int(-90, 110)) });
  }
  const newcomers = club.rowers.filter(
    (rower) =>
      rower.joinedOn !== null &&
      rower.group === "recreational" &&
      !keep.includes(rower.key)
  );
  const inTodaysOutings = new Set(
    outings
      .filter((outing) => outing.day >= today)
      .flatMap((outing) => outing.crew.map((member) => member.rowerKey))
  );
  for (const rower of pickKeys(
    rng,
    newcomers.filter((rower) => !inTodaysOutings.has(rower.key)),
    NEWCOMERS_WHO_STOPPED
  )) {
    stoppers.push({
      rower,
      lastDay: addDays(rower.joinedOn!, rng.int(45, 110)),
    });
  }

  const stoppedAfter = new Map(
    stoppers.map(({ rower, lastDay }) => [rower.key, lastDay])
  );
  const isGone = (key: string, day: string) => {
    const lastDay = stoppedAfter.get(key);
    return lastDay !== undefined && day > lastDay;
  };
  const removed = new Set<PlannedOuting>();
  const byDay = indexByDay(all);
  for (const { rower, lastDay } of stoppers) {
    for (const outing of all) {
      if (
        outing.day <= lastDay ||
        outing.day >= today ||
        !hasRower(outing, rower.key)
      )
        continue;
      const boat = club.boatByKey.get(outing.boatKey)!;
      const role = outing.crew.find(
        (member) => member.rowerKey === rower.key
      )!.role;
      const candidates =
        role === "cox"
          ? club.coxes[outing.group].map(
              (cox) => club.rowerByKey.get(cox.rowerKey)!
            )
          : club.rowers.filter(
              (other) =>
                other.group === rower.group &&
                other.key !== rower.key &&
                (other.joinedOn === null || other.joinedOn <= outing.day) &&
                canRow(boat, other)
            );
      const free = candidates.filter(
        (other) =>
          !hasRower(outing, other.key) &&
          !isGone(other.key, outing.day) &&
          !isBusy(byDay, outing, other.key)
      );
      const index = rng.weightedIndex(
        free.map(
          (other) => other.activity * (other.gender === rower.gender ? 1 : 0.3)
        )
      );
      if (index >= 0) {
        replaceMember(outing, rower.key, free[index].key);
      } else if (!incidentOutingIds.has(outing.id)) {
        // Nobody to take the seat: the crew stayed ashore.
        removed.add(outing);
      }
    }
  }
  if (removed.size > 0) all = all.filter((outing) => !removed.has(outing));

  // ----- Occasional members: a few outings a season, some seasons none -----
  const dayIndex = indexByDay(all);
  const occasional = Array.from({ length: OCCASIONAL_MEMBERS }, (_, index) =>
    occasionalSpec(rng, index)
  );
  const seatsFor = (outing: PlannedOuting) =>
    outing.crew
      .map((member, index) => ({ member, index }))
      .filter(
        ({ member, index }) =>
          index > 0 && member.role === "rower" && !shielded.has(member.rowerKey)
      );
  const recreationalCrews = all.filter(
    (outing) =>
      outing.day < today &&
      outing.group === "recreational" &&
      outing.cls !== "1x" &&
      !outing.crew.some((member) => keep.includes(member.rowerKey)) &&
      seatsFor(outing).length > 0
  );
  for (const member of occasional) {
    const days = new Set<string>();
    for (const season of seasonsOf(today)) {
      const target = rng.chance(0.3) ? 0 : rng.int(1, 9);
      const candidates = recreationalCrews.filter(
        (outing) => seasonOf(outing.day) === season && !days.has(outing.day)
      );
      for (const outing of pickKeys(rng, candidates, target)) {
        const seats = seatsFor(outing);
        if (seats.length === 0 || isBusy(dayIndex, outing, member.key))
          continue;
        replaceMember(outing, rng.pick(seats).member.rowerKey, member.key);
        days.add(outing.day);
      }
    }
  }

  // ----- Guests -----
  const guests = Array.from({ length: GUESTS }, (_, index) =>
    guestSpec(rng, index)
  );
  for (const outing of all) {
    if (outing.day >= today) continue;
    if (outing.group !== "recreational" && outing.group !== "masters") continue;
    if (outing.cls === "1x" || outing.cls === "launch") continue;
    if (outing.crew.some((member) => keep.includes(member.rowerKey))) continue;
    const isTour = outing.outingTypeCode === "tour";
    if (
      !rng.chance(isTour ? 0.5 : outing.group === "recreational" ? 0.18 : 0.05)
    )
      continue;
    // Never the first seat (the member who booked the boat), never the cox.
    const seats = seatsFor(outing);
    if (seats.length === 0) continue;
    const seat = rng.pick(seats);
    const free = guests.filter((guest) => !isBusy(dayIndex, outing, guest.key));
    const index = rng.weightedIndex(free.map((guest) => guest.activity));
    if (index < 0) continue;
    replaceMember(outing, seat.member.rowerKey, free[index].key);
  }

  // ----- Outing types (module "Types de sortie") -----
  const regattas = new Set(regattaDays(today));
  const camp = new Set(trainingCampDays(today));
  for (const outing of all) {
    if (outing.outingTypeCode !== null) continue;
    const first = rowerOf(outing.crew[0]?.rowerKey ?? "");
    const joinedOn = first?.joinedOn ?? null;
    const isBeginner = joinedOn !== null && outing.day < addDays(joinedOn, 56);
    const draw = rng.next();
    switch (outing.group) {
      case "competition":
        outing.outingTypeCode = regattas.has(outing.day)
          ? "regatta"
          : camp.has(outing.day)
            ? "training_camp"
            : outing.hasBeenCoached || draw < 0.5
              ? "training"
              : null;
        break;
      case "juniors":
        outing.outingTypeCode =
          first?.category === AgeCategoryEnum.J14
            ? outing.hasBeenCoached
              ? "instruction"
              : "training"
            : regattas.has(outing.day) && draw < 0.6
              ? "regatta"
              : camp.has(outing.day)
                ? "training_camp"
                : "training";
        break;
      case "masters":
        outing.outingTypeCode =
          regattas.has(outing.day) && draw < 0.25
            ? "regatta"
            : draw < 0.35
              ? "training"
              : null;
        break;
      case "adaptive":
        outing.outingTypeCode = draw < 0.6 ? "instruction" : null;
        break;
      case "recreational":
        outing.outingTypeCode = isBeginner
          ? "instruction"
          : weekdayOf(outing.day) === 0 &&
              [5, 6].includes(monthOf(outing.day)) &&
              draw < 0.12
            ? "club_trip"
            : null;
        break;
      case "staff":
        break;
    }
  }

  // ----- Old boats, taken out now and then -----
  const extraBoats: ExtraBoat[] = OLD_BOATS.map((plan) => ({
    name: plan.name,
    buildYear: plan.buildYear,
    spec: {
      key: plan.key,
      id: idFor("boat", plan.key),
      // Out of the fleet order: these boats are named by `name`.
      nameSlot: -1,
      configurations: [
        {
          id: idFor("boat-configuration", `${plan.key}:${plan.cls}`),
          cls: plan.cls,
          position: 0,
        },
      ],
      groups: plan.groups,
      level: null,
      maintenanceFrom: null,
    },
  }));
  const takenDays = new Set<string>();
  for (const [index, { spec }] of extraBoats.entries()) {
    const plan = OLD_BOATS[index];
    const taken: PlannedOuting[] = [];
    seasonsOf(today).forEach((season, seasonIndex) => {
      const candidates = all.filter(
        (outing) =>
          seasonOf(outing.day) === season &&
          outing.day < today &&
          outing.cls === plan.cls &&
          plan.groups.includes(outing.group) &&
          !takenDays.has(outing.day) &&
          !incidentOutingIds.has(outing.id) &&
          !outing.crew.some((member) => keep.includes(member.rowerKey)) &&
          // Spring to autumn: nobody takes the old wooden boats out in winter.
          [4, 5, 6, 7, 8, 9].includes(monthOf(outing.day))
      );
      for (const outing of pickKeys(
        rng,
        candidates,
        plan.perSeason[seasonIndex]
      )) {
        // Two picks of the same day may be at the same time: one boat, one outing.
        const start = outing.startMinutes;
        const end = outing.endMinutes ?? start;
        if (
          taken.some(
            (other) =>
              other.day === outing.day &&
              start < (other.endMinutes ?? other.startMinutes) &&
              other.startMinutes < end
          )
        )
          continue;
        taken.push(outing);
        outing.boatKey = spec.key;
        outing.configurationId = spec.configurations[0].id;
        takenDays.add(outing.day);
      }
    });
  }
  for (const { spec } of extraBoats) club.boatByKey.set(spec.key, spec);

  all.sort((a, b) =>
    a.day === b.day
      ? a.startMinutes - b.startMinutes || (a.key < b.key ? -1 : 1)
      : a.day < b.day
        ? -1
        : 1
  );

  const extraRowers: ExtraRower[] = [
    ...formerMembers.map((spec, index) => ({
      spec,
      status: "member" as const,
      birthDateKnown: true,
      // Archived by the club during the following winter.
      archivedAt: `${current}-01-${pad(10 + (index % 15))}T18:30:00.000Z`,
    })),
    ...occasional.map((spec, index) => ({
      spec,
      status: "member" as const,
      birthDateKnown: index % 3 !== 0,
      archivedAt: null,
    })),
    ...guests.map((spec) => ({
      spec,
      status: "guest" as const,
      birthDateKnown: false,
      archivedAt: null,
    })),
  ];
  for (const extra of extraRowers)
    club.rowerByKey.set(extra.spec.key, extra.spec);

  return {
    outings: all,
    history: {
      extraRowers,
      extraBoats,
      stoppedRowers: stoppers.map(({ rower, lastDay }) => ({
        rowerKey: rower.key,
        lastDay,
      })),
      historyStart,
    },
  };
};
