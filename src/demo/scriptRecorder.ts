import { sqlLiteral, type SqlClient } from "../_common/database/sqlClient";

/**
 * A SqlClient that writes nothing: it records every statement, parameters
 * inlined as SQLite literals, to be run later as one script. The Tauri SQL
 * plugin spreads separate calls over its connections, so a transaction
 * (BEGIN … COMMIT) only holds in a single multi-statement call, as in the
 * efa2 import. Every read answers "no row": the club being written is new.
 */
export const createScriptRecorder = () => {
  const statements: string[] = [];
  const client: SqlClient = {
    execute: (sql, params = []) => {
      const text = sql.trim().replace(/;+$/, "");
      statements.push(
        `${text.replace(/\$(\d+)/g, (_, index: string) => {
          const position = Number(index) - 1;
          if (position >= params.length) {
            throw new Error(
              `Statement uses $${index} without a value: ${text}`
            );
          }
          return sqlLiteral(params[position]);
        })};`
      );
      return Promise.resolve();
    },
    select: <T>() => Promise.resolve([] as T),
  };
  return { client, statements };
};
