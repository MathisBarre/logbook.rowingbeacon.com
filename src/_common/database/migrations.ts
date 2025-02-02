import createSessionTable from "./migrations/01_create-session-table";
import updateSessionTable from "./migrations/02_update-session-table";
import createSessionRowersTable from "./migrations/03_session_rowers-table";
import addIndexes from "./migrations/04_add-index";
import createMigrationTable from "./migrations/00_migration-table";
import Database from "@tauri-apps/plugin-sql";
import { getErrorMessage } from "../utils/error";

export const applyMigrations = async (db: Database) => {
  try {
    await db.execute(createMigrationTable);

    migrations.sort(sortByTimestamp);

    for (const migration of migrations) {
      const { timestamp, sql, label } = migration;

      const applied = await db.select<{ timestamp: number }[]>(
        "SELECT * FROM migration WHERE timestamp = $1",
        [timestamp]
      );

      if (applied.length === 0) {
        await db.execute(sql);
        await db.execute("INSERT INTO migration (timestamp) VALUES ($1)", [
          timestamp,
        ]);
        console.log(`✅ Migration "${label}" applied`);
      } else {
        console.log(`⏩ Migration "${label}" has been skipped`);
      }
    }

    console.log("✅ All migration applied");
  } catch (e) {
    console.error("❌" + getErrorMessage(e));
    throw e;
  }
};

const sortByTimestamp = (
  a: { timestamp: number },
  b: { timestamp: number }
) => {
  return a.timestamp - b.timestamp;
};

export const migrations: {
  label: string;
  timestamp: number;
  sql: string;
}[] = [
  {
    label: "Create session table",
    timestamp: 1732188036770,
    sql: createSessionTable,
  },
  {
    label: "Update session table",
    timestamp: 1732189377064,
    sql: updateSessionTable,
  },
  {
    label: "Session rowers table",
    timestamp: 1732189665154,
    sql: createSessionRowersTable,
  },
  {
    label: "Add indexes to improve performance on existing tables",
    timestamp: 1732189896438,
    sql: addIndexes,
  },
];
