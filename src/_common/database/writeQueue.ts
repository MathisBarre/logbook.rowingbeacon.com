import { toast } from "sonner";
import i18n from "../i18n/config";
import { SqlClient } from "./sqlClient";

let resolveClient: (db: SqlClient) => void;
let clientPromise = new Promise<SqlClient>((resolve) => {
  resolveClient = resolve;
});
let queue: Promise<unknown> = Promise.resolve();
let reloadAfterFailure: ((db: SqlClient) => Promise<unknown>) | null = null;
let reloadScheduled = false;
let writeCount = 0;

/**
 * The stores keep club data in memory for the UI and write every change to
 * SQLite through this queue, one write at a time and in order (ADR 0003).
 */
export const setWriteClient = (db: SqlClient) => {
  resolveClient(db);
};

/**
 * Called once the queue has drained after a failed write, to replace the
 * in-memory stores with what SQLite really holds: the failed change
 * disappears from the screen instead of silently diverging.
 */
export const setReloadAfterFailedWrite = (
  reload: ((db: SqlClient) => Promise<unknown>) | null
) => {
  reloadAfterFailure = reload;
};

/**
 * A change made after the reload was queued is already on screen but is
 * written after the reload: reloading then would hide it until restart.
 * So the reload waits until no write was queued meanwhile.
 */
const scheduleReload = () => {
  if (reloadScheduled || !reloadAfterFailure) return;
  reloadScheduled = true;
  const reload = reloadAfterFailure;
  const writesWhenScheduled = writeCount;
  queue = queue.then(async () => {
    reloadScheduled = false;
    if (writeCount !== writesWhenScheduled) return scheduleReload();
    // One retry: until a reload succeeds the screen keeps the failed change.
    const db = await clientPromise;
    try {
      await reload(db).catch(() => reload(db));
    } catch (error) {
      console.error("❌ Failed to reload club data after a failed save", error);
      toast.error(i18n.t("database.reloadFailed"));
    }
    if (writeCount !== writesWhenScheduled) scheduleReload();
  });
};

/**
 * Resolves with false when the write failed (the error is already shown,
 * unless the caller shows its own with `quiet`).
 */
export const enqueueWrite = (
  label: string,
  write: (db: SqlClient) => Promise<unknown>,
  { quiet = false }: { quiet?: boolean } = {}
): Promise<boolean> => {
  writeCount++;
  const next = queue.then(async () => {
    const db = await clientPromise;
    try {
      await write(db);
      return true;
    } catch (error) {
      console.error(`❌ Failed to save: ${label}`, error);
      // One toast for a burst of failures (bulk edit on a locked database).
      if (!quiet) {
        toast.error(i18n.t("database.failedToSave"), {
          id: "database.failedToSave",
        });
      }
      scheduleReload();
      return false;
    }
  });
  queue = next;
  return next;
};

/** Resolves once every queued write has been attempted. */
export const flushWrites = () => queue.then(() => undefined);

/** Test helper. */
export const resetWriteQueueForTests = () => {
  queue = Promise.resolve();
  reloadAfterFailure = null;
  reloadScheduled = false;
  writeCount = 0;
  clientPromise = new Promise<SqlClient>((resolve) => {
    resolveClient = resolve;
  });
};
