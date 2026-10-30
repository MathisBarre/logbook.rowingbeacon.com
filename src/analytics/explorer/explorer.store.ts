import { create } from "zustand";
import { ChartSpec, ParamDef, ParamDefs, ParamType } from "../chartSpec";
import type {
  AiDraft,
  ExplorerDraft,
  ParamValue,
  QueryOrigin,
  SavedQuery,
} from "../types";
import { paramDefsFromSql } from "../params/resolveParams";
import { onAnalyticsLocalMemoryCleared } from "../store/localMemory";

/**
 * The parameters of `sql`, the ones typed here required (review 22): an
 * empty `:depuis` would otherwise run as NULL and silently return no rows;
 * required, the run stops on "Donnez une valeur à :depuis". Parameters
 * already defined (a saved query, a draft) keep their own definition.
 */
export const detectParams = (sql: string, existing: ParamDef[]) =>
  paramDefsFromSql(sql, existing).map((def) =>
    existing.some((known) => known.name === def.name)
      ? def
      : { ...def, required: true }
  );

/**
 * State of the Explorer (plan 1.3): the query being edited ("doc"), what
 * it was when last opened or saved (to know when it has unsaved changes),
 * the run asked by "Exécuter", the side panel tab and the run history.
 *
 * Module state, so switching hub tabs keeps the work. The doc and the
 * history are also remembered per workstation in localStorage (ADR 0003,
 * try/catch): closing the app by mistake does not lose a query.
 */

export interface ExplorerDoc {
  /** Saved query id; null for a query never saved. */
  queryId: string | null;
  /** "" until saved (the AI and reports prefill it). */
  title: string;
  description: string | null;
  sql: string;
  params: ParamDef[];
  chart: ChartSpec | null;
  origin: QueryOrigin;
  basedOnReportId: string | null;
  /** An MCP proposal opened before it was accepted. */
  isProposal: boolean;
}

export type SidebarTab = "queries" | "proposals" | "dictionary";

interface HistoryEntry {
  sql: string;
  /** ISO time of the run. */
  at: string;
}

interface RunRequest {
  sql: string;
  /** Raw values of the params editor (resolved when the run starts). */
  paramValues: Record<string, ParamValue>;
  params: ParamDef[];
  /** Changes at every "Exécuter", so the same query runs again. */
  nonce: number;
}

export const HISTORY_MAX = 30;
const DOC_STORAGE_KEY = "rb.analytics.explorer.doc";
const HISTORY_STORAGE_KEY = "rb.analytics.explorer.history";
const TAB_STORAGE_KEY = "rb.analytics.explorer.tab";
const SIDEBAR_TABS: SidebarTab[] = ["queries", "proposals", "dictionary"];

/** An AI answer as handed over; `unverified` when it never ran. */
export type IncomingAiDraft = AiDraft & { unverified?: boolean };

export const emptyDoc = (): ExplorerDoc => ({
  queryId: null,
  title: "",
  description: null,
  sql: "",
  params: [],
  chart: null,
  origin: "user",
  basedOnReportId: null,
  isProposal: false,
});

interface ExplorerState {
  doc: ExplorerDoc;
  /**
   * The doc as opened or saved; null when it never was (new query, AI
   * answer): then any SQL counts as unsaved.
   */
  baseline: ExplorerDoc | null;
  /**
   * The last AI answer loaded, as loaded: while the doc is still exactly
   * that, a new AI answer ("Affiner") replaces it without asking.
   */
  aiDraft: ExplorerDoc | null;
  paramValues: Record<string, ParamValue>;
  run: RunRequest | null;
  sidebarTab: SidebarTab;
  /**
   * True once the user picked a side panel tab on this workstation (it is
   * remembered): the first-run switch to the Dictionary (review 10) then
   * never overrides it.
   */
  sidebarTabChosen: boolean;
  history: HistoryEntry[];
  /** Bumped after each write, so lists read the database again. */
  queriesVersion: number;

