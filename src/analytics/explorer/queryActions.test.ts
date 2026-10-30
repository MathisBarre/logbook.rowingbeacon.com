import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../../_common/database/migrations";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";
import {
  archiveQuery,
  getQuery,
  insertProposal,
  listQueries,
  saveDashboardItem,
} from "../repository/analytics.repository";
import { emptyDoc, ExplorerDoc, useExplorerStore } from "./explorer.store";
import {
  acceptProposalFrom,
  acceptQueryProposal,
  archiveSavedQuery,
  countPins,
  duplicateQuery,
  QueryDb,
  refuseQueryProposal,
  renameQuery,
  restoreArchivedQuery,
  saveDoc,
} from "./queryActions";

let client: ReturnType<typeof createTestSqlClient>;
let db: QueryDb;
beforeEach(async () => {
  client = createTestSqlClient();
  const log = console.log;
  console.log = () => undefined;
  await applyMigrations(client);
  console.log = log;
  db = {
    read: (read) => read(client),
    write: async (_label, write) => {
      await write(client);
      return true;
    },
  };
});
afterEach(async () => {
  await client.close();
});

const doc: ExplorerDoc = {
  ...emptyDoc(),
  sql: "SELECT boat_name, COUNT(*) AS n FROM v_outings WHERE season = :season GROUP BY 1",
  params: [
    { name: "season", type: "season", required: true, default: "current" },
  ],
  chart: {
    type: "bar",
    x: "boat_name",
    y: ["n"],
    orientation: "vertical",
    stacked: false,
    sort: "none",
  },
  origin: "ai",
};

