import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_LOCK_AFTER_MS,
  startAutoLock,
  unlockWith,
  useAdminLockStore,
} from "./useAnalyticsAdmin";

beforeEach(() => {
  useAdminLockStore.getState().lock();
});

describe("analytics admin lock", () => {
  it("unlocks with the admin password only", async () => {
    expect(await unlockWith(() => Promise.resolve(false))).toBe(false);
    expect(useAdminLockStore.getState().isUnlocked).toBe(false);
    expect(await unlockWith(() => Promise.resolve(true))).toBe(true);
    expect(useAdminLockStore.getState().isUnlocked).toBe(true);
  });

  it("does not ask again while unlocked", async () => {
    useAdminLockStore.getState().markUnlocked();
    const ask = vi.fn(() => Promise.resolve(true));
    expect(await unlockWith(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("locks after 15 minutes without activity", () => {
    const store = useAdminLockStore.getState();
    store.markUnlocked(0);
    store.touch(10 * 60 * 1000);
    expect(store.expireIfIdle(AUTO_LOCK_AFTER_MS)).toBe(false);
    expect(useAdminLockStore.getState().isUnlocked).toBe(true);
    expect(store.expireIfIdle(10 * 60 * 1000 + AUTO_LOCK_AFTER_MS)).toBe(true);
    expect(useAdminLockStore.getState().isUnlocked).toBe(false);
  });

  it("ignores activity while locked", () => {
    useAdminLockStore.getState().touch(5);
    expect(useAdminLockStore.getState().isUnlocked).toBe(false);
  });
});

describe("startAutoLock", () => {
  it("counts wheel, touch and keys anywhere in the target, and locks on leave", () => {
    const target = new EventTarget();
    useAdminLockStore.getState().markUnlocked(0);
    const stop = startAutoLock(target);
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      useAdminLockStore.setState({ lastActivityAt: 0 });
      target.dispatchEvent(new Event(type));
      expect(useAdminLockStore.getState().lastActivityAt, type).toBeGreaterThan(
        0
      );
    }
    stop();
    expect(useAdminLockStore.getState().isUnlocked).toBe(false);
    // Listeners are gone: activity no longer touches anything.
    useAdminLockStore.getState().markUnlocked(0);
    target.dispatchEvent(new Event("wheel"));
    expect(useAdminLockStore.getState().lastActivityAt).toBe(0);
  });
});
