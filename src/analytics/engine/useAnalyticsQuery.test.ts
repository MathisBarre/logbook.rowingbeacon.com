import { describe, expect, it, vi } from "vitest";
import type { QueryResult, RunQueryRequest } from "../types";
import type { RunQueryOptions } from "./queue";
import { createQueryController } from "./useAnalyticsQuery";

const result: QueryResult = {
  columns: [{ name: "n", declType: null }],
  rows: [[1]],
  truncated: false,
  elapsedMs: 3,
  ignoredColumns: [],
  cached: false,
};

const createRunner = () => {
  const calls: { request: RunQueryRequest; options: RunQueryOptions }[] = [];
  const pending: {
    resolve: (r: QueryResult) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const run = (request: RunQueryRequest, options: RunQueryOptions) =>
    new Promise<QueryResult>((resolve, reject) => {
      calls.push({ request, options });
      pending.push({ resolve, reject });
    });
  return { run, calls, pending };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const input = { sql: "SELECT 1 AS n", params: { season: 2025 } };

describe("createQueryController", () => {
  it("is idle without SQL and while disabled", () => {
    const runner = createRunner();
    const controller = createQueryController({ run: runner.run });
    controller.setInput({ sql: null, params: {} });
    expect(controller.getState().status).toBe("idle");
    controller.setInput({ ...input, enabled: false });
    expect(controller.getState().status).toBe("idle");
    expect(runner.calls).toHaveLength(0);
  });

  it("loads then succeeds, with the request defaults", async () => {
    const runner = createRunner();
    const controller = createQueryController({
      run: runner.run,
      now: () => "2026-06-20T09:47",
    });
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.setInput(input);
    expect(controller.getState().status).toBe("loading");
    expect(runner.calls[0].request).toMatchObject({
      sql: "SELECT 1 AS n",
      params: { season: 2025 },
      maxRows: 5000,
      timeoutMs: 20_000,
      useCache: true,
      privacy: "nominative",
      now: "2026-06-20T09:47",
    });
    runner.pending[0].resolve(result);
    await flush();
    expect(controller.getState()).toEqual({
      status: "success",
      result,
      error: null,
      isSlow: false,
    });
    expect(listener).toHaveBeenCalled();
  });

  it("does not rerun for an equal input", () => {
    const runner = createRunner();
    const controller = createQueryController({ run: runner.run });
    controller.setInput(input);
    controller.setInput({ sql: "SELECT 1 AS n", params: { season: 2025 } });
    expect(runner.calls).toHaveLength(1);
    controller.setInput({ ...input, params: { season: 2024 } });
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0].options.signal?.aborted).toBe(true);
  });

  it("becomes slow after the delay", () => {
    vi.useFakeTimers();
    try {
      const runner = createRunner();
      const controller = createQueryController({
        run: runner.run,
        slowAfterMs: 1500,
      });
      controller.setInput(input);
      vi.advanceTimersByTime(1499);
      expect(controller.getState().isSlow).toBe(false);
      vi.advanceTimersByTime(1);
      expect(controller.getState().isSlow).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports errors as AnalyticsError", async () => {
    const runner = createRunner();
    const controller = createQueryController({ run: runner.run });
    controller.setInput({ ...input, timeoutMs: 10_000 });
    runner.pending[0].reject({ code: "timeout", message: "interrupted" });
    await flush();
    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error).toMatchObject({ code: "timeout", timeoutMs: 10_000 });
  });

  it("cancels and reruns", async () => {
    const runner = createRunner();
    const controller = createQueryController({ run: runner.run });
    controller.setInput(input);
    controller.cancel();
    expect(runner.calls[0].options.signal?.aborted).toBe(true);
    expect(controller.getState()).toMatchObject({
      status: "error",
      error: { code: "cancelled" },
    });
    // A late answer of the cancelled run is ignored.
    runner.pending[0].resolve(result);
    await flush();
    expect(controller.getState().status).toBe("error");

    controller.rerun();
    expect(runner.calls).toHaveLength(2);
    runner.pending[1].resolve(result);
    await flush();
    expect(controller.getState().status).toBe("success");
  });

  it("keeps the result when the same query goes off screen", async () => {
    const runner = createRunner();
    const controller = createQueryController({ run: runner.run });
    controller.setInput(input);
    runner.pending[0].resolve(result);
    await flush();
    controller.setInput({ ...input, enabled: false });
    expect(controller.getState().status).toBe("success");
    controller.setInput(input);
    expect(controller.getState()).toMatchObject({ status: "loading", result });
  });

  it("passes the priority to the queue and stops on dispose", () => {
    const runner = createRunner();
    const controller = createQueryController({ run: runner.run });
    controller.setInput({ ...input, priority: "high", exclusive: true });
    expect(runner.calls[0].options.priority).toBe("high");
    expect(runner.calls[0].options.exclusive).toBe(true);
    controller.dispose();
    expect(runner.calls[0].options.signal?.aborted).toBe(true);
    expect(controller.getState().status).toBe("idle");
  });
});
