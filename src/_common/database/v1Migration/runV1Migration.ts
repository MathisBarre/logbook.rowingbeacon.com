import { SqlClient, sqlLiteral } from "../sqlClient";
import {
  planV1Migration,
  V1LocalData,
  V1SessionRow,
  V1SessionRowerRow,
} from "./planV1Migration";

/** localStorage keys written by the v1 zustand stores. */
export const V1_LOCAL_STORAGE_KEYS = [
  "clubOverview",
  "sessions",
  "incidents",
  "boatLevelConfigStore",
] as const;

export const V1_MIGRATION_SETTING_KEY = "migration.v1";

export interface V1MigrationDependencies {
  readLocalStorage: (key: string) => string | null;
  removeLocalStorage: (key: string) => void;
  /** Writes the backup and resolves with where it went. */
  writeBackup: (content: string) => Promise<string>;
  unknownLabels?: { boat: string; rower: string; route: string };
  now?: Date;
  generateId?: () => string;
}

export type V1MigrationResult =
  | { status: "already-done" }
  | { status: "nothing-to-migrate" }
  | {
      status: "migrated";
      backupLocation: string;
      counts: Record<string, number>;
      skipped: number;
    };

const parsePersistedState = <T>(raw: string | null): T | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { state?: T };
    return parsed.state;
  } catch {
    return undefined;
  }
};

/**
 * Copy v1 data (localStorage + v1 tables) into the v2 tables.
 *
 * The Tauri SQL plugin cannot hold a transaction across calls, so the
 * migration is made safe by being re-runnable instead: it wipes the v2
 * tables first, only marks itself done after the row counts are verified,
 * and only then clears localStorage. The v1 tables are left untouched.
 */
export const runV1Migration = async (
  db: SqlClient,
  deps: V1MigrationDependencies
): Promise<V1MigrationResult> => {
  const done = await db.select<{ value: string }[]>(
    "SELECT value FROM setting WHERE key = $1",
    [V1_MIGRATION_SETTING_KEY]
  );
  if (done.length > 0) {
    // The removal after a migration may not have reached the disk (app
    // killed right after): the v1 copy of the club must not linger.
    for (const key of V1_LOCAL_STORAGE_KEYS) {
      deps.removeLocalStorage(key);
    }
    return { status: "already-done" };
  }

  const raw = Object.fromEntries(
    V1_LOCAL_STORAGE_KEYS.map((key) => [key, deps.readLocalStorage(key)])
  ) as Record<(typeof V1_LOCAL_STORAGE_KEYS)[number], string | null>;

  const local: V1LocalData = {
    clubOverview: parsePersistedState(raw.clubOverview),
    sessions: parsePersistedState(raw.sessions),
    incidents: parsePersistedState(raw.incidents),
    boatLevelConfigStore: parsePersistedState(raw.boatLevelConfigStore),
  };

  // A store that cannot be read at all is reported like a damaged record.
  const unreadableStores = V1_LOCAL_STORAGE_KEYS.filter(
    (key) => raw[key] !== null && local[key] === undefined
  ).map((key) => ({ kind: "store", reason: "unreadable", record: key }));

  const legacySessions = await db.select<V1SessionRow[]>(
    "SELECT id, boat_id, start_date_time, estimated_end_date_time, route_id, end_date_time, comment, has_been_coached FROM session"
  );
  const legacySessionRowers = await db.select<V1SessionRowerRow[]>(
    "SELECT session_id, rower_id FROM session_rowers"
  );

  const hasLocalData = V1_LOCAL_STORAGE_KEYS.some((key) => raw[key] !== null);

  if (!hasLocalData && legacySessions.length === 0) {
    await markDone(db, { status: "nothing-to-migrate" });
    return { status: "nothing-to-migrate" };
  }

  const plan = planV1Migration({
    local,
    legacySessions,
    legacySessionRowers,
    now: deps.now,
    generateId: deps.generateId,
    unknownLabels: deps.unknownLabels,
  });
  const skippedRecords = [...unreadableStores, ...plan.skipped];

  const backupLocation = await deps.writeBackup(
    JSON.stringify(
      {
        createdAt: (deps.now ?? new Date()).toISOString(),
        description:
          "Rowing Beacon v1 data saved before the v2 migration. The v1 session tables stay in main.db. Records listed in skipped could not be copied (or were only partly copied). Records listed in placeholders were created, archived, for ids that outings used but no list held.",
        skipped: skippedRecords,
        placeholders: plan.placeholders,
        localStorage: raw,
      },
      null,
      2
    )
  );

  for (const statement of plan.statements) {
    await db.execute(statement);
  }

  const counts: Record<string, number> = {};
  for (const [table, expected] of Object.entries(plan.expected)) {
    const [{ count }] = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) AS count FROM ${table}`
    );
    if (Number(count) !== expected) {
      throw new Error(
        `v1 migration check failed for ${table}: expected ${expected} rows, found ${count}`
      );
    }
    counts[table] = expected;
  }

  const skipped = skippedRecords.length;
  await markDone(db, { status: "migrated", backupLocation, counts, skipped });

  for (const key of V1_LOCAL_STORAGE_KEYS) {
    deps.removeLocalStorage(key);
  }

  return { status: "migrated", backupLocation, counts, skipped };
};

const markDone = async (db: SqlClient, value: Record<string, unknown>) => {
  await db.execute(
    `INSERT OR REPLACE INTO setting (key, value) VALUES (${sqlLiteral(V1_MIGRATION_SETTING_KEY)}, ${sqlLiteral(
      JSON.stringify({ ...value, at: new Date().toISOString() })
    )});`
  );
};
