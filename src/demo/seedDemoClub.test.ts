import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MODULE_IDS } from "../_common/business/modules.rules";
import { sortReservations } from "../_common/business/reservation.rules";
import { loadClubData } from "../_common/database/repositories/club.repository";
import { loadReservations } from "../_common/database/repositories/reservation.repository";
import type { SqlClient } from "../_common/database/sqlClient";
import { createTestSqlClient } from "../_common/database/testing/nodeSqlClient";
import { hashPassword } from "../_common/utils/password";
import { simplifyString } from "../_common/utils/string.utils";
import { addDays } from "./seed/calendar";
import { CONTENT } from "./seed/content";
import {
  DEMO_ADMIN_PASSWORD,
  seedDemoClub,
  type DemoLocale,
} from "./seedDemoClub";

const LOCALES = Object.keys(CONTENT) as DemoLocale[];

/** The clocks the demo must survive: hours, seasons, closed days, leap day, New Year. */
const NOWS = [
  "2026-10-29T14:05", // the day this was written, a Thursday afternoon
  "2026-06-20T09:47", // the studio's clock
  "2027-01-01T10:00", // New Year's Day, closed
  "2028-02-29T23:30", // leap day, late at night
  "2026-12-25T11:00", // Christmas
  "2026-07-31T05:00", // last day of the season, before dawn
  "2027-02-15T07:10", // a winter Monday, before the first crews
  "2026-08-01T12:00", // first day of a season
  "2030-04-13T18:45", // a Saturday evening in spring, years later
  "2027-03-14T16:59",
];

interface Seeded {
  db: ReturnType<typeof createTestSqlClient>;
  /** Calls to `execute` (the migrations of an empty database included). */
  statements: number;
  /** Size of the largest call: the whole club is one script. */
  scriptSize: number;
  now: string;
}

const seed = async (locale: DemoLocale, now: string): Promise<Seeded> => {
  const raw = createTestSqlClient();
  let statements = 0;
  let scriptSize = 0;
  const db: SqlClient = {
    execute: (sql, params) => {
      statements += 1;
      scriptSize = Math.max(scriptSize, sql.length);
      return raw.execute(sql, params);
    },
    select: <T>(sql: string, params?: unknown[]) => raw.select<T>(sql, params),
  };
  const result = await seedDemoClub(db, { locale, now });
  expect(result.clubName).toBe(CONTENT[locale].clubName);
  return { db: raw, statements, scriptSize, now };
};

type Row = Record<string, unknown>;
const all = (db: SqlClient, sql: string, params?: unknown[]) =>
  db.select<Row[]>(sql, params);
const count = async (db: SqlClient, sql: string, params?: unknown[]) =>
  Number((await all(db, sql, params))[0].n);

beforeAll(() => {
  // Migrations announce themselves.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-29T14:05") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the demo password", () => {
  it("is the one the club asks for", () => {
    expect(DEMO_ADMIN_PASSWORD).toBe("admin");
  });
});

