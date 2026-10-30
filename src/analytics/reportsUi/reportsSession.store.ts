import { create } from "zustand";
import type { ChartSpec } from "../chartSpec";
import type { ParamValue, ReportCategory } from "../types";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import { onAnalyticsLocalMemoryCleared } from "../store/localMemory";

/**
 * What the Rapports tab remembers while the app runs (review D 3, H 47):
 * the catalogue's search and theme, the open report with its parameters
 * and season, and the chart customised on each report. A switch to
 * another hub tab and back finds the tab as it was left. Nothing is
 * written to disk.
 */

/** Where a report was opened from: its back button returns there. */
export type ReportOrigin = "catalog" | "dashboard";

export interface OpenReportState {
  reportId: string;
  /** Values of the report's parameters (season excepted). */
  values: Record<string, ParamValue>;
  /** Season fixed on the dashboard card it comes from; null follows the hub. */
  season: number | null;
  origin: ReportOrigin;
  /** Changes on each opening, so a report opened twice starts afresh. */
  key: number;
}

interface ReportsSessionState {
  search: string;
  /** Theme chosen above the catalogue; null shows them all. */
  category: ReportCategory | null;
  open: OpenReportState | null;
  /** Last report opened from the catalogue: its card gets the focus back. */
  lastOpenedId: string | null;
  /** Charts customised with "Personnaliser", per report id. */
  customCharts: Record<string, ChartSpec>;
  /** Origin of the next report handed over through the hub store. */
  pendingOrigin: ReportOrigin | null;
  setSearch: (search: string) => void;
  setCategory: (category: ReportCategory | null) => void;
  openReport: (request: {
    reportId: string;
    values?: Record<string, ParamValue>;
    season?: number | null;
    origin?: ReportOrigin;
  }) => void;
  /** Keeps the open report's parameters and season (tab switches). */
  updateOpenReport: (
    patch: Partial<Pick<OpenReportState, "values" | "season">>
  ) => void;
  closeReport: () => void;
  setCustomChart: (reportId: string, spec: ChartSpec | null) => void;
  takePendingOrigin: () => ReportOrigin | null;
}

const initial = {
  search: "",
  category: null,
  open: null,
  lastOpenedId: null,
  customCharts: {},
  pendingOrigin: null,
} satisfies Partial<ReportsSessionState>;

export const useReportsSession = create<ReportsSessionState>()((set, get) => ({
  ...initial,
  setSearch(search) {
    set({ search });
  },
  setCategory(category) {
    set({ category });
  },
  openReport({ reportId, values = {}, season = null, origin = "catalog" }) {
    set({
      open: {
        reportId,
        values,
        season,
        origin,
        key: (get().open?.key ?? 0) + 1,
      },
      lastOpenedId: origin === "catalog" ? reportId : get().lastOpenedId,
    });
  },
  updateOpenReport(patch) {
    const open = get().open;
    if (open) set({ open: { ...open, ...patch } });
  },
  closeReport() {
    set({ open: null });
  },
  setCustomChart(reportId, spec) {
    const others = { ...get().customCharts };
    delete others[reportId];
    set({ customCharts: spec ? { ...others, [reportId]: spec } : others });
  },
  takePendingOrigin() {
    const origin = get().pendingOrigin;
    if (origin) set({ pendingOrigin: null });
    return origin;
  },
}));

/**
 * Opens a report in the Rapports tab, remembering where it comes from
 * (review X6): "Ouvrir" on a dashboard card passes origin "dashboard", and
 * the report's back button then reads "‹ Tableau de bord".
 */
export const openReportFrom = (
  origin: ReportOrigin,
  reportId: string,
  paramValues: Record<string, ParamValue> = {},
  season: number | null = null
) => {
  useReportsSession.setState({ pendingOrigin: origin });
  useAnalyticsHubStore.getState().openReport(reportId, paramValues, season);
};

/**
 * Back to the catalogue: for the hub, when the active "Rapports" tab is
 * clicked again (review D 3).
 */
export const showReportsCatalog = () =>
  useReportsSession.getState().closeReport();

// "Supprimer toutes les données": nothing of the previous club is kept.
onAnalyticsLocalMemoryCleared(() => useReportsSession.setState(initial));
