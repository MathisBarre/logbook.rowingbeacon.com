import { createRequire } from "node:module";

/**
 * A deterministic fake club for checking the reports on realistic volumes
 * (port of the planning validation seed): 37 boats in nine classes, 380
 * rowers (members, guests, others; some without gender, birth date or
 * category), 10 routes, outings every day from `from` to `to` with
 * seasonal and weekly rhythms, efa2-like and multi-day outings, motorboat
 * launches, incidents and damages. One boat is archived, one boat and one
 * rower are excluded from statistics. The same seed always gives the same
 * club, whatever the time zone (dates are computed in UTC components and
 * written as local wall-clock text).
 *
 * `outingsPerDay` 12 gives about 10k outings over three seasons, 110
 * about 44k; the perf test uses 250 over six seasons (about 100k).
 */

interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const require = createRequire(import.meta.url);

const openDatabase = (path: string): Database => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { DatabaseSync } = require("node:sqlite");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return new DatabaseSync(path) as Database;
};

/** mulberry32. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pad = (n: number) => String(n).padStart(2, "0");
const MINUTE = 60_000;
const DAY = 86_400_000;

/** Epoch milliseconds of a local text "YYYY-MM-DD[THH:mm]", as UTC. */
const parseLocal = (text: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text);
  if (!match) throw new Error(`Invalid local date: ${text}`);
  const [, y, mo, d, h, mi] = match;
  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0)
  );
};

const formatLocal = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

interface SeedOptions {
  outingsPerDay?: number;
  from?: string;
  to?: string;
  /** Outings ending after `now` stay ongoing. */
  now?: string;
  seed?: number;
}

export interface SeedSummary {
  outings: number;
  crew: number;
  boats: number;
  rowers: number;
}

const BOAT_CLASSES: [string, number | null, string | null, 0 | 1, number][] = [
  ["1x", 1, "scull", 0, 12],
  ["2x", 2, "scull", 0, 8],
  ["2-", 2, "sweep", 0, 2],
  ["4x", 4, "scull", 0, 4],
  ["4x+", 4, "scull", 1, 3],
  ["4+", 4, "sweep", 1, 3],
  ["4-", 4, "sweep", 0, 2],
  ["8+", 8, "sweep", 1, 2],
  ["?", null, null, 0, 1],
];
const OUTING_TYPES = [
  "normal",
  "normal",
  "normal",
  "training",
  "training",
  "regatta",
  "instruction",
  "tour",
];
const SEASONAL = [0.5, 0.6, 0.8, 1, 1.2, 1.3, 1.1, 0.4, 1.2, 1.1, 0.8, 0.5];
const WEEKLY = [1.8, 0.6, 0.9, 1.0, 0.7, 0.8, 2.0];