describe.each(NOWS)("seedDemoClub at %s", (now) => {
  let seeded: Seeded;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(now) });
    seeded = await seed("fr-FR", now);
    vi.useRealTimers();
  }, 60_000);

  it("has what the statistics show: queries, dashboard, history", async () => {
    // Saved queries of every origin, and the starting dashboard (ADR 0008).
    expect(
      await count(seeded.db, "SELECT COUNT(*) AS n FROM analytics_query")
    ).toBeGreaterThanOrEqual(5);
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(DISTINCT origin) AS n FROM analytics_query"
      )
    ).toBeGreaterThanOrEqual(3);
    // Saved during the last months, never after now.
    const day = seeded.now.slice(0, 10);
    for (const { updated } of await all(
      seeded.db,
      "SELECT updated_at AS updated FROM analytics_query"
    )) {
      const savedOn = String(updated).slice(0, 10);
      expect(savedOn <= day, `${savedOn} after ${day}`).toBe(true);
      expect(savedOn > addDays(day, -365), savedOn).toBe(true);
    }
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM analytics_dashboard_item"
      )
    ).toBeGreaterThan(0);
    // Three seasons of outings, and former members kept as archived.
    const [{ first }] = await all(
      seeded.db,
      "SELECT MIN(start_date_time) AS first FROM outing"
    );
    const year = Number(seeded.now.slice(0, 4));
    expect(Number(String(first).slice(0, 4))).toBeLessThanOrEqual(year - 2);
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM rower WHERE archived_at IS NOT NULL"
      )
    ).toBeGreaterThan(0);
  });

  it("loads like a club that was onboarded with every module", async () => {
    const data = await loadClubData(seeded.db);
    expect(data.settings["onboarding.done"]).toBe(true);
    expect(data.settings["modules.enabled"]).toEqual([...MODULE_IDS]);
    expect(data.settings["modules.dismissedSuggestions"]).toEqual([
      ...MODULE_IDS,
    ]);
    expect(data.settings["club.passwordHash"]).toBe(
      hashPassword(DEMO_ADMIN_PASSWORD)
    );
    expect(data.settings["club.coachNote"]).toBe(CONTENT["fr-FR"].coachNote);
    // The 38 boats of the fleet and the two old ones of the statistics profile.
    expect(data.boats).toHaveLength(40);
    expect(data.rowers.length).toBeGreaterThan(100);
  });

  it("has no outing in the future, none ending after now", async () => {
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM outing WHERE start_date_time > $1",
        [now]
      )
    ).toBe(0);
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM outing WHERE end_date_time > $1",
        [now]
      )
    ).toBe(0);
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM outing WHERE end_date_time <= start_date_time"
      )
    ).toBe(0);
    // Incidents and damages are not from the future either.
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM incident WHERE occurred_at > $1",
        [now]
      )
    ).toBe(0);
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM boat_damage WHERE reported_at > $1 OR fixed_at > $1",
        [now]
      )
    ).toBe(0);
  });

  it("keeps ongoing outings on the water only while the club rows", async () => {
    const data = await loadClubData(seeded.db);
    const [, time] = now.split("T");
    // The stored local values: the loaded ones are UTC instants.
    const ongoing = await all(
      seeded.db,
      "SELECT start_date_time FROM outing WHERE end_date_time IS NULL"
    );
    expect(ongoing).toHaveLength(data.ongoingOutings.length);
    for (const { start_date_time: start } of ongoing) {
      expect(String(start) <= now).toBe(true);
      expect(String(start).slice(0, 10)).toBe(now.slice(0, 10));
    }
    if (time < "07:30" || time >= "20:00" || now.startsWith("2026-12-25")) {
      expect(data.ongoingOutings).toHaveLength(0);
    }
    if (now === "2026-10-29T14:05") {
      expect(data.ongoingOutings.length).toBeGreaterThanOrEqual(5);
    }
    // Nobody and no boat twice on the water or in overlapping outings.
    const rowerOverlaps = await count(
      seeded.db,
      `SELECT COUNT(*) AS n FROM outing_crew a
       JOIN outing_crew b ON a.rower_id = b.rower_id AND a.outing_id < b.outing_id
       JOIN outing o1 ON o1.id = a.outing_id
       JOIN outing o2 ON o2.id = b.outing_id
       WHERE o1.start_date_time < COALESCE(o2.end_date_time, '9999') AND o2.start_date_time < COALESCE(o1.end_date_time, '9999')`
    );
    expect(rowerOverlaps).toBe(0);
    const boatOverlaps = await count(
      seeded.db,
      `SELECT COUNT(*) AS n FROM outing o1 JOIN outing o2 ON o1.boat_id = o2.boat_id AND o1.id < o2.id
       WHERE o1.start_date_time < COALESCE(o2.end_date_time, '9999') AND o2.start_date_time < COALESCE(o1.end_date_time, '9999')`
    );
    expect(boatOverlaps).toBe(0);
  });

  it("covers a season and a half at least, with distances", async () => {
    const [{ first, n }] = await all(
      seeded.db,
      "SELECT MIN(start_date_time) AS first, COUNT(*) AS n FROM outing"
    );
    expect(Number(n)).toBeGreaterThan(2500);
    expect(Date.parse(now) - Date.parse(String(first))).toBeGreaterThan(
      360 * 86_400_000
    );
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM route WHERE distance_m IS NULL"
      )
    ).toBe(0);
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM outing WHERE route_id IS NOT NULL AND end_date_time IS NOT NULL AND distance_m IS NULL"
      )
    ).toBe(0);
  });

  it("shows outing types, captains and guests", async () => {
    const types = (
      await all(
        seeded.db,
        "SELECT outing_type_code AS code, COUNT(*) AS n FROM outing GROUP BY 1"
      )
    ).map((row) => String(row.code));
    expect(types).toEqual(
      expect.arrayContaining([
        "normal",
        "training",
        "instruction",
        "regatta",
        "training_camp",
        "tour",
        "motorboat",
      ])
    );
    expect(types).not.toContain("null");

    // A captain is part of the crew.
    expect(
      await count(
        seeded.db,
        "SELECT COUNT(*) AS n FROM outing WHERE captain_rower_id IS NOT NULL"
      )
    ).toBeGreaterThan(50);
    expect(
      await count(
        seeded.db,
        `SELECT COUNT(*) AS n FROM outing o WHERE captain_rower_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM outing_crew c WHERE c.outing_id = o.id AND c.rower_id = o.captain_rower_id)`
      )
    ).toBe(0);

    // The pack's five guests carry a note; the statistics profile adds
    // twenty more, without one.
    const guests = await all(
      seeded.db,
      "SELECT id, first_name, last_name, age_category, note FROM rower WHERE status = 'guest'"
    );
    expect(guests).toHaveLength(25);
    const noted = guests.filter((guest) => guest.note);
    expect(noted).toHaveLength(5);
    for (const guest of noted) {
      expect(
        await count(
          seeded.db,
          "SELECT COUNT(*) AS n FROM outing_crew WHERE rower_id = $1",
          [guest.id]
        )
      ).toBeGreaterThan(0);
    }
    for (const guest of guests) {
      // A guest is never the captain.
      expect(
        await count(
          seeded.db,
          "SELECT COUNT(*) AS n FROM outing WHERE captain_rower_id = $1",
          [guest.id]
        )
      ).toBe(0);
    }
  });

  it("fills member records", async () => {
    const members = await all(
      seeded.db,
      "SELECT * FROM rower WHERE status = 'member'"
    );
    const withEmail = members.filter((row) => row.email).length;
    expect(withEmail / members.length).toBeGreaterThan(0.6);
    expect(members.filter((row) => row.phone).length).toBeGreaterThan(40);
    expect(members.filter((row) => row.license_number).length).toBeGreaterThan(
      40
    );
    expect(members.filter((row) => row.address).length).toBeGreaterThan(40);
    expect(members.filter((row) => row.note)).toHaveLength(6);
    expect(members.every((row) => row.gender)).toBe(true);
    // Only a few occasional members of the statistics profile leave no birth date.
    expect(members.filter((row) => !row.birth_date).length).toBeLessThan(8);
    for (const row of members) {
      if (row.email)
        expect(row.email as string).toMatch(/^[a-z0-9.]+@.+\.example$/);
    }

    // Ages follow the category whatever the year.
    const year = Number(now.slice(0, 4));
    const ranges: Record<string, [number, number]> = {
      J14: [12, 15],
      J16: [14, 17],
      J18: [16, 19],
    };
    for (const row of members.filter((member) => member.birth_date)) {
      const age = year - Number(String(row.birth_date).slice(0, 4));
      const range = ranges[String(row.age_category)];
      if (range) {
        expect(age).toBeGreaterThanOrEqual(range[0]);
        expect(age).toBeLessThanOrEqual(range[1]);
      }
      expect(age).toBeGreaterThanOrEqual(10);
    }
  });

  it("has open and repaired damages of every severity", async () => {
    const data = await loadClubData(seeded.db);
    const open = data.damages.filter((damage) => damage.fixedAt === null);
    const repaired = data.damages.filter((damage) => damage.fixedAt !== null);
    expect(open.length).toBeGreaterThanOrEqual(5);
    expect(new Set(open.map((damage) => damage.severity))).toEqual(
      new Set(["usable", "limited", "unusable"])
    );
    expect(
      open.filter((damage) => damage.severity !== "unusable").length
    ).toBeGreaterThanOrEqual(3);
    expect(open.filter((damage) => damage.incidentId).length).toBeGreaterThan(
      1
    );
    expect(open.filter((damage) => !damage.incidentId).length).toBeGreaterThan(
      0
    );
    expect(repaired.length).toBeGreaterThanOrEqual(5);
    for (const damage of repaired) {
      expect(damage.repairNote).toBeTruthy();
      expect(damage.repairCost).not.toBeNull();
      expect(damage.fixedByRowerId).toBeTruthy();
      expect(damage.fixedAt! >= damage.reportedAt).toBe(true);
      expect(damage.description).not.toBe("");
    }
    expect(repaired.some((damage) => damage.incidentId)).toBe(true);
    expect(repaired.some((damage) => damage.outingId)).toBe(true);
    expect(new Set(repaired.map((damage) => damage.repairNote)).size).toBe(
      repaired.length
    );

    // A boat out of service is not rowed in meanwhile (stored local values:
    // the loaded ones are UTC instants).
    const unusable = await all(
      seeded.db,
      "SELECT boat_id, reported_at, fixed_at FROM boat_damage WHERE severity = 'unusable'"
    );
    expect(unusable.length).toBeGreaterThan(0);
    for (const damage of unusable) {
      expect(
        await count(
          seeded.db,
          "SELECT COUNT(*) AS n FROM outing WHERE boat_id = $1 AND start_date_time > $2 AND start_date_time < $3",
          [damage.boat_id, damage.reported_at, damage.fixed_at ?? "9999"]
        )
      ).toBe(0);
    }
  });

  it("has reservations to come, and a past", async () => {
    const reservations = await loadReservations(seeded.db);
    const { upcoming, past } = sortReservations(reservations, new Date(now));
    expect(upcoming.length).toBeGreaterThanOrEqual(5);
    expect(past.length).toBeGreaterThanOrEqual(1);
    expect(reservations.some((r) => r.recurrence === "weekly")).toBe(true);
    expect(reservations.some((r) => r.recurrence === "once")).toBe(true);
    expect(reservations.some((r) => r.rowerId)).toBe(true);
    expect(reservations.some((r) => r.personName)).toBe(true);
  });

  it("is written in one script, not thousands of calls over the IPC", () => {
    // The migrations of an empty database, then the club in a single call.
    expect(seeded.statements).toBeLessThan(40);
    expect(seeded.scriptSize).toBeGreaterThan(500_000);
    expect(seeded.scriptSize).toBeLessThan(6_000_000);
  });
});

