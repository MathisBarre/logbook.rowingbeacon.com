import { getErrorMessage } from "../utils/error";
import { SqlClient } from "./sqlClient";

/**
 * Puts the club database in WAL mode if it is not (review A, L8). In WAL
 * mode readers never block the boathouse's writes: the read-only
 * statistics engine, the MCP server and a backup can read while outings
 * are saved. sqlx only sets WAL on a database it creates, so a `main.db`
 * copied in by hand or made by other tooling can still be in rollback
 * mode, where a 20 s report would make saves fail after the 5 s busy
 * timeout.
 *
 * Safe at start-up: the switch is persistent, needs no other connection
 * to be reading (it fails with SQLITE_BUSY otherwise, and is tried again
 * at the next start), and never loses data. A failure is logged, never
 * thrown: the app works in rollback mode too, only less concurrently.
 * Returns the journal mode in use afterwards ("wal", "delete"...).
 */
export const ensureWalMode = async (db: SqlClient): Promise<string> => {
  const read = async (sql: string) => {
    const rows = await db.select<{ journal_mode?: string }[]>(sql);
    return String(rows[0]?.journal_mode ?? "").toLowerCase();
  };
  let mode = "";
  try {
    mode = await read("PRAGMA journal_mode");
    // "memory" (tests) cannot change; "wal" is the goal.
    if (mode === "wal" || mode === "memory") return mode;
    mode = await read("PRAGMA journal_mode = WAL");
    if (mode === "wal") {
      console.log("✅ Database switched to WAL mode");
    } else {
      console.warn(`⚠️ The database stays in ${mode} mode (WAL refused)`);
    }
  } catch (error) {
    console.warn(
      `⚠️ Could not switch the database to WAL mode: ${getErrorMessage(error)}`
    );
  }
  return mode;
};
