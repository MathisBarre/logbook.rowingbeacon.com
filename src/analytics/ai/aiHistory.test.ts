import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_HISTORY_MAX,
  AI_HISTORY_STORAGE_KEY,
  AiHistoryEntry,
  readAiHistory,
  rememberAiAnswer,
  withAiHistoryEntry,
} from "./aiHistory";

const entry = (question: string, at = "2026-05-12T10:00:00.000Z") =>
  ({
    question,
    at,
    provider: "anthropic",
    model: "claude-opus-5-5",
    draft: {
      title: question,
      sql: "SELECT 1 AS n",
      params: [],
      chart: { type: "table" },
      explanation: "",
      assumptions: [],
    },
  }) satisfies AiHistoryEntry;

const memoryStorage = () => {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
  });
  return data;
};

afterEach(() => vi.unstubAllGlobals());

describe("AI history", () => {
  it("keeps the newest first, one per question, at most 10", () => {
    let list: AiHistoryEntry[] = [];
    for (let i = 0; i < 12; i++)
      list = withAiHistoryEntry(list, entry(`q${i}`));
    expect(list).toHaveLength(AI_HISTORY_MAX);
    expect(list[0].question).toBe("q11");
    list = withAiHistoryEntry(list, entry("  Q5 "));
    expect(list[0].question).toBe("  Q5 ");
    expect(
      list.filter((e) => e.question.trim().toLowerCase() === "q5")
    ).toHaveLength(1);
  });

  it("stores and reads back, skipping what it cannot read", () => {
    const data = memoryStorage();
    rememberAiAnswer(entry("Bateaux du week-end"));
    expect(readAiHistory()).toEqual([entry("Bateaux du week-end")]);
    data.set(
      AI_HISTORY_STORAGE_KEY,
      JSON.stringify([{ question: "x" }, entry("ok"), 42])
    );
    expect(readAiHistory().map((e) => e.question)).toEqual(["ok"]);
    data.set(AI_HISTORY_STORAGE_KEY, "{not json");
    expect(readAiHistory()).toEqual([]);
  });

  it("works without storage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readAiHistory()).toEqual([]);
    expect(rememberAiAnswer(entry("x"))).toHaveLength(1);
  });
});
