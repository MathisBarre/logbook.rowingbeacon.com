import { describe, expect, it, vi } from "vitest";
import { ANALYTICS_COMMANDS } from "../engine/ipc";
import { clearProposalsInbox } from "./proposalsInbox";

type Invoke = NonNullable<Parameters<typeof clearProposalsInbox>[0]>;

const fakeInbox = (ids: string[], failing: string[] = []) => {
  const files = new Set(ids);
  const invoke: Invoke = <T>(
    command: string,
    args?: Record<string, unknown>
  ): Promise<T> => {
    if (command === ANALYTICS_COMMANDS.inboxList) {
      return Promise.resolve(
        [...files].map((id) => ({ id, title: "t", error: null })) as T
      );
    }
    const id = String(args?.id);
    if (failing.includes(id)) return Promise.reject(new Error("EACCES"));
    files.delete(id);
    return Promise.resolve(undefined as T);
  };
  return { files, invoke };
};

describe("clearProposalsInbox", () => {
  it("deletes every waiting proposal", async () => {
    const { files, invoke } = fakeInbox(["a", "b", "c"]);
    expect(await clearProposalsInbox(invoke, true)).toBe(true);
    expect(files.size).toBe(0);
  });

  it("goes on after a file it cannot delete, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { files, invoke } = fakeInbox(["a", "b", "c"], ["b"]);
    expect(await clearProposalsInbox(invoke, true)).toBe(false);
    expect([...files]).toEqual(["b"]);
  });

  it("reports an inbox it cannot read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: Invoke = () => Promise.reject(new Error("EIO"));
    expect(await clearProposalsInbox(failing, true)).toBe(false);
  });

  it("does nothing outside the desktop app", async () => {
    let calls = 0;
    const invoke: Invoke = () => {
      calls += 1;
      return Promise.reject(new Error("no inbox"));
    };
    expect(await clearProposalsInbox(invoke, false)).toBe(true);
    expect(calls).toBe(0);
  });
});