  setSql: (sql: string) => void;
  setParamType: (name: string, type: ParamType) => void;
  setParamValues: (values: Record<string, ParamValue>) => void;
  setChart: (chart: ChartSpec | null) => void;
  /** The user picked a tab: shown and remembered on this workstation. */
  setSidebarTab: (tab: SidebarTab) => void;
  /** Shows a tab without remembering it as the user's choice. */
  showSidebarTab: (tab: SidebarTab) => void;
  newDoc: () => void;
  openQuery: (query: SavedQuery) => void;
  openDraft: (draft: ExplorerDraft) => void;
  /**
   * An AI answer: its explanation and assumptions become the description
   * ("Hypothèses : a ; b", the label given by the caller so the store
   * stays free of translations).
   */
  openAiDraft: (draft: IncomingAiDraft, assumptionsLabel?: string) => void;
  /** After a save: the doc becomes that query, without unsaved changes. */
  markSaved: (query: SavedQuery) => void;
  /** The open proposal was accepted: it is a saved query now, as edited. */
  markAccepted: (queryId: string) => void;
  /** A query was renamed in the list: follow it if it is the open one. */
  renameOpenQuery: (
    queryId: string,
    title: string,
    description: string | null
  ) => void;
  /** The saved query was archived or deleted: keep the text as new. */
  detachQuery: (queryId: string) => void;
  requestRun: () => void;
  clearHistory: () => void;
  bumpQueries: () => void;
}

const readJson = (key: string): unknown => {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: only a convenience is lost.
  }
};

const ORIGINS: QueryOrigin[] = ["user", "ai", "mcp", "report"];

/** A doc read back from storage, or null when unreadable. */
export const parseStoredDoc = (value: unknown): ExplorerDoc | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const params = ParamDefs.safeParse(v.params);
  const chart = v.chart === null ? null : ChartSpec.safeParse(v.chart);
  if (
    typeof v.sql !== "string" ||
    typeof v.title !== "string" ||
    !params.success ||
    (chart !== null && !chart.success)
  ) {
    return null;
  }
  return {
    queryId: typeof v.queryId === "string" ? v.queryId : null,
    title: v.title.slice(0, 120),
    description: typeof v.description === "string" ? v.description : null,
    sql: v.sql,
    params: params.data,
    chart: chart === null ? null : chart.data,
    origin: ORIGINS.includes(v.origin as QueryOrigin)
      ? (v.origin as QueryOrigin)
      : "user",
    basedOnReportId:
      typeof v.basedOnReportId === "string" ? v.basedOnReportId : null,
    isProposal: v.isProposal === true,
  };
};

const parseHistory = (value: unknown): HistoryEntry[] =>
  Array.isArray(value)
    ? value
        .filter(
          (entry): entry is HistoryEntry =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as HistoryEntry).sql === "string" &&
            typeof (entry as HistoryEntry).at === "string"
        )
        .slice(0, HISTORY_MAX)
    : [];

const readStored = () => {
  const stored = readJson(DOC_STORAGE_KEY);
  const record =
    typeof stored === "object" && stored !== null
      ? (stored as Record<string, unknown>)
      : {};
  return {
    doc: parseStoredDoc(record.doc) ?? emptyDoc(),
    baseline: parseStoredDoc(record.baseline),
    history: parseHistory(readJson(HISTORY_STORAGE_KEY)),
    sidebarTab: SIDEBAR_TABS.find((tab) => tab === readJson(TAB_STORAGE_KEY)),
  };
};

/**
 * SQL compared without trailing spaces at line ends and around the text:
 * a stray space is not a change worth a prompt (review 41).
 */
export const normalizeSqlForCompare = (sql: string) =>
  sql.replace(/[ \t]+$/gm, "").trim();

const sameDoc = (a: ExplorerDoc, b: ExplorerDoc) =>
  normalizeSqlForCompare(a.sql) === normalizeSqlForCompare(b.sql) &&
  a.title === b.title &&
  (a.description ?? "") === (b.description ?? "") &&
  JSON.stringify(a.params) === JSON.stringify(b.params) &&
  JSON.stringify(a.chart) === JSON.stringify(b.chart);

