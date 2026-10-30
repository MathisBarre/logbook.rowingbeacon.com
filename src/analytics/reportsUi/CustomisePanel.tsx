import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowUturnLeftIcon,
  BookmarkSquareIcon,
  LockClosedIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import { ChartBuilder } from "../charts/ChartBuilder";
import { SaveQueryDialog } from "../explorer/SaveQueryDialog";
import { saveQuery, writeAnalytics } from "../repository/analytics.repository";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import type {
  ChartSpec,
  ParamValue,
  QueryResult,
  ReportDefinition,
  SavedQuery,
} from "../types";
import { reportTitle } from "./reportHelpers";
import { actionButtonClass } from "./UnavailableReport";

/**
 * "Personnaliser" (plan 1.3, level 2): the chart builder on the report's
 * result. Changes only affect the display until the chart is pinned
 * (as the item's chart_override) or saved as a query (origin "report").
 */
export const CustomisePanel = ({
  report,
  result,
  value,
  baseChart,
  onChange,
  onClose,
  paramValues,
}: {
  report: ReportDefinition;
  result: QueryResult | null;
  /** The customised chart; null shows the report's own chart. */
  value: ChartSpec | null;
  /** The chart the report page draws when nothing is customised. */
  baseChart?: ChartSpec;
  onChange: (spec: ChartSpec | null) => void;
  onClose: () => void;
  paramValues: Record<string, ParamValue>;
}) => {
  const { t } = useTranslation();
  const { isUnlocked, unlock } = useAnalyticsAdmin();
  const [dialogOpen, setDialogOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownChart = value ?? baseChart ?? report.chart;

  // The panel takes the focus when it opens (review H 46).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // A title is asked for each save, so two saves are two named queries.
  const askTitle = async () => {
    if (await unlock()) setDialogOpen(true);
  };

  const saveAsQuery = async (title: string, description: string | null) => {
    // The hub may have locked itself while the dialog was open.
    if (!(await unlock())) return false;
    let saved = null as SavedQuery | null;
    const ok = await writeAnalytics("save customised report", async (db) => {
      saved = await saveQuery(db, {
        title,
        description,
        sql: report.sql,
        params: report.params,
        chart: shownChart,
        origin: "report",
        basedOnReportId: report.id,
      });
    });
    const query: SavedQuery | null = saved;
    if (!ok || !query) return false;
    toast.success(t("analytics.dashboard.report.savedAsQuery", { title }), {
      action: {
        label: t("analytics.dashboard.report.openInExplorer"),
        onClick: () =>
          useAnalyticsHubStore.getState().openInExplorer({
            queryId: query.id,
            title: query.title,
            sql: query.sql,
            params: query.params,
            chart: query.chart,
            basedOnReportId: report.id,
            paramValues,
          }),
      },
    });
    return true;
  };

  return (
    <aside
      className="flex flex-col gap-4 rounded-lg border border-steel-blue-200 bg-white p-4 shadow-sm"
      aria-label={t("analytics.charts.builder.title")}
      onKeyDown={(event) => {
        // Escape closes the panel, unless a list or the dialog uses it.
        if (event.key === "Escape" && !dialogOpen && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="flex-1 text-base font-semibold text-gray-900 focus:outline-none"
        >
          {t("analytics.charts.builder.title")}
        </h3>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded text-gray-600 hover:bg-gray-100"
          aria-label={t("analytics.common.actions.close")}
          onClick={onClose}
        >
          <XMarkIcon className="w-5 h-5" aria-hidden />
        </button>
      </div>
      <p className="text-xs text-gray-600">
        {t("analytics.reports.customiseHint")}
      </p>

      {result && (
        <ChartBuilder
          result={result}
          value={shownChart}
          onChange={(spec) => onChange(spec)}
        />
      )}

      <div className="flex flex-col gap-2 border-t border-gray-100 pt-4">
        {value && (
          <button
            type="button"
            className={actionButtonClass}
            onClick={() => onChange(null)}
          >
            <ArrowUturnLeftIcon className="w-5 h-5" aria-hidden />
            {t("analytics.charts.builder.reset")}
          </button>
        )}
        <button
          type="button"
          className={actionButtonClass}
          onClick={() => void askTitle()}
        >
          {isUnlocked ? (
            <BookmarkSquareIcon className="w-5 h-5" aria-hidden />
          ) : (
            <LockClosedIcon className="w-5 h-5" aria-hidden />
          )}
          {t("analytics.dashboard.report.saveAsQuery")}
        </button>
      </div>
      {dialogOpen && (
        <SaveQueryDialog
          open
          mode="save"
          initialTitle={t("analytics.dashboard.report.customisedTitle", {
            title: reportTitle(report.id, t),
          })}
          initialDescription={null}
          onOpenChange={setDialogOpen}
          onSubmit={saveAsQuery}
        />
      )}
    </aside>
  );
};
