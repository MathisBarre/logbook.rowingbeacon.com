import type { DemoLocale } from "./seedDemoClub";

/**
 * Demo mode (ADR 0009): the app opens `demo.db` instead of `main.db`, so the
 * real club is never read nor written while the club tries the app. The mode
 * is a flag in the localStorage, read once when the database is first
 * opened; switching always reloads the webview.
 */

/**
 * Shown in the demo banner and cards. It must equal DEMO_ADMIN_PASSWORD of
 * seedDemoClub (a test checks it): the seed is imported lazily, so its
 * constant cannot be imported here without loading it with the app.
 */
export const DEMO_ADMIN_PASSWORD_HINT = "admin";

export const MAIN_DATABASE_FILE = "main.db";
export const DEMO_DATABASE_FILE = "demo.db";
export const MAIN_DATABASE_URL = `sqlite:${MAIN_DATABASE_FILE}`;
export const DEMO_DATABASE_URL = `sqlite:${DEMO_DATABASE_FILE}`;

export const DEMO_STATE_KEY = "rowingbeacon.demo";
export const DEMO_CHECKLIST_KEY = "rowingbeacon.demo.checklist";

export interface DemoState {
  active: boolean;
  /** demo.db must be filled with a fresh demo club before it is read. */
  seedPending: boolean;
  /** The real club (main.db) had been set up before the demo started. */
  hadRealClub: boolean;
  /** The "what to try" panel still has to open once. */
  guidePending: boolean;
}

export type DemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const INACTIVE: DemoState = {
  active: false,
  seedPending: false,
  hadRealClub: false,
  guidePending: false,
};

/** The WebView storage, or null where it is blocked (private window, tests). */
const defaultStorage = (): DemoStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readDemoState = (
  storage: DemoStorage | null = defaultStorage()
): DemoState => {
  try {
    const raw = storage?.getItem(DEMO_STATE_KEY);
    if (!raw) return INACTIVE;
    const parsed = JSON.parse(raw) as Partial<DemoState> | null;
    if (parsed?.active !== true) return INACTIVE;
    return {
      active: true,
      seedPending: parsed.seedPending === true,
      hadRealClub: parsed.hadRealClub === true,
      guidePending: parsed.guidePending === true,
    };
  } catch {
    return INACTIVE;
  }
};

/** False when the state could not be saved: the mode did not change. */
const writeDemoState = (
  state: DemoState,
  storage: DemoStorage | null
): boolean => {
  try {
    if (!storage) return false;
    storage.setItem(DEMO_STATE_KEY, JSON.stringify(state));
    return readDemoState(storage).active === state.active;
  } catch {
    return false;
  }
};

export const isDemoMode = (storage?: DemoStorage | null) =>
  readDemoState(storage).active;

/** The database to open: demo.db in demo mode, main.db otherwise. */
export const getDatabaseUrl = (demo: boolean) =>
  demo ? DEMO_DATABASE_URL : MAIN_DATABASE_URL;

export const getActiveDatabaseUrl = (storage?: DemoStorage | null) =>
  getDatabaseUrl(isDemoMode(storage));

/**
 * The file name of the open database, for the Rust side of Statistiques
 * (which reads the file itself and accepts these two names only, ADR 0009).
 */
export const getActiveDatabaseFile = (storage?: DemoStorage | null) =>
  isDemoMode(storage) ? DEMO_DATABASE_FILE : MAIN_DATABASE_FILE;

const clearChecklist = (storage: DemoStorage | null) => {
  try {
    storage?.removeItem(DEMO_CHECKLIST_KEY);
  } catch {
    // Nothing to forget without storage.
  }
};

/** Enter demo mode: a fresh demo club is seeded at the next start. */
export const beginDemo = (
  hadRealClub: boolean,
  storage: DemoStorage | null = defaultStorage()
) => {
  const saved = writeDemoState(
    { active: true, seedPending: true, hadRealClub, guidePending: true },
    storage
  );
  if (saved) clearChecklist(storage);
  return saved;
};

/** Start the demo over: seeded again at the next start. */
export const scheduleDemoReseed = (
  storage: DemoStorage | null = defaultStorage()
) => {
  const current = readDemoState(storage);
  if (!current.active) return false;
  const saved = writeDemoState(
    { ...current, seedPending: true, guidePending: false },
    storage
  );
  if (saved) clearChecklist(storage);
  return saved;
};

/** The demo club is in demo.db: later starts keep it. */
export const markDemoSeeded = (
  storage: DemoStorage | null = defaultStorage()
) => {
  const current = readDemoState(storage);
  if (!current.active || !current.seedPending) return;
  writeDemoState({ ...current, seedPending: false }, storage);
};

/** True once, right after entering the demo. */
export const consumeDemoGuidePending = (
  storage: DemoStorage | null = defaultStorage()
) => {
  const current = readDemoState(storage);
  if (!current.active || !current.guidePending) return false;
  writeDemoState({ ...current, guidePending: false }, storage);
  return true;
};

/** Leave demo mode. False when the flag could not be removed. */
export const endDemo = (storage: DemoStorage | null = defaultStorage()) => {
  try {
    if (!storage) return false;
    storage.removeItem(DEMO_STATE_KEY);
    clearChecklist(storage);
    return !readDemoState(storage).active;
  } catch {
    return false;
  }
};

/** Where "leave the demo" goes, which the button says. */
export const getDemoExitLabelKey = (hadRealClub: boolean) =>
  hadRealClub ? "demo.banner.backToClub" : "demo.banner.createClub";

/**
 * The seed knows six languages; the other English variants take the closest
 * one.
 */
export const toDemoLocale = (locale: string | null): DemoLocale => {
  switch (locale) {
    case "fr-FR":
    case "en-US":
    case "en-GB":
    case "de-DE":
    case "it-IT":
    case "nl-NL":
      return locale;
    case "en-AU":
    case "en-NZ":
      return "en-GB";
    default:
      return "en-US";
  }
};

/** Local date-time "YYYY-MM-DDTHH:mm", as the seed expects. */
export const formatLocalNow = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
};

export const readDemoChecklist = (
  storage: DemoStorage | null = defaultStorage()
): string[] => {
  try {
    const parsed = JSON.parse(
      storage?.getItem(DEMO_CHECKLIST_KEY) ?? "[]"
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};

export const writeDemoChecklist = (
  ids: string[],
  storage: DemoStorage | null = defaultStorage()
) => {
  try {
    storage?.setItem(DEMO_CHECKLIST_KEY, JSON.stringify(ids));
  } catch {
    // The ticks are a convenience: they only last until the next start.
  }
};
