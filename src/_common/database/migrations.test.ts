import { describe, expect, it } from "vitest";
import { applyMigrations, migrations } from "./migrations";
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
      "analytics_query",
      "analytics_dashboard_item",
    ]) {
      expect(names).toContain(table);
    }

    const types = await db.select<{ code: string }[]>(
      "SELECT code FROM outing_type"
    );
    expect(types.length).toBe(9);
  });

  const columns = async (
    db: ReturnType<typeof createTestSqlClient>,
    table: string
  ) =>
    db.select<{ name: string; notnull: number; dflt_value: string | null }[]>(
      `SELECT name, "notnull", dflt_value FROM pragma_table_info('${table}')`
    );

  it("keeps the columns of migrations 05, 06 and 12", async () => {
    const db = createTestSqlClient();
    await applyMigrations(db);
    const coached = (await columns(db, "session")).find(
      (column) => column.name === "has_been_coached"
    );
    // 05 added it NOT NULL DEFAULT 'false'; 06 made it nullable.
    expect(coached).toMatchObject({ notnull: 0, dflt_value: "null" });
    expect((await columns(db, "analytics_query")).map((c) => c.name)).toContain(
      "client"
    );
    const recorded = await db.select<{ timestamp: number }[]>(
      "SELECT timestamp FROM migration ORDER BY timestamp"
    );
    expect(recorded.map((row) => row.timestamp)).toEqual(
      migrations.map((m) => m.timestamp).sort((a, b) => a - b)
    );
  });

  // Review D, L6: a migration and its row in `migration` are one
  // transaction, so a failure (or a power cut) leaves neither and the next
  // start applies it again instead of failing on "duplicate column name".
  it("applies a migration and records it atomically", async () => {
    const db = createTestSqlClient();
    await applyMigrations(db);
    const broken = {
      label: "Broken",
      timestamp: 9_000_000_000_000,
      sql: "ALTER TABLE analytics_query ADD COLUMN extra TEXT;\nSELECT * FROM no_such_table;",
    };
    await expect(applyMigrations(db, [...migrations, broken])).rejects.toThrow(
      /no_such_table/
    );
    expect(
      (await columns(db, "analytics_query")).map((c) => c.name)
    ).not.toContain("extra");
    expect(
      await db.select("SELECT * FROM migration WHERE timestamp = $1", [
        broken.timestamp,
      ])
    ).toEqual([]);

    // Fixed, it applies on the next start.
    const fixed = {
      ...broken,
      sql: "ALTER TABLE analytics_query ADD COLUMN extra TEXT;",
    };
    await applyMigrations(db, [...migrations, fixed]);
    await applyMigrations(db, [...migrations, fixed]);
    expect((await columns(db, "analytics_query")).map((c) => c.name)).toContain(
      "extra"
    );
  });
});
