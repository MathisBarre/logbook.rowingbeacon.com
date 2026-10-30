import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  CodeBracketIcon,
  EllipsisHorizontalIcon,
  LockClosedIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../_common/components/Popover";
import { canSeeReport } from "../access/canSee";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import type { ChartViewMode } from "../charts/ChartView";
import { ExportMenu } from "../charts/ExportMenu";
import { primaryButtonClass } from "../components/AnalyticsStates";
import { PinButton } from "../dashboard/PinButton";
import { useChartSvgRef } from "../dashboard/chartSvgRef";
import { useAnalyticsQuery } from "../engine/useAnalyticsQuery";
import { ParamsBar } from "../params/ParamsBar";
import { resolveParams } from "../params/resolveParams";
import { formatSeason, localNow } from "../params/season";
import {
  coverageMessageKey,
  getCoverage,
  shouldShowCoverage,
} from "../reports/coverage";
import { reportNoteKey, splitReportNotes } from "../reports/catalog";
import {
  useAnalyticsHubStore,
  useHubSeason,
} from "../store/analyticsHub.store";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import type { ChartSpec, ParamValue, ReportDefinition } from "../types";
import { CustomisePanel } from "./CustomisePanel";
import { ReportBadges } from "./ReportCatalog";
import {
  dataHints,
  dropEmptyPrevious,
  pageResult,
  relevantNotes,
  reportPageChart,
  scopeLine,
  splitDescription,
} from "./reportDisplay";
import {
  paramLabel,
  reportDescription,
  reportHowToRead,
  reportQuerySql,
  reportTitle,
  seasonParamNames,
} from "./reportHelpers";
import { ResultBody } from "./ResultBody";
import { useReportsSession, type ReportOrigin } from "./reportsSession.store";
import { actionButtonClass, UnavailableReport } from "./UnavailableReport";
import { useReportAvailability } from "./useReportAvailability";

const toggleClass = (active: boolean) =>
  actionButtonClass +
  (active ? " !bg-steel-blue-800 !text-white !border-steel-blue-800" : "");

const segmentClass = (active: boolean) =>
  "inline-flex min-h-11 items-center gap-2 px-3 text-sm font-medium first:rounded-l last:rounded-r focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-steel-blue-500 disabled:cursor-not-allowed disabled:opacity-50 " +
  (active
    ? "bg-steel-blue-700 text-white"
    : "bg-white text-steel-blue-800 hover:bg-steel-blue-50");

/** "Graphique | Tableau" (review B 6): both stay, the shown one pressed. */
const ViewSwitch = ({
  mode,
  onChange,
  disabled,
}: {
  mode: ChartViewMode;
  onChange: (mode: ChartViewMode) => void;
  disabled: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("analytics.reports.view.label")}
      className="inline-flex divide-x divide-steel-blue-200 rounded border border-steel-blue-200"
    >
      {(
        [
          ["chart", ChartBarIcon, "analytics.reports.view.chart"],
          ["table", TableCellsIcon, "analytics.reports.view.table"],
        ] as const
      ).map(([value, Icon, key]) => (
        <button
          key={value}
          type="button"
          className={segmentClass(mode === value)}
          aria-pressed={mode === value}
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          <Icon className="w-5 h-5" aria-hidden />
          {t(key)}
        </button>
      ))}
    </div>
  );
};

