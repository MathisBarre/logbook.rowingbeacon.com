import type { SqlClient } from "../../../_common/database/sqlClient";

/**
 * A small hand-built club whose report results are known in advance
 * (reports.test.ts). Seasons start in August (default setting): season
 * 2024 runs from 2024-08-01 to 2025-07-31, season 2025 from 2025-08-01 and
 * is in progress on FIXTURE_NOW.
 *
 * Edge cases on purpose: an outing across midnight (S06) and one over two
 * days (S08), two ongoing outings (S13 yesterday, S14 today), an efa2
 * outing imported at 00:00 (S09), motorboat outings (S10, S19), an
 * ergometer session (S20), a boat excluded from statistics (Faucon), an
 * excluded rower (Karim), an archived boat (Goéland), a boat without any
 * configuration (Zodiac), rowers without birth date (Emma, Félix) or
 * gender (Gaëlle), a guest (Jules), a coach with status "other" (Léa), a
 * late return (S16), outings without a planned return time (S05, S09)
 * and youth outings without coaching (S02, S14).
 */

export const FIXTURE_NOW = "2026-03-15T12:00";

interface FixtureBoat {
  id: string;
  name: string;
  /** null: the boat has no configuration at all. */
  config: { seats: number; rigging: "scull" | "sweep"; coxed: boolean } | null;
  buildYear: number | null;
  excludeFromStats?: boolean;
  archivedAt?: string;
}

interface FixtureRower {
  id: string;
  firstName: string;
  lastName: string;
  status: "member" | "guest" | "other";
  gender: "female" | "male" | null;
  birthDate: string | null;
  ageCategory: string | null;
  seriousness: "recreational" | "competitor" | null;
  excludeFromStats?: boolean;
}

interface FixtureRoute {
  id: string;
  name: string;
  distanceM: number | null;
}

interface FixtureOuting {
  id: string;
  boatId: string;
  start: string;
  end: string | null;
  estimatedEnd: string | null;
  crew: string[];
  /** Last crew member is the cox. */
  cox?: boolean;
  distanceM?: number;
  routeId?: string;
  type?: string;
  coached: 0 | 1 | null;
}

export const FIXTURE_ROUTES: FixtureRoute[] = [
  { id: "route-short", name: "Boucle courte", distanceM: 6000 },
  { id: "route-long", name: "Grande boucle", distanceM: 12000 },
  { id: "route-none", name: "Balade libre", distanceM: null },
];

export const FIXTURE_BOATS: FixtureBoat[] = [
  {
    id: "boat-aigle",
    name: "Aigle",
    config: { seats: 1, rigging: "scull", coxed: false },
    buildYear: 2015,
  },
  {
    id: "boat-bison",
    name: "Bison",
    config: { seats: 2, rigging: "scull", coxed: false },
    buildYear: 2010,
  },
  {
    id: "boat-castor",
    name: "Castor",
    config: { seats: 4, rigging: "sweep", coxed: true },
    buildYear: 2005,
  },
  {
    id: "boat-dauphin",
    name: "Dauphin",
    config: { seats: 1, rigging: "scull", coxed: false },
    buildYear: 1998,
  },
  { id: "boat-zodiac", name: "Zodiac", config: null, buildYear: null },
  {
    id: "boat-faucon",
    name: "Faucon",
    config: { seats: 2, rigging: "scull", coxed: false },
    buildYear: 2018,
    excludeFromStats: true,
  },
  {
    id: "boat-goeland",
    name: "Goéland",
    config: { seats: 1, rigging: "scull", coxed: false },
    buildYear: 1985,
    archivedAt: "2025-07-01T10:00",
  },
];

const rower = (
  id: string,
  firstName: string,
  lastName: string,
  rest: Partial<FixtureRower>
): FixtureRower => ({
  id,
  firstName,
  lastName,
  status: "member",
  gender: null,
  birthDate: null,
  ageCategory: null,
  seriousness: null,
  ...rest,
});

