import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../_common/database/migrations";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";
import { SqlClient } from "../../_common/database/sqlClient";
import {
  createNodeEngine,
  NodeEngine,
  NodeEngineOptions,
} from "../engine/nodeEngine";

/**
 * Test helpers (never imported by app code): a migrated SQLite file that
 * the read-only node engine can open, and a few inserts.
 */

export interface AnalyticsTestDb {
  path: string;
  /** Read-write client (same `$1` style as the app). */
  db: SqlClient & { close: () => Promise<void> };
  /** Read-only engine over the same file. */
  engine: (options?: NodeEngineOptions) => NodeEngine;
  cleanup: () => Promise<void>;
}

export const createAnalyticsTestDb = async (
  options: {
    /** Drops `boat_damage`, to test a report whose table is missing. */
    withoutDamages?: boolean;
  } = {}
): Promise<AnalyticsTestDb> => {
  const dir = mkdtempSync(join(tmpdir(), "rb-analytics-"));
  const path = join(dir, "main.db");
  const db = createTestSqlClient(path);
  // applyMigrations logs every step: keep test output readable.
  const log = console.log;
  console.log = () => undefined;
  try {
    await applyMigrations(db);
  } finally {
    console.log = log;
  }
  if (options.withoutDamages) {
    await db.execute("DROP TABLE boat_damage");
  }
  return {
    path,
    db,
    engine: (engineOptions) => createNodeEngine(path, engineOptions),
    cleanup: async () => {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

const STAMP = "2025-01-01T00:00:00.000Z";

export const insertTestBoat = async (
  db: SqlClient,
  boat: {
    id: string;
    name: string;
    seats?: number | null;
    rigging?: "scull" | "sweep" | null;
    coxed?: boolean;
    excludeFromStats?: boolean;
  }
) => {
  await db.execute(
    "INSERT INTO boat (id, name, exclude_from_stats, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
    [boat.id, boat.name, boat.excludeFromStats ? 1 : 0, STAMP]
  );
  if (boat.seats !== undefined) {
    await db.execute(
      "INSERT INTO boat_configuration (id, boat_id, seats, rigging, coxed, is_default) VALUES ($1, $2, $3, $4, $5, 1)",
      [
        `${boat.id}-c`,
        boat.id,
        boat.seats,
        boat.rigging ?? null,
        boat.coxed ? 1 : 0,
      ]
    );
  }
};

export const insertTestRower = async (
  db: SqlClient,
  rower: {
    id: string;
    firstName: string;
    lastName?: string;
    status?: "member" | "guest" | "other";
    gender?: "female" | "male" | "other" | null;
    birthDate?: string | null;
  }
) => {
  await db.execute(
    "INSERT INTO rower (id, first_name, last_name, status, gender, birth_date, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
    [
      rower.id,
      rower.firstName,
      rower.lastName ?? "",
      rower.status ?? "member",
      rower.gender ?? null,
      rower.birthDate ?? null,
      STAMP,
    ]
  );
};

export const insertTestOuting = async (
  db: SqlClient,
  outing: {
    id: string;
    boatId: string;
    start: string;
    end?: string | null;
    crew?: string[];
    distanceM?: number | null;
    outingTypeCode?: string | null;
    coached?: boolean | null;
  }
) => {
  await db.execute(
    "INSERT INTO outing (id, boat_id, start_date_time, end_date_time, distance_m, outing_type_code, has_been_coached, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)",
    [
      outing.id,
      outing.boatId,
      outing.start,
      outing.end ?? null,
      outing.distanceM ?? null,
      outing.outingTypeCode ?? null,
      outing.coached === undefined || outing.coached === null
        ? null
        : outing.coached
          ? 1
          : 0,
      STAMP,
    ]
  );
  for (const [position, rowerId] of (outing.crew ?? []).entries()) {
    await db.execute(
      "INSERT INTO outing_crew (outing_id, rower_id, role, position) VALUES ($1, $2, 'rower', $3)",
      [outing.id, rowerId, position]
    );
  }
};
