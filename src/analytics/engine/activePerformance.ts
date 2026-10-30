import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { ANALYTICS_COMMANDS } from "./ipc";
import {
  ActivePerformance,
  couldGoHigher,
  editorMaxRows,
  MachineInfo,
  queryTimeoutMs,
  resolvePerformance,
} from "./performance";

/**
 * The profile in use (performance.ts): the club's choice from the
 * settings store and this machine, as `analytics_machine_info` detected
 * it. Until the machine is known (and outside the app) "auto" is Économe,
 * the safe floor; Rust clamps every request on its own anyway.
 */

interface MachineState {
  machine: MachineInfo | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  setMachine: (machine: MachineInfo | null) => void;
}

export const useMachineStore = create<MachineState>()((set) => ({
  machine: null,
  status: "idle",
  setMachine(machine) {
    set({ machine, status: machine ? "ready" : "idle" });
  },
}));

/** Asks Rust once for the machine (no-op outside the app or when known). */
export const ensureMachineInfo = async (): Promise<MachineInfo | null> => {
  const { status, machine } = useMachineStore.getState();
  if (status === "ready" || status === "loading") return machine;
  if (!isTauri()) {
    useMachineStore.setState({ status: "unavailable" });
    return null;
  }
  useMachineStore.setState({ status: "loading" });
  try {
    const info = await invoke<MachineInfo>(ANALYTICS_COMMANDS.machineInfo);
    useMachineStore.setState({ machine: info, status: "ready" });
    return info;
  } catch (error) {
    console.error("❌ Failed to read the machine's performance", error);
    useMachineStore.setState({ status: "unavailable" });
    return null;
  }
};

/** The profile and limits in use, for code outside React. */
export const getActivePerformance = (): ActivePerformance =>
  resolvePerformance(
    useAnalyticsSettingsStore.getState().performanceProfile,
    useMachineStore.getState().machine
  );

/** Explorer and AI timeout (override clamped to the profile). */
export const getQueryTimeoutMs = () =>
  queryTimeoutMs(
    getActivePerformance().limits,
    useAnalyticsSettingsStore.getState().queryTimeoutSeconds
  );

/** Explorer and AI rows (setting clamped to the profile). */
export const getEditorMaxRows = () => {
  const settings = useAnalyticsSettingsStore.getState();
  return editorMaxRows(
    getActivePerformance().limits,
    settings.editorMaxRowsSet ? settings.editorMaxRows : null
  );
};

/** The hint "choose a heavier profile" applies (timeouts, too large). */
export const canRaiseLimits = () =>
  couldGoHigher(
    getActivePerformance().profile,
    useMachineStore.getState().machine
  );

/** React: the profile and limits in use, re-rendered when either changes. */
export const useActivePerformance = (): ActivePerformance & {
  machine: MachineInfo | null;
  queryTimeoutMs: number;
  editorMaxRows: number;
} => {
  const choice = useAnalyticsSettingsStore((s) => s.performanceProfile);
  const override = useAnalyticsSettingsStore((s) => s.queryTimeoutSeconds);
  const rows = useAnalyticsSettingsStore((s) =>
    s.editorMaxRowsSet ? s.editorMaxRows : null
  );
  const machine = useMachineStore((s) => s.machine);
  const active = resolvePerformance(choice, machine);
  return {
    ...active,
    machine,
    queryTimeoutMs: queryTimeoutMs(active.limits, override),
    editorMaxRows: editorMaxRows(active.limits, rows),
  };
};
