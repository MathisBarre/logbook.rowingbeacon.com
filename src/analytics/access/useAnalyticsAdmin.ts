import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";

/**
 * Admin unlock of the analytics hub (plan 1.6): the Gestion password, kept
 * in memory only, shared by every analytics component, locked again after
 * 15 minutes without pointer, key or wheel events while the hub is shown,
 * and when the Stats page unmounts (`useAnalyticsAutoLock`, mounted by the hub).
 */

export const AUTO_LOCK_AFTER_MS = 15 * 60 * 1000;

interface AdminLockState {
  isUnlocked: boolean;
  lastActivityAt: number;
  markUnlocked: (now?: number) => void;
  touch: (now?: number) => void;
  lock: () => void;
  /** Locks when idle for AUTO_LOCK_AFTER_MS; returns true when it locked. */
  expireIfIdle: (now?: number) => boolean;
}

export const useAdminLockStore = create<AdminLockState>()((set, get) => ({
  isUnlocked: false,
  lastActivityAt: 0,
  markUnlocked(now = Date.now()) {
    set({ isUnlocked: true, lastActivityAt: now });
  },
  touch(now = Date.now()) {
    if (get().isUnlocked) set({ lastActivityAt: now });
  },
  lock() {
    set({ isUnlocked: false });
  },
  expireIfIdle(now = Date.now()) {
    const { isUnlocked, lastActivityAt } = get();
    if (isUnlocked && now - lastActivityAt >= AUTO_LOCK_AFTER_MS) {
      set({ isUnlocked: false });
      return true;
    }
    return false;
  },
}));

/** Asks the password unless already unlocked; true when unlocked. */
export const unlockWith = async (
  askForAdminAccess: () => Promise<boolean>
): Promise<boolean> => {
  const store = useAdminLockStore.getState();
  if (store.isUnlocked) {
    store.touch();
    return true;
  }
  const granted = await askForAdminAccess();
  if (granted) {
    useAdminLockStore.getState().markUnlocked();
  }
  return granted;
};

export const useAnalyticsAdmin = () => {
  const isUnlocked = useAdminLockStore((state) => state.isUnlocked);
  const { askForAdminAccess } = useAdminEditModeSystem();
  const unlock = useCallback(
    () => unlockWith(() => askForAdminAccess()),
    [askForAdminAccess]
  );
  const lock = useCallback(() => useAdminLockStore.getState().lock(), []);
  return { isUnlocked, unlock, lock };
};

/** Events that count as activity for the idle lock. */
export const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/**
 * Activity tracking and idle lock, on `target` (the whole document while
 * the hub is mounted, so typing in a dialog portalled out of the hub and
 * scrolling with the wheel count too). The returned cleanup locks.
 */
export const startAutoLock = (target: EventTarget): (() => void) => {
  const onActivity = () => useAdminLockStore.getState().touch();
  for (const type of ACTIVITY_EVENTS) {
    target.addEventListener(type, onActivity, { passive: true });
  }
  const timer = setInterval(
    () => useAdminLockStore.getState().expireIfIdle(),
    30_000
  );
  return () => {
    for (const type of ACTIVITY_EVENTS) {
      target.removeEventListener(type, onActivity);
    }
    clearInterval(timer);
    useAdminLockStore.getState().lock();
  };
};

/** Mounted once by the hub: activity tracking, idle lock, lock on leave. */
export const useAnalyticsAutoLock = () => {
  useEffect(() => startAutoLock(document), []);
};
