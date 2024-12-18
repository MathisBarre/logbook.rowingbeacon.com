/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { drizzle as drizzleProxy } from "drizzle-orm/sqlite-proxy";
import Database from "@tauri-apps/plugin-sql";
import * as schema from "./schema";

export type SelectQueryResult = {
  [key: string]: any;
};

export const getDrizzle = (sqlite: Database) => {
  return drizzleProxy<typeof schema>(
    async (sql, params, method) => {
      let rows: any = [];
      let results = [];

      if (isSelectQuery(sql)) {
        rows = await sqlite.select(sql, params).catch((e) => {
          console.error("SQL Error:", e);
          return [];
        });
      } else {
        rows = await sqlite.execute(sql, params).catch((e) => {
          console.error("SQL Error:", e);
          return [];
        });
        return { rows: [] };
      }

      rows = rows.map((row: any) => {
        return Object.values(row);
      });

      results = method === "all" ? rows : rows[0];

      return { rows: results };
    },

    { schema: schema, logger: true }
  );
};

function isSelectQuery(sql: string): boolean {
  const selectRegex = /^\s*SELECT\b/i;
  return selectRegex.test(sql);
}
