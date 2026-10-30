import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "../../_common/database/migrations";
import { createTestSqlClient } from "../../_common/database/testing/nodeSqlClient";
import type { InboxProposal } from "../engine/ipc";
import { beginDemo } from "../../demo/demoMode";
import {
  acceptProposal,
  deleteQuery,
  listQueries,
  refuseProposal,
} from "../repository/analytics.repository";
import {
  forgetInboxFile,
  InvokeFn,
  sameInvalidList,
  syncInbox,
  validateProposal,
  WriteFn,
} from "./useProposalsInbox";

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

const VALID: InboxProposal = {
  id: "0b9f3c2e-8a51-4d3c-9a7e-1f2b3c4d5e6f",
  createdAt: "2026-06-20T07:40:00Z",
  client: "claude-ai",
  title: "Sorties du samedi",
  description: "Sorties du samedi matin par bateau.",
  sql: "SELECT boat_name, COUNT(*) AS outings FROM v_outings WHERE start_weekday = 6 AND season = :season GROUP BY boat_name",
  params: [
    { name: "season", type: "season", required: true, default: "current" },
  ],
  chart: { type: "bar", x: "boat_name", y: ["outings"] },
  error: null,
};
const BROKEN: InboxProposal = {
  id: "11111111-2222-4333-8444-555555555555",
  createdAt: null,
  client: null,
  title: null,
  description: null,
  sql: null,
  params: null,
  chart: null,
  error: "expected value at line 1 column 1",
};

/** A fake inbox folder behind `invoke`. */
const fakeInbox = (
  files: InboxProposal[],
  options: { failRemove?: boolean } = {}
) => {
  const folder = new Map(files.map((file) => [file.id, file]));
  const calls: string[] = [];
  const invoke: InvokeFn = <T>(
    command: string,
    args?: Record<string, unknown>
  ) => {
    calls.push(command);
    if (command === "analytics_inbox_list") {
      return Promise.resolve([...folder.values()] as T);
    }
    if (command === "analytics_inbox_remove") {
      if (options.failRemove) return Promise.reject(new Error("locked"));
      folder.delete(String(args?.id));
      return Promise.resolve(undefined as T);
    }
    return Promise.reject(new Error(`unexpected ${command}`));
  };
  return { folder, calls, invoke };
};

const write: WriteFn = async (_label, fn) => {
  await fn(db);
  return true;
};

