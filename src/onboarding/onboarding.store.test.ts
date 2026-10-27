import { describe, expect, it, vi } from "vitest";

const enqueueWrite = vi.fn();
vi.mock("../_common/database/writeQueue", () => ({ enqueueWrite }));

const { SETTING_ONBOARDING_DONE, useOnboardingStore } = await import(
  "./onboarding.store"
);

describe("onboarding store", () => {
  it("derives the flag without writing, so a reload cannot loop", () => {
    expect(useOnboardingStore.getState().hydrate({}, true)).toBe(true);
    expect(useOnboardingStore.getState().isOnboarded).toBe(true);

    expect(
      useOnboardingStore
        .getState()
        .hydrate({ [SETTING_ONBOARDING_DONE]: true }, true)
    ).toBe(false);
    expect(enqueueWrite).not.toHaveBeenCalled();
  });
});
