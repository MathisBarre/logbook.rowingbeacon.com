import { isDemoMode } from "../../demo/demoMode";

/**
 * What the analytics hub remembers on this workstation outside the
 * database: the Explorer's doc and run history, the last tab
 * (localStorage keys `rb.analytics.*`), and the in-memory state of the
 * stores already loaded. "Supprimer toutes les données" clears it all, so
 * the next club never finds the previous club's SQL, titles or values
 * (review C, 5).
 *
 * Kept tiny (its one import, the demo flag, is in the main chunk already):
 * the main chunk loads it with the logout, and the hub's stores register
 * their reset here when they load, so the logout never pulls the Explorer
 * into the main chunk.
 */

export const LOCAL_STORAGE_PREFIX = "rb.analytics.";
/** The demo club's own copy of every key (demo mode, ADR 0009). */
export const DEMO_LOCAL_STORAGE_PREFIX = `${LOCAL_STORAGE_PREFIX}demo.`;

/**
 * The key to read and write for `key` (a `rb.analytics.*` key): in demo
 * mode the demo club's own, so the real club's SQL, run history and AI
 * questions never show in the demo, and the demo never overwrites them.
 * The mode only changes with a reload.
 */
export const analyticsStorageKey = (key: string) =>
  isDemoMode() && key.startsWith(LOCAL_STORAGE_PREFIX)
    ? DEMO_LOCAL_STORAGE_PREFIX + key.slice(LOCAL_STORAGE_PREFIX.length)
    : key;

const resets = new Set<() => void>();

/** Registers the reset of a store (called once, when its module loads). */
export const onAnalyticsLocalMemoryCleared = (reset: () => void) => {
  resets.add(reset);
};

const removeKeysStartingWith = (prefix: string) => {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage blocked: nothing was remembered there.
  }
};

/** Resets the loaded stores, then removes every `rb.analytics.*` key. */
export const clearAnalyticsLocalMemory = () => {
  for (const reset of resets) {
    try {
      reset();
    } catch (error) {
      console.error(error);
    }
  }
  removeKeysStartingWith(LOCAL_STORAGE_PREFIX);
};

/**
 * Forgets what the demo club's analytics remembered, when the demo starts,
 * starts over or ends (a reload follows): the next demo club never finds
 * queries of the previous one. The real club's keys stay.
 */
export const clearDemoAnalyticsLocalMemory = () =>
  removeKeysStartingWith(DEMO_LOCAL_STORAGE_PREFIX);
