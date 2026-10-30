// The fake club, without any text: boats, rowers, routes, regular crews.
// The same structure is used for every locale; names come from the content
// packs through the *Slot indexes (see names.ts).
import { AgeCategoryEnum } from "../../_common/business/ageCategory.rules";
import { SeriousnessCategoryEnum } from "../../_common/business/seriousness.rules";
import { createRng, uuidFor } from "./prng";

/** Bump to get a different (but still deterministic) club. */
export const SEED = "rowingbeacon-studio-v1";

export const idFor = (kind: string, key: string) =>
  uuidFor(`${SEED}:${kind}:${key}`);

export type GroupId =
  | "competition"
  | "masters"
  | "recreational"
  | "juniors"
  | "adaptive"
  | "staff";

/** Classes a crew rows; "launch" is the coaches' motor boat. */
export type BoatClass =
  | "1x"
  | "2x"
  | "2-"
  | "4x"
  | "4-"
  | "4+"
  | "8+"
  | "launch";

export interface ClassShape {
  seats: number | null;
  rigging: "scull" | "sweep" | null;
  coxed: boolean;
}

export const CLASS_SHAPES: Record<BoatClass, ClassShape> = {
  "1x": { seats: 1, rigging: "scull", coxed: false },
  "2x": { seats: 2, rigging: "scull", coxed: false },
  "2-": { seats: 2, rigging: "sweep", coxed: false },
  "4x": { seats: 4, rigging: "scull", coxed: false },
  "4-": { seats: 4, rigging: "sweep", coxed: false },
  "4+": { seats: 4, rigging: "sweep", coxed: true },
  "8+": { seats: 8, rigging: "sweep", coxed: true },
  // An unclassified boat (efa2 "OTHER"): one person aboard.
  launch: { seats: null, rigging: null, coxed: false },
};

export interface RowerSpec {
  key: string;
  id: string;
  group: GroupId;
  gender: "female" | "male";
  category: AgeCategoryEnum;
  type: SeriousnessCategoryEnum | undefined;
  birthDate: string;
  /** Relative appetite for outings (1 = average member of the group). */
  activity: number;
  /** First day the member can row (new members of the current season). */
  joinedOn: string | null;
  /** Index among the rowers of the same gender (first name). */
  firstNameSlot: number;
  /** Index of the family name (members of a family share it). */
  lastNameSlot: number;
  /** Their usual single, if any. */
  singleKey: string | null;
}

export interface BoatConfigurationSpec {
  id: string;
  cls: BoatClass;
  position: number;
}

export interface BoatSpec {
  key: string;
  id: string;
  /** Index in the fleet order of LocaleContent.boatNames. */
  nameSlot: number;
  configurations: BoatConfigurationSpec[];
  /** Groups whose outings may use it. */
  groups: GroupId[];
  level: {
    minimalRowerCategory: AgeCategoryEnum | null;
    minimalRowerType: SeriousnessCategoryEnum | null;
  } | null;
  /** Out of service from this day on (an incident on its last outing). */
  maintenanceFrom: string | null;
}

export interface RouteSpec {
  id: string;
  /** Index in LocaleContent.routes. */
  slot: number;
  distanceM: number;
}

/** A regular crew: rows together whenever its members are free. */
export interface PodSpec {
  key: string;
  group: GroupId;
  classes: BoatClass[];
  members: { rowerKey: string; presence: number }[];
  boatKey: string;
  /** Chance the pod goes out when its group rows this class. */
  use: number;
}

export interface ClubStructure {
  rowers: RowerSpec[];
  boats: BoatSpec[];
  routes: RouteSpec[];
  pods: PodSpec[];
  /** Weighted coxes per group (rower keys). */
  coxes: Record<
    GroupId,
    { rowerKey: string; weight: number; days?: number[] }[]
  >;
  rowerByKey: Map<string, RowerSpec>;
  boatByKey: Map<string, BoatSpec>;
}

