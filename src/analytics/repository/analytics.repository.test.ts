import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../_common/database/migrations";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";
import {
  acceptProposal,
  archiveQuery,
  deleteDashboardItem,
  deleteQuery,
  getQuery,
  insertProposal,
  MAX_REFUSED_PROPOSALS,
  REFUSED_PROPOSALS_SETTING,
  refuseProposal,
  listDashboardItems,
  listQueries,
  moveDashboardItem,
  replaceDashboard,
  saveDashboardItem,
  saveQuery,
} from "./analytics.repository";
import { deleteAllClubData } from "../../_common/database/repositories/club.repository";

let db: ReturnType<typeof createTestSqlClient>;
beforeEach(async () => {
  db = createTestSqlClient();
  const log = console.log;
  console.log = () => undefined;
  await applyMigrations(db);
  console.log = log;
});
afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

const query = {
  title: "Sorties du week-end",
  sql: "SELECT boat_name FROM v_outings WHERE start_weekday IN (6, 7)",
  params: [
    {
      name: "season",
      type: "season" as const,
      required: true,
      default: "current",
    },
  ],
  chart: { type: "table" as const },
};

const reportItem = (reportId: string) => ({
  source: { kind: "report" as const, reportId },
  size: "half" as const,
  paramValues: {},
  chartOverride: null,
});

describe("analytics queries", () => {
  it("saves, updates and lists queries", async () => {
    const saved = await saveQuery(db, { ...query, origin: "ai" });
    expect(saved).toMatchObject({
      title: "Sorties du week-end",
      origin: "ai",
      status: "saved",
      specVersion: 1,
      archivedAt: null,
      basedOnReportId: null,
      chart: { type: "table" },
    });

    const updated = await saveQuery(db, {
      ...query,
      id: saved.id,
      title: "Week-end",
      origin: "user",
    });
    expect(updated.title).toBe("Week-end");
    expect(updated.origin).toBe("ai");
    expect(updated.createdAt).toBe(saved.createdAt);

    expect((await listQueries(db)).map((q) => q.id)).toEqual([saved.id]);
    expect(await listQueries(db, { status: "proposed" })).toEqual([]);
  });

  it("skips unreadable rows with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await db.execute(
      "INSERT INTO analytics_query (id, title, sql, params, created_at, updated_at) VALUES ('bad', 'x', 'SELECT 1', 'not json', 'a', 'a')"
    );
    expect(await listQueries(db)).toEqual([]);
    expect(await getQuery(db, "bad")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("archives a query and removes its dashboard items", async () => {
    const saved = await saveQuery(db, query);
    await saveDashboardItem(db, {
      source: { kind: "query", queryId: saved.id },
      size: "full",
      paramValues: {},
      chartOverride: null,
    });
    await saveDashboardItem(db, reportItem("season-overview"));
    await archiveQuery(db, saved.id);
    expect(await listQueries(db)).toEqual([]);
    expect((await getQuery(db, saved.id))?.archivedAt).not.toBeNull();
    expect((await listDashboardItems(db)).map((i) => i.source)).toEqual([
      { kind: "report", reportId: "season-overview" },
    ]);
  });

  it("imports proposals once, accepts and refuses them", async () => {
    const proposal = {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      title: "Samedi matin",
      description: null,
      sql: "SELECT 1",
      params: [],
      chart: null,
      createdAt: "2026-06-20T07:47:00Z",
    };
    await insertProposal(db, proposal);
    await insertProposal(db, { ...proposal, title: "again" });
    const proposed = await listQueries(db, { status: "proposed" });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ origin: "mcp", title: "Samedi matin" });

    await acceptProposal(db, proposal.id);
    expect(await listQueries(db, { status: "proposed" })).toEqual([]);
    expect((await listQueries(db))[0].id).toBe(proposal.id);

    await deleteQuery(db, proposal.id);
    expect(await getQuery(db, proposal.id)).toBeNull();
  });

  it("remembers refused proposals, a bounded number of them", async () => {
    const proposal = {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      title: "Samedi matin",
      description: null,
      sql: "SELECT 1",
      params: [],
      chart: null,
    };
    expect(await insertProposal(db, proposal)).toBe("stored");
    await refuseProposal(db, proposal.id);
    expect(await getQuery(db, proposal.id)).toBeNull();
    expect(await insertProposal(db, proposal)).toBe("refused");
    expect(
      await insertProposal(db, { ...proposal, id: proposal.id.toUpperCase() })
    ).toBe("refused");
    expect(await getQuery(db, proposal.id)).toBeNull();

    for (let i = 0; i < MAX_REFUSED_PROPOSALS + 5; i++) {
      await refuseProposal(db, `id-${i}`);
    }
    const [row] = await db.select<{ value: string }[]>(
      "SELECT value FROM setting WHERE key = $1",
      [REFUSED_PROPOSALS_SETTING]
    );
    const ids = JSON.parse(row.value) as string[];
    expect(ids).toHaveLength(MAX_REFUSED_PROPOSALS);
    expect(ids.at(-1)).toBe(`id-${MAX_REFUSED_PROPOSALS + 4}`);
    // The oldest are forgotten first.
    expect(await insertProposal(db, proposal)).toBe("stored");
  });
});

