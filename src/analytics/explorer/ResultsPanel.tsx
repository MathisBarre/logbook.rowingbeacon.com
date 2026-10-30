import { memo, ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PlayIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import type { ChartSpec } from "../chartSpec";
import type { ParamValue } from "../types";
import type { QueryState } from "../engine/useAnalyticsQuery";
import {
  canRaiseLimits,
  useActivePerformance,
} from "../engine/activePerformance";
import {
  DesktopOnlyState,
  LoadingState,
  primaryButtonClass,
  ResultNotices,
  secondaryButtonClass,
} from "../components/AnalyticsStates";
import { ChartView, ChartViewMode } from "../charts/ChartView";
import { ResultTable } from "../charts/ResultTable";
import { ChartBuilder } from "../charts/ChartBuilder";
import { ExportMenu } from "../charts/ExportMenu";
import { useChartSvgRef } from "../dashboard/chartSvgRef";
import type { SqlErrorHelp, SqlFix } from "./sqlErrorHelp";

/**
 * Result of the editor's run (plan 1.3): one status line ("8 482 lignes ·
 * 74 ms", or the limit reached, or no rows, with the season it covers),
 * the hidden-columns notice, table or chart, the chart builder and the
 * exports. While the SQL was edited since, the result is dimmed under a
 * "La requête a changé" bar (review 20).
 *
 * Errors come explained (sqlErrorHelp): one-tap fixes, the raw SQLite
 * text in a disclosure, "Relancer" only where running again can help
 * (review 28); a refused write is a calm notice (29) and a timeout a
 * yellow one with tips and the performance profile (30).
 */

/** The status line, focused by the AI panel's "Voir le résultat". */
export const RESULT_STATUS_ID = "explorer-result-status";
export const RESULTS_ID = "explorer-results";

/** Codes where running the same query again can give another outcome. */
const RETRYABLE = new Set(["timeout", "busy", "internal", "cancelled"]);

interface ResultsPanelProps {
  state: QueryState;
  /** Chart of the query; null = not chosen yet (guessed when asked). */
  chart: ChartSpec | null;
  /** The chart shown when `chart` is null. */
  fallbackChart: ChartSpec;
  onChartChange: (chart: ChartSpec) => void;
  mode: ChartViewMode;
  onModeChange: (mode: ChartViewMode) => void;
  builderOpen: boolean;
  onBuilderOpenChange: (open: boolean) => void;
  params: Record<string, ParamValue>;
  /** The editor has text (else nothing is shown before a run). */
  hasSql: boolean;
  /** The SQL changed since this result or error. */
  stale: boolean;
  /** The error explained; null without an error. */
  errorHelp: SqlErrorHelp | null;
  /** "Aller à l'erreur", for a query long enough to need it. */
  onGoToError: (() => void) | null;
  onApplyFix: (fix: SqlFix) => void;
  /** Runs the query again (also "Exécuter" on the stale bar). */
  onRetry: () => void;
  /** Gestion › Statistiques › Performances, for a timeout. */
  onChangeProfile: (() => void) | null;
  /** "Saison 2024-2025" when a season parameter is bound. */
  seasonLabel: string | null;
  fileSlug: string;
  /** Heading of the printed page and Excel sheet name. */
  title?: string;
}

const toggleClass = (active: boolean) =>
  "min-h-11 px-3 inline-flex items-center gap-1 text-sm font-medium border first:rounded-l last:rounded-r -ml-px first:ml-0 " +
  (active
    ? "bg-steel-blue-800 text-white border-steel-blue-800"
    : "bg-white text-steel-blue-800 border-steel-blue-200 hover:bg-gray-50");

const Running = () => {
  const { t } = useTranslation();
  const { queryTimeoutMs } = useActivePerformance();
  return (
    <div className="flex flex-col gap-2" id={RESULTS_ID}>
      <LoadingState height={200} />
      <p className="text-sm text-gray-600" role="status">
        {t("analytics.explorer.results.running", {
          seconds: Math.round(queryTimeoutMs / 1000),
        })}
      </p>
    </div>
  );
};

const TechnicalDetail = ({ detail }: { detail: string | null }) => {
  const { t } = useTranslation();
  if (!detail) return null;
  return (
    <details className="text-xs text-gray-600">
      <summary className="cursor-pointer select-none">
        {t("analytics.explorer.errors.technicalDetail")}
      </summary>
      <p className="mt-1 font-mono break-all">{detail}</p>
    </details>
  );
};

const Timeout = ({
  help,
  onRetry,
  onChangeProfile,
}: {
  help: SqlErrorHelp;
  onRetry: () => void;
  onChangeProfile: (() => void) | null;
}) => {
  const { t } = useTranslation();
  const { queryTimeoutMs, profile } = useActivePerformance();
  return (
    <div
      className="flex flex-col gap-3 rounded border border-yellow-300 bg-yellow-50 p-4"
      role="alert"
    >
      <p className="flex items-start gap-2 text-sm text-yellow-900">
        <ClockIcon className="h-5 w-5 flex-none text-yellow-700" aria-hidden />
        {t("analytics.explorer.errors.timeout", {
          seconds: Math.round(queryTimeoutMs / 1000),
          profile: t(`analytics.performance.profiles.${profile}.name`, {
            defaultValue: profile,
          }),
        })}
      </p>
      <ul className="ml-7 list-disc text-sm text-gray-800">
        {(["1", "2", "3"] as const).map((tip) => (
          <li key={tip}>{t(`analytics.explorer.errors.timeoutTips.${tip}`)}</li>
        ))}
      </ul>
      <TechnicalDetail detail={help.detail} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={onRetry}
        >
          <ArrowPathIcon className="h-5 w-5" aria-hidden />
          {t("analytics.explorer.results.runAgain")}
        </button>
        {onChangeProfile && canRaiseLimits() && (
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={onChangeProfile}
          >
            {t("analytics.explorer.errors.changeProfile")}
          </button>
        )}
      </div>
    </div>
  );
};

const ErrorBox = ({
  code,
  help,
  onGoToError,
  onApplyFix,
  onRetry,
}: {
  code: string;
  help: SqlErrorHelp;
  onGoToError: (() => void) | null;
  onApplyFix: (fix: SqlFix) => void;
  onRetry: () => void;
}) => {
  const { t } = useTranslation();
  if (help.tone === "info") {
    return (
      <div
        className="flex items-start gap-2 rounded border border-steel-blue-200 bg-steel-blue-50 p-4"
        role="status"
      >
        <InformationCircleIcon
          className="h-5 w-5 flex-none text-steel-blue-700"
          aria-hidden
        />
        <p className="text-sm text-gray-800">{help.message}</p>
      </div>
    );
  }
  const cancelled = code === "cancelled";
  return (
    <div
      className={
        "flex flex-col gap-3 rounded border p-4 " +
        (cancelled
          ? "border-gray-200 bg-gray-50"
          : "border-error-200 bg-error-50")
      }
      role={cancelled ? "status" : "alert"}
    >
      <div className="flex items-start gap-2">
        {!cancelled && (
          <ExclamationTriangleIcon
            className="h-5 w-5 flex-none text-error-600"
            aria-hidden
          />
        )}
        <p
          className={
            "text-sm " + (cancelled ? "text-gray-700" : "text-error-800")
          }
        >
          {help.message}
        </p>
      </div>
      <TechnicalDetail detail={help.detail} />
      {(help.suggestions.length > 0 || onGoToError || RETRYABLE.has(code)) && (
        <div className="flex flex-wrap gap-2">
          {help.suggestions.map((fix) => (
            <button
              key={`${fix.replace.from}-${fix.replace.text}`}
              type="button"
              className={primaryButtonClass}
              onClick={() => onApplyFix(fix)}
            >
              {fix.label}
            </button>
          ))}
          {onGoToError && (
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={onGoToError}
            >
              {t("analytics.explorer.editor.goToError")}
            </button>
          )}
          {RETRYABLE.has(code) && (
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={onRetry}
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              {t("analytics.explorer.results.runAgain")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/** Dims a result the SQL no longer matches, under a bar to run again. */
const Stale = ({
  stale,
  onRun,
  children,
}: {
  stale: boolean;
  onRun: () => void;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  if (!stale) return <>{children}</>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
        <span className="mr-auto">{t("analytics.explorer.results.stale")}</span>
        <button
          type="button"
          className={primaryButtonClass + " min-h-9"}
          onClick={onRun}
        >
          <PlayIcon className="h-4 w-4" aria-hidden />
          {t("analytics.explorer.editor.run")}
        </button>
      </div>
      <div className="opacity-60">{children}</div>
    </div>
  );
};

/**
 * Memoised: the Explorer re-renders on every keystroke in the editor, and
 * the chart (a 365-day calendar, 30 bars) is costly on a Raspberry Pi. The
 * Explorer passes stable props.
 */
export const ResultsPanel = memo(function ResultsPanel({
  state,
  chart,
  fallbackChart,
  onChartChange,
  mode,
  onModeChange,
  builderOpen,
  onBuilderOpenChange,
  params,
  hasSql,
  stale,
  errorHelp,
  onGoToError,
  onApplyFix,
  onRetry,
  onChangeProfile,
  seasonLabel,
  fileSlug,
  title,
}: ResultsPanelProps) {
  const { t, i18n } = useTranslation();
  // The drawn chart, for the PNG export and the print.
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const chartRef = useChartSvgRef(chartBoxRef);

  if (state.status === "idle") {
    // Nothing to show before a query exists (review 2).
    if (!hasSql) return null;
    return (
      <p className="text-sm text-gray-500" id={RESULTS_ID}>
        {t("analytics.explorer.results.idle")}
      </p>
    );
  }

  if (state.status === "loading") return <Running />;

  if (state.status === "error" && state.error) {
    if (state.error.code === "desktop_only") return <DesktopOnlyState />;
    const help = errorHelp ?? {
      message: state.error.message,
      detail: null,
      range: null,
      suggestions: [],
      tone: "error" as const,
    };
    return (
      <section id={RESULTS_ID} className="flex flex-col gap-2">
        <Stale stale={stale} onRun={onRetry}>
          {state.error.code === "timeout" ? (
            <Timeout
              help={help}
              onRetry={onRetry}
              onChangeProfile={onChangeProfile}
            />
          ) : (
            <ErrorBox
              code={state.error.code}
              help={stale ? { ...help, suggestions: [] } : help}
              onGoToError={stale ? null : onGoToError}
              onApplyFix={onApplyFix}
              onRetry={onRetry}
            />
          )}
        </Stale>
      </section>
    );
  }

  const result = state.result;
  if (!result) return null;
  const spec = chart ?? fallbackChart;
  const count = result.rows.length;
  const ms = Math.round(result.elapsedMs).toLocaleString(i18n.language);
  const n = count.toLocaleString(i18n.language);
  const season = seasonLabel ? ` · ${seasonLabel}` : "";

  const status =
    count === 0 ? (
      <>
        <span className="font-medium">
          {t("analytics.explorer.results.noRows", { ms })}
          {season}
        </span>{" "}
        <span className="text-gray-600">
          {t("analytics.explorer.results.noRowsHint")}
        </span>
      </>
    ) : result.truncated ? (
      <>
        <span className="font-medium text-yellow-800">
          {t("analytics.explorer.results.truncated", { count, n, ms })}
          {season}
        </span>{" "}
        <span className="text-gray-600">
          {t("analytics.explorer.results.truncatedHint")}
        </span>
      </>
    ) : (
      <>
        {t("analytics.explorer.results.status", { count, n, ms })}
        {season}
      </>
    );

  return (
    <section className="flex flex-col gap-3" id={RESULTS_ID}>
      <Stale stale={stale} onRun={onRetry}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p
              id={RESULT_STATUS_ID}
              className="mr-auto text-sm text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
              role="status"
              aria-live="polite"
              tabIndex={-1}
            >
              {status}
              {result.cached && (
                <span className="ml-1 text-gray-500">
                  {t("analytics.explorer.results.cached")}
                </span>
              )}
            </p>
            {count > 0 && (
              <>
                <div className="inline-flex" role="group">
                  <button
                    type="button"
                    className={toggleClass(mode === "table")}
                    aria-pressed={mode === "table"}
                    onClick={() => onModeChange("table")}
                  >
                    <TableCellsIcon className="h-5 w-5" aria-hidden />
                    {t("analytics.common.actions.showTable")}
                  </button>
                  <button
                    type="button"
                    className={toggleClass(mode === "chart")}
                    aria-pressed={mode === "chart"}
                    onClick={() => onModeChange("chart")}
                  >
                    <ChartBarIcon className="h-5 w-5" aria-hidden />
                    {t("analytics.common.actions.showChart")}
                  </button>
                </div>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  aria-pressed={builderOpen}
                  onClick={() => {
                    // What is customised is what is shown (review 31).
                    if (!builderOpen && mode === "table") onModeChange("chart");
                    onBuilderOpenChange(!builderOpen);
                  }}
                >
                  <AdjustmentsHorizontalIcon className="h-5 w-5" aria-hidden />
                  {t("analytics.common.actions.customise")}
                </button>
                <ExportMenu
                  result={result}
                  spec={mode === "table" ? { type: "table" } : spec}
                  params={params}
                  fileSlug={fileSlug}
                  chartRef={chartRef}
                  title={title}
                />
              </>
            )}
          </div>
          {/* The limit is said in the status line; personal data here. */}
          <ResultNotices result={{ ...result, truncated: false }} />

          {count === 0 ? (
            result.columns.length > 0 && (
              <ResultTable
                result={result}
                maxHeight={120}
                fit
                showColumnNames
                hideFooter
              />
            )
          ) : (
            <div
              className={
                builderOpen
                  ? "grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"
                  : "flex flex-col"
              }
            >
              <div
                ref={chartBoxRef}
                className={
                  "min-w-0 rounded border border-gray-200 bg-white p-3" +
                  // A narrow table is not stretched to the whole width.
                  (mode === "table" && !builderOpen
                    ? " max-w-full self-start"
                    : "")
                }
              >
                {mode === "table" ? (
                  // The count is in the status line above: no footer.
                  <ResultTable
                    result={result}
                    spec={spec}
                    params={params}
                    fit
                    showColumnNames
                    hideFooter
                  />
                ) : (
                  <ChartView
                    spec={spec}
                    result={result}
                    params={params}
                    height={360}
                    mode="chart"
                    onModeChange={onModeChange}
                  />
                )}
              </div>
              {builderOpen && (
                <aside className="min-w-0 rounded border border-gray-200 bg-white p-3">
                  <ChartBuilder
                    result={result}
                    value={spec}
                    // The table is the "Voir le tableau" view, not a chart.
                    allowTable={false}
                    onChange={(next) => {
                      if (next.type === "table") {
                        onModeChange("table");
                        return;
                      }
                      onChartChange(next);
                      onModeChange("chart");
                    }}
                  />
                </aside>
              )}
            </div>
          )}
        </div>
      </Stale>
    </section>
  );
});