/** History starts here; "now" is set by the scene (see SeedOptions). */
export const HISTORY_START = "2024-08-01";
/** Members who joined at the start of the current season. */
export const NEW_MEMBERS_JOINED_ON = "2025-09-13";

export const ROUTE_DISTANCES_M = [4000, 6000, 8000, 12000, 16000] as const;

// ----- Rowers -----

interface GroupPlan {
  group: GroupId;
  prefix: string;
  members: {
    suffix: string;
    gender: "female" | "male";
    category: AgeCategoryEnum;
    type: SeriousnessCategoryEnum | undefined;
    born: [number, number];
  }[];
}

const { SENIOR, J14, J16, J18 } = AgeCategoryEnum;
const { COMPETITOR, RECREATIONAL } = SeriousnessCategoryEnum;

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

const people = (
  gender: "female" | "male",
  letter: string,
  count: number,
  category: AgeCategoryEnum,
  type: SeriousnessCategoryEnum | undefined,
  born: [number, number],
  typeOf?: (index: number) => SeriousnessCategoryEnum | undefined
) =>
  range(count).map((i) => ({
    suffix: `${letter}${i}`,
    gender,
    category,
    type: typeOf ? typeOf(i) : type,
    born,
  }));

const GROUP_PLANS: GroupPlan[] = [
  {
    group: "competition",
    prefix: "comp",
    members: [
      ...people("female", "F", 7, SENIOR, COMPETITOR, [1996, 2006]),
      ...people("male", "M", 7, SENIOR, COMPETITOR, [1995, 2006]),
    ],
  },
  {
    group: "masters",
    prefix: "masters",
    members: [
      ...people("female", "F", 8, SENIOR, COMPETITOR, [1964, 1986], (i) =>
        i >= 6 ? RECREATIONAL : COMPETITOR
      ),
      ...people("male", "M", 8, SENIOR, COMPETITOR, [1961, 1986], (i) =>
        i >= 7 ? RECREATIONAL : COMPETITOR
      ),
    ],
  },
  {
    group: "recreational",
    prefix: "rec",
    members: [
      ...people("female", "F", 24, SENIOR, RECREATIONAL, [1955, 2002]),
      ...people("male", "M", 22, SENIOR, RECREATIONAL, [1953, 2002]),
    ],
  },
  {
    group: "juniors",
    prefix: "jun",
    members: [
      ...people("female", "J14F", 4, J14, RECREATIONAL, [2012, 2013]),
      ...people("male", "J14M", 4, J14, RECREATIONAL, [2012, 2013]),
      ...people("female", "J16F", 4, J16, COMPETITOR, [2010, 2011]),
      ...people("male", "J16M", 4, J16, COMPETITOR, [2010, 2011]),
      ...people("female", "J18F", 4, J18, COMPETITOR, [2008, 2009]),
      ...people("male", "J18M", 4, J18, COMPETITOR, [2008, 2009]),
    ],
  },
  {
    group: "adaptive",
    prefix: "adaptive",
    members: [
      ...people("female", "F", 3, SENIOR, RECREATIONAL, [1970, 2000], (i) =>
        i === 0 ? COMPETITOR : RECREATIONAL
      ),
      ...people("male", "M", 3, SENIOR, RECREATIONAL, [1968, 2000], (i) =>
        i === 0 ? COMPETITOR : RECREATIONAL
      ),
    ],
  },
  {
    group: "staff",
    prefix: "staff",
    members: [
      {
        suffix: "coachF",
        gender: "female",
        category: SENIOR,
        type: undefined,
        born: [1984, 1990],
      },
      {
        suffix: "coachM",
        gender: "male",
        category: SENIOR,
        type: undefined,
        born: [1975, 1983],
      },
      {
        suffix: "coxF",
        gender: "female",
        category: SENIOR,
        type: RECREATIONAL,
        born: [1997, 2002],
      },
      {
        suffix: "coxM",
        gender: "male",
        category: J14,
        type: RECREATIONAL,
        born: [2012, 2012],
      },
    ],
  },
];

