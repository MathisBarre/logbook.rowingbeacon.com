import Database from "@tauri-apps/plugin-sql";
import { toast } from "sonner";
import { applyMigrations } from "./migrations";
import { getDrizzle } from "./drizzle";
import i18n from "../i18n/config";

let db: Database | null = null;

export const getDatabase = async () => {
  try {
    if (db === null) {
      console.log("ℹ️ Loading database...");
      db = await Database.load("sqlite:main.db");

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
