import { applyMigrations, migrations } from "../database/migrations";
import { SqlClient, sqlLiteral } from "../database/sqlClient";
import {
  BackupFile,
  BackupKind,
  getBackupFileName,
  parseBackupFileName,
  selectBackupsToPrune,
  sortBackupsNewestFirst,
} from "./backup.rules";

/**
 * Backups are copies of the club database made by SQLite itself
 * (`VACUUM INTO`), consistent even during a write. A restore copies the
 * tables of a backup into the open database in one transaction (ADR 0005).
 */

/** Where backups live; the Tauri implementation is in backup.tauri.ts. */
export interface BackupStorage {
  /** Absolute path of the backup folder, created if needed. */
  directory: () => Promise<string>;
  join: (folder: string, fileName: string) => Promise<string>;
  /** File names in a folder; throws when the folder cannot be read. */
  list: (folder: string) => Promise<string[]>;
  remove: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

export type ClosableSqlClient = SqlClient & { close: () => Promise<unknown> };

export type OpenDatabase = (path: string) => Promise<ClosableSqlClient>;

export type ExternalCopyResult = "written" | "not-configured" | "failed";

export class NotABackupError extends Error {}

/** Made by a newer Rowing Beacon: restoring it would drop what it knows more. */
export class NewerBackupError extends Error {}

/**
 * The restore script failed and was rolled back. As with an import, the
 * caller reopens the database in case the ROLLBACK reached another
 * connection of the pool than the one holding the transaction.
 */
export class RestoreFailedError extends Error {
  constructor(readonly reason: unknown) {
    super("Restore failed");
  }
}

const RESTORE_COPY_PATTERN = /^restore-\d+\.db(-wal|-shm|-journal)?$/;
const PARTIAL_BACKUP_SUFFIX = ".part";

/**
 * Remove the working copies a restore, or a backup cut short, left behind
 * when the app stopped.
 */
export const removeLeftoverRestoreCopies = async (storage: BackupStorage) => {
  const folder = await storage.directory();
  for (const fileName of await storage.list(folder)) {
    if (
      RESTORE_COPY_PATTERN.test(fileName) ||
      fileName.endsWith(PARTIAL_BACKUP_SUFFIX)
    ) {
      await storage.remove(await storage.join(folder, fileName));
    }
  }
};

const vacuumInto = (db: SqlClient, path: string) =>
  db.execute(`VACUUM INTO ${sqlLiteral(path)};`);

/**
 * A backup gets its final name only once complete: a copy cut short (app
 * closed, disk full) is never listed as a backup to restore.
 */
const writeBackupFile = async (
  db: SqlClient,
  storage: BackupStorage,
  path: string
) => {
  const partial = `${path}${PARTIAL_BACKUP_SUFFIX}`;
  try {
    await vacuumInto(db, partial);
    await storage.rename(partial, path);
  } catch (error) {
    await storage.remove(partial).catch(() => undefined);
    throw error;
  }
};

const prune = async (
  storage: BackupStorage,
  folder: string,
  machineId: string | undefined,
  /** The backup just written: older partial copies were cut short. */
  justWritten: BackupFile
) => {
  const fileNames = await storage.list(folder);
  const backups = fileNames
    .map(parseBackupFileName)
    .filter((backup): backup is BackupFile => backup !== null);
  // Pruning is best effort: a file held open (antivirus, sync client) must
  // not fail the backup that was just written.
  const removeQuietly = async (fileName: string) => {
    try {
      await storage.remove(await storage.join(folder, fileName));
    } catch (error) {
      console.error("❌ Could not remove an old backup", fileName, error);
    }
  };
  for (const backup of selectBackupsToPrune(backups, undefined, machineId)) {
    await removeQuietly(backup.fileName);
  }
  // A copy cut short on another drive (USB key unplugged, app closed) is
  // only found here: the start-up clean-up sees the app's own folder.
  for (const fileName of fileNames) {
    if (!fileName.endsWith(PARTIAL_BACKUP_SUFFIX)) continue;
    const partial = parseBackupFileName(
      fileName.slice(0, -PARTIAL_BACKUP_SUFFIX.length)
    );
    if (
      partial &&
      partial.machineId === justWritten.machineId &&
      partial.createdAt < justWritten.createdAt
    ) {
      await removeQuietly(fileName);
    }
  }
};

export const listBackups = async (storage: BackupStorage) => {
  const folder = await storage.directory();
  return sortBackupsNewestFirst(
    (await storage.list(folder))
      .map(parseBackupFileName)
      .filter((backup): backup is BackupFile => backup !== null)
  );
};

export const createBackup = async (
  db: SqlClient,
  kind: BackupKind,
  {
    storage,
    externalFolder,
    machineId,
    now = new Date(),
  }: {
    storage: BackupStorage;
    /** Second folder to copy this backup to, if any. */
    externalFolder?: string | null;
    machineId?: string;
    now?: Date;
  }
): Promise<{
  fileName: string;
  path: string;
  externalCopy: ExternalCopyResult;
}> => {
  const folder = await storage.directory();
  // VACUUM INTO refuses an existing file: two backups in the same second.
  const existing = new Set(await storage.list(folder));
  let date = now;
  while (existing.has(getBackupFileName(kind, date, machineId))) {
    date = new Date(date.getTime() + 1000);
  }
  const fileName = getBackupFileName(kind, date, machineId);
  const path = await storage.join(folder, fileName);
  await writeBackupFile(db, storage, path);
  const written = parseBackupFileName(fileName)!;
  await prune(storage, folder, machineId, written);

  let externalCopy: ExternalCopyResult = "not-configured";
  if (externalFolder) {
    try {
      await writeBackupFile(
        db,
        storage,
        await storage.join(externalFolder, fileName)
      );
      externalCopy = "written";
    } catch (error) {
      console.error("❌ External backup copy failed", error);
      externalCopy = "failed";
    }
    // The second folder may not be listable (outside the app's file scope).
    await prune(storage, externalFolder, machineId, written).catch(
      () => undefined
    );
  }

  return { fileName, path, externalCopy };
};

const listTables = async (db: SqlClient) =>
  (
    await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'migration' ORDER BY name"
    )
  ).map((row) => row.name);