/** Recreational members who joined this season (no outing last season). */
const NEW_MEMBERS = [
  "rec.F20",
  "rec.F21",
  "rec.F22",
  "rec.F23",
  "rec.M18",
  "rec.M19",
  "rec.M20",
  "rec.M21",
];

/** Children share the family name of a parent in the club. */
const FAMILIES: Record<string, string> = {
  "jun.J16F1": "masters.M3",
  "jun.J14M2": "masters.M3",
  "jun.J18M0": "masters.F2",
  "jun.J14F0": "rec.F5",
  "jun.J16M3": "rec.M7",
  "jun.J18F2": "jun.J14F3",
};

/** Usual singles (1x keys) of the scullers who have one. */
const SINGLES: Record<string, string> = {
  "comp.F0": "1x.R1",
  "comp.F6": "1x.R3",
  "comp.M0": "1x.R2",
  "comp.M6": "1x.R1",
  "comp.F4": "1x.R3",
  "comp.M3": "1x.R2",
  "masters.F0": "1x.C4",
  "masters.F1": "1x.C2",
  "masters.F6": "1x.C1",
  "masters.M0": "1x.C3",
  "masters.M1": "1x.R3",
  "masters.M7": "1x.C3",
  "masters.M5": "1x.C5",
  "jun.J18M1": "1x.J1",
  "jun.J18F0": "1x.J1",
  "jun.J16M0": "1x.C6",
  "rec.F3": "1x.B1",
  "rec.M4": "1x.B2",
  "rec.M9": "1x.B3",
};

/** Hand-set appetites; the others are drawn. */
const ACTIVITY: Record<string, number> = {
  "masters.F0": 0.9,
  "comp.F0": 2.0,
  "comp.M0": 1.9,
  "comp.F6": 1.8,
  "comp.M6": 1.7,
  "comp.M3": 1.7,
};

const buildRowers = (): RowerSpec[] => {
  const rng = createRng(`${SEED}:rowers`);
  const rowers: RowerSpec[] = [];
  const genderCount = { female: 0, male: 0 };

  for (const plan of GROUP_PLANS) {
    for (const member of plan.members) {
      const key = `${plan.prefix}.${member.suffix}`;
      const year = rng.int(member.born[0], member.born[1]);
      const month = rng.int(1, 12);
      const day = rng.int(1, 28);
      const drawn = Math.exp(rng.normal() * 0.45);
      rowers.push({
        key,
        id: idFor("rower", key),
        group: plan.group,
        gender: member.gender,
        category: member.category,
        type: member.type,
        birthDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        activity: ACTIVITY[key] ?? Math.min(2.4, Math.max(0.3, drawn)),
        joinedOn: NEW_MEMBERS.includes(key) ? NEW_MEMBERS_JOINED_ON : null,
        firstNameSlot: genderCount[member.gender]++,
        lastNameSlot: -1,
        singleKey: SINGLES[key] ?? null,
      });
    }
  }

  // Family names: one per family, in a stable order.
  let nextLastName = 0;
  const byKey = new Map(rowers.map((rower) => [rower.key, rower]));
  for (const rower of rowers) {
    if (FAMILIES[rower.key]) continue;
    rower.lastNameSlot = nextLastName++;
  }
  for (const rower of rowers) {
    let parentKey = FAMILIES[rower.key];
    while (parentKey && FAMILIES[parentKey]) parentKey = FAMILIES[parentKey];
    if (!parentKey) continue;
    const parent = byKey.get(parentKey);
    if (!parent) throw new Error(`Unknown family member ${parentKey}`);
    rower.lastNameSlot = parent.lastNameSlot;
  }

  return rowers;
};

// ----- Boats -----

interface BoatPlan {
  key: string;
  classes: BoatClass[];
  groups: GroupId[];
  level?: BoatSpec["level"];
  maintenanceFrom?: string;
}

