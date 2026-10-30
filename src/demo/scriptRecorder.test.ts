import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applyMigrations } from "../_common/database/migrations";
import { createTestSqlClient } from "../_common/database/testing/nodeSqlClient";
import { createScriptRecorder } from "./scriptRecorder";
import { seedClubWith } from "./seed/seedClub";

const NOW = "2026-06-20T09:47";

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

const TABLES = [
  "setting",
  "boat",
  "boat_configuration",
  "rower",
  "route",
  "outing",
  "outing_crew",
  "incident",
  "boat_damage",
  "boat_reservation",
  "change_log",
];

it("writes the same club as the statements it records, run as one script", async () => {
  const options = { locale: "fr-FR", now: NOW, modules: ["damages"] } as const;

  const direct = createTestSqlClient();
  await seedClubWith(direct, options);

  const recorded = createTestSqlClient();
  await applyMigrations(recorded);
  const recorder = createScriptRecorder();
  await seedClubWith(recorder.client, options, { migrated: true });
  expect(recorder.statements.length).toBeGreaterThan(1000);
  await recorded.execute(recorder.statements.join("\n"));

  for (const table of TABLES) {
    const sql = `SELECT * FROM ${table} ORDER BY rowid`;
    expect(await recorded.select(sql)).toEqual(await direct.select(sql));
  }
}, 60_000);

it("leaves the database untouched when the script fails halfway", async () => {
  const db = createTestSqlClient();
  await applyMigrations(db);
  const recorder = createScriptRecorder();
  await seedClubWith(
    recorder.client,
    { locale: "fr-FR", now: NOW },
    { migrated: true }
  );
  const script = recorder.statements.join("\n");
  // A statement that fails after the club was half written.
  const broken = script.replace(
    /COMMIT;$/,
    "INSERT INTO no_such_table VALUES (1);\nCOMMIT;"
  );
  await expect((async () => db.execute(broken))()).rejects.toThrow();
  await db.execute("ROLLBACK;");
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM outing"
  );
  expect(rows[0].n).toBe(0);
}, 60_000);
