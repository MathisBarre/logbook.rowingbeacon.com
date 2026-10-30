/**
 * Backups (ADR 0005): dated copies of the club database, kept in the
 * app data folder and optionally copied to a second folder.
 */

export const BACKUP_KINDS = [
  "auto",
  "manual",
  "before-import",
  "before-restore",
  "before-delete",
  "before-update",
] as const;

export type BackupKind = (typeof BACKUP_KINDS)[number];

export interface BackupFile {
  fileName: string;
  kind: BackupKind;
  /** Computer that made it, so that two computers can share a folder. */
  machineId?: string;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm:ss". */
  createdAt: string;
}

/** Automatic backups kept; the others are never pruned automatically. */
const AUTO_BACKUPS_KEPT = 14;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Automatic backups are copied to the second folder once a week only. */
const EXTERNAL_AUTO_COPY_INTERVAL_MS = 7 * AUTO_BACKUP_INTERVAL_MS;

const pad = (value: number) => String(value).padStart(2, "0");

const localStamp = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

export const getBackupFileName = (
  kind: BackupKind,
  date: Date,
  machineId?: string
) =>
  `rowingbeacon-${machineId ? `${machineId}-` : ""}${localStamp(date)}-${kind}.db`;

const FILE_NAME_PATTERN =
  /^rowingbeacon-(?:([a-z][a-z0-9]*)-)?(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})-([a-z-]+)\.db$/;

export const parseBackupFileName = (fileName: string): BackupFile | null => {
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) return null;
  const kind = match[6] as BackupKind;
  if (!BACKUP_KINDS.includes(kind)) return null;
  return {
    fileName,
    kind,
    ...(match[1] ? { machineId: match[1] } : {}),
    createdAt: `${match[2]}T${match[3]}:${match[4]}:${match[5]}`,
  };
};

/** A short random id naming this computer in backup file names. */
export const createMachineId = (random = Math.random) =>
  "p" +
  Array.from({ length: 5 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(random() * 36))
  ).join("");

export const sortBackupsNewestFirst = (backups: BackupFile[]) =>
  [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const selectBackupsToPrune = (
  backups: BackupFile[],
  kept = AUTO_BACKUPS_KEPT,
  /** Only this computer's backups are pruned (and unnamed older ones). */
  machineId?: string
) =>
  sortBackupsNewestFirst(backups)
    .filter(
      (backup) =>
        backup.kind === "auto" &&
        (!backup.machineId || backup.machineId === machineId)
    )
    .slice(kept);

export const isAutoBackupDue = (
  lastAutoBackupAt: string | null,
  now: Date,
  interval = AUTO_BACKUP_INTERVAL_MS
) => {
  if (!lastAutoBackupAt) return true;
  const last = new Date(lastAutoBackupAt).getTime();
  const elapsed = now.getTime() - last;
  // A last backup "in the future" means the clock was wrong then: back up.
  return !Number.isFinite(last) || elapsed < 0 || elapsed >= interval;
};

/** Whether this automatic backup also goes to the second folder. */
export const isExternalAutoCopyDue = (
  lastExternalAutoCopyAt: string | null,
  now: Date
) =>
  isAutoBackupDue(lastExternalAutoCopyAt, now, EXTERNAL_AUTO_COPY_INTERVAL_MS);
