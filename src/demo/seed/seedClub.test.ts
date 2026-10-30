/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison -- test data compares enums to string literals */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";
import { loadClubData } from "../../_common/database/repositories/club.repository";
import type { SqlClient } from "../../_common/database/sqlClient";
import { getDatabase } from "../../_common/database/database";
import { getDrizzle } from "../../_common/database/drizzle";
import { getSeasonDate } from "../../_common/utils/seasons";
import { buildEfa2Export } from "../../_common/efa2/buildEfa2Export";
import {
  getBoatReservationState,
  getReservationsOverlapping,
  sortReservations,
  validateReservation,
} from "../../_common/business/reservation.rules";
import { loadReservations } from "../../_common/database/repositories/reservation.repository";
import { CONTENT } from "./content";
import type { StudioLocale } from "./content/types";
import type { SeedOptions } from "./scenario";
import { FEATURED_ROWER_OUTINGS, seedClub } from "./seedClub";
import { YOUNG_FIRST_NAMES } from "./names";
import { validateContent } from "./validate";

// Stats queries open the Tauri database: they get the test database instead.
vi.mock("../../_common/database/database", () => ({ getDatabase: vi.fn() }));

const NOW = "2026-06-20T09:47:00";
const LOCALES = Object.keys(CONTENT) as StudioLocale[];
const TABLES = [
  "setting",
  "boat",
  "boat_configuration",
  "boat_level_config",
  "rower",
  "route",
  "outing",
  "outing_crew",
  "incident",
  "change_log",
  "boat_reservation",
];

/** Text columns that differ between locales; everything else must not. */
const LOCALIZED: Record<string, string[]> = {
  boat: ["name"],
  rower: ["first_name", "last_name"],
  route: ["name"],
  outing: ["comment"],
  incident: ["message"],
  boat_reservation: ["person_name", "reason", "contact"],
};

type Row = Record<string, unknown>;

const dump = async (db: SqlClient) => {
  const tables: Record<string, Row[]> = {};
  for (const table of TABLES) {
    tables[table] = await db.select<Row[]>(
      `SELECT * FROM ${table} ORDER BY rowid`
    );
  }
  return tables;
};

const seed = async (
  locale: StudioLocale,
  modules?: SeedOptions["modules"],
  extra: Pick<SeedOptions, "coachNote"> = {}
) => {
  const db = createTestSqlClient();
  const started = performance.now();
  const scenario = await seedClub(db, { locale, now: NOW, modules, ...extra });
  return { db, scenario, ms: performance.now() - started };
};

/** Answers drizzle's "?" queries as well as the repositories' "$1" ones. */
const withPositionalParams = (
  client: ReturnType<typeof createTestSqlClient>
): SqlClient => ({
  execute: (sql, params) => client.execute(sql, params),
  select: <T>(sql: string, params: unknown[] = []) =>
    /\$\d+/.test(sql)
      ? client.select<T>(sql, params)
      : Promise.resolve(
          (
            client.raw.prepare(sql) as unknown as {
              all: (...values: unknown[]) => T;
            }
          ).all(...params)
        ),
});

