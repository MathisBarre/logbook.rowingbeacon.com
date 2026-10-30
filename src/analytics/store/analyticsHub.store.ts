import { create } from "zustand";
import type { ExplorerDraft, ParamValue } from "../types";
import { currentSeason, localNow } from "../params/season";
import { useAnalyticsSettingsStore } from "./analyticsSettings.store";
import { onAnalyticsLocalMemoryCleared } from "./localMemory";

/**
 * State of the analytics hub (plan 1.2): the open tab (remembered per
 * workstation, ADR 0003), the season chosen at the top (null = the current
 * season), and hand-overs between tabs: a query sent to the Explorer
 * ("Voir la requête SQL"), a report to open in Rapports ("Ouvrir" on a
 * dashboard card), a question for the AI ("Demander à l'IA" in Rapports).
 */

export const ANALYTICS_TABS = [
  "dashboard",
  "reports",
  "annual",
  "explorer",
] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

const TAB_STORAGE_KEY = "rb.analytics.tab";

interface PendingReport {
  reportId: string;
  paramValues: Record<string, ParamValue>;
  /**
   * The season fixed on the dashboard card it comes from: the report opens
   * on it without changing the hub season. Null follows the hub.
   */
  season: number | null;
}

interface AnalyticsHubState {
  tab: AnalyticsTab;
  /** Start year; null follows the current season. */
  season: number | null;
  pendingDraft: ExplorerDraft | null;
  pendingReport: PendingReport | null;
  /**
   * A question typed elsewhere (the Rapports search) for the AI panel:
   * it fills the question box once, and is never sent on its own (an AI
   * question costs money).
   */
  pendingAiQuestion: string | null;
  setTab: (tab: AnalyticsTab) => void;
  setSeason: (season: number | null) => void;
  /** Switches to the Explorer with this query loaded. */
  openInExplorer: (draft: ExplorerDraft) => void;
  /** The draft sent to the Explorer, once (null afterwards). */
  takePendingDraft: () => ExplorerDraft | null;
  /** Switches to Rapports with this report open. */
  openReport: (
    reportId: string,
    paramValues?: Record<string, ParamValue>,
    season?: number | null
  ) => void;
  /**
   * The hub was left: the hub locks itself, so the Explorer tab is not
   * kept for the next member (it would only show the padlock).
   */
  leaveHub: () => void;
  /** The report to open, once (null afterwards). */
  takePendingReport: () => PendingReport | null;
  /** Switches to the Explorer with this question in the AI box. */
  askAi: (question: string) => void;
  /** The question for the AI panel, once (null afterwards). */
  takePendingAiQuestion: () => string | null;
}

/**
 * The tab remembered on this workstation. Never the Explorer: the hub is
 * locked when it opens, and the next member at the boathouse would land on
 * a padlock instead of the dashboard.
 */
export const readTab = (): AnalyticsTab => {
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return (ANALYTICS_TABS as readonly string[]).includes(stored ?? "") &&
      stored !== "explorer"
      ? (stored as AnalyticsTab)
      : "dashboard";
  } catch {
    return "dashboard";
  }
};

const writeTab = (tab: AnalyticsTab) => {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Storage blocked: the tab is simply not remembered.
  }
};

export const useAnalyticsHubStore = create<AnalyticsHubState>()((set, get) => ({
  tab: readTab(),
  season: null,
  pendingDraft: null,
  pendingReport: null,
  pendingAiQuestion: null,
  setTab(tab) {
    set({ tab });
    writeTab(tab);
  },
  setSeason(season) {
    set({ season });
  },
  openInExplorer(draft) {
    set({ pendingDraft: draft });
    get().setTab("explorer");
  },
  takePendingDraft() {
    const draft = get().pendingDraft;
    if (draft) set({ pendingDraft: null });
    return draft;
  },
  openReport(reportId, paramValues = {}, season = null) {
    set({ pendingReport: { reportId, paramValues, season } });
    get().setTab("reports");
  },
  leaveHub() {
    // Statistiques always reopens on the dashboard, whoever left it elsewhere.
    set({ tab: "dashboard" });
    writeTab("dashboard");
    set({ pendingAiQuestion: null });
  },
  takePendingReport() {
    const report = get().pendingReport;
    if (report) set({ pendingReport: null });
    return report;
  },
  askAi(question) {
    set({ pendingAiQuestion: question.trim() });
    get().setTab("explorer");
  },
  takePendingAiQuestion() {
    const question = get().pendingAiQuestion;
    if (question !== null) set({ pendingAiQuestion: null });
    return question;
  },
}));

/** The season chosen at the top of the hub, "current" resolved. */
export const useHubSeason = (): number => {
  const season = useAnalyticsHubStore((state) => state.season);
  const startMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  return season ?? currentSeason(localNow(), startMonth);
};

// "Supprimer toutes les données" (review C, 5): nothing of the previous
// club waits in the hub.
onAnalyticsLocalMemoryCleared(() =>
  useAnalyticsHubStore.setState({
    tab: "dashboard",
    season: null,
    pendingDraft: null,
    pendingReport: null,
    pendingAiQuestion: null,
  })
);
