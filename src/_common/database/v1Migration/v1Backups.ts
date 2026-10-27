/**
 * The v1 backup holds every name of the club in clear. It is kept long
 * enough to recover from a bad migration, then deleted (GDPR).
 */
export const V1_BACKUP_RETENTION_DAYS = 90;

const V1_BACKUP_NAME = /^v1-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;

export const toV1BackupFileName = (date: Date) =>
  `v1-backup-${date.toISOString().replace(/[:.]/g, "-")}.json`;

/** When a v1 backup was written, read from its file name. */
export const getV1BackupDate = (fileName: string): Date | null => {
  const match = V1_BACKUP_NAME.exec(fileName);
  if (!match) return null;
  const [, day, hours, minutes, seconds, ms] = match;
  return new Date(`${day}T${hours}:${minutes}:${seconds}.${ms}Z`);
};

export const getExpiredV1Backups = (fileNames: string[], now: Date) => {
  const limit = now.getTime() - V1_BACKUP_RETENTION_DAYS * 24 * 3600 * 1000;
  return fileNames.filter((fileName) => {
    const date = getV1BackupDate(fileName);
    return date !== null && date.getTime() < limit;
  });
};
