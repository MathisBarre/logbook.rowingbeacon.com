import Database from "@tauri-apps/plugin-sql";
import { toast } from "sonner";
import { applyMigrations } from "./migrations";
import { ensureWalMode } from "./journalMode";
import { getDrizzle } from "./drizzle";
import i18n from "../i18n/config";
import { getActiveDatabaseUrl } from "../../demo/demoMode";

let db: Database | null = null;

export const getDatabase = async () => {
  try {
    if (db === null) {
      // main.db for the club, demo.db in demo mode (ADR 0009): the mode is
      // read here, once, and only changes with a reload.
      const url = getActiveDatabaseUrl();
      console.log(`ℹ️ Loading database ${url}...`);
      db = await Database.load(url);

      // Before anything reads: readers then never block the app's writes.
      await ensureWalMode(db);
      await applyMigrations(db);
    }

    const drizzle = getDrizzle(db);

    return { db, drizzle };
  } catch (e) {
    console.error(e);
    toast.error(i18n.t("database.failedToLoad"));
    throw e;
  }
};

/**
 * Close every connection to the club database. A script that failed inside
 * a transaction can leave it open on one connection of the pool; closing
 * the pool rolls it back. The next getDatabase() opens it again.
 */
export const closeDatabase = async () => {
  if (db === null) return;
  const current = db;
  db = null;
  await current.close(current.path).catch((error: unknown) => {
    console.error("❌ Closing the database failed", error);
  });
};
