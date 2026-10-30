import { beforeEach, describe, expect, it } from "vitest";
import type { SavedQuery } from "../types";
import {
  detectParams,
  hasUnsavedChanges,
  HISTORY_MAX,
  isUntouchedAiDraft,
  parseStoredDoc,
  resetExplorerStoreForTests,
  useExplorerStore,
} from "./explorer.store";

const store = () => useExplorerStore.getState();

const saved: SavedQuery = {
  id: "q1",
  title: "Sorties par bateau",
  description: null,
  sql: "SELECT boat_name, COUNT(*) AS n FROM v_outings WHERE season = :season GROUP BY boat_name",
  params: [
    { name: "season", type: "season", required: true, default: "current" },
  ],
  chart: { type: "table" },
  origin: "user",
  status: "saved",
  basedOnReportId: null,
  specVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

beforeEach(() => resetExplorerStoreForTests());

describe("parameters", () => {
  it("detects :names, guesses types and keeps values while editing", () => {
    store().setSql(
      "SELECT * FROM v_outings WHERE season = :season AND boat_id = :boat_id"
    );
    expect(store().doc.params.map((p) => [p.name, p.type])).toEqual([
      ["season", "season"],
      ["boat_id", "boat"],
    ]);
    expect(store().paramValues).toEqual({ season: "current", boat_id: null });

    store().setParamValues({ boat_id: "b1" });
    store().setParamType("boat_id", "text");
    expect(store().paramValues.boat_id).toBeNull();
    store().setParamValues({ boat_id: "b1" });

    // Typing elsewhere keeps the parameter, its type and its value.
    store().setSql(
      "SELECT * FROM v_outings WHERE season = :season AND boat_id = :boat_id AND start_hour > :min_hour"
    );
    expect(store().doc.params.find((p) => p.name === "boat_id")?.type).toBe(
      "text"
    );
    expect(store().paramValues).toMatchObject({
      boat_id: "b1",
      min_hour: null,
    });
    expect(store().doc.params.find((p) => p.name === "min_hour")?.type).toBe(
      "integer"
    );

    // A removed parameter disappears; typing it again starts afresh.
    store().setSql("SELECT * FROM v_outings WHERE season = :season");
    expect(Object.keys(store().paramValues)).toEqual(["season"]);
  });
});

describe("unsaved changes", () => {
  it("a new query is unsaved as soon as it has SQL", () => {
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(false);
    store().setSql("SELECT 1");
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
  });

  it("an opened query is unsaved only once edited, and saved again after markSaved", () => {
    store().openQuery(saved);
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(false);
    store().setChart({ type: "kpi", items: [{ value: "n" }] });
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
    store().markSaved({
      ...saved,
      chart: { type: "kpi", items: [{ value: "n" }] },
    });
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(false);
    // Parameter values alone are not changes of the query.
    store().setParamValues({ season: 2024 });
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(false);
  });

  it("a report draft opens clean, an AI answer opens unsaved with origin ai", () => {
    store().openDraft({
      title: "Classement des bateaux",
      sql: saved.sql,
      params: saved.params,
      basedOnReportId: "boat-usage-ranking",
      paramValues: { season: 2024 },
    });
    expect(store().doc).toMatchObject({
      origin: "report",
      basedOnReportId: "boat-usage-ranking",
    });
    expect(store().paramValues.season).toBe(2024);
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(false);

    store().openAiDraft({
      title: "Sorties du samedi",
      sql: "SELECT 1 AS n",
      params: [],
      chart: { type: "table" },
      explanation: "Compte les sorties.",
      assumptions: [],
    });
    expect(store().doc).toMatchObject({
      origin: "ai",
      title: "Sorties du samedi",
      description: "Compte les sorties.",
      queryId: null,
    });
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
  });

  it("keeps the AI's assumptions in the description, with the caller's label", () => {
    store().openAiDraft(
      {
        title: "Jeunes",
        sql: "SELECT 1 AS n",
        params: [],
        chart: { type: "table" },
        explanation: "Compte les jeunes.",
        assumptions: ["jeunes = 18 ans ou moins", " ", "saison choisie"],
        unverified: true,
      },
      "Hypothèses"
    );
    expect(store().doc.description).toBe(
      "Compte les jeunes.\n\nHypothèses : jeunes = 18 ans ou moins ; saison choisie"
    );
    store().openAiDraft({
      title: "x",
      sql: "SELECT 1",
      params: [],
      chart: { type: "table" },
      explanation: "",
      assumptions: ["a"],
    });
    // No label given: the store stays free of translations.
    expect(store().doc.description).toBeNull();
  });

  it("ignores spaces at line ends and around the text (review 41)", () => {
    store().openQuery(saved);
    store().setSql(saved.sql + "  ");
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(false);
    store().setSql(saved.sql.replace(" FROM", "   \nFROM"));
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
    store().setSql(saved.sql + " LIMIT 1");
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
  });

  it("detaching an archived query keeps its text as a new query", () => {
    store().openQuery(saved);
    store().detachQuery("other");
    expect(store().doc.queryId).toBe("q1");
    store().detachQuery("q1");
    expect(store().doc.queryId).toBeNull();
    expect(store().doc.sql).toBe(saved.sql);
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
  });

  it("follows a rename of the open query without losing edits", () => {
    store().openQuery(saved);
    store().setSql(saved.sql + " LIMIT 5");
    store().renameOpenQuery("q1", "Nouveau titre", "Desc");
    expect(store().doc).toMatchObject({
      title: "Nouveau titre",
      sql: saved.sql + " LIMIT 5",
    });
    expect(store().baseline?.title).toBe("Nouveau titre");
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
  });
});

describe("runs and history", () => {
  it("each run gets a new nonce and the history keeps distinct SQL, newest first", () => {
    store().setSql("SELECT 1");
    store().requestRun();
    const first = store().run?.nonce ?? 0;
    store().requestRun();
    expect(store().run?.nonce).toBe(first + 1);
    store().setSql("SELECT 2");
    store().requestRun();
    expect(store().history.map((h) => h.sql)).toEqual(["SELECT 2", "SELECT 1"]);

    for (let i = 0; i < HISTORY_MAX + 5; i++) {
      store().setSql(`SELECT ${i + 10}`);
      store().requestRun();
    }
    expect(store().history).toHaveLength(HISTORY_MAX);
    store().clearHistory();
    expect(store().history).toEqual([]);
  });

  it("does not record an empty query", () => {
    store().requestRun();
    expect(store().history).toEqual([]);
  });
});

describe("side panel tab", () => {
  it("remembers a tab the user picked, not one shown for them", () => {
    expect(store().sidebarTabChosen).toBe(false);
    store().showSidebarTab("dictionary");
    expect(store()).toMatchObject({
      sidebarTab: "dictionary",
      sidebarTabChosen: false,
    });
    store().setSidebarTab("proposals");
    expect(store()).toMatchObject({
      sidebarTab: "proposals",
      sidebarTabChosen: true,
    });
  });
});

describe("parseStoredDoc", () => {
  it("reads back a stored doc and rejects broken ones", () => {
    store().openQuery(saved);
    const copy = JSON.parse(JSON.stringify(store().doc)) as unknown;
    expect(parseStoredDoc(copy)).toEqual(store().doc);
    expect(parseStoredDoc({ sql: 1 })).toBeNull();
    expect(
      parseStoredDoc({ ...(copy as object), chart: { type: "radar" } })
    ).toBeNull();
    expect(parseStoredDoc(null)).toBeNull();
  });
});

describe("AI follow-ups", () => {
  const answer = (sql: string) => ({
    title: "Sorties",
    sql,
    params: [],
    chart: { type: "table" as const },
    explanation: "",
    assumptions: [],
  });

  it("an untouched AI answer can be replaced without asking, not once edited", () => {
    expect(isUntouchedAiDraft(store())).toBe(false);
    store().openAiDraft(answer("SELECT 1 AS n"));
    // Still unsaved (it cost money), but nothing of the user's is lost.
    expect(hasUnsavedChanges(store().doc, store().baseline)).toBe(true);
    expect(isUntouchedAiDraft(store())).toBe(true);
    store().openAiDraft(answer("SELECT 2 AS n"));
    expect(isUntouchedAiDraft(store())).toBe(true);
    store().setSql("SELECT 2 AS n -- mine");
    expect(isUntouchedAiDraft(store())).toBe(false);
  });

  it("a saved or other query is not an AI draft", () => {
    store().openAiDraft(answer("SELECT 1 AS n"));
    store().openQuery(saved);
    expect(isUntouchedAiDraft(store())).toBe(false);
  });
});

describe("markAccepted", () => {
  it("turns the open proposal into a saved query, edits kept", () => {
    store().openQuery({ ...saved, status: "proposed", origin: "mcp" });
    expect(store().doc.isProposal).toBe(true);
    store().setSql(`${saved.sql} LIMIT 3`);
    store().markAccepted("other");
    expect(store().doc.isProposal).toBe(true);
    store().markAccepted(saved.id);
    expect(store().doc.isProposal).toBe(false);
    expect(store().baseline?.isProposal).toBe(false);
    expect(store().doc.sql).toContain("LIMIT 3");
  });
});

describe("detectParams", () => {
  it("makes typed parameters required and keeps known ones", () => {
    const params = detectParams(
      "SELECT * FROM v_outings WHERE start_date >= :depuis AND season = :season",
      [{ name: "season", type: "season", required: false, default: null }]
    );
    expect(params.find((def) => def.name === "depuis")?.required).toBe(true);
    expect(params.find((def) => def.name === "season")?.required).toBe(false);
  });
});
