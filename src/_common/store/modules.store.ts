import { create } from "zustand";
import { ModuleId, normalizeModuleIds } from "../business/modules.rules";
import { enqueueWrite } from "../database/writeQueue";
import { saveSetting } from "../database/repositories/club.repository";

export const SETTING_MODULES_ENABLED = "modules.enabled";
export const SETTING_MODULES_DISMISSED_SUGGESTIONS =
  "modules.dismissedSuggestions";
export const SETTING_CAPTAIN_REQUIRED = "captain.required";

interface ModulesStoreState {
  enabled: ModuleId[];
  /** Modules whose contextual suggestion was already answered. */
  dismissedSuggestions: ModuleId[];
  /** Captain module option: an outing cannot start without a captain. */
  captainRequired: boolean;
  hydrate: (settings: Record<string, unknown>) => void;
  setEnabled: (enabled: ModuleId[]) => void;
  enable: (id: ModuleId) => void;
  disable: (id: ModuleId) => void;
  dismissSuggestion: (id: ModuleId) => void;
  setCaptainRequired: (required: boolean) => void;
  reset: () => void;
}

const write = (key: string, value: unknown) => {
  void enqueueWrite(`setting ${key}`, (db) => saveSetting(db, key, value));
};

export const useModulesStore = create<ModulesStoreState>()((set, get) => ({
  enabled: [],
  dismissedSuggestions: [],
  captainRequired: false,
  hydrate(settings) {
    set({
      enabled: normalizeModuleIds(settings[SETTING_MODULES_ENABLED]),
      dismissedSuggestions: normalizeModuleIds(
        settings[SETTING_MODULES_DISMISSED_SUGGESTIONS]
      ),
      captainRequired: settings[SETTING_CAPTAIN_REQUIRED] === true,
    });
  },
  setEnabled(enabled) {
    const normalized = normalizeModuleIds(enabled);
    set({ enabled: normalized });
    write(SETTING_MODULES_ENABLED, normalized);
  },
  enable(id) {
    get().setEnabled([...get().enabled, id]);
    get().dismissSuggestion(id);
  },
  disable(id) {
    get().setEnabled(get().enabled.filter((enabledId) => enabledId !== id));
  },
  dismissSuggestion(id) {
    if (get().dismissedSuggestions.includes(id)) {
      return;
    }
    const dismissed = normalizeModuleIds([...get().dismissedSuggestions, id]);
    set({ dismissedSuggestions: dismissed });
    write(SETTING_MODULES_DISMISSED_SUGGESTIONS, dismissed);
  },
  setCaptainRequired(required) {
    set({ captainRequired: required });
    write(SETTING_CAPTAIN_REQUIRED, required);
  },
  reset() {
    set({ enabled: [], dismissedSuggestions: [], captainRequired: false });
  },
}));

export const useModule = (id: ModuleId) =>
  useModulesStore((state) => state.enabled.includes(id));

export const isModuleEnabled = (id: ModuleId) =>
  useModulesStore.getState().enabled.includes(id);
