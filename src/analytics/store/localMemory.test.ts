import { afterEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "../explorer/explorer.store";
import { useAnalyticsHubStore } from "./analyticsHub.store";
import { beginDemo } from "../../demo/demoMode";
import { readAiHistory, rememberAiAnswer } from "../ai/aiHistory";
import {
  analyticsStorageKey,
  clearAnalyticsLocalMemory,
  clearDemoAnalyticsLocalMemory,
} from "./localMemory";

afterEach(() => vi.unstubAllGlobals());

/** A Map behind the Storage methods the module uses. */
const fakeStorage = (entries: Record<string, string>) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    storage: {
      get length() {
        return map.size;
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
  };
};

describe("clearAnalyticsLocalMemory (review C, 5)", () => {
  it("removes every rb.analytics key and resets the loaded stores", () => {
    const { map, storage } = fakeStorage({
      "rb.analytics.explorer.doc": '{"doc":{"sql":"SELECT 1"}}',
      "rb.analytics.explorer.history": '[{"sql":"SELECT 1","at":"x"}]',
      "rb.analytics.tab": "reports",
      i18nextLng: "fr-FR",
    });
    vi.stubGlobal("window", { localStorage: storage });
    useExplorerStore.getState().setSql("SELECT 'Anouk' AS name");
    useAnalyticsHubStore.getState().openInExplorer({
      title: "Anouk",
      sql: "SELECT 1",
      params: [],
      basedOnReportId: null,
    });

    clearAnalyticsLocalMemory();

    expect([...map.keys()]).toEqual(["i18nextLng"]);
    const explorer = useExplorerStore.getState();
    expect(explorer.doc.sql).toBe("");
    expect(explorer.history).toEqual([]);
    expect(explorer.baseline).toBeNull();
    const hub = useAnalyticsHubStore.getState();
    expect(hub.tab).toBe("dashboard");
    expect(hub.pendingDraft).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => clearAnalyticsLocalMemory()).not.toThrow();
  });
});

describe("the demo's own analytics memory (ADR 0009)", () => {
  const entry = (question: string) => ({
    question,
    draft: {
      title: question,
      sql: "SELECT 1",
      params: [],
      chart: { type: "table" as const },
      explanation: "",
      assumptions: [],
    },
    at: "2026-10-29T10:00:00Z",
    provider: null,
    model: null,
  });

  it("never shows the real club's keys in the demo, nor the demo's in the club", () => {
    const { map, storage } = fakeStorage({});
    vi.stubGlobal("window", { localStorage: storage });
    expect(analyticsStorageKey("rb.analytics.tab")).toBe("rb.analytics.tab");
    rememberAiAnswer(entry("Sorties d'Anouk Martin ?"));

    expect(beginDemo(true)).toBe(true);
    expect(analyticsStorageKey("rb.analytics.tab")).toBe(
      "rb.analytics.demo.tab"
    );
    expect(readAiHistory()).toEqual([]);
    rememberAiAnswer(entry("Sorties du club fictif ?"));
    expect(readAiHistory().map((e) => e.question)).toEqual([
      "Sorties du club fictif ?",
    ]);

    // Demo reset or left: only the demo's memory goes.
    clearDemoAnalyticsLocalMemory();
    expect(readAiHistory()).toEqual([]);
    expect(
      [...map.keys()].filter((k) => k.startsWith("rb.analytics."))
    ).toEqual(["rb.analytics.ai.history"]);
    expect(map.get("rb.analytics.ai.history")).toContain("Anouk Martin");
  });
});