export const FIXTURE_ROWERS: FixtureRower[] = [
  rower("r01", "Alice", "Martin", {
    gender: "female",
    birthDate: "1990-05-01",
    ageCategory: "Senior",
    seriousness: "recreational",
  }),
  rower("r02", "Bruno", "Petit", {
    gender: "male",
    birthDate: "1985-02-10",
    ageCategory: "Senior",
    seriousness: "competitor",
  }),
  rower("r03", "Chloé", "Durand", {
    gender: "female",
    birthDate: "2011-03-01",
    ageCategory: "J14",
    seriousness: "competitor",
  }),
  rower("r04", "David", "Leroy", {
    gender: "male",
    birthDate: "2013-06-15",
    ageCategory: "J12",
    seriousness: "recreational",
  }),
  rower("r05", "Emma", "Moreau", {
    gender: "female",
    ageCategory: "Senior",
    seriousness: "recreational",
  }),
  rower("r06", "Félix", "Simon", { gender: "male" }),
  rower("r07", "Gaëlle", "Laurent", {
    birthDate: "1970-01-01",
    ageCategory: "Senior",
    seriousness: "recreational",
  }),
  rower("r08", "Hugo", "Michel", {
    gender: "male",
    birthDate: "1995-09-09",
    ageCategory: "Senior",
    seriousness: "recreational",
  }),
  rower("r09", "Inès", "Garcia", {
    gender: "female",
    birthDate: "1980-04-04",
    ageCategory: "Senior",
    seriousness: "recreational",
  }),
  rower("r10", "Jules", "Bernard", { status: "guest", gender: "male" }),
  rower("r11", "Karim", "Roux", {
    gender: "male",
    ageCategory: "Senior",
    excludeFromStats: true,
  }),
  rower("r12", "Léa", "Fournier", {
    status: "other",
    gender: "female",
    birthDate: "1975-07-07",
    ageCategory: "Senior",
  }),
];