const COMPETITORS_ONLY = {
  minimalRowerCategory: null,
  minimalRowerType: COMPETITOR,
};

const BOAT_PLANS: BoatPlan[] = [
  // Singles: racing, a junior racing single, club singles, wide beginners' singles.
  {
    key: "1x.R1",
    classes: ["1x"],
    groups: ["competition"],
    level: COMPETITORS_ONLY,
  },
  {
    key: "1x.R2",
    classes: ["1x"],
    groups: ["competition"],
    level: COMPETITORS_ONLY,
  },
  { key: "1x.R3", classes: ["1x"], groups: ["competition", "masters"] },
  {
    key: "1x.J1",
    classes: ["1x"],
    groups: ["juniors", "competition"],
    level: { minimalRowerCategory: J16, minimalRowerType: null },
  },
  ...range(6).map((i) => ({
    key: `1x.C${i + 1}`,
    classes: ["1x"] as BoatClass[],
    groups: ["masters", "recreational", "juniors"] as GroupId[],
  })),
  ...range(6).map((i) => ({
    key: `1x.B${i + 1}`,
    classes: ["1x"] as BoatClass[],
    groups: ["recreational", "juniors"] as GroupId[],
    maintenanceFrom: i === 5 ? "2026-06-08" : undefined,
  })),
  // Doubles and pairs.
  { key: "2x.R1", classes: ["2x"], groups: ["competition", "masters"] },
  { key: "2x.R2", classes: ["2x"], groups: ["competition", "masters"] },
  ...range(6).map((i) => ({
    key: `2x.C${i + 1}`,
    classes: ["2x"] as BoatClass[],
    groups: ["masters", "recreational", "juniors", "adaptive"] as GroupId[],
    maintenanceFrom: i === 5 ? "2026-05-30" : undefined,
  })),
  {
    key: "2-.S1",
    classes: ["2-"],
    groups: ["competition", "masters"],
    level: COMPETITORS_ONLY,
  },
  { key: "2-.S2", classes: ["2-"], groups: ["competition", "masters"] },
  // Quads: two can be rigged as coxless fours.
  {
    key: "4x.Q1",
    classes: ["4x", "4-"],
    groups: ["competition", "juniors"],
    level: COMPETITORS_ONLY,
  },
  {
    key: "4x.Q2",
    classes: ["4x", "4-"],
    groups: ["competition", "masters", "recreational", "juniors"],
  },
  { key: "4x.Q3", classes: ["4x"], groups: ["masters", "recreational"] },
  { key: "4x.Q4", classes: ["4x"], groups: ["juniors", "recreational"] },
  {
    key: "4x.Q5",
    classes: ["4x"],
    groups: ["recreational", "masters", "juniors"],
  },
  // Coxed fours and eights.
  ...range(3).map((i) => ({
    key: `4+.F${i + 1}`,
    classes: ["4+"] as BoatClass[],
    groups: ["recreational", "adaptive", "juniors"] as GroupId[],
  })),
  {
    key: "8+.E1",
    classes: ["8+"],
    groups: ["competition", "masters"],
    level: { minimalRowerCategory: SENIOR, minimalRowerType: COMPETITOR },
  },
  { key: "8+.E2", classes: ["8+"], groups: ["recreational", "juniors"] },
  {
    key: "8+.E3",
    classes: ["8+"],
    groups: ["juniors", "recreational", "masters"],
  },
  // The coaches' launch, logged for safety.
  { key: "other.L1", classes: ["launch"], groups: ["staff"] },
];

const buildBoats = (): BoatSpec[] => {
  return BOAT_PLANS.map((plan, index) => ({
    key: plan.key,
    id: idFor("boat", plan.key),
    nameSlot: index,
    configurations: plan.classes.map((cls, position) => ({
      id: idFor("boat-configuration", `${plan.key}:${cls}`),
      cls,
      position,
    })),
    groups: plan.groups,
    level: plan.level ?? null,
    maintenanceFrom: plan.maintenanceFrom ?? null,
  }));
};