const listColumns = async (db: SqlClient, table: string) =>
  (
    await db.select<{ name: string }[]>(
      `PRAGMA table_info(${sqlLiteral(table)})`
    )
  ).map((row) => row.name);

/**
 * Replace every club table with the content of a backup file. The file is
 * never modified: it is copied, the copy is brought to the current schema,
 * then its rows are copied into the open database.
 */
export const restoreBackup = async (
  db: SqlClient,
  sourcePath: string,
  {
    storage,
    openDatabase,
    externalFolder,
    machineId,
    now = new Date(),
  }: {
    storage: BackupStorage;
    openDatabase: OpenDatabase;
    externalFolder?: string | null;
    machineId?: string;
    now?: Date;
  }
) => {
  const folder = await storage.directory();
  const copyPath = await storage.join(folder, `restore-${now.getTime()}.db`);

  const source = await openDatabase(sourcePath);
  try {
    const tables = await listTables(source).catch(() => {
      throw new NotABackupError("Not a SQLite file");
    });
    const [{ migrationTables }] = await source.select<
      { migrationTables: number }[]
    >(
      "SELECT COUNT(*) AS migrationTables FROM sqlite_master WHERE type = 'table' AND name = 'migration'"
    );
    if (Number(migrationTables) === 0 || !tables.includes("session")) {
      throw new NotABackupError("Not a Rowing Beacon database");
    }
    const known = new Set(migrations.map((migration) => migration.timestamp));
    const applied = await source.select<{ timestamp: number }[]>(
      "SELECT timestamp FROM migration"
    );
    if (applied.some((row) => !known.has(Number(row.timestamp)))) {
      throw new NewerBackupError("Backup made by a newer Rowing Beacon");
    }
    await vacuumInto(source, copyPath);
  } catch (error) {
    // A copy cut short (disk full) must not stay behind.
    try {
      await storage.remove(copyPath);
    } catch {
      // Nothing was written.
    }
    throw error;
  } finally {
    await source.close();
  }

  try {
    const copy = await openDatabase(copyPath);
    const columns = new Map<string, string[]>();
    try {
      await applyMigrations(copy);
      for (const table of await listTables(copy)) {
        columns.set(table, await listColumns(copy, table));
      }
    } finally {
      await copy.close();
    }

    const safetyBackup = await createBackup(db, "before-restore", {
      storage,
      externalFolder,
      machineId,
      now,
    });

    const statements = [
      `ATTACH DATABASE ${sqlLiteral(copyPath)} AS restored;`,
      "BEGIN;",
      "PRAGMA defer_foreign_keys = ON;",
    ];
    // Empty every table before refilling any: a delete can fire ON DELETE
    // actions (SET NULL, CASCADE) on rows another table already got back.
    const tables = await listTables(db);
    for (const table of tables) {
      statements.push(`DELETE FROM main."${table}";`);
    }
    for (const table of tables) {
      const sourceColumns = columns.get(table);
      if (!sourceColumns) continue;
      const own = await listColumns(db, table);
      const shared = own
        .filter((column) => sourceColumns.includes(column))
        .map((column) => `"${column}"`)
        .join(", ");
      if (shared) {
        statements.push(
          `INSERT INTO main."${table}" (${shared}) SELECT ${shared} FROM restored."${table}";`
        );
      }
    }
    statements.push("COMMIT;", "DETACH DATABASE restored;");

    try {
      await db.execute(statements.join("\n"));
    } catch (error) {
      await db.execute("ROLLBACK;").catch(() => undefined);
      await db.execute("DETACH DATABASE restored;").catch(() => undefined);
      throw new RestoreFailedError(error);
    }
    return safetyBackup;
  } finally {
    await storage.remove(copyPath).catch(() => undefined);
  }
};
