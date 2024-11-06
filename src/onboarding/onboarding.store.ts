import create from "zustand";
import { persist } from "zustand/middleware";

interface OnboardingStore {
  isOnboarded: boolean;
  setOnboarded: (value: boolean) => void;
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      isOnboarded: false,
      setOnboarded: (value) => set({ isOnboarded: value }),
    }),
    {
      name: "onboarding-storage",
    }
  )
);
