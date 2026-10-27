import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../database/migrations";
import { createTestSqlClient } from "../database/testing/nodeSqlClient";
import { SqlClient } from "../database/sqlClient";
import {
  BackupStorage,
  createBackup,
  listBackups,
  NewerBackupError,
  NotABackupError,
  removeLeftoverRestoreCopies,
  restoreBackup,
  RestoreFailedError,
} from "./backup.service";
import { getBackupFileName } from "./backup.rules";

let root: string;
let storage: BackupStorage;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rb-backup-"));
  storage = {
    directory: () => Promise.resolve(join(root, "backups")),
    join: (folder, fileName) => Promise.resolve(join(folder, fileName)),
    list: (folder) => Promise.resolve(readdirSync(folder)),
    remove: (path) => Promise.resolve(rmSync(path)),
    rename: (from, to) => Promise.resolve(renameSync(from, to)),
  };
  rmSync(join(root, "backups"), { force: true, recursive: true });
  mkdirSync(join(root, "backups"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const openDatabase = (path: string) =>
  Promise.resolve(createTestSqlClient(path));

const clubDatabase = async () => {
  const db = createTestSqlClient(join(root, "main.db"));
  await applyMigrations(db);
  await db.execute(
    "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('b1', 'Hirondelle', 'x', 'x')"
  );
  await db.execute(
    "INSERT INTO rower (id, first_name, created_at, updated_at) VALUES ('r1', 'Jeanne', 'x', 'x')"
  );
  await db.execute(
    "INSERT INTO outing (id, boat_id, start_date_time, created_at, updated_at) VALUES ('o1', 'b1', '2026-05-02T09:00', 'x', 'x')"
  );
  await db.execute(
    "INSERT INTO outing_crew (outing_id, rower_id) VALUES ('o1', 'r1')"
  );
  return db;
};

const names = async (db: SqlClient) =>
  (
    await db.select<{ name: string }[]>("SELECT name FROM boat ORDER BY name")
  ).map((row) => row.name);

describe("backups", () => {
  test("a backup is a dated copy of the database", async () => {
    const db = await clubDatabase();
    const { fileName } = await createBackup(db, "manual", {
      storage,
      now: new Date(2026, 9, 19, 8, 0, 0),
    });
    expect(fileName).toBe("rowingbeacon-2026-10-19_08-00-00-manual.db");

    const copy = createTestSqlClient(join(root, "backups", fileName));
    expect(await names(copy)).toEqual(["Hirondelle"]);
    await copy.close();
  });

  test("only the 14 newest automatic backups are kept", async () => {
    const db = await clubDatabase();
    for (let day = 1; day <= 16; day++) {
      await createBackup(db, "auto", { storage, now: new Date(2026, 0, day) });
    }
    await createBackup(db, "manual", { storage, now: new Date(2025, 0, 1) });

    const backups = await listBackups(storage);
    expect(backups.filter((b) => b.kind === "auto")).toHaveLength(14);
    expect(backups.filter((b) => b.kind === "manual")).toHaveLength(1);
    expect(backups[0].createdAt).toBe("2026-01-16T00:00:00");
  });

  test("also copies to a second folder, and survives when it is missing", async () => {
    const db = await clubDatabase();
    const external = join(root, "usb");
    mkdirSync(external);
    const ok = await createBackup(db, "manual", {
      storage,
      externalFolder: external,
    });
    expect(ok.externalCopy).toBe("written");
    expect(readdirSync(external)).toEqual([ok.fileName]);

    const missing = await createBackup(db, "manual", {
      storage,
      externalFolder: join(root, "unplugged"),
      now: new Date(2026, 1, 1),
    });
    expect(missing.externalCopy).toBe("failed");
  });

  test("a restore brings back the data and keeps a backup of the replaced data", async () => {
    const db = await clubDatabase();
    const { path } = await createBackup(db, "manual", {
      storage,
      now: new Date(2026, 0, 1),
    });

    await db.execute("DELETE FROM outing_crew");
    await db.execute("DELETE FROM outing");
    await db.execute("UPDATE boat SET name = 'Renamed'");
    await db.execute(
      "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('b2', 'New boat', 'x', 'x')"
    );

    await restoreBackup(db, path, {
      storage,
      openDatabase,
      now: new Date(2026, 0, 2),
    });

    expect(await names(db)).toEqual(["Hirondelle"]);
    const [{ crew }] = await db.select<{ crew: number }[]>(
      "SELECT COUNT(*) AS crew FROM outing_crew"
    );
    expect(Number(crew)).toBe(1);

    const backups = await listBackups(storage);
    expect(backups.map((b) => b.kind)).toContain("before-restore");
    expect(
      readdirSync(join(root, "backups")).some((f) => f.startsWith("restore-"))
    ).toBe(false);
  });

  test("a restore keeps incidents linked to their outing", async () => {
    const db = await clubDatabase();
    await db.execute(
      "INSERT INTO incident (id, outing_id, boat_id, message, occurred_at, created_at) VALUES ('i1', 'o1', 'b1', 'Dérive cassée', 'x', 'x')"
    );
    const { path } = await createBackup(db, "manual", { storage });

    await restoreBackup(db, path, { storage, openDatabase });

    const [incident] = await db.select<{ outing_id: string | null }[]>(
      "SELECT outing_id FROM incident WHERE id = 'i1'"
    );
    expect(incident.outing_id).toBe("o1");
  });

  test("an older backup is brought to the current schema before restoring", async () => {
    const db = await clubDatabase();
    const oldPath = join(root, "old.db");
    const old = createTestSqlClient(oldPath);
    // A database from before the efa2 records table, with one boat.
    await applyMigrations(old);
    await old.execute("DROP TABLE efa_record");
    await old.execute("DELETE FROM migration WHERE timestamp = 1792400000000");
    await old.execute(
      "INSERT INTO boat (id, name, created_at, updated_at) VALUES ('b9', 'Ancienne', 'x', 'x')"
    );
    await old.close();

    await restoreBackup(db, oldPath, { storage, openDatabase });
    expect(await names(db)).toEqual(["Ancienne"]);
  });

  test("refuses a file that is not a Rowing Beacon database", async () => {
    const db = await clubDatabase();
    const other = join(root, "other.db");
    const foreign = createTestSqlClient(other);
    await foreign.execute("CREATE TABLE t (x)");
    await foreign.close();
    await expect(
      restoreBackup(db, other, { storage, openDatabase })
    ).rejects.toThrow(NotABackupError);

    const text = join(root, "notes.txt");
    writeFileSync(text, "hello");
    await expect(
      restoreBackup(db, text, { storage, openDatabase })
    ).rejects.toThrow();
    expect(await names(db)).toEqual(["Hirondelle"]);
  });

  test("refuses a backup made by a newer Rowing Beacon", async () => {
    const db = await clubDatabase();
    const newerPath = join(root, "newer.db");
    const newer = createTestSqlClient(newerPath);
    await applyMigrations(newer);
    await newer.execute(
      "INSERT INTO migration (timestamp) VALUES (9999999999999)"
    );
    await newer.close();

    await expect(
      restoreBackup(db, newerPath, { storage, openDatabase })
    ).rejects.toThrow(NewerBackupError);
    expect(await names(db)).toEqual(["Hirondelle"]);
  });

  test("a failed restore changes nothing", async () => {
    const db = await clubDatabase();
    const { path } = await createBackup(db, "manual", {
      storage,
      now: new Date(2026, 0, 1),
    });
    await db.execute(
      "CREATE TRIGGER no_boat BEFORE INSERT ON boat BEGIN SELECT RAISE(ABORT, 'no'); END;"
    );

    await expect(
      restoreBackup(db, path, { storage, openDatabase })
    ).rejects.toThrow(RestoreFailedError);
    expect(await names(db)).toEqual(["Hirondelle"]);
  });

  test("a copy cut short on the second folder is cleaned at the next backup", async () => {
    const db = await clubDatabase();
    const external = join(root, "usb");
    mkdirSync(external);
    const old = new Date(2026, 0, 1, 8, 0, 0);
    const mine = `${getBackupFileName("manual", old, "pabcde")}.part`;
    const other = `${getBackupFileName("manual", old, "pzzzzz")}.part`;
    writeFileSync(join(external, mine), "");
    writeFileSync(join(external, other), "");
    const { fileName } = await createBackup(db, "manual", {
      storage,
      externalFolder: external,
      machineId: "pabcde",
      now: new Date(2026, 0, 2),
    });
    expect(readdirSync(external).sort()).toEqual([fileName, other].sort());
  });

  test("an old backup that cannot be removed does not fail the backup", async () => {
    const db = await clubDatabase();
    for (let day = 1; day <= 15; day++) {
      await createBackup(db, "auto", { storage, now: new Date(2026, 0, day) });
    }
    const locked = {
      ...storage,
      remove: () => Promise.reject(new Error("locked")),
    };
    const result = await createBackup(db, "auto", {
      storage: locked,
      now: new Date(2026, 0, 20),
    });
    expect(readdirSync(join(root, "backups"))).toContain(result.fileName);
  });

  test("a backup cut short is never listed", async () => {
    const db = await clubDatabase();
    const failing = {
      ...storage,
      rename: () => Promise.reject(new Error("disk full")),
    };
    await expect(createBackup(db, "auto", { storage: failing })).rejects.toThrow(
      "disk full"
    );
    expect(await listBackups(storage)).toEqual([]);
    expect(readdirSync(join(root, "backups"))).toEqual([]);
  });

  test("leftover restore copies and partial backups are removed", async () => {
    writeFileSync(join(root, "backups", "restore-123.db"), "");
    writeFileSync(join(root, "backups", "restore-123.db-wal"), "");
    writeFileSync(
      join(root, "backups", "rowingbeacon-2026-01-01_08-00-00-auto.db.part"),
      ""
    );
    writeFileSync(join(root, "backups", "keep.txt"), "");
    await removeLeftoverRestoreCopies(storage);
    expect(readdirSync(join(root, "backups"))).toEqual(["keep.txt"]);
  });

  test("two backups in the same second both succeed", async () => {
    const db = await clubDatabase();
    const at = new Date(2026, 0, 1, 8, 0, 0);
    const first = await createBackup(db, "manual", { storage, now: at });
    const second = await createBackup(db, "manual", { storage, now: at });
    expect(second.fileName).not.toBe(first.fileName);
  });

  test("file names never collide within a day", () => {
    expect(getBackupFileName("auto", new Date(2026, 0, 1, 1))).not.toBe(
      getBackupFileName("auto", new Date(2026, 0, 1, 2))
    );
  });
});