/** True while the doc is the last AI answer, untouched and unsaved. */
export const isUntouchedAiDraft = (
  state: Pick<ExplorerState, "doc" | "baseline" | "aiDraft">
): boolean =>
  state.aiDraft !== null &&
  state.baseline === null &&
  state.doc.queryId === null &&
  sameDoc(state.doc, state.aiDraft);

/** True when leaving the doc would lose something. */
export const hasUnsavedChanges = (
  doc: ExplorerDoc,
  baseline: ExplorerDoc | null
): boolean =>
  baseline === null ? doc.sql.trim() !== "" : !sameDoc(doc, baseline);

const docOf = (query: SavedQuery): ExplorerDoc => ({
  queryId: query.id,
  title: query.title,
  description: query.description,
  sql: query.sql,
  params: query.params,
  chart: query.chart,
  origin: query.origin,
  basedOnReportId: query.basedOnReportId,
  isProposal: query.status === "proposed",
});

/** Values for a set of params: kept when known, else the default. */
const valuesFor = (
  params: ParamDef[],
  current: Record<string, ParamValue>,
  given: Record<string, ParamValue> = {}
): Record<string, ParamValue> =>
  Object.fromEntries(
    params.map((def) => [
      def.name,
      given[def.name] !== undefined
        ? given[def.name]
        : current[def.name] !== undefined
          ? current[def.name]
          : def.default,
    ])
  );

const stored = readStored();

