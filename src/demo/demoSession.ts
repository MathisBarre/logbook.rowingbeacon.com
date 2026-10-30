import { toast } from "sonner";
import i18n from "../_common/i18n/config";
import { closeDatabase } from "../_common/database/database";
import type { SqlClient } from "../_common/database/sqlClient";
import { flushWrites } from "../_common/database/writeQueue";
import { useLocaleStore } from "../_common/store/locale.store";
import { clearDemoAnalyticsLocalMemory } from "../analytics/store/localMemory";
import {
  beginDemo,
  endDemo,
  formatLocalNow,
  markDemoSeeded,
  readDemoState,
  scheduleDemoReseed,
  toDemoLocale,
} from "./demoMode";

const FLUSH_TIMEOUT_MS = 5000;

/**
 * Let the writes in flight land. A stuck queue (bootstrap failed, nothing to
 * wait for) must not keep the club from leaving the demo.
 */
const flushOrGiveUp = () =>
  Promise.race([
    flushWrites(),
    new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
  ]);

const failSwitch = () => {
  toast.error(i18n.t("demo.errors.switchFailed"));
  return false;
};

/**
 * Switch the webview to the other database. The flag is saved before the
 * database is closed: when it cannot be saved nothing has changed.
 */
const switchAndReload = async (saveFlag: () => boolean) => {
  await flushOrGiveUp();
  if (!saveFlag()) return failSwitch();
  // The Explorer and assistant of a demo club are worth nothing to the next
  // one, nor to the real club, which keeps its own (ADR 0009).
  clearDemoAnalyticsLocalMemory();
  await closeDatabase();
  // Every store, query and timer starts again on the right database.
  window.location.reload();
  return true;
};

/**
 * Try the app on a fictitious club (ADR 0009). `hasRealClub` tells where
 * "leave the demo" goes back to. The demo club is seeded at the next start.
 */
export const enterDemo = ({ hasRealClub }: { hasRealClub: boolean }) =>
  switchAndReload(() => beginDemo(hasRealClub));

/** Back to the real club, or to the onboarding when there is none. */
export const exitDemo = () => switchAndReload(() => endDemo());

/** Throw the demo club away and seed a fresh one. */
export const resetDemo = () => switchAndReload(() => scheduleDemoReseed());

/**
 * At start-up, in demo mode: fill demo.db with a fresh demo club when the
 * demo has just been entered or reset. A restart of the app in the middle of
 * a demo keeps the club as it was. The flag stays until the seed succeeded,
 * so an interrupted seed is made again.
 */
export const seedDemoIfPending = async (db: SqlClient) => {
  if (!readDemoState().seedPending) return;
  // The seed holds the big content packs: loaded only when a demo starts.
  const { seedDemoClub } = await import("./seedDemoClub");
  try {
    await seedDemoClub(db, {
      locale: toDemoLocale(useLocaleStore.getState().locale),
      now: formatLocalNow(new Date()),
    });
  } catch (error) {
    // The script may have left its transaction open on one connection of
    // the pool: closing it rolls back. "Retry" reloads, which reopens it.
    await closeDatabase();
    throw error;
  }
  markDemoSeeded();
};
