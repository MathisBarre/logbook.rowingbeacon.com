import Database from "@tauri-apps/plugin-sql";
import { toast } from "sonner";
import { applyMigrations } from "./migrations";
import { getDrizzle } from "./drizzle";

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
    toast.error("Failed to load database");
    throw e;
  }
};