export const useExplorerStore = create<ExplorerState>()((set, get) => ({
  doc: stored.doc,
  baseline: stored.baseline,
  aiDraft: null,
  paramValues: valuesFor(stored.doc.params, {}),
  run: null,
  sidebarTab: stored.sidebarTab ?? "queries",
  sidebarTabChosen: stored.sidebarTab !== undefined,
  history: stored.history,
  queriesVersion: 0,

  setSql(sql) {
    const { doc, paramValues } = get();
    const params = detectParams(sql, doc.params);
    set({
      doc: { ...doc, sql, params },
      paramValues: valuesFor(params, paramValues),
    });
  },
  setParamType(name, type) {
    const { doc, paramValues } = get();
    const params = doc.params.map((def) =>
      def.name === name
        ? {
            ...def,
            type,
            required: type === "season" ? true : def.required,
            default: type === "season" ? "current" : null,
            options: type === "choice" ? def.options : undefined,
          }
        : def
    );
    set({
      doc: { ...doc, params },
      // The old value rarely fits the new type.
      paramValues: {
        ...paramValues,
        [name]: params.find((def) => def.name === name)?.default ?? null,
      },
    });
  },
  setParamValues(values) {
    set({ paramValues: { ...get().paramValues, ...values } });
  },
  setChart(chart) {
    set({ doc: { ...get().doc, chart } });
  },
  setSidebarTab(sidebarTab) {
    set({ sidebarTab, sidebarTabChosen: true });
    writeJson(TAB_STORAGE_KEY, sidebarTab);
  },
  showSidebarTab(sidebarTab) {
    set({ sidebarTab });
  },
  newDoc() {
    set({ doc: emptyDoc(), baseline: null, paramValues: {}, run: null });
  },
  openQuery(query) {
    const doc = docOf(query);
    set({
      doc,
      baseline: doc,
      paramValues: valuesFor(doc.params, {}),
      run: null,
    });
  },
  openDraft(draft) {
    const params = paramDefsFromSql(draft.sql, draft.params);
    const doc: ExplorerDoc = {
      ...emptyDoc(),
      title: draft.title,
      sql: draft.sql,
      params,
      chart: draft.chart ?? null,
      origin: draft.basedOnReportId ? "report" : "user",
      basedOnReportId: draft.basedOnReportId ?? null,
    };
    // A report's query can be opened again: no unsaved-changes prompt
    // until it is edited.
    set({
      doc,
      baseline: doc,
      paramValues: valuesFor(params, {}, draft.paramValues),
      run: null,
    });
  },
  openAiDraft(draft, assumptionsLabel) {
    const params = paramDefsFromSql(draft.sql, draft.params);
    const assumptions = draft.assumptions.filter((a) => a.trim() !== "");
    const description = [
      draft.explanation.trim(),
      assumptions.length > 0 && assumptionsLabel
        ? `${assumptionsLabel} : ${assumptions.join(" ; ")}`
        : "",
    ]
      .filter((part) => part !== "")
      .join("\n\n");
    const doc: ExplorerDoc = {
      ...emptyDoc(),
      title: draft.title,
      description: description || null,
      sql: draft.sql,
      params,
      chart: draft.chart,
      origin: "ai",
    };
    // An AI answer costs money: unsaved until "Enregistrer".
    set({
      doc,
      baseline: null,
      aiDraft: doc,
      paramValues: valuesFor(params, get().paramValues),
      run: null,
    });
  },
  markSaved(query) {
    const doc = docOf(query);
    set({ doc, baseline: doc });
  },
  markAccepted(queryId) {
    const { doc, baseline } = get();
    if (doc.queryId !== queryId) return;
    set({
      doc: { ...doc, isProposal: false },
      baseline: baseline && { ...baseline, isProposal: false },
    });
  },
  renameOpenQuery(queryId, title, description) {
    const { doc, baseline } = get();
    if (doc.queryId !== queryId) return;
    set({
      doc: { ...doc, title, description },
      baseline: baseline && { ...baseline, title, description },
    });
  },
  detachQuery(queryId) {
    const { doc } = get();
    if (doc.queryId !== queryId) return;
    set({ doc: { ...doc, queryId: null }, baseline: null });
  },
  requestRun() {
    const { doc, paramValues, history, run } = get();
    const sql = doc.sql;
    const entry: HistoryEntry = { sql, at: new Date().toISOString() };
    const nextHistory =
      sql.trim() === ""
        ? history
        : [entry, ...history.filter((h) => h.sql.trim() !== sql.trim())].slice(
            0,
            HISTORY_MAX
          );
    set({
      run: {
        sql,
        params: doc.params,
        paramValues,
        nonce: (run?.nonce ?? 0) + 1,
      },
      history: nextHistory,
    });
    if (nextHistory !== history) writeJson(HISTORY_STORAGE_KEY, nextHistory);
  },
  clearHistory() {
    set({ history: [] });
    writeJson(HISTORY_STORAGE_KEY, []);
  },
  bumpQueries() {
    set({ queriesVersion: get().queriesVersion + 1 });
  },
}));

// Remember the doc (debounced: one write per burst of typing).
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useExplorerStore.subscribe((state, previous) => {
  if (state.doc === previous.doc && state.baseline === previous.baseline) {
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { doc, baseline } = useExplorerStore.getState();
    writeJson(DOC_STORAGE_KEY, { doc, baseline });
  }, 500);
});

/** Hook: true when the current doc has unsaved changes. */
export const useHasUnsavedChanges = () =>
  useExplorerStore((state) => hasUnsavedChanges(state.doc, state.baseline));

/** Back to a new, empty Explorer, with nothing left to remember. */
const resetExplorerStore = () => {
  useExplorerStore.setState({
    doc: emptyDoc(),
    baseline: null,
    aiDraft: null,
    paramValues: {},
    run: null,
    sidebarTab: "queries",
    sidebarTabChosen: false,
    history: [],
    queriesVersion: useExplorerStore.getState().queriesVersion + 1,
  });
  try {
    window.localStorage.removeItem(TAB_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was remembered.
  }
  // The empty doc is not worth a write: its key is being removed.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
};

// "Supprimer toutes les données" (review C, 5).
onAnalyticsLocalMemoryCleared(resetExplorerStore);

/** Test helper: back to a new, empty Explorer. */
export const resetExplorerStoreForTests = () => {
  resetExplorerStore();
  useExplorerStore.setState({ queriesVersion: 0 });
};
