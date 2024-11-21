import Database from "@tauri-apps/plugin-sql";
import { toast } from "sonner";
import createMigrationTable from "./migrations/00_migration-table";
import { getErrorMessage } from "../utils/error";
import { migrations } from "./migrations";

let db: Database | null = null;

export const getDatabase = async () => {
  try {
    if (db === null) {
      console.log("ℹ️ Loading database...");
      db = await Database.load("sqlite:main.db");

      await applyMigrations(db);
    }

    return db;
  } catch (e) {
    console.error(e);
    toast.error("Failed to load database");
  }
};

const applyMigrations = async (db: Database) => {
  try {
    db.execute(createMigrationTable);

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
