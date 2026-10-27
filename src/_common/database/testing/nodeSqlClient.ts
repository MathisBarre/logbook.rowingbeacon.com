import { createRequire } from "node:module";
import { SqlClient } from "../sqlClient";

const require = createRequire(import.meta.url);

interface NodeStatement {
  run(params: Record<string, unknown>): unknown;
  all(params: Record<string, unknown>): unknown[];
}

interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

const toNamedParams = (params: unknown[] = []) => {
  return Object.fromEntries(
    params.map((value, index) => [
      String(index + 1),
      typeof value === "boolean" ? (value ? 1 : 0) : (value ?? null),
    ])
  );
};

/**
 * SQLite client for tests (in memory unless a file is given), with the
 * same `$1` parameter style and foreign key enforcement as the Tauri SQL
 * plugin.
 */
export const createTestSqlClient = (
  path = ":memory:"
): SqlClient & { raw: NodeDatabase; close: () => Promise<void> } => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { DatabaseSync } = require("node:sqlite");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const raw = new DatabaseSync(path) as NodeDatabase;
  raw.exec("PRAGMA foreign_keys = ON;");

  return {
    raw,
    execute: (sql, params) => {
      if (!params || params.length === 0) {
        raw.exec(sql);
        return Promise.resolve();
      }
      raw.prepare(sql).run(toNamedParams(params));
      return Promise.resolve();
    },
    select: <T>(sql: string, params?: unknown[]) => {
      return Promise.resolve(raw.prepare(sql).all(toNamedParams(params)) as T);
    },
    close: () => {
      raw.close();
      return Promise.resolve();
    },
  };
};
