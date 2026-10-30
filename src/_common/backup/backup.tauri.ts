import Database from "@tauri-apps/plugin-sql";
import {
  BaseDirectory,
  mkdir,
  readDir,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import i18n from "../i18n/config";
import { closeDatabase, getDatabase } from "../database/database";
import { flushWrites } from "../database/writeQueue";
import {
  BackupKind,
  isAutoBackupDue,
  isExternalAutoCopyDue,
} from "./backup.rules";
import {
  BackupStorage,
  ClosableSqlClient,
  createBackup,
  listBackups,
  removeLeftoverRestoreCopies,
  restoreBackup,
  RestoreFailedError,
} from "./backup.service";
import { useBackupStore } from "./backup.store";
import { isDemoMode } from "../../demo/demoMode";

const BACKUP_FOLDER = "backups";
const AUTO_BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const backupStorage: BackupStorage = {
  directory: async () => {
    await mkdir(BACKUP_FOLDER, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
    return join(await appDataDir(), BACKUP_FOLDER);
  },
  join: (folder, fileName) => join(folder, fileName),
  list: async (folder) =>
    (await readDir(folder))
      .filter((entry) => entry.isFile)
      .map((entry) => entry.name),
  remove: (path) => remove(path),
  rename: (from, to) => rename(from, to),
};

/** Opens another SQLite file; the SQL plugin resolves absolute paths as is. */
const openDatabase = async (path: string): Promise<ClosableSqlClient> => {
  const db = await Database.load(`sqlite:${path}`);
  return {
    execute: (sql, params) => db.execute(sql, params),
    select: (sql, params) => db.select(sql, params),
    // Without a name, the plugin closes every pool, the club database too.
    close: () => db.close(db.path),
  };
};

export const getBackupFolder = () => backupStorage.directory();

export const getBackups = () => listBackups(backupStorage);

const recordBackup = (
  kind: BackupKind,
  result: Awaited<ReturnType<typeof createBackup>>
) => {
  useBackupStore.getState().recordBackup({
    at: new Date().toISOString(),
    auto: kind === "auto",
    externalCopy: result.externalCopy,
  });
  if (result.externalCopy === "failed") {
    toast.warning(i18n.t("backup.externalCopyFailed"));
  }
};

/**
 * Resolves with null in demo mode (ADR 0009): there is nothing worth saving
 * in demo.db, and a copy must never land in the club's backup folders.
 */
export const runBackup = async (kind: BackupKind) => {
  if (isDemoMode()) return null;
  const { db } = await getDatabase();
  await flushWrites();
  const { externalFolder, lastExternalAutoCopyAt, machineId } =
    useBackupStore.getState();
  // A daily copy would fill a USB key: the second folder gets one a week.
  const copyExternally =
    kind !== "auto" ||
    isExternalAutoCopyDue(lastExternalAutoCopyAt, new Date());
  const result = await createBackup(db, kind, {
    storage: backupStorage,
    externalFolder: copyExternally ? externalFolder : null,
    machineId,
  });
  recordBackup(kind, result);
  return result;
};

const runAutoBackupIfDue = async () => {
  if (isDemoMode()) return;
  if (
    !isAutoBackupDue(useBackupStore.getState().lastAutoBackupAt, new Date())
  ) {
    return;
  }
  try {
    await runBackup("auto");
  } catch (error) {
    console.error("❌ Automatic backup failed", error);
    toast.error(i18n.t("backup.autoBackupFailed"));
  }
};

let autoBackupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Back up at start-up and every 24 hours while the app runs: the boathouse
 * computer often stays on for days.
 */
export const startAutoBackups = () => {
  if (isDemoMode()) return;
  void removeLeftoverRestoreCopies(backupStorage).catch((error: unknown) => {
    console.error("❌ Removing leftover restore copies failed", error);
  });
  void runAutoBackupIfDue();
  autoBackupTimer ??= setInterval(() => {
    void runAutoBackupIfDue();
  }, AUTO_BACKUP_CHECK_INTERVAL_MS);
};

/** Replace the club data with a backup, then reload the app. */
export const restoreFromFile = async (path: string) => {
  // The screen hides the button in demo; this keeps a stray call harmless.
  if (isDemoMode()) throw new Error("Restoring a backup is off in demo mode");
  const { db } = await getDatabase();
  await flushWrites();
  try {
    const safetyBackup = await restoreBackup(db, path, {
      storage: backupStorage,
      openDatabase,
      externalFolder: useBackupStore.getState().externalFolder,
      machineId: useBackupStore.getState().machineId,
    });
    recordBackup("before-restore", safetyBackup);
  } catch (error) {
    // The caller reloads the app, which reopens the database.
    if (error instanceof RestoreFailedError) await closeDatabase();
    throw error;
  }
  window.location.reload();
};