describe("saved query actions", () => {
  it("lists archived queries and restores one (review 40)", async () => {
    const saved = await saveDoc(
      doc,
      { title: "Bateaux", description: null, asNew: false },
      db
    );
    if (!saved) throw new Error("not saved");
    expect(await archiveSavedQuery(saved.id, db)).toBe(true);
    expect(await listQueries(client)).toEqual([]);
    expect(
      (await listQueries(client, { archived: true })).map((q) => q.id)
    ).toEqual([saved.id]);
    expect(await restoreArchivedQuery(saved.id, db)).toBe(true);
    expect((await listQueries(client)).map((q) => q.id)).toEqual([saved.id]);
    expect(await listQueries(client, { archived: true })).toEqual([]);
    expect((await getQuery(client, saved.id))?.archivedAt).toBeNull();
  });

  it("saves, saves in place, saves as, renames and duplicates", async () => {
    const first = await saveDoc(
      doc,
      { title: "Bateaux", description: null, asNew: false },
      db
    );
    expect(first).toMatchObject({
      title: "Bateaux",
      origin: "ai",
      status: "saved",
    });
    if (!first) return;

    const inPlace = await saveDoc(
      { ...doc, queryId: first.id, sql: doc.sql + " LIMIT 5" },
      { title: "Bateaux", description: "Top 5", asNew: false },
      db
    );
    expect(inPlace?.id).toBe(first.id);
    expect(inPlace?.sql).toContain("LIMIT 5");

    const copy = await saveDoc(
      { ...doc, queryId: first.id },
      { title: "Bateaux (bis)", description: null, asNew: true },
      db
    );
    expect(copy?.id).not.toBe(first.id);

    const renamed = await renameQuery(
      first,
      { title: "Flotte", description: "x" },
      db
    );
    expect(renamed).toMatchObject({
      id: first.id,
      title: "Flotte",
      description: "x",
      sql: first.sql,
    });

    const dup = await duplicateQuery(first, "(copie)", db);
    expect(dup?.title).toBe("Bateaux (copie)");
    expect((await listQueries(client)).length).toBe(3);
  });

  it("counts pins and archives a pinned query with its items", async () => {
    const query = await saveDoc(
      doc,
      { title: "Bateaux", description: null, asNew: false },
      db
    );
    if (!query) throw new Error("not saved");
    expect(await countPins(query.id, db)).toBe(0);
    await saveDashboardItem(client, {
      source: { kind: "query", queryId: query.id },
      size: "half",
      paramValues: {},
      chartOverride: null,
    });
    expect(await countPins(query.id, db)).toBe(1);
    expect(await archiveSavedQuery(query.id, db)).toBe(true);
    expect(await listQueries(client)).toEqual([]);
    expect(await countPins(query.id, db)).toBe(0);
  });

  it("accepts and refuses proposals", async () => {
    for (const id of ["a", "b"]) {
      await insertProposal(client, {
        id,
        title: id,
        description: null,
        sql: "SELECT 1",
        params: [],
        chart: null,
      });
    }
    await acceptQueryProposal("a", db);
    await refuseQueryProposal("b", db);
    expect((await getQuery(client, "a"))?.status).toBe("saved");
    expect(await getQuery(client, "b")).toBeNull();
  });

  it("accepts the edited SQL of the proposal open in the editor", async () => {
    await insertProposal(client, {
      id: "p",
      title: "Sorties du soir",
      description: "De Claude",
      sql: "SELECT COUNT(*) AS n FROM v_outings WHERE start_hour >= 18",
      params: [],
      chart: null,
    });
    const proposal = await getQuery(client, "p");
    if (!proposal) throw new Error("missing proposal");
    const store = useExplorerStore.getState();
    store.openQuery(proposal);
    store.setSql("SELECT COUNT(*) AS n FROM v_outings WHERE start_hour >= 19");
    const { doc: edited, baseline } = useExplorerStore.getState();

    const saved = await acceptProposalFrom(
      proposal,
      { doc: edited, baseline },
      db
    );
    if (typeof saved === "boolean") throw new Error("expected a saved query");
    expect(saved.status).toBe("saved");
    expect(saved.sql).toContain(">= 19");
    expect(saved.origin).toBe("mcp");
    expect((await getQuery(client, "p"))?.sql).toContain(">= 19");
    useExplorerStore.getState().markSaved(saved);
    expect(useExplorerStore.getState().doc.isProposal).toBe(false);
  });

  it("accepts the stored proposal when the open one is unchanged or another one is open", async () => {
    await insertProposal(client, {
      id: "p",
      title: "Sorties",
      description: null,
      sql: "SELECT 1 AS n",
      params: [],
      chart: null,
    });
    const proposal = await getQuery(client, "p");
    if (!proposal) throw new Error("missing proposal");
    const store = useExplorerStore.getState();
    store.openQuery(proposal);
    const { doc: open, baseline } = useExplorerStore.getState();
    expect(
      await acceptProposalFrom(proposal, { doc: open, baseline }, db)
    ).toBe(true);
    expect((await getQuery(client, "p"))?.status).toBe("saved");
    useExplorerStore.getState().markAccepted("p");
    const after = useExplorerStore.getState();
    expect(after.doc.isProposal).toBe(false);
    expect(after.doc.sql).toBe("SELECT 1 AS n");
    // No unsaved badge once accepted.
    expect(after.baseline?.isProposal).toBe(false);

    // Another doc, edited, is not what "Accepter" saves.
    await insertProposal(client, {
      id: "q",
      title: "Autre",
      description: null,
      sql: "SELECT 2 AS n",
      params: [],
      chart: null,
    });
    const other = await getQuery(client, "q");
    if (!other) throw new Error("missing proposal");
    store.setSql("SELECT 3 AS n");
    const state = useExplorerStore.getState();
    expect(
      await acceptProposalFrom(
        other,
        { doc: state.doc, baseline: state.baseline },
        db
      )
    ).toBe(true);
    expect((await getQuery(client, "q"))?.sql).toBe("SELECT 2 AS n");
  });

  it("saves a query archived elsewhere as a new, visible query", async () => {
    const query = await saveDoc(
      doc,
      { title: "Bateaux", description: null, asNew: true },
      db
    );
    if (!query) throw new Error("not saved");
    await archiveQuery(client, query.id);
    expect(await listQueries(client)).toEqual([]);
    const again = await saveDoc(
      { ...doc, queryId: query.id },
      { title: "Bateaux", description: null, asNew: false },
      db
    );
    expect(again?.archivedAt).toBeNull();
    expect(again?.id).not.toBe(query.id);
    expect((await listQueries(client)).map((q) => q.id)).toEqual([again?.id]);
  });

  it("returns null when the write failed", async () => {
    const failing: QueryDb = { ...db, write: () => Promise.resolve(false) };
    expect(
      await saveDoc(
        doc,
        { title: "x", description: null, asNew: false },
        failing
      )
    ).toBeNull();
  });
});