/** "⋯ Plus d'actions": the less used actions (review B 7). */
const MoreActions = ({
  onViewSql,
  isUnlocked,
}: {
  onViewSql: () => void;
  isUnlocked: boolean;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={actionButtonClass + " !px-2"}
          aria-label={t("analytics.common.actions.more")}
          aria-haspopup="menu"
        >
          <EllipsisHorizontalIcon className="w-5 h-5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 rounded-md border border-gray-200 p-1"
      >
        <ul role="menu" className="flex flex-col">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full items-center gap-3 rounded px-3 text-left text-sm text-gray-800 hover:bg-gray-100 focus-visible:outline-none focus-visible:bg-gray-100"
              onClick={() => {
                setOpen(false);
                onViewSql();
              }}
            >
              {isUnlocked ? (
                <CodeBracketIcon
                  className="w-5 h-5 shrink-0 text-gray-500"
                  aria-hidden
                />
              ) : (
                <LockClosedIcon
                  className="w-5 h-5 shrink-0 text-gray-500"
                  aria-hidden
                />
              )}
              {t("analytics.common.actions.viewSql")}
            </button>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
};

/**
 * One report (plan 1.3, review B 5): a header row (back button, title,
 * badges), the question and the scope line, the parameters, then the
 * chart card with its toolbar (Graphique | Tableau, Exporter, Épingler,
 * Personnaliser, ⋯), and "Comment lire ce rapport" under it. Nominative
 * and officials-only reports show the lock card and run nothing until
 * unlocked.
 */
export const ReportView = ({
  report,
  initialValues = {},
  initialSeason = null,
  origin = "catalog",
  onBack,
  onValuesChange,
  onSeasonChange,
}: {
  report: ReportDefinition;
  /** Values of the non-season parameters (dashboard card, session). */
  initialValues?: Record<string, ParamValue>;
  /**
   * The season fixed on the dashboard card it was opened from: shown here
   * only, the hub season is left as it is. Null follows the hub.
   */
  initialSeason?: number | null;
  /** Where the back button leads (review X6). */
  origin?: ReportOrigin;
  onBack: () => void;
  /** The parameters changed (kept for a tab switch). */
  onValuesChange?: (values: Record<string, ParamValue>) => void;
  /** The fixed season changed (null: follows the hub). */
  onSeasonChange?: (season: number | null) => void;
}) => {
  const { t, i18n } = useTranslation();
  const { isUnlocked, unlock } = useAnalyticsAdmin();
  const publicRankings = useAnalyticsSettingsStore((s) => s.publicRankings);
  const seasonStartMonth = useAnalyticsSettingsStore((s) => s.seasonStartMonth);
  const hubSeason = useHubSeason();
  const [seasonOverride, setSeasonOverrideState] = useState<number | null>(
    initialSeason === hubSeason ? null : initialSeason
  );
  const setSeasonOverride = (season: number | null) => {
    setSeasonOverrideState(season);
    onSeasonChange?.(season);
  };
  // Choosing a season at the top of the page takes over.
  const hubSeasonAtOpen = useRef(hubSeason);
  useEffect(() => {
    if (hubSeason !== hubSeasonAtOpen.current && seasonOverride !== null) {
      setSeasonOverride(null);
    }
  }, [hubSeason]);
  const season = seasonOverride ?? hubSeason;
  const availabilityOf = useReportAvailability();
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const chartRef = useChartSvgRef(chartBoxRef);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const customiseRef = useRef<HTMLButtonElement>(null);

  // The title takes the focus, so a screen reader starts at the report.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const seasonNames = seasonParamNames(report.params);
  const [values, setValuesState] = useState<Record<string, ParamValue>>(() =>
    Object.fromEntries(
      Object.entries(initialValues).filter(([k]) => !seasonNames.includes(k))
    )
  );
  const setValues = (next: Record<string, ParamValue>) => {
    const kept = Object.fromEntries(
      Object.entries(next).filter(([k]) => !seasonNames.includes(k))
    );
    setValuesState(kept);
    onValuesChange?.(kept);
  };
  // The customised chart is kept per report for the session (H 47).
  const custom = useReportsSession(
    (state) => state.customCharts[report.id] ?? null
  );
  const setCustom = (spec: ChartSpec | null) =>
    useReportsSession.getState().setCustomChart(report.id, spec);
  const [customising, setCustomising] = useState(false);
  const [mode, setMode] = useState<ChartViewMode>("chart");
  const [coverage, setCoverage] = useState<{ pct: number } | null>(null);

  const title = reportTitle(report.id, t);
  const { question, rest } = splitDescription(reportDescription(report.id, t));
  const visible = canSeeReport(report, { isUnlocked, publicRankings });
  const availability = availabilityOf(report);

  const withSeason: Record<string, ParamValue> = { ...values };
  for (const name of seasonNames) withSeason[name] = season;
  const now = localNow();
  const resolved = resolveParams(report.params, withSeason, {
    now,
    seasonStartMonth,
  });
  const missing = report.params.find(
    (def) => def.required && resolved.values[def.name] === null
  );
  const filtered = report.params.some(
    (def) =>
      !seasonNames.includes(def.name) &&
      values[def.name] !== undefined &&
      values[def.name] !== def.default
  );

  const query = useAnalyticsQuery({
    sql: reportQuerySql(report, {
      isUnlocked,
      publicRankings,
      availability,
      missingRequired: !!missing,
    }),
    params: resolved.values,
    priority: "high",
    exclusive: report.cost === "heavy",
  });
  const rawResult = query.status === "success" ? query.result : null;

  // Coverage hint, after the report itself (one query at a time).
  const hasResult = rawResult !== null;
  useEffect(() => {
    setCoverage(null);
    if (!report.coverage || !hasResult) return;
    const abort = new AbortController();
    getCoverage(report, season, { signal: abort.signal }).then(
      (value) => !abort.signal.aborted && setCoverage(value),
      () => undefined
    );
    return () => abort.abort();
  }, [report, season, hasResult]);

  const baseSpec = custom ?? reportPageChart(report);
  const result = useMemo(
    () => (rawResult ? pageResult(report, baseSpec, rawResult, t) : null),
    [rawResult, report, baseSpec, t]
  );
  const ctx = {
    t,
    locale: i18n.language,
    season,
    seasonStartMonth,
    now,
  };
  const spec = dropEmptyPrevious(report, baseSpec, result);
  const seasonLabel = formatSeason(season, seasonStartMonth);
  const { footnotes, details } = splitReportNotes(report);
  const notes = relevantNotes(
    [...footnotes, ...details],
    result,
    spec,
    resolved.values
  );
  const howToRead = reportHowToRead(report.id, t);
  const coverageKey = coverageMessageKey(report);
  const hints = dataHints(report, result, ctx);
  const fixedSeason = seasonOverride !== null && seasonNames.length > 0;
  const scope = scopeLine(report, resolved.values, { ...ctx, fixedSeason });
  const pinValues = {
    ...values,
    ...pickSeason(resolved.values, seasonNames),
  };

  const viewSql = () => {
    void unlock().then((granted) => {
      if (!granted) return;
      useAnalyticsHubStore.getState().openInExplorer({
        title,
        sql: report.sql,
        params: report.params,
        chart: spec,
        basedOnReportId: report.id,
        paramValues: resolved.values,
      });
    });
  };

  const header = (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="min-h-11 -ml-2 inline-flex items-center gap-1 rounded px-2 text-sm font-medium text-steel-blue-800 hover:bg-steel-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
          onClick={onBack}
        >
          <ChevronLeftIcon className="w-4 h-4" aria-hidden />
          {t(
            origin === "dashboard"
              ? "analytics.common.tabs.dashboard"
              : "analytics.common.tabs.reports"
          )}
        </button>
        <h2
          ref={titleRef}
          tabIndex={-1}
          className="text-lg font-semibold text-gray-900 focus:outline-none"
        >
          {title}
        </h2>
        <ReportBadges report={report} locked={!visible} showCost={false} />
      </div>
      {question && (
        <p className="max-w-prose text-sm text-gray-700">{question}</p>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
        <span>{scope}</span>
        {fixedSeason && (
          <button
            type="button"
            className="min-h-11 rounded px-1 font-medium text-steel-blue-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
            onClick={() => setSeasonOverride(null)}
          >
            {t("analytics.reports.scope.followHub")}
          </button>
        )}
      </p>
    </header>
  );

  const reading =
    rest || howToRead || notes.length > 0 ? (
      <section
        aria-labelledby={`${report.id}-how-to-read`}
        className="flex max-w-prose flex-col gap-2 text-sm text-gray-700"
      >
        <h3
          id={`${report.id}-how-to-read`}
          className="text-sm font-semibold text-gray-900"
        >
          {t("analytics.reports.howToRead")}
        </h3>
        {rest && <p>{rest}</p>}
        {howToRead && <p>{howToRead}</p>}
        {notes.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-gray-600">
            {notes.map((note) => (
              <li key={note}>{t(reportNoteKey(note))}</li>
            ))}
          </ul>
        )}
      </section>
    ) : null;

  if (!visible) {
    return (
      <div className="flex flex-col gap-4 pb-6">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-white p-6 text-center">
          <LockClosedIcon className="w-8 h-8 text-steel-blue-700" aria-hidden />
          <p className="font-semibold text-gray-900">
            {t("analytics.common.admin.locked")}
          </p>
          <p className="max-w-prose text-sm text-gray-600">
            {t(
              report.visibility === "nominative"
                ? "analytics.reports.locked.names"
                : "analytics.reports.locked.admin"
            )}
          </p>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => void unlock()}
          >
            <LockClosedIcon className="w-5 h-5" aria-hidden />
            {t("analytics.reports.locked.unlock")}
          </button>
        </div>
        {reading}
      </div>
    );
  }
  if (availability !== "pending" && !availability.available) {
    return (
      <div className="flex flex-col gap-4 pb-6">
        {header}
        <div className="rounded-lg border border-gray-200 bg-white">
          <UnavailableReport availability={availability} />
        </div>
        {reading}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      {header}

      <ParamsBar
        defs={report.params}
        values={values}
        onChange={setValues}
        hidden={seasonNames}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <section
          ref={chartBoxRef}
          aria-label={title}
          className={
            "flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm" +
            (customising ? " lg:sticky lg:top-0 lg:self-start" : "")
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-x-2 text-sm">
              {custom ? (
                <>
                  <span className="font-medium text-steel-blue-800">
                    {t("analytics.dashboard.report.customised")}
                  </span>
                  <button
                    type="button"
                    className="min-h-11 inline-flex items-center gap-1 rounded px-1 font-medium text-steel-blue-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
                    onClick={() => setCustom(null)}
                  >
                    <ArrowUturnLeftIcon className="w-4 h-4" aria-hidden />
                    {t("analytics.charts.builder.reset")}
                  </button>
                </>
              ) : null}
            </div>
            <div
              className="flex flex-wrap items-center gap-2"
              role="toolbar"
              aria-label={t("analytics.reports.toolbar")}
            >
              {spec.type !== "table" && (
                <ViewSwitch mode={mode} onChange={setMode} disabled={!result} />
              )}
              {result ? (
                <ExportMenu
                  result={result}
                  spec={spec}
                  fileSlug={`${report.id}-${seasonLabel}`}
                  chartRef={chartRef}
                  params={resolved.values}
                  title={title}
                  triggerClassName={actionButtonClass}
                />
              ) : (
                <button type="button" className={actionButtonClass} disabled>
                  <ArrowDownTrayIcon className="w-5 h-5" aria-hidden />
                  {t("analytics.common.actions.export")}
                </button>
              )}
              <PinButton
                source={{ kind: "report", reportId: report.id }}
                paramValues={pinValues}
                chartOverride={custom}
              />
              <button
                ref={customiseRef}
                type="button"
                className={toggleClass(customising)}
                aria-pressed={customising}
                onClick={() => setCustomising(!customising)}
              >
                <AdjustmentsHorizontalIcon className="w-5 h-5" aria-hidden />
                {t("analytics.common.actions.customise")}
              </button>
              <MoreActions onViewSql={viewSql} isUnlocked={isUnlocked} />
            </div>
          </div>
          <div className="min-w-0 overflow-x-auto">
            {missing ? (
              <p className="p-4 text-sm text-gray-700">
                {t("analytics.reports.missingParam", {
                  name: paramLabel(missing, t),
                })}
              </p>
            ) : (
              <ResultBody
                query={query}
                spec={spec}
                params={resolved.values}
                height={380}
                mode={mode}
                onModeChange={setMode}
                heavy={report.cost === "heavy"}
                transform={(raw) => pageResult(report, baseSpec, raw, t)}
                onResetFilters={filtered ? () => setValues({}) : undefined}
                tableMaxHeight="viewport"
              />
            )}
          </div>
          {((shouldShowCoverage(coverage) && coverageKey) ||
            hints.length > 0) && (
            <footer className="flex flex-col gap-1 text-xs text-gray-600">
              {hints.map((hint) => (
                <p key={hint}>{hint}</p>
              ))}
              {shouldShowCoverage(coverage) && coverageKey && (
                <p>
                  {t(coverageKey, {
                    pct: new Intl.NumberFormat(i18n.language, {
                      maximumFractionDigits: 0,
                    }).format(coverage.pct),
                  })}
                </p>
              )}
            </footer>
          )}
        </section>
        {customising && (
          <div className="w-full lg:w-96 lg:shrink-0">
            <CustomisePanel
              report={report}
              result={result}
              value={custom}
              baseChart={reportPageChart(report)}
              onChange={setCustom}
              onClose={() => {
                setCustomising(false);
                customiseRef.current?.focus();
              }}
              paramValues={pinValues}
            />
          </div>
        )}
      </div>

      {reading}
    </div>
  );
};

/** The resolved season values, so the pin dialog can offer to keep them. */
const pickSeason = (
  values: Record<string, ParamValue>,
  names: string[]
): Record<string, ParamValue> =>
  Object.fromEntries(names.map((name) => [name, values[name] ?? null]));