describe("every locale", () => {
  it.each(LOCALES)(
    "%s seeds a coherent demo club",
    async (locale) => {
      const now = "2026-10-29T14:05";
      const { db, statements } = await seed(locale, now);
      const data = await loadClubData(db);
      expect(
        data.damages.filter((d) => d.fixedAt === null).length
      ).toBeGreaterThan(4);
      expect(
        data.damages.filter((d) => d.fixedAt !== null).length
      ).toBeGreaterThan(4);
      expect(data.ongoingOutings.length).toBeGreaterThan(5);
      expect(statements).toBeLessThan(40);

      // Names: distinct, none starting another (the crew picker filters by prefix).
      const names = (
        await all(
          db,
          "SELECT first_name || ' ' || last_name AS name FROM rower"
        )
      )
        .map((row) => simplifyString(String(row.name)))
        .sort();
      for (let i = 1; i < names.length; i++) {
        expect(names[i].startsWith(names[i - 1])).toBe(false);
      }
      const boats = (await all(db, "SELECT name FROM boat")).map((row) =>
        simplifyString(String(row.name))
      );
      expect(new Set(boats).size).toBe(boats.length);

      // Incident texts are the locale's own.
      const incidents = (await all(db, "SELECT message FROM incident")).map(
        (row) => String(row.message)
      );
      for (const message of incidents) {
        expect(CONTENT[locale].incidents).toContain(message);
      }
    },
    60_000
  );
});