describe("syncInbox", () => {
  it("imports valid files once, removes them, and lists invalid ones", async () => {
    const inbox = fakeInbox([VALID, BROKEN]);
    const first = await syncInbox({ invoke: inbox.invoke, write });
    expect(first.imported).toEqual([VALID.id]);
    expect(first.proposals).toEqual([
      { id: VALID.id, title: "Sorties du samedi", client: VALID.client },
    ]);
    expect(first.invalid).toEqual([
      expect.objectContaining({
        id: BROKEN.id,
        reason: "unreadable",
        detail: BROKEN.error,
      }),
    ]);
    expect([...inbox.folder.keys()]).toEqual([BROKEN.id]);

    const proposed = await listQueries(db, { status: "proposed" });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      id: VALID.id,
      title: "Sorties du samedi",
      origin: "mcp",
      status: "proposed",
      chart: { type: "bar", x: "boat_name" },
    });

    const second = await syncInbox({ invoke: inbox.invoke, write });
    expect(second.imported).toEqual([]);
    expect(await listQueries(db, { status: "proposed" })).toHaveLength(1);
  });

  it("leaves the real club's inbox alone in demo mode (ADR 0009)", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
      },
    });
    try {
      expect(beginDemo(true)).toBe(true);
      const inbox = fakeInbox([VALID, BROKEN]);
      const result = await syncInbox({ invoke: inbox.invoke, write });
      expect(result).toEqual({ imported: [], proposals: [], invalid: [] });
      expect(inbox.calls).toEqual([]);
      expect(inbox.folder.size).toBe(2);
      expect(await listQueries(db, { status: "proposed" })).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is idempotent when the file could not be removed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inbox = fakeInbox([VALID], { failRemove: true });
    await syncInbox({ invoke: inbox.invoke, write });
    await syncInbox({ invoke: inbox.invoke, write });
    expect(inbox.folder.size).toBe(1);
    expect(await listQueries(db, { status: "proposed" })).toHaveLength(1);
  });

  it("does not bring back a refused proposal whose file stayed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let failRemove = true;
    const folder = new Map([[VALID.id, VALID]]);
    const invoke: InvokeFn = <T>(
      command: string,
      args?: Record<string, unknown>
    ) => {
      if (command === "analytics_inbox_list") {
        return Promise.resolve([...folder.values()] as T);
      }
      if (failRemove) return Promise.reject(new Error("locked"));
      folder.delete(String(args?.id));
      return Promise.resolve(undefined as T);
    };
    await syncInbox({ invoke, write });
    expect(folder.size).toBe(1);
    // "Refuser" (the Explorer): the file first, then the row.
    failRemove = false;
    expect(await forgetInboxFile(invoke, VALID.id)).toBe(true);
    await deleteQuery(db, VALID.id);
    await syncInbox({ invoke, write });
    expect(await listQueries(db, { status: "proposed" })).toEqual([]);
  });

  it("never imports a refused proposal again, even when its file stays (review C, 4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inbox = fakeInbox([VALID], { failRemove: true });
    expect((await syncInbox({ invoke: inbox.invoke, write })).imported).toEqual(
      [VALID.id]
    );
    // "Refuser": the file still cannot be removed.
    expect(await forgetInboxFile(inbox.invoke, VALID.id)).toBe(false);
    await refuseProposal(db, VALID.id);
    const again = await syncInbox({ invoke: inbox.invoke, write });
    expect(again.imported).toEqual([]);
    expect(await listQueries(db, { status: "proposed" })).toEqual([]);
    // Its removal is tried again at each poll.
    expect(
      inbox.calls.filter((call) => call === "analytics_inbox_remove")
    ).toHaveLength(3);
  });

  it("skips a proposal refused while a poll was reading it", async () => {
    const inbox = fakeInbox([VALID]);
    const refusedMeanwhile: WriteFn = async (label, fn) => {
      await refuseProposal(db, VALID.id);
      return write(label, fn);
    };
    const result = await syncInbox({
      invoke: inbox.invoke,
      write: refusedMeanwhile,
    });
    expect(result.imported).toEqual([]);
    expect(await listQueries(db, { status: "proposed" })).toEqual([]);
    expect(inbox.folder.size).toBe(0);
  });

  it("never throws when a refused proposal's file cannot be removed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inbox = fakeInbox([VALID], { failRemove: true });
    expect(await forgetInboxFile(inbox.invoke, VALID.id)).toBe(false);
  });

  it("compares unreadable lists so a poll with no change keeps the same array", () => {
    const item = {
      id: BROKEN.id,
      title: null,
      client: null,
      createdAt: null,
      reason: "unreadable" as const,
      detail: "x",
    };
    expect(sameInvalidList([], [])).toBe(true);
    expect(sameInvalidList([item], [{ ...item }])).toBe(true);
    expect(sameInvalidList([item], [{ ...item, detail: "y" }])).toBe(false);
    expect(sameInvalidList([item], [{ ...item, reason: "sql_missing" }])).toBe(
      false
    );
    expect(sameInvalidList([item], [])).toBe(false);
  });

  it("keeps the file when the write failed", async () => {
    const inbox = fakeInbox([VALID]);
    const failing: WriteFn = () => Promise.resolve(false);
    const result = await syncInbox({ invoke: inbox.invoke, write: failing });
    expect(result.imported).toEqual([]);
    expect(inbox.folder.size).toBe(1);
    expect(inbox.calls).not.toContain("analytics_inbox_remove");
  });

  it("accepts and refuses imported proposals", async () => {
    const other = {
      ...VALID,
      id: "22222222-3333-4444-8555-666666666666",
      title: "Autre",
    };
    const inbox = fakeInbox([VALID, other]);
    await syncInbox({ invoke: inbox.invoke, write });
    await acceptProposal(db, VALID.id);
    await deleteQuery(db, other.id);
    expect((await listQueries(db)).map((q) => q.id)).toEqual([VALID.id]);
    expect(await listQueries(db, { status: "proposed" })).toEqual([]);
  });
});

describe("validateProposal", () => {
  it("rejects missing SQL or title, bad params and file names, with a reason code", () => {
    expect(validateProposal({ ...VALID, sql: "  " })).toMatchObject({
      ok: false,
      reason: "sql_missing",
    });
    expect(validateProposal({ ...VALID, title: null })).toMatchObject({
      ok: false,
      reason: "title_missing",
    });
    expect(validateProposal({ ...VALID, id: "../x" })).toMatchObject({
      ok: false,
      reason: "bad_file_name",
    });
    expect(
      validateProposal({ ...VALID, sql: "x".repeat(100_001) })
    ).toMatchObject({ ok: false, reason: "sql_too_long" });
    const badParams = validateProposal({
      ...VALID,
      params: [{ name: "Season!" }],
    });
    expect(badParams.ok).toBe(false);
    if (!badParams.ok) {
      expect(badParams.reason).toBe("bad_params");
      expect(badParams.detail).toContain("0.name");
    }
  });

  it("keeps a proposal with an unreadable chart, as a table", () => {
    const checked = validateProposal({
      ...VALID,
      chart: { type: "radar" },
      params: undefined,
    });
    expect(checked).toMatchObject({
      ok: true,
      input: { chart: null, params: [] },
    });
  });
});