/** Writes the club into the migrated database at `path`. */
export const seedAnalyticsClub = (
  path: string,
  {
    outingsPerDay = 12,
    from = "2023-08-01",
    to = "2026-06-20",
    now = "2026-06-20T09:47",
    seed = 42,
  }: SeedOptions = {}
): SeedSummary => {
  const db = openDatabase(path);
  const rand = prng(seed);
  const pick = <T>(values: T[]): T =>
    values[Math.floor(rand() * values.length)];
  const uuid = () => {
    const h = Array.from({ length: 32 }, () =>
      Math.floor(rand() * 16).toString(16)
    ).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(
      17,
      20
    )}-${h.slice(20, 32)}`;
  };
  const stamp = "2023-01-01T00:00:00.000Z";
  const nowMs = parseLocal(now);

  db.exec("BEGIN");
  try {
    const insBoat = db.prepare(
      "INSERT INTO boat (id, name, exclude_from_stats, archived_at, build_year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insConf = db.prepare(
      "INSERT INTO boat_configuration (id, boat_id, position, seats, rigging, coxed, is_default) VALUES (?, ?, 0, ?, ?, ?, 1)"
    );
    const boats: {
      id: string;
      configurationId: string;
      seats: number | null;
      coxed: 0 | 1;
      archivedMs: number | null;
    }[] = [];
    let n = 0;
    for (const [code, seats, rigging, coxed, count] of BOAT_CLASSES) {
      for (let i = 0; i < count; i++) {
        n++;
        const id = uuid();
        const archived = n === 5 ? "2025-01-10T10:00" : null;
        insBoat.run(
          id,
          `Bateau ${code} ${i + 1}`,
          n === 7 ? 1 : 0,
          archived,
          1990 + Math.floor(rand() * 35),
          stamp,
          stamp
        );
        const configurationId = uuid();
        insConf.run(configurationId, id, seats, rigging, coxed);
        boats.push({
          id,
          configurationId,
          seats,
          coxed,
          archivedMs: archived ? parseLocal(archived) : null,
        });
        rand(); // popularity draw of the original seed, kept for stability
      }
    }

    const insRower = db.prepare(
      "INSERT INTO rower (id, first_name, last_name, status, age_category, seriousness, gender, birth_date, email, exclude_from_stats, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const fromMs = parseLocal(from);
    const toMs = parseLocal(to);
    const rowers: {
      id: string;
      joined: number;
      left: number;
      weight: number;
    }[] = [];
    for (let i = 0; i < 380; i++) {
      const id = uuid();
      const status = i < 320 ? "member" : rand() < 0.8 ? "guest" : "other";
      const gender = rand() < 0.1 ? null : rand() < 0.42 ? "female" : "male";
      const birthYear = 1950 + Math.floor(rand() * 64);
      const birth =
        rand() < 0.3
          ? null
          : `${birthYear}-${pad(1 + Math.floor(rand() * 12))}-${pad(
              1 + Math.floor(rand() * 28)
            )}`;
      const age = 2025 - birthYear;
      const category =
        birth === null && rand() < 0.5
          ? null
          : age <= 10
            ? "J10"
            : age <= 12
              ? "J12"
              : age <= 14
                ? "J14"
                : age <= 16
                  ? "J16"
                  : age <= 18
                    ? "J18"
                    : "Senior";
      const joined = i < 150 ? fromMs : fromMs + rand() * (toMs - fromMs);
      const stays = rand();
      const left =
        stays < 0.3
          ? joined + (30 + rand() * 120) * DAY
          : stays < 0.5
            ? joined + rand() * 600 * DAY
            : Infinity;
      insRower.run(
        id,
        `Prénom${i}`,
        `Nom${i}`,
        status,
        category,
        rand() < 0.25 ? "competitor" : "recreational",
        gender,
        birth,
        `r${i}@example.org`,
        i === 3 ? 1 : 0,
        stamp,
        stamp
      );
      rowers.push({
        id,
        joined,
        left,
        weight: status === "member" ? 0.2 + rand() * rand() * 4 : 0.05,
      });
    }

    const insRoute = db.prepare(
      "INSERT INTO route (id, name, distance_m, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    const routes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = uuid();
      insRoute.run(
        id,
        `Parcours ${i + 1}`,
        i < 8 ? 4000 + i * 2000 : null,
        stamp,
        stamp
      );
      routes.push(id);
    }

    const insOuting = db.prepare(
      "INSERT INTO outing (id, boat_id, boat_configuration_id, route_id, outing_type_code, start_date_time, estimated_end_date_time, end_date_time, distance_m, has_been_coached, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insCrew = db.prepare(
      "INSERT INTO outing_crew (outing_id, rower_id, role, position) VALUES (?, ?, ?, ?)"
    );
    const insIncident = db.prepare(
      "INSERT INTO incident (id, outing_id, boat_id, message, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const hasDamages = db
      .prepare("SELECT 1 FROM sqlite_master WHERE name = 'boat_damage'")
      .get();
    const insDamage = hasDamages
      ? db.prepare(
          "INSERT INTO boat_damage (id, boat_id, kind, severity, description, reported_at, fixed_at, repair_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
      : null;

    let outings = 0;
    let crewRows = 0;
    const busy = new Map<string, number>();
    for (let t = fromMs; t <= toMs; t += DAY) {
      const day = new Date(t);
      const dow = day.getUTCDay();
      const count = Math.round(
        outingsPerDay *
          SEASONAL[day.getUTCMonth()] *
          WEEKLY[dow] *
          (0.7 + rand() * 0.6)
      );
      busy.clear();
      const active = rowers.filter((r) => r.joined <= t && t <= r.left);
      const totalWeight = active.reduce((sum, r) => sum + r.weight, 0);
      for (let k = 0; k < count; k++) {
        if (active.length < 10) break;
        const boat = boats[Math.floor(Math.pow(rand(), 1.6) * boats.length)];
        if (boat.archivedMs !== null && t > boat.archivedMs) continue;
        const hour = pick(
          dow === 0 || dow === 6
            ? [8, 9, 9, 10, 10, 11, 14, 15]
            : [7, 12, 12, 18, 18, 18, 19]
        );
        const start =
          t + hour * 3_600_000 + Math.floor(rand() * 4) * 15 * MINUTE;
        const duration = 45 + Math.floor(rand() * 90);
        if (start > nowMs) continue;
        if ((busy.get(boat.id) ?? 0) > start) continue;
        busy.set(boat.id, start + duration * MINUTE);
        const type = boat.seats === null ? "motorboat" : pick(OUTING_TYPES);
        const estimated = rand() < 0.8 ? start + 90 * MINUTE : null;
        const multiDay = type === "tour" && rand() < 0.2;
        const end =
          start +
          (multiDay
            ? 2 * DAY
            : duration * MINUTE + (rand() < 0.05 ? 60 * MINUTE : 0));
        const forgotten = rand() < 0.0005;
        // efa2 imports carry no time: one outing in fifty starts at 00:00.
        const efa = rand() < 0.02;
        const id = uuid();
        const route = rand() < 0.85 ? pick(routes) : null;
        const coached = rand() < 0.2 ? null : rand() < 0.35 ? 1 : 0;
        const startText = efa
          ? `${formatLocal(start).slice(0, 10)}T00:00`
          : formatLocal(start);
        insOuting.run(
          id,
          boat.id,
          rand() < 0.02 ? null : boat.configurationId,
          route,
          type,
          startText,
          estimated && !efa ? formatLocal(estimated) : null,
          end > nowMs || forgotten ? null : efa ? startText : formatLocal(end),
          rand() < 0.6 ? 3000 + Math.floor(rand() * 15000) : null,
          coached,
          stamp,
          stamp
        );
        const size = (boat.seats ?? 1) + boat.coxed;
        const chosen = new Set<string>();
        let guard = 0;
        while (chosen.size < size && guard++ < 200) {
          let x = rand() * totalWeight;
          for (const r of active) {
            x -= r.weight;
            if (x <= 0) {
              chosen.add(r.id);
              break;
            }
          }
        }
        [...chosen].forEach((rowerId, position) => {
          insCrew.run(
            id,
            rowerId,
            boat.coxed && position === size - 1 ? "cox" : "rower",
            position
          );
          crewRows++;
        });
        if (rand() < 0.012) {
          insIncident.run(
            uuid(),
            id,
            boat.id,
            "Choc sur la coque",
            formatLocal(end),
            stamp
          );
        }
        if (rand() < 0.004) {
          const fixed = rand() < 0.8 ? end + (2 + rand() * 40) * DAY : null;
          insDamage?.run(
            uuid(),
            boat.id,
            "damage",
            pick(["usable", "limited", "unusable"]),
            "Dégât",
            formatLocal(end),
            fixed !== null && fixed < nowMs ? formatLocal(fixed) : null,
            rand() < 0.5 ? Math.round(rand() * 400) : null,
            stamp,
            stamp
          );
        }
        outings++;
      }
    }
    db.exec("COMMIT");
    db.exec("ANALYZE");
    return {
      outings,
      crew: crewRows,
      boats: boats.length,
      rowers: rowers.length,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
};