// ----- Regular crews -----

const pod = (
  key: string,
  group: GroupId,
  classes: BoatClass[],
  boatKey: string,
  use: number,
  members: [string, number][]
): PodSpec => ({
  key,
  group,
  classes,
  boatKey,
  use,
  members: members.map(([rowerKey, presence]) => ({ rowerKey, presence })),
});

const PODS: PodSpec[] = [
  pod("comp.W4x", "competition", ["4x"], "4x.Q1", 0.8, [
    ["comp.F0", 0.95],
    ["comp.F1", 0.9],
    ["comp.F2", 0.88],
    ["comp.F3", 0.8],
  ]),
  pod("comp.M4", "competition", ["4x", "4-"], "4x.Q1", 0.8, [
    ["comp.M0", 0.95],
    ["comp.M1", 0.9],
    ["comp.M2", 0.85],
    ["comp.M3", 0.8],
  ]),
  pod("comp.M2-", "competition", ["2-"], "2-.S1", 0.85, [
    ["comp.M4", 0.95],
    ["comp.M5", 0.9],
  ]),
  pod("comp.W2x", "competition", ["2x"], "2x.R1", 0.75, [
    ["comp.F4", 0.92],
    ["comp.F5", 0.88],
  ]),
  pod("masters.W4x", "masters", ["4x"], "4x.Q3", 0.85, [
    ["masters.F0", 0.68],
    ["masters.F1", 0.85],
    ["masters.F2", 0.78],
    ["masters.F3", 0.7],
  ]),
  pod("masters.mixed2x", "masters", ["2x"], "2x.C1", 0.5, [
    ["masters.F0", 0.65],
    ["masters.M0", 0.85],
  ]),
  pod("masters.M4x", "masters", ["4x"], "4x.Q2", 0.8, [
    ["masters.M1", 0.9],
    ["masters.M2", 0.85],
    ["masters.M3", 0.85],
    ["masters.M4", 0.75],
  ]),
  pod("masters.M2x", "masters", ["2x"], "2x.C2", 0.6, [
    ["masters.M5", 0.9],
    ["masters.M6", 0.85],
  ]),
  pod("masters.W2x", "masters", ["2x"], "2x.R2", 0.6, [
    ["masters.F4", 0.85],
    ["masters.F5", 0.85],
  ]),
  pod("rec.F2x", "recreational", ["2x"], "2x.C3", 0.35, [
    ["rec.F0", 0.85],
    ["rec.F1", 0.8],
  ]),
  pod("rec.M2x", "recreational", ["2x"], "2x.C4", 0.35, [
    ["rec.M0", 0.85],
    ["rec.M1", 0.8],
  ]),
  pod("rec.mixed2x", "recreational", ["2x"], "2x.C5", 0.3, [
    ["rec.F2", 0.85],
    ["rec.M2", 0.85],
  ]),
  pod("jun.J18M4x", "juniors", ["4x"], "4x.Q1", 0.6, [
    ["jun.J18M0", 0.9],
    ["jun.J18M1", 0.9],
    ["jun.J18M2", 0.85],
    ["jun.J18M3", 0.85],
  ]),
  pod("jun.J18W4x", "juniors", ["4x"], "4x.Q4", 0.6, [
    ["jun.J18F0", 0.9],
    ["jun.J18F1", 0.9],
    ["jun.J18F2", 0.85],
    ["jun.J18F3", 0.85],
  ]),
  pod("jun.J16W4x", "juniors", ["4x"], "4x.Q4", 0.6, [
    ["jun.J16F0", 0.9],
    ["jun.J16F1", 0.85],
    ["jun.J16F2", 0.85],
    ["jun.J16F3", 0.8],
  ]),
  pod("jun.J16M4x", "juniors", ["4x"], "4x.Q5", 0.6, [
    ["jun.J16M0", 0.9],
    ["jun.J16M1", 0.85],
    ["jun.J16M2", 0.85],
    ["jun.J16M3", 0.8],
  ]),
  pod("adaptive.4+", "adaptive", ["4+"], "4+.F1", 0.7, [
    ["adaptive.F0", 0.9],
    ["adaptive.F1", 0.85],
    ["adaptive.M0", 0.9],
    ["adaptive.M1", 0.8],
  ]),
];

