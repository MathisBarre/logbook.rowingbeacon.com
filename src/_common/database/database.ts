import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

export const getDatabase = async () => {
  if (!db) {
    db = await Database.load("sqlite:main.db");
  }
  return db;
};
