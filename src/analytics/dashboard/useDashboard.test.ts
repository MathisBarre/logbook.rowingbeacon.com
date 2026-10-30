import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../_common/database/migrations";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";
import {
  archiveQuery,
  listDashboardItems,
  saveDashboardItem,
  saveQuery,
} from "../repository/analytics.repository";
import { getReport } from "../reports/catalog";
import type { ParamDef } from "../types";
import { savePin } from "./PinDialog";
import {
  createDashboardController,
  DashboardRepository,
  resolveCardParams,
} from "./useDashboard";

let db: ReturnType<typeof createTestSqlClient>;
let repository: DashboardRepository;

beforeEach(async () => {
  db = createTestSqlClient();
  const log = console.log;
  console.log = () => undefined;
  await applyMigrations(db);
  console.log = log;
  repository = {
    read: (read) => read(db),
    write: async (_label, write) => {
      await write(db);
      return true;
    },
  };
});
afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

const report = (reportId: string) => ({
  source: { kind: "report" as const, reportId },
  size: "half" as const,
  paramValues: {},
  chartOverride: null,
});

const reportIds = (controller: ReturnType<typeof createDashboardController>) =>
  controller
    .getState()
    .entries.map((entry) =>
      entry.item.source.kind === "report" ? entry.item.source.reportId : "q"
    );

