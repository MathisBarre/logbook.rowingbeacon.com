import { create } from "zustand";

interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
}

type UpdatePhase =
  | "idle"
  | "checking"
  | "backup"
  | "download"
  | "install"
  | "failed";

/** Backing up, downloading or installing: the dialog cannot be left. */
export const isUpdateBusy = (phase: UpdatePhase) =>
  phase === "backup" || phase === "download" || phase === "install";

/** What this launch knows about updates; nothing is kept across restarts. */
interface UpdateStore {
  available: AvailableUpdate | null;
  phase: UpdatePhase;
  /** Download progress in percents, null while the size is unknown. */
  percent: number | null;
  dialogOpen: boolean;
  setAvailable: (available: AvailableUpdate | null) => void;
  setPhase: (phase: UpdatePhase, percent?: number | null) => void;
  setDialogOpen: (open: boolean) => void;
}

export const useUpdateStore = create<UpdateStore>()((set) => ({
  available: null,
  phase: "idle",
  percent: null,
  dialogOpen: false,
  setAvailable: (available) => set({ available }),
  setPhase: (phase, percent = null) => set({ phase, percent }),
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}));
