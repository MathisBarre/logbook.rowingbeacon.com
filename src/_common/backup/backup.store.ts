import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createMachineId } from "./backup.rules";

/**
 * Backup preferences of this computer (ADR 0005): they stay in the
 * localStorage so that restoring a backup made elsewhere keeps them.
 */
interface BackupStore {
  /**
   * Second folder (USB key, synced folder) that receives the manual
   * backups, those made before an import, restore or deletion, and one
   * automatic backup a week.
   */
  externalFolder: string | null;
  lastAutoBackupAt: string | null;
  lastBackupAt: string | null;
  lastExternalAutoCopyAt: string | null;
  /** Set when the last copy to the second folder failed. */
  externalCopyFailedAt: string | null;
  /** Names this computer in backup file names. */
  machineId: string;
  setExternalFolder: (folder: string | null) => void;
  recordBackup: (args: {
    at: string;
    auto: boolean;
    externalCopy: "written" | "not-configured" | "failed";
  }) => void;
}

export const useBackupStore = create<BackupStore>()(
  persist(
    (set) => ({
      externalFolder: null,
      lastAutoBackupAt: null,
      lastBackupAt: null,
      lastExternalAutoCopyAt: null,
      externalCopyFailedAt: null,
      machineId: createMachineId(),
      setExternalFolder: (externalFolder) =>
        set({
          externalFolder,
          externalCopyFailedAt: null,
          lastExternalAutoCopyAt: null,
        }),
      recordBackup: ({ at, auto, externalCopy }) =>
        set((state) => ({
          lastBackupAt: at,
          lastAutoBackupAt: auto ? at : state.lastAutoBackupAt,
          lastExternalAutoCopyAt:
            auto && externalCopy === "written"
              ? at
              : state.lastExternalAutoCopyAt,
          externalCopyFailedAt:
            externalCopy === "failed"
              ? at
              : externalCopy === "written" || !state.externalFolder
                ? null
                : state.externalCopyFailedAt,
        })),
    }),
    { name: "backup-storage" }
  )
);