describe("dashboard controller", () => {
  it("starts loading, then lists the items in order", async () => {
    await saveDashboardItem(db, report("season-overview"));
    await saveDashboardItem(db, report("boat-usage-ranking"));
    const controller = createDashboardController(repository);
    expect(controller.getState().status).toBe("loading");
    await controller.load();
    expect(controller.getState().status).toBe("ready");
    expect(reportIds(controller)).toEqual([
      "season-overview",
      "boat-usage-ranking",
    ]);
  });

  it("pins at the end", async () => {
    const controller = createDashboardController(repository);
    await controller.pin(report("season-overview"));
    await controller.pin({ ...report("boat-usage-ranking"), size: "full" });
    expect(reportIds(controller)).toEqual([
      "season-overview",
      "boat-usage-ranking",
    ]);
    expect(controller.getState().entries[1].item.size).toBe("full");
  });

  it("moves up and down, and does nothing at the ends", async () => {
    const controller = createDashboardController(repository);
    for (const id of ["a", "b", "c"]) await controller.pin(report(id));
    const [a, , c] = controller.getState().entries.map((e) => e.item.id);

    await controller.move(a, "up");
    expect(reportIds(controller)).toEqual(["a", "b", "c"]);
    await controller.move(c, "down");
    expect(reportIds(controller)).toEqual(["a", "b", "c"]);

    await controller.move(a, "down");
    expect(reportIds(controller)).toEqual(["b", "a", "c"]);
    await controller.move(c, "up");
    expect(reportIds(controller)).toEqual(["b", "c", "a"]);

    // The order is what SQLite holds, not only what the screen shows.
    const stored = await listDashboardItems(db);
    expect(
      stored.map((i) => (i.source.kind === "report" ? i.source.reportId : ""))
    ).toEqual(["b", "c", "a"]);
  });

  it("shows a move at once, before the write is done", async () => {
    let release: () => void = () => undefined;
    const slow: DashboardRepository = {
      read: repository.read,
      write: async (label, write) => {
        await new Promise<void>((resolve) => (release = resolve));
        return repository.write(label, write);
      },
    };
    await saveDashboardItem(db, report("a"));
    await saveDashboardItem(db, report("b"));
    const controller = createDashboardController(slow);
    await controller.load();
    const [a] = controller.getState().entries.map((e) => e.item.id);
    const moving = controller.move(a, "down");
    expect(reportIds(controller)).toEqual(["b", "a"]);
    release();
    await moving;
    expect(reportIds(controller)).toEqual(["b", "a"]);
  });

  it("resizes and keeps the position and values", async () => {
    const controller = createDashboardController(repository);
    await controller.pin(report("a"));
    await controller.pin({ ...report("b"), paramValues: { metric: "km" } });
    const b = controller.getState().entries[1].item;
    await controller.resize(b.id, "third");
    const after = controller.getState().entries[1].item;
    expect(after).toMatchObject({
      id: b.id,
      size: "third",
      position: b.position,
      paramValues: { metric: "km" },
    });
  });

  it("removes an item", async () => {
    const controller = createDashboardController(repository);
    await controller.pin(report("a"));
    await controller.pin(report("b"));
    await controller.remove(controller.getState().entries[0].item.id);
    expect(reportIds(controller)).toEqual(["b"]);
    expect(await listDashboardItems(db)).toHaveLength(1);
  });

  it("puts a removed item back at its place, with its size and values", async () => {
    const controller = createDashboardController(repository);
    await controller.pin(report("a"));
    await controller.pin({
      ...report("b"),
      size: "full",
      paramValues: { metric: "km" },
    });
    await controller.pin(report("c"));
    const removed = controller.getState().entries[1];
    await controller.remove(removed.item.id);
    expect(reportIds(controller)).toEqual(["a", "c"]);

    const restoring = controller.restore(removed);
    // Shown at once, before the write.
    expect(reportIds(controller)).toEqual(["a", "b", "c"]);
    expect(await restoring).toBe(true);
    expect(reportIds(controller)).toEqual(["a", "b", "c"]);
    const back = controller.getState().entries[1].item;
    expect(back.id).toBe(removed.item.id);
    expect(back.size).toBe("full");
    expect(back.paramValues).toEqual({ metric: "km" });
    // A second "Annuler" does nothing.
    await controller.restore(removed);
    expect(await listDashboardItems(db)).toHaveLength(3);
  });

  it("loads the saved query of a query item; archived ones disappear", async () => {
    const query = await saveQuery(db, {
      title: "Sorties du soir",
      sql: "SELECT COUNT(*) AS outings FROM v_outings WHERE start_hour >= 18",
      params: [],
      chart: { type: "table" },
    });
    const controller = createDashboardController(repository);
    await controller.pin(report("season-overview"));
    await controller.pin({
      ...report("x"),
      source: { kind: "query", queryId: query.id },
    });
    expect(controller.getState().entries[1].query?.title).toBe(
      "Sorties du soir"
    );
    await archiveQuery(db, query.id);
    await controller.load();
    expect(reportIds(controller)).toEqual(["season-overview"]);
  });

  it("keeps the last list and reports an error when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = createDashboardController({
      ...repository,
      read: () => Promise.reject(new Error("locked")),
    });
    await controller.load();
    expect(controller.getState()).toEqual({ status: "error", entries: [] });
  });
});

