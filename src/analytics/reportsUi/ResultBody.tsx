import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { FunnelIcon } from "@heroicons/react/24/outline";
import { ChartView, ChartViewMode } from "../charts/ChartView";
import { autoChart } from "../charts/autoChart";
import { formatValue } from "../charts/format";
import type { ChartSpec } from "../chartSpec";
import {
  ErrorState,
  LoadingState,
  ResultNotices,
  secondaryButtonClass,
} from "../components/AnalyticsStates";
import type { QueryState } from "../engine/useAnalyticsQuery";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import type { ParamValue, QueryResult } from "../types";
import { isEmptyResult, partialSeasonEnd } from "./reportHelpers";

/**
 * The states of a query (plan 1.5) around ChartView: skeleton then
 * "Calcul en cours…" and "Arrêter", error with "Réessayer", the chart (or
 * table), then the truncated and hidden-columns notices. While a new
 * result is computed, the previous one stays, dimmed (review I 49).
 * ChartView shows the empty state itself, unless filters are set: then
 * the filters are blamed and can be reset (review I 50).
 */
export const ResultBody = ({
  query,
  spec,
  params,
  height,
  mode,
  onModeChange,
  heavy = false,
  transform,
  onResetFilters,
  fitHeight,
  onOpenFull,
  tableMaxHeight,
}: {
  query: QueryState & { cancel: () => void; rerun: () => void };
  /** null: guessed from the result (a saved query without chart). */
  spec: ChartSpec | null;
  params: Record<string, ParamValue>;
  height?: number;
  mode?: ChartViewMode;
  onModeChange?: (mode: ChartViewMode) => void;
  heavy?: boolean;
  /** Reshapes the result before it is drawn (report page). */
  transform?: (result: QueryResult) => QueryResult;
  /** Set when filters narrow the result: an empty one offers to reset. */
  onResetFilters?: () => void;
  /** Horizontal bars keep to the height (a dashboard card). */
  fitHeight?: boolean;
  /** Opens the full report from a `fitHeight` chart's note. */
  onOpenFull?: () => void;
  /** Height of the table view ("viewport" on a report page). */
  tableMaxHeight?: number | "viewport";
}) => {
  const { t } = useTranslation();
  const last = useRef<QueryResult | null>(null);
  if (query.status === "success" && query.result) last.current = query.result;
  if (query.status === "error" && query.error) {
    return <ErrorState error={query.error} onRetry={query.rerun} />;
  }
  const loading = query.status !== "success" || !query.result;
  const shown = loading ? last.current : query.result;
  if (!shown) {
    return (
      <LoadingState
        isSlow={query.isSlow}
        heavy={heavy}
        onStop={query.cancel}
        height={height ?? 160}
      />
    );
  }
  const result = transform ? transform(shown) : shown;
  const body =
    onResetFilters && isEmptyResult(result) ? (
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FunnelIcon className="w-8 h-8 text-gray-400" aria-hidden />
        <p className="text-sm text-gray-700">
          {t("analytics.reports.empty.filtered")}
        </p>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={onResetFilters}
        >
          {t("analytics.reports.empty.reset")}
        </button>
      </div>
    ) : (
      <ChartView
        spec={spec ?? autoChart(result.columns, result.rows)}
        result={result}
        params={params}
        height={height}
        mode={mode}
        onModeChange={onModeChange}
        fitHeight={fitHeight}
        onOpenFull={onOpenFull}
        tableMaxHeight={tableMaxHeight}
      />
    );
  return (
    <div className="relative flex flex-col gap-2 min-w-0" aria-busy={loading}>
      <div
        className={
          loading
            ? "flex flex-col gap-2 min-w-0 opacity-50 transition-opacity motion-reduce:transition-none"
            : "flex flex-col gap-2 min-w-0"
        }
      >
        {body}
        <ResultNotices result={result} />
      </div>
      {loading && query.isSlow && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <p className="rounded bg-white/90 px-3 py-1 text-sm text-gray-800 shadow-sm">
            {t(
              heavy
                ? "analytics.common.states.loadingHeavy"
                : "analytics.common.states.loading"
            )}
          </p>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={query.cancel}
          >
            {t("analytics.common.actions.stop")}
          </button>
        </div>
      )}
    </div>
  );
};

/** "Saison en cours : données jusqu'au 19 juin 2026." when it applies. */
export const PartialSeasonNote = ({
  result,
}: {
  result: QueryResult | null;
}) => {
  const { t, i18n } = useTranslation();
  const seasonStartMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const end = partialSeasonEnd(result);
  if (!end) return null;
  return (
    <p className="text-xs text-gray-600">
      {t("analytics.common.season.partial", {
        date: formatValue("cutoff_date", end, {
          locale: i18n.language,
          seasonStartMonth,
          format: "date",
        }),
      })}
    </p>
  );
};