beforeAll(() => {
  // Migrations announce themselves; the seed is quiet otherwise.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

beforeEach(() => {
  // created_at / updated_at come from the clock, frozen in the studio too.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("content packs", () => {
  it.each(LOCALES)("%s follows the content rules", (locale) => {
    expect(() => validateContent(CONTENT[locale])).not.toThrow();
  });

  it("reports every broken rule at once", () => {
    const broken = {
      ...CONTENT["fr-FR"],
      boatNames: ["Une coque au nom bien trop long", "Loire", "loire"],
      lastNames: ["Martin Jr."],
    };
    let message = "";
    try {
      validateContent(broken);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Content pack fr-FR is invalid:\n- /);
    expect(message).toContain("- boatNames has 3 entries, at least 38 needed");
    expect(message).toContain(
      '"Une coque au nom bien trop long" is 31 characters long, at most 14'
    );
    expect(message).toContain('"loire" repeats "Loire"');
    expect(message).toContain("- lastNames has 1 entries");
    expect(message).toContain('"Martin Jr." holds a title or suffix');
  });
});

describe.each(LOCALES)("seedClub(%s)", (locale) => {
  it("builds the club the scenes expect", async () => {
    const { db, scenario } = await seed(locale);
    const content = CONTENT[locale];
    const data = await loadClubData(db);

    expect(scenario.locale).toBe(locale);
    expect(scenario.clubName).toBe(content.clubName);
    expect(data.boats).toHaveLength(scenario.counts.boats);
    expect(data.rowers).toHaveLength(scenario.counts.rowers);
    expect(data.routes).toHaveLength(scenario.counts.routes);
    expect(data.incidents).toHaveLength(scenario.counts.incidents);
    expect(scenario.counts).toMatchObject({
      boats: 38,
      rowers: 110,
      routes: 5,
      incidents: 20,
    });
    const [{ outings }] = await db.select<{ outings: number }[]>(
      "SELECT COUNT(*) AS outings FROM outing"
    );
    expect(outings).toBe(scenario.counts.outings);

    expect(data.ongoingOutings).toHaveLength(9);
    expect(data.boats.filter((boat) => boat.isInMaintenance)).toHaveLength(2);
    expect(data.boatLevelConfigs).toHaveLength(6);
    expect(data.settings).toMatchObject({
      "onboarding.done": true,
      "modules.enabled": [],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      "club.passwordHash": expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(data.settings["club.coachNote"]).toBeUndefined();

    // Gender-matched first names from the pack (recent ones for juniors),
    // no two members alike.
    const rows = await db.select<
      {
        first_name: string;
        last_name: string;
        gender: "female" | "male";
        age_category: string;
      }[]
    >("SELECT first_name, last_name, gender, age_category FROM rower");
    for (const row of rows) {
      const list = content.firstNames[row.gender];
      expect(list).toContain(row.first_name);
      if (row.age_category !== "Senior") {
        expect(list.indexOf(row.first_name)).toBeLessThan(YOUNG_FIRST_NAMES);
      }
      expect(content.lastNames).toContain(row.last_name);
    }
    expect(new Set(data.rowers.map((rower) => rower.name)).size).toBe(
      data.rowers.length
    );
    expect(new Set(data.boats.map((boat) => boat.name)).size).toBe(
      data.boats.length
    );
    expect(data.routes.map((route) => route.name).sort()).toEqual(
      [...content.routes].sort()
    );
  }, 30_000);

  it("points the scenario at records that exist", async () => {
    const { db, scenario } = await seed(locale);
    const data = await loadClubData(db);
    const ongoing = data.ongoingOutings;
    const onWater = new Set(
      ongoing.flatMap((outing) => outing.rowers.map((rower) => rower.id))
    );

    // Start dialog: a free quad that can also be rigged as a four, a free crew.
    const startBoat = data.boats.find(
      (boat) => boat.id === scenario.start.boatId
    );
    expect(startBoat?.name).toBe(scenario.start.boatName);
    expect(startBoat?.type).toBe("FOUR_ROWERS_COXLESS");
    expect(startBoat?.isInMaintenance).toBe(false);
    expect(startBoat?.configurations).toHaveLength(2);
    expect(ongoing.some((outing) => outing.boat.id === startBoat?.id)).toBe(
      false
    );
    expect(
      data.boatLevelConfigs.some((config) => config.boatId === startBoat?.id)
    ).toBe(false);
    expect(
      data.routes.find((route) => route.id === scenario.start.routeId)
    ).toMatchObject({
      name: scenario.start.routeName,
      distanceM: 8000,
    });
    expect(scenario.start.crew).toHaveLength(4);
    for (const member of scenario.start.crew) {
      const rower = data.rowers.find((r) => r.id === member.id);
      expect(rower).toBeDefined();
      expect(onWater.has(member.id)).toBe(false);
      // As the crew picker labels its options (RowersSection getOptions).
      expect(member.name).toMatch(
        new RegExp(
          `^${rower!.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(Senior - .+\\)$`
        )
      );
    }

    // Stop dialog: a double out since 08:45, nothing typed yet.
    const stop = ongoing.find((outing) => outing.id === scenario.stop.outingId);
    expect(stop?.boat).toEqual({
      id: scenario.stop.boatId,
      name: scenario.stop.boatName,
    });
    expect(stop?.rowers).toHaveLength(2);
    expect(stop?.comment).toBe("");
    const [stopRow] = await db.select<{ start_date_time: string }[]>(
      "SELECT start_date_time FROM outing WHERE id = $1",
      [scenario.stop.outingId]
    );
    expect(stopRow.start_date_time).toBe("2026-06-20T08:45");

    // Every crew has a route and comes back this morning.
    for (const outing of ongoing) {
      expect(outing.route).not.toBeNull();
      const back = new Date(outing.estimatedEndDateTime!);
      expect([back.getDate(), back.getHours()]).toEqual([20, 10]);
    }

    // One boat in each section: the launch follows a crew of juniors.
    const launch = ongoing.find(
      (outing) =>
        data.boats.find((boat) => boat.id === outing.boat.id)?.type === "OTHER"
    );
    const followed = ongoing.filter(
      (outing) =>
        outing !== launch &&
        outing.startDateTime === launch?.startDateTime &&
        outing.route?.id === launch?.route?.id &&
        outing.estimatedEndDateTime === launch?.estimatedEndDateTime
    );
    expect(followed).toHaveLength(1);
    const coach = data.rowers.find(
      (rower) => rower.id === launch?.rowers[0].id
    );
    expect(launch?.rowers).toHaveLength(1);
    expect(coach?.type).toBeUndefined();
    expect(
      followed[0].rowers.every(
        (member) =>
          data.rowers.find((r) => r.id === member.id)?.category !== "Senior"
      )
    ).toBe(true);

    // Featured rower: about 110 outings this season, some as cox.
    expect(
      data.rowers.find((rower) => rower.id === scenario.rower.id)?.name
    ).toBe(scenario.rower.name);
    const [rowerSeason] = await db.select<{ rowing: number; cox: number }[]>(
      `SELECT SUM(c.role = 'rower') AS rowing, SUM(c.role = 'cox') AS cox
         FROM outing_crew c JOIN outing o ON o.id = c.outing_id
         WHERE c.rower_id = $1 AND o.end_date_time IS NOT NULL AND o.start_date_time >= '2025-08-01'`,
      [scenario.rower.id]
    );
    expect(rowerSeason.rowing).toBe(FEATURED_ROWER_OUTINGS);
    expect(rowerSeason.cox).toBeGreaterThanOrEqual(6);
    expect(rowerSeason.cox).toBeLessThanOrEqual(20);

    // Featured boat: in use all season, an incident last week.
    expect(data.boats.find((boat) => boat.id === scenario.boat.id)?.name).toBe(
      scenario.boat.name
    );
    const boatIncidents = data.incidents.filter(
      (incident) => incident.boatId === scenario.boat.id
    );
    expect(boatIncidents.length).toBeGreaterThanOrEqual(2);
    expect(
      boatIncidents[0].datetime >= new Date("2026-06-10T00:00").toISOString()
    ).toBe(true);
    const [boatSeason] = await db.select<{ outings: number }[]>(
      "SELECT COUNT(*) AS outings FROM outing WHERE boat_id = $1 AND start_date_time >= '2025-08-01' AND end_date_time IS NOT NULL",
      [scenario.boat.id]
    );
    expect(boatSeason.outings).toBeGreaterThan(80);
  }, 30_000);
});

describe.each(LOCALES)(
  "seedClub(%s) with the Reservations module",
  (locale) => {
    it("writes valid reservations that match what the scenes promise", async () => {
      const { db, scenario } = await seed(locale, ["reservations"]);
      const content = CONTENT[locale];
      const data = await loadClubData(db);
      const reservations = await loadReservations(db);
      const now = new Date(NOW);
      const promised = scenario.reservations!;

      expect(data.settings["modules.enabled"]).toEqual(["reservations"]);
      expect(reservations).toHaveLength(8);
      // Valid against the Logbook's own rules, none holding a boat twice at once.
      for (const reservation of reservations) {
        expect(
          validateReservation(
            reservation,
            reservations.filter((other) => other.id !== reservation.id)
          )
        ).toBeNull();
      }
      const { upcoming, past } = sortReservations(reservations, now);
      expect(promised.counts).toEqual({ upcoming: 5, past: 3 });
      expect([upcoming.length, past.length]).toEqual([5, 3]);

      // A weekly slot with a period, a two-day regatta with reason and contact, a masters crew held by a rower.
      expect(
        upcoming.map((reservation) => [
          reservation.recurrence,
          reservation.startTime,
        ])
      ).toEqual([
        ["weekly", "09:00"],
        ["weekly", "10:00"],
        ["weekly", "17:30"],
        ["weekly", "07:00"],
        ["once", "06:30"],
      ]);
      const [running, masters, juniors, , regatta] = upcoming;
      expect(juniors).toMatchObject({
        personName: content.reservations.holders.juniors,
        startDate: "2026-04-08",
        endDate: "2026-07-01",
        dayOfWeek: 3,
      });
      expect(regatta).toMatchObject({
        startDate: "2026-06-27",
        endDate: "2026-06-28",
        reason: content.reservations.reasons.regatta,
        contact: content.reservations.regattaContact,
      });
      expect(masters.rowerId).not.toBeNull();
      expect(masters.personName).toBeNull();
      expect(
        data.rowers.find((rower) => rower.id === masters.rowerId)?.name
      ).toBe(promised.notice.holder);

      // Boathouse: one boat reserved now (until 11:00), one soon (10:00); both are free boats.
      const onWater = new Set(
        data.ongoingOutings.map((outing) => outing.boat.id)
      );
      expect(running.boatId).toBe(promised.badges.now.boatId);
      expect(
        getBoatReservationState(reservations, promised.badges.now.boatId, now)
          ?.state
      ).toBe("reserved");
      expect(
        getBoatReservationState(reservations, promised.badges.soon.boatId, now)
          ?.state
      ).toBe("soon");
      expect(
        onWater.has(promised.badges.now.boatId) ||
          onWater.has(promised.badges.soon.boatId)
      ).toBe(false);

      // Start dialog: the double is reserved during a 90 minute outing now; the featured start boat is not.
      expect(promised.notice.boatId).toBe(promised.badges.soon.boatId);
      expect(
        getReservationsOverlapping(
          reservations,
          promised.notice.boatId,
          now,
          new Date(now.getTime() + 90 * 60_000)
        )
      ).toHaveLength(1);
      expect(
        data.boats.find((boat) => boat.id === promised.notice.boatId)?.name
      ).toBe(promised.notice.boatName);
      expect(
        getReservationsOverlapping(
          reservations,
          scenario.start.boatId,
          now,
          new Date(now.getTime() + 90 * 60_000)
        )
      ).toHaveLength(0);
      expect(promised.notice.boatId).not.toBe(scenario.stop.boatId);

      // Reservation dialog: a boat with no reservation yet, a period that starts on the day it repeats.
      expect(
        reservations.some(
          (reservation) => reservation.boatId === promised.form.boatId
        )
      ).toBe(false);
      expect(new Date(`${promised.form.periodStart}T12:00`).getDay()).toBe(
        promised.form.dayOfWeek
      );
      expect(new Date(`${promised.form.periodEnd}T12:00`).getDay()).toBe(
        promised.form.dayOfWeek
      );
    }, 30_000);
  }
);

describe("scenes of the 2.1 features", () => {
  it("write the damages the Damages scenes open, in every locale", async () => {
    for (const locale of LOCALES) {
      const { db, scenario } = await seed(locale, ["damages"]);
      const damages = await db.select<
        {
          boat_id: string;
          severity: string;
          fixed_at: string | null;
          description: string;
        }[]
      >("SELECT boat_id, severity, fixed_at, description FROM boat_damage");
      const promised = scenario.damages!;
      const open = damages.filter((damage) => damage.fixed_at === null);
      expect(open, locale).toHaveLength(promised.counts.open);
      expect(damages.length - open.length, locale).toBe(promised.counts.fixed);
      expect(open.map((damage) => damage.severity).sort(), locale).toEqual([
        "limited",
        "limited",
        "unusable",
        "unusable",
        "usable",
        "usable",
      ]);
      // The start dialog's quad shows its two open damages, none of them blocking.
      const onWarningBoat = open.filter(
        (damage) => damage.boat_id === promised.warning.boatId
      );
      expect(onWarningBoat.map((damage) => damage.description).sort()).toEqual(
        [...promised.warning.descriptions].sort()
      );
      expect(
        onWarningBoat.every((damage) => damage.severity !== "unusable")
      ).toBe(true);
    }
  }, 60_000);

  it("leave only the featured double on the water for the all-boats-back reminder", async () => {
    const db = createTestSqlClient();
    const scenario = await seedClub(db, {
      locale: "fr-FR",
      now: NOW,
      onWater: "one",
    });
    const onWater = await db.select<{ id: string }[]>(
      "SELECT id FROM outing WHERE end_date_time IS NULL"
    );
    expect(onWater.map((outing) => outing.id)).toEqual([
      scenario.stop.outingId,
    ]);
  }, 30_000);

  it("give the club a location (sunrise and sunset) and a free seat in the start scene", async () => {
    const { db, scenario } = await seed("fr-FR");
    const { settings } = await loadClubData(db);
    expect(settings["club.latitude"]).toBeCloseTo(47.4);
    expect(settings["club.longitude"]).toBeCloseTo(0.7);
    expect(scenario.start.typed).toBe(scenario.start.crew.length - 1);
    expect(scenario.damages).toBeNull();
    expect(scenario.past.late.crew).toHaveLength(2);
  }, 30_000);
});

describe("scenes without modules", () => {
  it("leave the club exactly as before: no module, no reservation", async () => {
    const { db, scenario } = await seed("fr-FR");
    expect(scenario.reservations).toBeNull();
    expect((await loadClubData(db)).settings["modules.enabled"]).toEqual([]);
    expect(await loadReservations(db)).toEqual([]);
  }, 30_000);
});

describe("scenes of the features page", () => {
  it("write the coach note only when asked, and a complete file for the featured rower only with the Member profile module", async () => {
    for (const locale of LOCALES) {
      const content = CONTENT[locale];
      const plain = await seed(locale);
      const plainData = await loadClubData(plain.db);
      expect(plainData.settings["club.coachNote"], locale).toBeUndefined();
      expect(
        plainData.rowers.find((rower) => rower.id === plain.scenario.rower.id)
          ?.licenseNumber ?? null
      ).toBeNull();

      const rich = await seed(locale, ["memberProfile", "guests"], {
        coachNote: true,
      });
      const data = await loadClubData(rich.db);
      expect(data.settings["club.coachNote"], locale).toBe(content.coachNote);
      const rower = data.rowers.find(
        (candidate) => candidate.id === rich.scenario.rower.id
      );
      expect(rower?.licenseNumber, locale).toBe(
        content.scenario.memberProfile.licenseNumber
      );
      expect(rower?.email, locale).toMatch(/^[a-z]\.[a-z-]+@mail\.test$/);
      // The guest typed at the start is nobody in the club: the picker offers to add it.
      expect(
        data.rowers.some(
          (candidate) => candidate.name === content.scenario.guestName
        ),
        `${locale}: ${content.scenario.guestName}`
      ).toBe(false);
    }
  }, 120_000);
});

describe("determinism", () => {
  it("gives identical rows for identical input", async () => {
    const first = await seed("fr-FR");
    const second = await seed("fr-FR");
    expect(await dump(second.db)).toEqual(await dump(first.db));
    expect(second.scenario).toEqual(first.scenario);
  }, 60_000);

  it("gives every locale the same club, only the words change", async () => {
    const strip = (tables: Record<string, Row[]>) =>
      Object.fromEntries(
        Object.entries(tables).map(([table, rows]) => [
          table,
          rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([column, value]) => [
                column,
                (LOCALIZED[table] ?? []).includes(column)
                  ? value !== null
                  : value,
              ])
            )
          ),
        ])
      );
    const reference = strip(await dump((await seed("fr-FR")).db));
    for (const locale of LOCALES.filter((l) => l !== "fr-FR")) {
      expect(strip(await dump((await seed(locale)).db)), locale).toEqual(
        reference
      );
    }
  }, 120_000);

  it("gives every locale the same reservations, only the words change", async () => {
    const strip = (tables: Record<string, Row[]>) =>
      tables.boat_reservation.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([column, value]) => [
            column,
            LOCALIZED.boat_reservation.includes(column)
              ? value !== null
              : value,
          ])
        )
      );
    const reference = strip(
      await dump((await seed("fr-FR", ["reservations"])).db)
    );
    expect(reference).toHaveLength(8);
    for (const locale of LOCALES.filter((l) => l !== "fr-FR")) {
      expect(
        strip(await dump((await seed(locale, ["reservations"])).db)),
        locale
      ).toEqual(reference);
    }
  }, 120_000);
});