describe("dashboard items", () => {
  it("adds items at the end and moves them", async () => {
    const a = await saveDashboardItem(db, reportItem("a"));
    const b = await saveDashboardItem(db, reportItem("b"));
    const c = await saveDashboardItem(db, reportItem("c"));
    const order = async () => (await listDashboardItems(db)).map((i) => i.id);
    expect(await order()).toEqual([a, b, c]);

    await moveDashboardItem(db, c, "up");
    expect(await order()).toEqual([a, c, b]);
    await moveDashboardItem(db, a, "up");
    expect(await order()).toEqual([a, c, b]);
    await moveDashboardItem(db, b, "down");
    expect(await order()).toEqual([a, c, b]);
    await moveDashboardItem(db, a, "down");
    expect(await order()).toEqual([c, a, b]);

    await saveDashboardItem(db, { ...reportItem("a"), id: a, size: "full" });
    const items = await listDashboardItems(db);
    expect(items.find((i) => i.id === a)).toMatchObject({
      size: "full",
      position: 1,
    });

    await deleteDashboardItem(db, a);
    expect(await order()).toEqual([c, b]);
  });

  it("replaces a dashboard idempotently", async () => {
    await saveDashboardItem(db, reportItem("old"));
    const items = [
      { ...reportItem("season-overview"), size: "full" as const },
      { ...reportItem("boat-usage-ranking"), paramValues: { season: 2024 } },
    ];
    await replaceDashboard(db, "main", items);
    await replaceDashboard(db, "main", items);
    const stored = await listDashboardItems(db, "main");
    expect(
      stored.map((i) => [i.position, i.source, i.size, i.paramValues])
    ).toEqual([
      [0, { kind: "report", reportId: "season-overview" }, "full", {}],
      [
        1,
        { kind: "report", reportId: "boat-usage-ranking" },
        "half",
        { season: 2024 },
      ],
    ]);
  });

  it("keeps the items readable when an override is broken", async () => {
    const id = await saveDashboardItem(db, reportItem("a"));
    await db.execute(
      'UPDATE analytics_dashboard_item SET chart_override = \'{"type":"radar"}\' WHERE id = $1',
      [id]
    );
    expect((await listDashboardItems(db))[0].chartOverride).toBeNull();
  });

  it("is cleared by deleteAllClubData", async () => {
    const saved = await saveQuery(db, query);
    await saveDashboardItem(db, {
      source: { kind: "query", queryId: saved.id },
      size: "half",
      paramValues: {},
      chartOverride: null,
    });
    await deleteAllClubData(db);
    expect(await listDashboardItems(db)).toEqual([]);
    expect(await getQuery(db, saved.id)).toBeNull();
  });
});
