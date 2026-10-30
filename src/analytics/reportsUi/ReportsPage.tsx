import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { getReport } from "../reports/catalog";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import { ReportCatalog } from "./ReportCatalog";
import { ReportView } from "./ReportView";
import {
  type OpenReportState,
  useReportsSession,
} from "./reportsSession.store";

// No layout effects on the server (static render tests).
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The hub's scrolling panel (AnalyticsHub), or the page. */
const scrollerOf = (node: HTMLElement | null): HTMLElement | null =>
  node?.closest<HTMLElement>("[data-analytics-scroll]") ??
  (typeof document !== "undefined"
    ? (document.scrollingElement as HTMLElement | null)
    : null);

/**
 * Hub tab "Rapports" (plan 1.3), lazy-loaded by AnalyticsHub: the
 * catalogue, or one report. A report sent from a dashboard card
 * ("Ouvrir") is opened directly. The open report, its parameters, the
 * search and the theme are kept for the session (reportsSession.store),
 * so a switch to another tab and back finds them. Back from a report, the
 * catalogue is where it was and its card has the focus.
 */
export const ReportsPage = () => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const catalogScroll = useRef<number | null>(null);
  const session = useReportsSession();
  const pending = useAnalyticsHubStore((state) => state.pendingReport);

  // A report handed over by the hub store is shown at once; the store is
  // read during render and emptied in an effect only, so a second render
  // (StrictMode) still sees it (review A 2).
  const shown: OpenReportState | null = pending
    ? {
        reportId: pending.reportId,
        values: pending.paramValues,
        season: pending.season,
        origin: session.pendingOrigin ?? "catalog",
        key: (session.open?.key ?? 0) + 1,
      }
    : session.open;

  useEffect(() => {
    if (!pending) return;
    const taken = useAnalyticsHubStore.getState().takePendingReport();
    if (!taken) return;
    const state = useReportsSession.getState();
    state.openReport({
      reportId: taken.reportId,
      values: taken.paramValues,
      season: taken.season,
      origin: state.takePendingOrigin() ?? "catalog",
    });
  }, [pending]);

  // The report starts at the top; back, the catalogue is where it was and
  // the card of the report just closed has the focus (review A 4).
  const isOpen = shown !== null;
  const wasOpen = useRef(isOpen);
  useIsomorphicLayoutEffect(() => {
    const scroller = scrollerOf(rootRef.current);
    if (isOpen) {
      if (scroller) scroller.scrollTop = 0;
    } else if (wasOpen.current) {
      if (scroller && catalogScroll.current !== null) {
        scroller.scrollTop = catalogScroll.current;
      }
      catalogScroll.current = null;
      const last = useReportsSession.getState().lastOpenedId;
      if (last) {
        rootRef.current
          ?.querySelector<HTMLElement>(`[data-report-open="${last}"]`)
          ?.focus({ preventScroll: true });
      }
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  const openFromCatalog = (reportId: string) => {
    catalogScroll.current = scrollerOf(rootRef.current)?.scrollTop ?? null;
    session.openReport({ reportId, origin: "catalog" });
  };

  const report = shown ? getReport(shown.reportId) : undefined;
  if (shown && report) {
    const back = () => {
      useReportsSession.getState().closeReport();
      if (shown.origin === "dashboard") {
        useAnalyticsHubStore.getState().setTab("dashboard");
      }
    };
    return (
      <div ref={rootRef}>
        <ReportView
          key={`${report.id}-${shown.key}`}
          report={report}
          initialValues={shown.values}
          initialSeason={shown.season}
          origin={shown.origin}
          onBack={back}
          onValuesChange={(values) =>
            useReportsSession.getState().updateOpenReport({ values })
          }
          onSeasonChange={(season) =>
            useReportsSession.getState().updateOpenReport({ season })
          }
        />
      </div>
    );
  }
  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {shown && !report && (
        <p className="flex items-center gap-2 rounded bg-yellow-50 py-1 pl-3 pr-1 text-sm text-yellow-900">
          <span className="flex-1">
            {t("analytics.dashboard.card.reportGone")}
          </span>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded hover:bg-yellow-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
            aria-label={t("analytics.common.actions.close")}
            onClick={() => session.closeReport()}
          >
            <XMarkIcon className="w-5 h-5" aria-hidden />
          </button>
        </p>
      )}
      <ReportCatalog
        search={session.search}
        onSearchChange={session.setSearch}
        category={session.category}
        onCategoryChange={session.setCategory}
        onOpen={openFromCatalog}
      />
    </div>
  );
};