export const FIXTURE_OUTINGS: FixtureOuting[] = [
  // ---- season 2024 (2024-08-01 → 2025-07-31)
  {
    id: "P01",
    boatId: "boat-bison",
    start: "2024-08-03T09:00",
    end: "2024-08-03T10:30",
    estimatedEnd: "2024-08-03T10:30",
    crew: ["r01", "r02"],
    distanceM: 8000,
    coached: 0,
  },
  {
    id: "P02",
    boatId: "boat-aigle",
    start: "2024-09-14T09:00",
    end: "2024-09-14T10:00",
    estimatedEnd: "2024-09-14T10:00",
    crew: ["r01"],
    routeId: "route-short",
    type: "training",
    coached: null,
  },
  {
    id: "P03",
    boatId: "boat-castor",
    start: "2024-10-05T09:00",
    end: "2024-10-05T11:00",
    estimatedEnd: "2024-10-05T11:00",
    crew: ["r02", "r05", "r07", "r09", "r12"],
    cox: true,
    distanceM: 12000,
    type: "training",
    coached: 1,
  },
  {
    id: "P04",
    boatId: "boat-aigle",
    start: "2025-01-11T14:00",
    end: "2025-01-11T15:30",
    estimatedEnd: "2025-01-11T15:00",
    crew: ["r09"],
    distanceM: 5000,
    coached: 0,
  },
  {
    id: "P05",
    boatId: "boat-goeland",
    start: "2025-03-08T09:00",
    end: "2025-03-08T10:00",
    estimatedEnd: "2025-03-08T10:00",
    crew: ["r09"],
    coached: 0,
  },
  {
    id: "P06",
    boatId: "boat-dauphin",
    start: "2025-05-10T09:00",
    end: "2025-05-10T10:00",
    estimatedEnd: "2025-05-10T10:00",
    crew: ["r09"],
    routeId: "route-short",
    coached: 0,
  },
  {
    id: "P07",
    boatId: "boat-bison",
    start: "2025-06-14T18:00",
    end: "2025-06-14T19:00",
    estimatedEnd: "2025-06-14T19:00",
    crew: ["r09", "r01"],
    routeId: "route-long",
    coached: 0,
  },
  {
    id: "P08",
    boatId: "boat-bison",
    start: "2025-03-01T09:00",
    end: "2025-03-01T10:00",
    estimatedEnd: "2025-03-01T10:00",
    crew: ["r01", "r06"],
    distanceM: 6000,
    coached: 1,
  },
  // ---- season 2025 (2025-08-01 → 2026-07-31), in progress
  {
    id: "S01",
    boatId: "boat-bison",
    start: "2025-08-02T09:00",
    end: "2025-08-02T10:30",
    estimatedEnd: "2025-08-02T10:30",
    crew: ["r01", "r02"],
    distanceM: 10000,
    coached: 1,
  },
  {
    id: "S02",
    boatId: "boat-aigle",
    start: "2025-08-02T09:00",
    end: "2025-08-02T10:00",
    estimatedEnd: "2025-08-02T10:00",
    crew: ["r03"],
    routeId: "route-short",
    type: "training",
    coached: 0,
  },
  {
    id: "S18",
    boatId: "boat-dauphin",
    start: "2025-08-02T09:15",
    end: "2025-08-02T09:45",
    estimatedEnd: "2025-08-02T09:45",
    crew: ["r06"],
    coached: 0,
  },
  {
    id: "S03",
    boatId: "boat-castor",
    start: "2025-09-06T09:00",
    end: "2025-09-06T11:00",
    estimatedEnd: "2025-09-06T11:00",
    crew: ["r01", "r02", "r05", "r08", "r12"],
    cox: true,
    routeId: "route-long",
    type: "training",
    coached: 1,
  },
  {
    id: "S04",
    boatId: "boat-bison",
    start: "2025-09-06T09:30",
    end: "2025-09-06T10:30",
    estimatedEnd: "2025-09-06T10:30",
    crew: ["r03", "r04"],
    routeId: "route-short",
    type: "instruction",
    coached: 1,
  },
  {
    id: "S05",
    boatId: "boat-aigle",
    start: "2025-10-07T18:00",
    end: "2025-10-07T19:00",
    estimatedEnd: null,
    crew: ["r08"],
    distanceM: 5000,
    coached: null,
  },
  {
    id: "S06",
    boatId: "boat-aigle",
    start: "2025-10-18T22:30",
    end: "2025-10-19T00:30",
    estimatedEnd: "2025-10-19T00:30",
    crew: ["r02"],
    distanceM: 4000,
    coached: 0,
  },
  {
    id: "S07",
    boatId: "boat-bison",
    start: "2025-11-08T10:00",
    end: "2025-11-08T11:00",
    estimatedEnd: "2025-11-08T11:00",
    crew: ["r01", "r10"],
    routeId: "route-short",
    coached: 0,
  },
  {
    id: "S16",
    boatId: "boat-bison",
    start: "2025-12-10T12:00",
    end: "2025-12-10T13:40",
    estimatedEnd: "2025-12-10T13:15",
    crew: ["r05", "r07"],
    distanceM: 7000,
    coached: 1,
  },
  {
    id: "S08",
    boatId: "boat-aigle",
    start: "2025-12-20T10:00",
    end: "2025-12-21T12:00",
    estimatedEnd: "2025-12-21T12:00",
    crew: ["r02"],
    distanceM: 40000,
    type: "tour",
    coached: 0,
  },
  {
    id: "S09",
    boatId: "boat-aigle",
    start: "2026-01-10T00:00",
    end: "2026-01-10T00:00",
    estimatedEnd: null,
    crew: ["r05"],
    coached: null,
  },
  {
    id: "S15",
    boatId: "boat-zodiac",
    start: "2026-01-17T10:00",
    end: "2026-01-17T11:00",
    estimatedEnd: "2026-01-17T11:00",
    crew: ["r06", "r07"],
    distanceM: 3000,
    coached: 0,
  },
  {
    id: "S10",
    boatId: "boat-zodiac",
    start: "2026-02-07T09:00",
    end: "2026-02-07T11:00",
    estimatedEnd: "2026-02-07T11:00",
    crew: ["r12"],
    type: "motorboat",
    coached: null,
  },
  {
    id: "S11",
    boatId: "boat-faucon",
    start: "2026-02-14T09:00",
    end: "2026-02-14T10:00",
    estimatedEnd: "2026-02-14T10:00",
    crew: ["r01", "r02"],
    distanceM: 6000,
    coached: 0,
  },
  {
    id: "S12",
    boatId: "boat-aigle",
    start: "2026-02-21T09:00",
    end: "2026-02-21T10:00",
    estimatedEnd: "2026-02-21T10:00",
    crew: ["r11"],
    distanceM: 6000,
    coached: 0,
  },
  {
    id: "S20",
    boatId: "boat-aigle",
    start: "2026-02-28T09:00",
    end: "2026-02-28T09:30",
    estimatedEnd: "2026-02-28T09:30",
    crew: ["r01"],
    distanceM: 5000,
    type: "ergometer",
    coached: null,
  },
  {
    id: "S17",
    boatId: "boat-aigle",
    start: "2026-03-05T18:00",
    end: "2026-03-05T19:00",
    estimatedEnd: "2026-03-05T19:00",
    crew: ["r08"],
    routeId: "route-none",
    coached: 0,
  },
  {
    id: "S19",
    boatId: "boat-zodiac",
    start: "2026-03-07T09:00",
    end: "2026-03-07T10:00",
    estimatedEnd: "2026-03-07T10:00",
    crew: ["r12"],
    type: "motorboat",
    coached: null,
  },
  {
    id: "S13",
    boatId: "boat-castor",
    start: "2026-03-14T09:00",
    end: null,
    estimatedEnd: "2026-03-14T11:00",
    crew: ["r01", "r02", "r07", "r08", "r12"],
    cox: true,
    routeId: "route-long",
    type: "training",
    coached: 1,
  },
  {
    id: "S14",
    boatId: "boat-bison",
    start: "2026-03-15T10:00",
    end: null,
    estimatedEnd: "2026-03-15T11:30",
    crew: ["r03", "r04"],
    coached: 0,
  },
];

