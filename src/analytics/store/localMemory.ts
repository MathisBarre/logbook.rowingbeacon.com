/**
 * What the analytics hub remembers on this workstation outside the
 * database: the Explorer's doc and run history, the last tab
 * (localStorage keys `rb.analytics.*`), and the in-memory state of the
 * stores already loaded. "Supprimer toutes les données" clears it all, so
 * the next club never finds the previous club's SQL, titles or values
 * (review C, 5).
 *
 * Kept tiny and free of imports: the main chunk loads it with the logout,
 * and the hub's stores register their reset here when they load, so the
 * logout never pulls the Explorer into the main chunk.
 */

export const LOCAL_STORAGE_PREFIX = "rb.analytics.";

const resets = new Set<() => void>();

/** Registers the reset of a store (called once, when its module loads). */
export const onAnalyticsLocalMemoryCleared = (reset: () => void) => {
  resets.add(reset);
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
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(LOCAL_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage blocked: nothing was remembered there.
  }
};
