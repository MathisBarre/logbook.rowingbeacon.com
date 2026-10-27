import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../migrations";
import { createTestSqlClient } from "../testing/nodeSqlClient";
import { runV1Migration, V1MigrationDependencies } from "./runV1Migration";

const BOAT_UUID = "11111111-1111-4111-8111-111111111111";
const SESSION_UUID = "22222222-2222-4222-8222-222222222222";
const ROWER_UUID = "33333333-3333-4333-8333-333333333333";

const persisted = (state: unknown) => JSON.stringify({ state, version: 0 });

const v1LocalStorage = () => ({
  clubOverview: persisted({
    clubOverview: {
      club: { password: "hash" },
      boats: [
        {
          id: `boat-${BOAT_UUID}`,
          name: "Marie-Claire",
          type: "FOUR_ROWERS_COXED",
          note: "Fragile",
          isInMaintenance: false,
        },
        {
          id: "boat-legacy",
          name: "Skiff",
          type: "ONE_ROWER_COXLESS",
          archivedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      routes: [{ id: "0.123", name: "Amont" }],
      rowers: [
        {
          id: `rower-${ROWER_UUID}`,
          name: "Jean  Dupont",
          category: "Senior",
          type: "competitor",
        },
        { id: "0.456", name: "Léa" },
        { id: "0.789", name: "Anne Marie de La Tour" },
      ],
    },
    coachNote: "Vent fort",
  }),
  sessions: persisted({
    session: [
      {
        id: "session-ongoing",
        boat: { id: "boat-legacy", name: "Skiff" },
        route: null,
        rowers: [{ id: "0.456", name: "Léa" }],
        startDateTime: "2026-10-18T08:00:00.000Z",
        comment: "",
        endDateTime: null,
      },
    ],
  }),
  incidents: persisted({
    incidents: [
      {
        id: "incident-x",
        boatId: `boat-${BOAT_UUID}`,
        message: "Dame cassée",
        sessionId: `session-${SESSION_UUID}`,
        datetime: "2026-10-01T10:00:00.000Z",
      },
    ],
  }),
  boatLevelConfigStore: persisted({
    boatTypeLevelConfigs: { ONE_ROWER_COXLESS: { alertFrom: 1, blockFrom: 2 } },
    boatLevelConfigs: [
      {
        boatId: `boat-${BOAT_UUID}`,
        minimalRowerCategory: "J16",
        minimalRowerType: null,
      },
    ],
  }),
});

const createDeps = (storage: Record<string, string>) => {
  const backups: string[] = [];
  const deps: V1MigrationDependencies = {
    readLocalStorage: (key) => storage[key] ?? null,
    removeLocalStorage: (key) => {
      delete storage[key];
    },
    writeBackup: (content) => {
      backups.push(content);
      return Promise.resolve("backup.json");
    },
    unknownLabels: {
      boat: "Bateau inconnu",
      rower: "Rameur inconnu",
      route: "Parcours inconnu",
    },
  };
  return { deps, backups };
};

describe("runV1Migration", () => {
  let db: ReturnType<typeof createTestSqlClient>;

  beforeEach(async () => {
    db = createTestSqlClient();
    await applyMigrations(db);
    await db.execute(`
      INSERT INTO session (id, boat_id, start_date_time, end_date_time, route_id, comment, has_been_coached) VALUES
        ('session-${SESSION_UUID}', 'boat-${BOAT_UUID}', '2026-10-01T09:00', '2026-10-01T10:00', '0.123', 'RAS', 'true'),
        ('session-old', 'NOT_FOUND', '2025-05-01T09:00', '2025-05-01T10:00', NULL, NULL, NULL);
      INSERT INTO session_rowers (session_id, rower_id) VALUES
        ('session-${SESSION_UUID}', 'rower-${ROWER_UUID}'),
        ('session-${SESSION_UUID}', '0.789'),
        ('session-${SESSION_UUID}', 'deleted-rower');
    `);
  });

  it("copies every v1 record into the v2 tables", async () => {
    const storage = v1LocalStorage();
    const { deps, backups } = createDeps(storage);

    const result = await runV1Migration(db, deps);

    expect(result.status).toBe("migrated");
    expect(backups).toHaveLength(1);
    expect(Object.keys(storage)).toHaveLength(0);

    const boats = await db.select<
      {
        id: string;
        name: string;
        note: string | null;
        archived_at: string | null;
      }[]
    >("SELECT id, name, note, archived_at FROM boat ORDER BY name");
    expect(boats.map((b) => b.name)).toEqual([
      "Bateau inconnu",
      "Marie-Claire",
      "Skiff",
    ]);
    expect(boats.find((b) => b.name === "Marie-Claire")?.id).toBe(BOAT_UUID);
    expect(
      boats.find((b) => b.name === "Bateau inconnu")?.archived_at
    ).not.toBeNull();

    const configuration = await db.select<
      { seats: number; coxed: number; is_default: number }[]
    >(
      "SELECT seats, coxed, is_default FROM boat_configuration WHERE boat_id = $1",
      [BOAT_UUID]
    );
    expect(configuration).toEqual([{ seats: 4, coxed: 1, is_default: 1 }]);

    const rowers = await db.select<
      { id: string; first_name: string; last_name: string; status: string }[]
    >(
      "SELECT id, first_name, last_name, status FROM rower ORDER BY first_name"
    );
    expect(rowers.map((r) => [r.first_name, r.last_name, r.status])).toEqual([
      ["Anne", "Marie de La Tour", "member"],
      ["Jean", "Dupont", "member"],
      ["Léa", "", "member"],
      ["Rameur", "inconnu", "guest"],
    ]);
    expect(rowers.find((r) => r.first_name === "Jean")?.id).toBe(ROWER_UUID);
    for (const rower of rowers) {
      expect(rower.id).toMatch(/^[0-9a-f-]{36}$/);
    }

    const outings = await db.select<
      {
        id: string;
        boat_id: string;
        route_id: string | null;
        end_date_time: string | null;
        has_been_coached: number | null;
        boat_configuration_id: string | null;
      }[]
    >(
      "SELECT id, boat_id, route_id, end_date_time, has_been_coached, boat_configuration_id FROM outing ORDER BY start_date_time"
    );
    expect(outings).toHaveLength(3);
    const finished = outings.find((o) => o.id === SESSION_UUID);
    expect(finished?.boat_id).toBe(BOAT_UUID);
    expect(finished?.has_been_coached).toBe(1);
    expect(finished?.boat_configuration_id).not.toBeNull();
    expect(outings.filter((o) => o.end_date_time === null)).toHaveLength(1);

    const crew = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM outing_crew WHERE outing_id = $1",
      [SESSION_UUID]
    );
    expect(crew[0].count).toBe(3);

    const incident = await db.select<{ outing_id: string; boat_id: string }[]>(
      "SELECT outing_id, boat_id FROM incident"
    );
    expect(incident).toEqual([{ outing_id: SESSION_UUID, boat_id: BOAT_UUID }]);

    const settings = await db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM setting ORDER BY key"
    );
    const settingsByKey = Object.fromEntries(
      settings.map((s) => [s.key, JSON.parse(s.value) as unknown])
    );
    expect(settingsByKey["club.passwordHash"]).toBe("hash");
    expect(settingsByKey["club.coachNote"]).toBe("Vent fort");
    expect(settingsByKey["levels.boatTypeLevelConfigs"]).toEqual({
      ONE_ROWER_COXLESS: { alertFrom: 1, blockFrom: 2 },
    });

    const levels = await db.select<
      { boat_id: string; minimal_rower_category: string }[]
    >("SELECT boat_id, minimal_rower_category FROM boat_level_config");
    expect(levels).toEqual([
      { boat_id: BOAT_UUID, minimal_rower_category: "J16" },
    ]);

    const legacy = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM session"
    );
    expect(legacy[0].count).toBe(2);
  });

  it("runs only once", async () => {
    const { deps } = createDeps(v1LocalStorage());
    await runV1Migration(db, deps);

    const second = await runV1Migration(db, createDeps(v1LocalStorage()).deps);
    expect(second.status).toBe("already-done");
  });

  it("leaves localStorage untouched when the backup fails, and can retry", async () => {
    const storage = v1LocalStorage();
    const { deps } = createDeps(storage);

    await expect(
      runV1Migration(db, {
        ...deps,
        writeBackup: () => Promise.reject(new Error("disk full")),
      })
    ).rejects.toThrow("disk full");
    expect(Object.keys(storage)).toHaveLength(4);

    const retry = await runV1Migration(db, deps);
    expect(retry.status).toBe("migrated");
  });

  it("recovers from a half-done run", async () => {
    const storage = v1LocalStorage();
    const { deps } = createDeps(storage);
    await db.execute(
      "INSERT INTO route (id, name, created_at, updated_at) VALUES ('leftover', 'Partiel', 'x', 'x')"
    );

    const result = await runV1Migration(db, deps);

    expect(result.status).toBe("migrated");
    const routes = await db.select<{ name: string }[]>(
      "SELECT name FROM route"
    );
    expect(routes.map((r) => r.name)).toEqual(["Amont"]);
  });

  it("marks a fresh install as done without a backup", async () => {
    await db.execute("DELETE FROM session_rowers; DELETE FROM session;");
    const { deps, backups } = createDeps({});

    const result = await runV1Migration(db, deps);

    expect(result.status).toBe("nothing-to-migrate");
    expect(backups).toHaveLength(0);
  });

  it("skips damaged v1 records instead of blocking the app", async () => {
    await db.execute(
      "INSERT INTO session (id, boat_id, end_date_time) VALUES ('session-broken', 'NOT_FOUND', NULL)"
    );
    const twin = "44444444-4444-4444-8444-444444444444";
    const storage = {
      clubOverview: persisted({
        clubOverview: {
          boats: [
            { id: `boat-${twin}`, name: "A" },
            { id: twin, name: "B" },
            { id: "boat-x" },
          ],
          rowers: [{ id: "r-no-name" }, { id: "r-ok", name: "Léa" }],
        },
      }),
      sessions: persisted({
        session: [
          {
            id: "ongoing-without-rowers",
            boat: { id: `boat-${twin}` },
            route: null,
            startDateTime: "2026-10-18T08:00:00.000Z",
            endDateTime: null,
          },
        ],
      }),
    };
    const { deps, backups } = createDeps(storage);

    const result = await runV1Migration(db, deps);

    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") return;
    expect(result.skipped).toBe(3);
    const backup = JSON.parse(backups[0]) as { skipped: { kind: string }[] };
    expect(backup.skipped.map((s) => s.kind).sort()).toEqual([
      "boat",
      "outing",
      "rower",
    ]);

    const boats = await db.select<{ id: string }[]>("SELECT id FROM boat");
    expect(new Set(boats.map((b) => b.id)).size).toBe(boats.length);
    const ongoing = await db.select<{ start_date_time: string }[]>(
      "SELECT start_date_time FROM outing WHERE end_date_time IS NULL"
    );
    expect(ongoing).toHaveLength(1);
  });

  it("skips duplicated v1 incidents and boat level configs", async () => {
    const incident = {
      id: "incident-twice",
      boatId: "b1",
      message: "Coque fissurée",
      sessionId: "none",
      datetime: "2026-10-01T10:00:00.000Z",
    };
    const storage = {
      clubOverview: persisted({
        clubOverview: { boats: [{ id: "b1", name: "Skiff" }] },
      }),
      incidents: persisted({ incidents: [incident, incident] }),
      boatLevelConfigStore: persisted({
        boatLevelConfigs: [
          { boatId: "b1", minimalRowerCategory: "J14", minimalRowerType: null },
          { boatId: "b1", minimalRowerCategory: "J16", minimalRowerType: null },
        ],
      }),
    };
    const { deps, backups } = createDeps(storage);

    const result = await runV1Migration(db, deps);

    expect(result.status).toBe("migrated");
    const backup = JSON.parse(backups[0]) as {
      skipped: { kind: string; reason: string }[];
    };
    expect(backup.skipped.map((s) => `${s.kind}: ${s.reason}`).sort()).toEqual(
      [
        "boatLevelConfig: duplicate boat",
        "incident: duplicate id",
        "incident: outing not found, link dropped",
      ]
    );
    const incidents = await db.select<{ id: string }[]>("SELECT id FROM incident");
    expect(incidents).toHaveLength(1);
    const levels = await db.select<{ minimal_rower_category: string }[]>(
      "SELECT minimal_rower_category FROM boat_level_config"
    );
    expect(levels).toEqual([{ minimal_rower_category: "J16" }]);
  });

  it("reports duplicated records and outings ending before they start", async () => {
    await db.execute(`
      INSERT INTO session (id, boat_id, start_date_time, end_date_time) VALUES
        ('session-reversed', 'b1', '2026-10-02T10:00', '2026-10-02T09:00');
      INSERT INTO session_rowers (session_id, rower_id) VALUES
        ('session-reversed', 'r1');
    `);
    const storage = {
      clubOverview: persisted({
        clubOverview: {
          boats: [
            { id: "b1", name: "Skiff" },
            { id: "b1", name: "Skiff bis" },
          ],
          rowers: [
            { id: "r1", name: "Jean" },
            { id: "r1", name: "Dup" },
          ],
        },
      }),
    };
    const { deps, backups } = createDeps(storage);

    await runV1Migration(db, deps);

    const backup = JSON.parse(backups[0]) as {
      skipped: { kind: string; reason: string }[];
    };
    const reasons = backup.skipped.map((s) => `${s.kind}: ${s.reason}`);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "boat: duplicate id",
        "rower: duplicate id",
        "outing: end before start",
      ])
    );
    const outings = await db.select<{ id: string }[]>(
      "SELECT id FROM outing WHERE start_date_time = '2026-10-02T10:00'"
    );
    expect(outings).toHaveLength(0);
    const reversed = backup.skipped.find(
      (s) => s.reason === "end before start"
    ) as unknown as { record: { rower_ids: string[] } };
    expect(reversed.record.rower_ids).toEqual(["r1"]);
  });

  it("lists placeholders and names them from ongoing outings", async () => {
    await db.execute(`
      INSERT INTO session (id, boat_id, start_date_time, end_date_time) VALUES
        ('session-past', 'b-gone', '2026-10-02T09:00', '2026-10-02T10:00');
    `);
    const storage = {
      sessions: persisted({
        session: [
          {
            id: "session-now",
            boat: { id: "b-gone", name: "Aviron Bleu" },
            rowers: [],
            startDateTime: "2026-10-18T09:00:00.000Z",
          },
        ],
      }),
    };
    const { deps, backups } = createDeps(storage);

    await runV1Migration(db, deps);

    const backup = JSON.parse(backups[0]) as {
      placeholders: { kind: string; v1Id: string; name: string }[];
    };
    expect(backup.placeholders).toEqual(
      expect.arrayContaining([
        { kind: "boat", v1Id: "b-gone", name: "Aviron Bleu" },
        { kind: "boat", v1Id: "NOT_FOUND", name: "Bateau inconnu" },
      ])
    );
    const boats = await db.select<{ name: string }[]>(
      "SELECT name FROM boat WHERE name = 'Aviron Bleu'"
    );
    expect(boats).toHaveLength(1);
  });

  it("reports a v1 store that cannot be read", async () => {
    const storage = { clubOverview: '{"state": {"clubOverv' };
    const { deps, backups } = createDeps(storage);

    const result = await runV1Migration(db, deps);

    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") return;
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const backup = JSON.parse(backups[0]) as { skipped: { kind: string }[] };
    expect(backup.skipped.map((s) => s.kind)).toContain("store");
  });

  it("clears v1 localStorage left behind after a finished migration", async () => {
    const storage = v1LocalStorage() as Record<string, string>;
    await runV1Migration(db, createDeps(storage).deps);
    storage.clubOverview = "{}";

    const result = await runV1Migration(db, createDeps(storage).deps);

    expect(result.status).toBe("already-done");
    expect(storage.clubOverview).toBeUndefined();
  });

  it("reports ongoing v1 outings with a broken end and level configs of unknown boats", async () => {
    const outing = (id: string, endDateTime: string | null) => ({
      id,
      boat: { id: "b1" },
      route: null,
      rowers: [],
      startDateTime: "2026-10-18T10:00:00.000Z",
      endDateTime,
    });
    const storage = {
      clubOverview: persisted({
        clubOverview: { boats: [{ id: "b1", name: "Skiff" }] },
      }),
      sessions: persisted({
        session: [
          outing("reversed", "2026-10-18T08:00:00.000Z"),
          outing("unreadable", "pas une date"),
        ],
      }),
      boatLevelConfigStore: persisted({
        boatLevelConfigs: [
          { boatId: "gone", minimalRowerCategory: "J16", minimalRowerType: null },
        ],
      }),
    };
    const { deps, backups } = createDeps(storage);

    await runV1Migration(db, deps);

    const backup = JSON.parse(backups[0]) as {
      skipped: { kind: string; reason: string }[];
    };
    expect(backup.skipped.map((s) => `${s.kind}: ${s.reason}`).sort()).toEqual([
      "boatLevelConfig: unknown boat",
      "outing: end before start",
      "outing: unreadable end date",
    ]);
    const outings = await db.select<{ id: string }[]>(
      "SELECT id FROM outing WHERE start_date_time LIKE '2026-10-18%'"
    );
    expect(outings).toHaveLength(0);
  });

  it("reports v1 values it has to drop and lists that are not lists", async () => {
    const storage = {
      clubOverview: persisted({
        clubOverview: { boats: [{ id: "b1", name: "Skiff" }], rowers: "?" },
      }),
      sessions: persisted({
        session: [
          {
            id: "ongoing",
            boat: { id: "b1" },
            route: { name: "sans id" },
            rowers: [],
            startDateTime: "2026-10-18T08:00:00.000Z",
            estimatedEndDateTime: "bientôt",
            endDateTime: null,
          },
        ],
      }),
    };
    const { deps, backups } = createDeps(storage);

    await runV1Migration(db, deps);

    const backup = JSON.parse(backups[0]) as {
      skipped: { kind: string; reason: string }[];
    };
    expect(backup.skipped.map((s) => `${s.kind}: ${s.reason}`)).toEqual(
      expect.arrayContaining([
        "store: rowers is not a list",
        "outing: route without id, dropped",
        "outing: unreadable estimated end, dropped",
      ])
    );
    const ongoing = await db.select<{ id: string }[]>(
      "SELECT id FROM outing WHERE end_date_time IS NULL"
    );
    expect(ongoing).toHaveLength(1);
  });
});
