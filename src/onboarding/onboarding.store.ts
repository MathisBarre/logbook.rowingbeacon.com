import { create } from "zustand";
import { enqueueWrite } from "../_common/database/writeQueue";
import { saveSetting } from "../_common/database/repositories/club.repository";
import { isDemoMode } from "../demo/demoMode";

export const SETTING_ONBOARDING_DONE = "onboarding.done";

/** Written by the first v2 builds, before the flag moved to SQLite. */
const LEGACY_ONBOARDING_KEY = "onboarding-storage";

/**
 * Once the flag is in SQLite the legacy key must go: left behind, it would
 * win again whenever the SQLite flag is missing (after "delete data").
 */
const forgetLegacyFlag = () => {
  // The legacy key belongs to the real club: the demo leaves it alone.
  if (isDemoMode()) return;
  try {
    window.localStorage.removeItem(LEGACY_ONBOARDING_KEY);
  } catch {
    // No storage (tests): nothing to forget.
  }
};

interface OnboardingStore {
  isOnboarded: boolean;
  /**
   * True when the flag was derived and should be saved. Nothing is written
   * here: hydrate also runs on the reload after a failed write.
   */
  hydrate: (
    settings: Record<string, unknown>,
    clubHasData: boolean,
    readLocalStorage?: (key: string) => string | null
  ) => boolean;
  setOnboarded: (value: boolean) => void;
  /** Saves the flag hydrate derived (see its return value). */
  saveDerivedFlag: () => Promise<boolean>;
}

const readLegacyFlag = (readLocalStorage: (key: string) => string | null) => {
  try {
    const raw = readLocalStorage(LEGACY_ONBOARDING_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { state?: { isOnboarded?: boolean } };
    return parsed.state?.isOnboarded;
  } catch {
    return undefined;
  }
};

/**
 * Whether the club was set up lives in SQLite with the club data, so that
 * clearing the WebView storage never shows the onboarding over a real club.
 */
export const useOnboardingStore = create<OnboardingStore>()((set) => ({
  isOnboarded: false,
  hydrate: (settings, clubHasData, readLocalStorage) => {
    const stored = settings[SETTING_ONBOARDING_DONE];
    if (typeof stored === "boolean") {
      set({ isOnboarded: stored });
      return false;
    }

    const isOnboarded =
      (readLocalStorage ? readLegacyFlag(readLocalStorage) : undefined) ??
      clubHasData;
    set({ isOnboarded });
    return isOnboarded;
  },
  setOnboarded: (value) => {
    set({ isOnboarded: value });
    void enqueueWrite("onboarding", async (db) => {
      await saveSetting(db, SETTING_ONBOARDING_DONE, value);
      forgetLegacyFlag();
    });
  },
  saveDerivedFlag: () =>
    enqueueWrite("onboarding", async (db) => {
      await saveSetting(db, SETTING_ONBOARDING_DONE, true);
      forgetLegacyFlag();
    }),
}));
