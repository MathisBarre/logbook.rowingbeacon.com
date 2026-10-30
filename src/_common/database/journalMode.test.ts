import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureWalMode } from "./journalMode";
import { createTestSqlClient } from "./testing/nodeSqlClient";
import { SqlClient } from "./sqlClient";

describe("ensureWalMode", () => {
  const dirs: string[] = [];
  const tempDb = () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-wal-"));
    dirs.push(dir);
    return join(dir, "main.db");
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
    vi.restoreAllMocks();
  });

  it("switches a rollback-journal database to WAL, for good", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const path = tempDb();
    const db = createTestSqlClient(path);
    await db.execute("PRAGMA journal_mode = DELETE");
    await db.execute("CREATE TABLE t (x INTEGER)");
    await db.execute("INSERT INTO t VALUES (1)");

    expect(await ensureWalMode(db)).toBe("wal");
    await db.close();

    const reopened = createTestSqlClient(path);
    expect(
      await reopened.select<{ journal_mode: string }[]>("PRAGMA journal_mode")
    ).toEqual([{ journal_mode: "wal" }]);
    expect(await reopened.select("SELECT x FROM t")).toEqual([{ x: 1 }]);
    await reopened.close();
  });

  it("leaves a WAL database alone", async () => {
    const db = createTestSqlClient(tempDb());
    await db.execute("PRAGMA journal_mode = WAL");
    const select = vi.spyOn(db, "select");

    expect(await ensureWalMode(db)).toBe("wal");
    expect(select).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it("never throws: the app still starts when the switch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing: SqlClient = {
      execute: () => Promise.resolve(),
      select: <T>(sql: string) =>
        sql.includes("=")
          ? Promise.reject(new Error("database is locked"))
          : Promise.resolve([{ journal_mode: "delete" }] as T),
    };

    expect(await ensureWalMode(failing)).toBe("delete");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("database is locked")
    );
  });

  it("does not try to change an in-memory database", async () => {
    const db = createTestSqlClient();
    expect(await ensureWalMode(db)).toBe("memory");
    await db.close();
  });
});