describe("savePin", () => {
  it("saves a draft query first, then pins it", async () => {
    await savePin(db, {
      source: {
        kind: "query",
        draft: {
          title: "brouillon",
          sql: "SELECT boat_name FROM v_outings",
          params: [],
          chart: null,
        },
      },
      paramValues: {},
      chartOverride: null,
      size: "full",
      season: null,
      seasonParams: [],
      title: "  Bateaux du matin  ",
    });
    const [item] = await listDashboardItems(db);
    expect(item.source.kind).toBe("query");
    const rows = await db.select<{ title: string; origin: string }[]>(
      "SELECT title, origin FROM analytics_query"
    );
    expect(rows).toEqual([{ title: "Bateaux du matin", origin: "user" }]);
  });

  it("keeps an AI draft's origin and description, and reports the query", async () => {
    let reported: string | null = null;
    const { itemId, savedQuery } = await savePin(db, {
      source: {
        kind: "query",
        draft: {
          title: "Sorties du soir",
          sql: "SELECT COUNT(*) AS outings FROM v_outings",
          params: [],
          chart: { type: "table" },
          origin: "ai",
          description: "Compte les sorties après 18 h.",
          basedOnReportId: "season-overview",
        },
      },
      paramValues: {},
      chartOverride: null,
      size: "half",
      season: null,
      seasonParams: [],
      onQuerySaved: (query) => {
        reported = query.id;
      },
    });
    expect(savedQuery).toMatchObject({
      title: "Sorties du soir",
      origin: "ai",
      description: "Compte les sorties après 18 h.",
      basedOnReportId: "season-overview",
    });
    expect(reported).toBe(savedQuery?.id);
    const [item] = await listDashboardItems(db);
    expect(item).toMatchObject({
      id: itemId,
      source: { kind: "query", queryId: savedQuery?.id },
    });
  });

  it("pins a saved query without saving it again", async () => {
    const query = await saveQuery(db, {
      title: "Déjà là",
      sql: "SELECT 1 AS n",
      params: [],
      chart: null,
    });
    const { savedQuery } = await savePin(db, {
      source: { kind: "query", queryId: query.id },
      paramValues: {},
      chartOverride: null,
      size: "third",
      season: null,
      seasonParams: [],
    });
    expect(savedQuery).toBeNull();
    const count = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM analytics_query"
    );
    expect(Number(count[0].n)).toBe(1);
  });

  it("refuses a draft without a title", async () => {
    await expect(
      savePin(db, {
        source: {
          kind: "query",
          draft: { title: "", sql: "SELECT 1", params: [], chart: null },
        },
        paramValues: {},
        chartOverride: null,
        size: "half",
        season: null,
        seasonParams: [],
        title: " ",
      })
    ).rejects.toThrow();
    expect(await listDashboardItems(db)).toHaveLength(0);
  });

  it("follows the hub season or fixes the shown one", async () => {
    const base = {
      source: { kind: "report" as const, reportId: "boat-usage-ranking" },
      paramValues: { season: 2024, boat_class: "4x" },
      chartOverride: { type: "table" as const },
      size: "half" as const,
      seasonParams: ["season"],
    };
    await savePin(db, { ...base, season: null });
    await savePin(db, { ...base, season: 2023 });
    const [follow, fixed] = await listDashboardItems(db);
    expect(follow.paramValues).toEqual({ boat_class: "4x" });
    expect(fixed.paramValues).toEqual({ season: 2023, boat_class: "4x" });
    expect(fixed.chartOverride).toEqual({ type: "table" });
  });
});

describe("resolveCardParams", () => {
  const ctx = { now: "2026-06-20T09:47", seasonStartMonth: 8 };
  const defs: ParamDef[] = [
    { name: "season", type: "season", required: true, default: "current" },
    {
      name: "metric",
      type: "choice",
      required: false,
      default: "outings",
      options: [{ value: "outings" }, { value: "km" }],
    },
  ];

  it("follows the hub season unless the item fixed one", () => {
    expect(resolveCardParams(defs, {}, 2023, ctx)).toEqual({
      values: { season: 2023, metric: "outings" },
      invalid: false,
    });
    expect(resolveCardParams(defs, { season: 2021 }, 2023, ctx).values).toEqual(
      { season: 2021, metric: "outings" }
    );
  });

  it("falls back to the defaults for values that no longer fit", () => {
    expect(
      resolveCardParams(defs, { metric: "hours", season: "abc" }, 2023, ctx)
    ).toEqual({ values: { season: 2025, metric: "outings" }, invalid: true });
  });

  it("ignores values of parameters the report no longer has", () => {
    expect(resolveCardParams(defs, { gone: 3 }, 2024, ctx)).toEqual({
      values: { season: 2024, metric: "outings" },
      invalid: false,
    });
  });

  it("works with the definitions of a real report", () => {
    const ranking = getReport("boat-usage-ranking");
    expect(ranking).toBeDefined();
    const resolved = resolveCardParams(ranking?.params ?? [], {}, 2025, ctx);
    expect(resolved.values.season).toBe(2025);
    expect(resolved.invalid).toBe(false);
  });
});
