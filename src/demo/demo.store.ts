import { create } from "zustand";
import type { ParametersTab } from "./demoGuide";
import { isDemoMode, readDemoChecklist, writeDemoChecklist } from "./demoMode";

interface DemoStore {
  /** The "what to try" panel. */
  isGuideOpen: boolean;
  /** Ticked steps, saved in the localStorage (cleared on reset). */
  doneStepIds: string[];
  /** Tab of the Gestion page that a guide step asked for, until it opens. */
  requestedParametersTab: ParametersTab | null;
  openGuide: () => void;
  closeGuide: () => void;
  toggleStep: (id: string) => void;
  requestParametersTab: (tab: ParametersTab | null) => void;
}

export const useDemoStore = create<DemoStore>()((set, get) => ({
  isGuideOpen: false,
  doneStepIds: isDemoMode() ? readDemoChecklist() : [],
  requestedParametersTab: null,
  openGuide: () => set({ isGuideOpen: true }),
  closeGuide: () => set({ isGuideOpen: false }),
  toggleStep: (id) => {
    const done = get().doneStepIds;
    const next = done.includes(id)
      ? done.filter((doneId) => doneId !== id)
      : [...done, id];
    writeDemoChecklist(next);
    set({ doneStepIds: next });
  },
  requestParametersTab: (requestedParametersTab) =>
    set({ requestedParametersTab }),
}));