const FIXTURE_INCIDENTS = [
  { id: "i1", boatId: "boat-aigle", outingId: "S05", at: "2025-10-07T19:00" },
  { id: "i2", boatId: "boat-aigle", outingId: "S12", at: "2026-02-21T10:00" },
  { id: "i3", boatId: "boat-castor", outingId: "S03", at: "2025-09-06T11:00" },
  { id: "i4", boatId: "boat-bison", outingId: "P07", at: "2025-06-14T19:00" },
];

const FIXTURE_DAMAGES = [
  {
    id: "d1",
    boatId: "boat-aigle",
    kind: "damage",
    severity: "unusable",
    reportedAt: "2025-10-07T19:00",
    fixedAt: "2025-10-17T12:00",
    repairCost: 150.5,
  },
  {
    id: "d2",
    boatId: "boat-aigle",
    kind: "damage",
    severity: "limited",
    reportedAt: "2026-02-21T10:00",
    fixedAt: null,
    repairCost: null,
  },
  {
    id: "d3",
    boatId: "boat-castor",
    kind: "damage",
    severity: "usable",
    reportedAt: "2025-09-06T11:00",
    fixedAt: "2025-09-08T11:00",
    repairCost: 20,
  },
  {
    id: "d4",
    boatId: "boat-bison",
    kind: "unavailable",
    severity: "unusable",
    reportedAt: "2025-11-01T08:00",
    fixedAt: "2025-11-03T08:00",
    repairCost: null,
  },
  {
    id: "d5",
    boatId: "boat-bison",
    kind: "damage",
    severity: "limited",
    reportedAt: "2025-05-01T08:00",
    fixedAt: "2025-05-04T08:00",
    repairCost: 40,
  },
] as const;

const STAMP = "2024-01-01T00:00:00.000Z";

/**
 * Writes the fixture club into a migrated database (see
 * createAnalyticsTestDb). Damages are written only when `boat_damage`
 * exists.
 */
export const insertFixtureClub = async (
  db: SqlClient,
  options: { withDamages?: boolean } = {}
) => {
  for (const route of FIXTURE_ROUTES) {
    await db.execute(
      "INSERT INTO route (id, name, distance_m, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
      [route.id, route.name, route.distanceM, STAMP]
    );
  }
  for (const boat of FIXTURE_BOATS) {
    await db.execute(
      "INSERT INTO boat (id, name, build_year, exclude_from_stats, archived_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
      [
        boat.id,
        boat.name,
        boat.buildYear,
        boat.excludeFromStats ? 1 : 0,
        boat.archivedAt ?? null,
        STAMP,
      ]
    );
    if (boat.config) {
      await db.execute(
        "INSERT INTO boat_configuration (id, boat_id, seats, rigging, coxed, is_default) VALUES ($1, $2, $3, $4, $5, 1)",
        [
          `${boat.id}-config`,
          boat.id,
          boat.config.seats,
          boat.config.rigging,
          boat.config.coxed ? 1 : 0,
        ]
      );
    }
  }
  for (const r of FIXTURE_ROWERS) {
    await db.execute(
      "INSERT INTO rower (id, first_name, last_name, status, gender, birth_date, age_category, seriousness, exclude_from_stats, email, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)",
      [
        r.id,
        r.firstName,
        r.lastName,
        r.status,
        r.gender,
        r.birthDate,
        r.ageCategory,
        r.seriousness,
        r.excludeFromStats ? 1 : 0,
        `${r.id}@example.org`,
        STAMP,
      ]
    );
  }
  for (const o of FIXTURE_OUTINGS) {
    await db.execute(
      "INSERT INTO outing (id, boat_id, route_id, outing_type_code, start_date_time, estimated_end_date_time, end_date_time, distance_m, has_been_coached, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)",
      [
        o.id,
        o.boatId,
        o.routeId ?? null,
        o.type ?? "normal",
        o.start,
        o.estimatedEnd,
        o.end,
        o.distanceM ?? null,
        o.coached,
        STAMP,
      ]
    );
    for (const [position, rowerId] of o.crew.entries()) {
      const role = o.cox && position === o.crew.length - 1 ? "cox" : "rower";
      await db.execute(
        "INSERT INTO outing_crew (outing_id, rower_id, role, position) VALUES ($1, $2, $3, $4)",
        [o.id, rowerId, role, position]
      );
    }
  }
  for (const i of FIXTURE_INCIDENTS) {
    await db.execute(
      "INSERT INTO incident (id, outing_id, boat_id, message, occurred_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [i.id, i.outingId, i.boatId, "Choc sur la coque", i.at, STAMP]
    );
  }
  if (options.withDamages) {
    for (const d of FIXTURE_DAMAGES) {
      await db.execute(
        "INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, fixed_at, repair_cost, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
        [
          d.id,
          d.boatId,
          d.kind,
          d.severity,
          "Dégât",
          d.reportedAt,
          d.fixedAt,
          d.repairCost,
          STAMP,
        ]
      );
    }
  }
};
