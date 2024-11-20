import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;

const getDB = async () => {
  if (!db) {
    db = await Database.load("sqlite:main.db");
  }
  return db;
};