describe("determinism", () => {
  it("gives identical rows for identical input", async () => {
    const dump = async (db: SqlClient) => {
      const tables: Record<string, Row[]> = {};
      for (const table of [
        "setting",
        "boat",
        "rower",
        "outing",
        "outing_crew",
        "incident",
        "boat_damage",
        "boat_reservation",
      ]) {
        tables[table] = await all(db, `SELECT * FROM ${table} ORDER BY rowid`);
      }
      return tables;
    };
    const first = await seed("de-DE", "2027-01-01T10:00");
    const second = await seed("de-DE", "2027-01-01T10:00");
    expect(await dump(second.db)).toEqual(await dump(first.db));
  }, 60_000);

  it("replaces an existing club instead of adding to it", async () => {
    const { db } = await seed("fr-FR", "2026-10-29T14:05");
    const before = await count(db, "SELECT COUNT(*) AS n FROM outing");
    await seedDemoClub(db, { locale: "en-GB", now: "2026-10-29T14:05" });
    expect(await count(db, "SELECT COUNT(*) AS n FROM outing")).toBe(before);
    expect(await count(db, "SELECT COUNT(*) AS n FROM rower")).toBeLessThan(
      200
    );
    const [{ name }] = await all(
      db,
      "SELECT name FROM boat ORDER BY id LIMIT 1"
    );
    expect(CONTENT["en-GB"].boatNames).toContain(String(name));
  }, 60_000);
});
