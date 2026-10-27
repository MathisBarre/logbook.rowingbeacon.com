import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueWrite,
  flushWrites,
  resetWriteQueueForTests,
  setReloadAfterFailedWrite,
  setWriteClient,
} from "./writeQueue";
import { SqlClient } from "./sqlClient";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const db = {} as SqlClient;

describe("write queue", () => {
  beforeEach(() => {
    resetWriteQueueForTests();
    setWriteClient(db);
  });

  it("reports a failed write and reloads the stores once the queue is empty", async () => {
    const events: string[] = [];
    setReloadAfterFailedWrite(() => {
      events.push("reload");
      return Promise.resolve();
    });

    const failed = enqueueWrite("a", () => Promise.reject(new Error("disk")));
    const after = enqueueWrite("b", () => {
      events.push("b");
      return Promise.resolve();
    });

    expect(await failed).toBe(false);
    expect(await after).toBe(true);
    await flushWrites();
    expect(events).toEqual(["b", "reload"]);
  });

  it("reloads after the writes queued once the failure happened", async () => {
    const events: string[] = [];
    setReloadAfterFailedWrite(() => {
      events.push("reload");
      return Promise.resolve();
    });

    const failed = enqueueWrite("a", () => Promise.reject(new Error("disk")));
    expect(await failed).toBe(false);
    // The reload is queued now; a change made right after must not be
    // hidden by it.
    const later = enqueueWrite("c", () => {
      events.push("c");
      return Promise.resolve();
    });

    expect(await later).toBe(true);
    await flushWrites();
    await flushWrites();
    expect(events).toEqual(["c", "reload"]);
  });
});
