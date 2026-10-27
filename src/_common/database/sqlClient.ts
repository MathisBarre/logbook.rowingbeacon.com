/**
 * Minimal SQL access used by repositories and data migrations.
 * The Tauri SQL plugin `Database` satisfies it; tests use an in-memory
 * SQLite adapter (see testing/nodeSqlClient.ts).
 */
export interface SqlClient {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

/**
 * Inline a value as a SQLite literal. Used for multi-statement scripts,
 * which the Tauri SQL plugin cannot bind parameters to.
 */
export const sqlLiteral = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "NULL";
    }
    return String(value);
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
};

/**
 * Build `INSERT INTO table (cols) VALUES (...), (...)` statements,
 * chunked to stay under SQLite limits.
 */
export const buildInsertStatements = (
  table: string,
  columns: string[],
  rows: unknown[][],
  options: { chunkSize?: number; orIgnore?: boolean } = {}
): string[] => {
  const chunkSize = options.chunkSize ?? 200;
  const statements: string[] = [];

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk
      .map((row) => `(${row.map(sqlLiteral).join(", ")})`)
      .join(",\n");
    statements.push(
      `INSERT${options.orIgnore ? " OR IGNORE" : ""} INTO ${table} (${columns.join(", ")}) VALUES\n${values};`
    );
  }

  return statements;
};