const SATURDAY = 6;

const COXES: ClubStructure["coxes"] = {
  competition: [
    { rowerKey: "staff.coxF", weight: 3 },
    { rowerKey: "staff.coxM", weight: 2 },
  ],
  masters: [
    { rowerKey: "staff.coxF", weight: 3 },
    { rowerKey: "staff.coachF", weight: 1 },
  ],
  recreational: [
    { rowerKey: "staff.coxF", weight: 3 },
    // The featured rower coxes the Saturday crews now and then.
    { rowerKey: "masters.F0", weight: 1.3, days: [SATURDAY] },
    { rowerKey: "rec.F14", weight: 1.5 },
    { rowerKey: "rec.F15", weight: 1.2 },
  ],
  juniors: [
    { rowerKey: "staff.coxM", weight: 3 },
    { rowerKey: "jun.J14F0", weight: 1 },
    { rowerKey: "jun.J14F1", weight: 1 },
    { rowerKey: "jun.J14M0", weight: 1 },
    { rowerKey: "jun.J14M1", weight: 1 },
  ],
  adaptive: [
    { rowerKey: "staff.coachF", weight: 2 },
    { rowerKey: "staff.coxF", weight: 2 },
  ],
  staff: [],
};

const buildRoutes = (): RouteSpec[] =>
  ROUTE_DISTANCES_M.map((distanceM, slot) => ({
    id: idFor("route", String(slot)),
    slot,
    distanceM,
  }));

export const buildClubStructure = (): ClubStructure => {
  const rowers = buildRowers();
  const boats = buildBoats();
  const rowerByKey = new Map(rowers.map((rower) => [rower.key, rower]));
  const boatByKey = new Map(boats.map((boat) => [boat.key, boat]));

  for (const rower of rowers) {
    if (rower.singleKey && !boatByKey.has(rower.singleKey)) {
      throw new Error(`Unknown single ${rower.singleKey} for ${rower.key}`);
    }
  }
  for (const crew of PODS) {
    if (!boatByKey.has(crew.boatKey))
      throw new Error(`Unknown boat ${crew.boatKey} in pod ${crew.key}`);
    for (const member of crew.members) {
      if (!rowerByKey.has(member.rowerKey)) {
        throw new Error(`Unknown rower ${member.rowerKey} in pod ${crew.key}`);
      }
    }
  }
  for (const list of Object.values(COXES)) {
    for (const cox of list) {
      if (!rowerByKey.has(cox.rowerKey))
        throw new Error(`Unknown cox ${cox.rowerKey}`);
    }
  }

  return {
    rowers,
    boats,
    routes: buildRoutes(),
    pods: PODS,
    coxes: COXES,
    rowerByKey,
    boatByKey,
  };
};

/** Keys of the records the scenes feature. */
export const FEATURED = {
  /** Rower whose statistics dialog is captured. */
  rower: "masters.F0",
  /** Boat whose statistics dialog is captured. */
  statsBoat: "4x.Q3",
  /** Free quad (4x / 4-) of the start dialog. */
  startBoat: "4x.Q2",
  /** Route picked in the start dialog (8 km). */
  startRouteSlot: 2,
  /** Crew typed in the start dialog, in seat order. */
  startCrew: ["rec.F6", "rec.M3", "rec.F8", "rec.M5"],
  /** Double on the water since 08:45, ended in the stop dialog. */
  stopBoat: "2x.C2",
} as const;
