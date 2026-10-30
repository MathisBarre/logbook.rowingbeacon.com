import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryResult, RunQueryRequest } from "../types";
import { AnalyticsEngine, setEngineForTests } from "./engine";
import { AnalyticsError } from "./errors";
import { createRequest, resetQueueForTests, runQuery } from "./queue";

const result = (sql: string): QueryResult => ({
  columns: [{ name: "sql", declType: null }],
  rows: [[sql]],
  truncated: false,
  elapsedMs: 1,
  ignoredColumns: [],
  cached: false,
});

/** An engine whose runs finish only when the test says so. */
const createFakeEngine = () => {
  const pending: {
    request: RunQueryRequest;
    resolve: () => void;
    reject: (error: unknown) => void;
  }[] = [];
  const started: string[] = [];
  const cancelled: string[] = [];
  const engine: AnalyticsEngine = {
    run: (request) =>
      new Promise((resolve, reject) => {
        started.push(request.sql);
        pending.push({
          request,
          resolve: () => resolve(result(request.sql)),
          reject,
        });
      }),
    cancel: (requestId) => {
      cancelled.push(requestId);
      const index = pending.findIndex((p) => p.request.requestId === requestId);
      if (index !== -1) {
        pending.splice(index, 1)[0].reject({
          code: "cancelled",
          message: "interrupted",
        });
      }
      return Promise.resolve();
    },
    objects: () => Promise.resolve({ views: [], tables: [], missingViews: [] }),
  };
  /** Finishes the oldest unfinished run. */
  const finishNext = async () => {
    const job = pending.shift();
    job?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { engine, started, cancelled, finishNext };
};

const request = (sql: string) =>
  createRequest({ sql, now: "2026-06-20T09:47" });

let fake: ReturnType<typeof createFakeEngine>;
beforeEach(() => {
  resetQueueForTests();
  fake = createFakeEngine();
  setEngineForTests(fake.engine);
});
afterEach(() => {
  setEngineForTests(null);
});

describe("runQuery", () => {
  it("runs one query at a time, in order", async () => {
    const a = runQuery(request("a"));
    const b = runQuery(request("b"));
    expect(fake.started).toEqual(["a"]);
    await fake.finishNext();
    expect(fake.started).toEqual(["a", "b"]);
    await fake.finishNext();
    expect((await a).rows).toEqual([["a"]]);
    expect((await b).rows).toEqual([["b"]]);
  });

  it("lets high priority jobs jump ahead of queued ones", async () => {
    void runQuery(request("running"));
    void runQuery(request("card 1"));
    void runQuery(request("card 2"));
    void runQuery(request("report"), { priority: "high" });
    await fake.finishNext();
    expect(fake.started).toEqual(["running", "report"]);
    await fake.finishNext();
    await fake.finishNext();
    expect(fake.started).toEqual(["running", "report", "card 1", "card 2"]);
  });

  it("shares one run between identical requests", async () => {
    const first = runQuery(request("same"));
    const second = runQuery(request("same"));
    expect(fake.started).toEqual(["same"]);
    await fake.finishNext();
    expect(await first).toBe(await second);
  });

  it("removes a queued job when its signal aborts", async () => {
    void runQuery(request("running"));
    const controller = new AbortController();
    const queued = runQuery(request("queued"), { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: "cancelled" });
    await fake.finishNext();
    expect(fake.started).toEqual(["running"]);
  });

  it("cancels a running job when its signal aborts", async () => {
    const controller = new AbortController();
    const running = runQuery(request("long"), { signal: controller.signal });
    const next = runQuery(request("next"));
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(AnalyticsError);
    expect(fake.cancelled).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.started).toEqual(["long", "next"]);
    await fake.finishNext();
    await expect(next).resolves.toMatchObject({ rows: [["next"]] });
  });

  it("keeps a shared run alive while another caller waits", async () => {
    const controller = new AbortController();
    const leaving = runQuery(request("shared"), { signal: controller.signal });
    const staying = runQuery(request("shared"));
    controller.abort();
    await expect(leaving).rejects.toMatchObject({ code: "cancelled" });
    expect(fake.cancelled).toEqual([]);
    await fake.finishNext();
    await expect(staying).resolves.toMatchObject({ rows: [["shared"]] });
  });

  it("rejects at once with an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runQuery(request("x"), { signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(fake.started).toEqual([]);
  });

  it("turns engine failures into AnalyticsError", async () => {
    setEngineForTests({
      ...fake.engine,
      run: () =>
        Promise.reject(
          Object.assign(new Error("no"), { code: "denied", object: "setting" })
        ),
    });
    await expect(
      runQuery(request("SELECT * FROM setting"))
    ).rejects.toMatchObject({
      code: "denied",
      object: "setting",
      sql: "SELECT * FROM setting",
    });
  });
});
