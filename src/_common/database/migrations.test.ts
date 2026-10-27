import { describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations";
import { createTestSqlClient } from "./testing/nodeSqlClient";

describe("applyMigrations", () => {
  it("creates the v2 tables and can run twice", async () => {
    const db = createTestSqlClient();

    await applyMigrations(db);
    await applyMigrations(db);

    const tables = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const names = tables.map((t) => t.name);

    for (const table of [
      "boat",
      "boat_configuration",
      "rower",
      "route",
      "outing",
      "outing_crew",
      "outing_type",
      "incident",
      "setting",
      "change_log",
      "efa_record",
      "session",
      "session_rowers",
    ]) {
      expect(names).toContain(table);
    }

    const types = await db.select<{ code: string }[]>(
      "SELECT code FROM outing_type"
    );
    expect(types.length).toBe(9);
  });
});