describe("what the screens read", () => {
  let client: ReturnType<typeof createTestSqlClient>;
  let db: SqlClient;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
    client = createTestSqlClient();
    db = withPositionalParams(client);
    await seedClub(client, { locale: "en-US", now: NOW });
    vi.mocked(getDatabase).mockResolvedValue({
      db,
      drizzle: getDrizzle(db as never),
    } as never);
    vi.useRealTimers();
  }, 30_000);

  it("stats: two seasons of about 3000 outings with a seasonal curve", async () => {
    // Season = 1 August to 31 July (analytics.seasonStartMonth defaults to 8).
    const rows = await db.select<
      { season: number; month: number; outings: number }[]
    >(
      `SELECT CAST(substr(start_date_time, 1, 4) AS INTEGER)
                - (CAST(substr(start_date_time, 6, 2) AS INTEGER) < 8) AS season,
              CAST(substr(start_date_time, 6, 2) AS INTEGER) AS month,
              COUNT(*) AS outings
       FROM outing WHERE start_date_time < $1 GROUP BY season, month`,
      [NOW.slice(0, 10)]
    );
    for (const season of [2024, 2025]) {
      const byMonth = new Map(
        rows
          .filter((row) => row.season === season)
          .map((row) => [row.month, row.outings])
      );
      const total = [...byMonth.values()].reduce(
        (sum, count) => sum + count,
        0
      );
      expect(total).toBeGreaterThan(2600);
      expect(total).toBeLessThan(3300);
      // Peaks in September and in spring, a winter low around Christmas.
      expect(byMonth.get(9)!).toBeGreaterThan(byMonth.get(12)!);
      expect(byMonth.get(5)!).toBeGreaterThan(1.8 * byMonth.get(12)!);
      expect(byMonth.get(4)!).toBeGreaterThan(byMonth.get(1)!);
    }
    expect(
      rows.every((row) => row.season === 2024 || row.season === 2025)
    ).toBe(true);

    // Every boat type of the stats charts is rowed: 1x, 2x/2-, 4x/4-, 4+, 8+ and the launch.
    const shapes = await db.select<{ shape: string }[]>(
      `SELECT DISTINCT COALESCE(c.seats, 'none') || '/' || c.coxed AS shape
       FROM outing o JOIN boat_configuration c ON c.id = o.boat_configuration_id`
    );
    expect(new Set(shapes.map((row) => row.shape))).toEqual(
      new Set(["1/0", "2/0", "4/0", "4/1", "8/1", "none/0"])
    );
  });

  it("comparisons: the top of each ranking is not tied", async () => {
    const { startDate, endDate } = getSeasonDate(new Date(NOW));
    const params = [startDate.toISOString(), endDate.toISOString()];
    const rowers = await db.select<{ minutes: number }[]>(
      `SELECT SUM((julianday(o.end_date_time) - julianday(o.start_date_time)) * 1440) AS minutes
       FROM outing_crew c JOIN outing o ON o.id = c.outing_id
       WHERE c.role = 'rower' AND o.end_date_time IS NOT NULL AND o.start_date_time BETWEEN $1 AND $2
       GROUP BY c.rower_id ORDER BY minutes DESC LIMIT 15`,
      params
    );
    const boats = await db.select<{ minutes: number }[]>(
      `SELECT SUM((julianday(end_date_time) - julianday(start_date_time)) * 1440) AS minutes
       FROM outing WHERE end_date_time IS NOT NULL AND start_date_time BETWEEN $1 AND $2
       GROUP BY boat_id ORDER BY minutes DESC LIMIT 15`,
      params
    );
    for (const ranking of [rowers, boats]) {
      const minutes = ranking.map((row) => Math.round(row.minutes));
      expect(new Set(minutes).size).toBe(minutes.length);
    }

    // A few of the top nine cox other crews now and then.
    const coxed = await db.select<{ cox: number }[]>(
      `SELECT (SELECT COUNT(*) FROM outing_crew x JOIN outing y ON y.id = x.outing_id
               WHERE x.rower_id = c.rower_id AND x.role = 'cox' AND y.end_date_time IS NOT NULL
               AND y.start_date_time BETWEEN $1 AND $2) AS cox
       FROM outing_crew c JOIN outing o ON o.id = c.outing_id
       WHERE c.role = 'rower' AND o.end_date_time IS NOT NULL AND o.start_date_time BETWEEN $1 AND $2
       GROUP BY c.rower_id
       ORDER BY SUM((julianday(o.end_date_time) - julianday(o.start_date_time)) * 1440) DESC LIMIT 9`,
      params
    );
    const counts = coxed.map((row) => row.cox).filter((count) => count > 0);
    expect(counts.length).toBeGreaterThanOrEqual(3);
    expect(counts.length).toBeLessThanOrEqual(4);
    expect(new Set(counts).size).toBe(counts.length);
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(20);
    }
  });

  it("efa2 export: the whole club in yearly logbooks", async () => {
    const { report } = await buildEfa2Export(db, {
      labels: {
        statuses: { member: "Member", guest: "Guest", other: "Other" },
        defaultProjectName: "Harlow Creek Rowing Club",
        boathouseName: "Boathouse",
      },
      now: new Date(NOW),
    });
    expect(report).toMatchObject({
      boats: 38,
      rowers: 110,
      routes: 5,
      crewsCut: 0,
    });
    expect(report.logbooks).toEqual(["2024", "2025", "2026"]);
    const [{ outings }] = await db.select<{ outings: number }[]>(
      "SELECT COUNT(*) AS outings FROM outing"
    );
    expect(report.outings).toBe(outings);
  });
});
