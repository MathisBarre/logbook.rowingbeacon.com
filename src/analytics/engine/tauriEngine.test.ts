import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginDemo } from "../../demo/demoMode";
import { ANALYTICS_COMMANDS } from "./ipc";
import { tauriEngine } from "./tauriEngine";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));

const request = {
  requestId: "r1",
  sql: "SELECT 1",
  params: {},
  maxRows: 10,
  timeoutMs: 1000,
  now: "2026-10-29T14:05:00",
  privacy: "nominative",
} as never;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({});
  // The tests run in node: a minimal localStorage for the demo flag.
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tauriEngine", () => {
  it("tells Rust to read main.db outside the demo", async () => {
    await tauriEngine.run(request);
    await tauriEngine.objects();
    expect(invoke).toHaveBeenCalledWith(ANALYTICS_COMMANDS.runQuery, {
      request,
      database: "main.db",
    });
    expect(invoke).toHaveBeenCalledWith(ANALYTICS_COMMANDS.listObjects, {
      database: "main.db",
    });
  });

  it("tells Rust to read demo.db in demo mode, never main.db", async () => {
    expect(beginDemo(false)).toBe(true);
    await tauriEngine.run(request);
    await tauriEngine.objects();
    expect(invoke).toHaveBeenCalledWith(ANALYTICS_COMMANDS.runQuery, {
      request,
      database: "demo.db",
    });
    expect(invoke).toHaveBeenCalledWith(ANALYTICS_COMMANDS.listObjects, {
      database: "demo.db",
    });
  });
});
