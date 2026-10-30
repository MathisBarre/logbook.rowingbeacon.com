import { ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  TableCellsIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Pin } from "lucide-react";
import { canSeeReport, queryVisibility } from "../access/canSee";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import type { ChartViewMode } from "../charts/ChartView";
import { ExportMenu } from "../charts/ExportMenu";
import { secondaryButtonClass } from "../components/AnalyticsStates";
import { useActivePerformance } from "../engine/activePerformance";
import { useAnalyticsQuery } from "../engine/useAnalyticsQuery";
import { formatSeason, localNow } from "../params/season";
import { getReport } from "../reports/catalog";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import {
  dataHints,
  dropEmptyPrevious,
  pageResult,
} from "../reportsUi/reportDisplay";
import { openReportFrom } from "../reportsUi/reportsSession.store";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import type {
  ChartSpec,
  DashboardItemSize,
  ParamDef,
  ParamValue,
  QueryResult,
  ReportVisibility,
} from "../types";
import {
  paramLabel,
  paramsSummary,
  reportQuerySql,
  reportTitle,
  seasonParamNames,
} from "../reportsUi/reportHelpers";
import { PartialSeasonNote, ResultBody } from "../reportsUi/ResultBody";
import { UnavailableReport } from "../reportsUi/UnavailableReport";
import {
  AvailabilityState,
  useReportAvailability,
} from "../reportsUi/useReportAvailability";
import { useChartSvgRef } from "./chartSvgRef";
import { sizeOptions } from "./PinDialog";
import type { DashboardEntry } from "./useDashboard";
import { resolveCardParams } from "./useDashboard";
import { useInView } from "./useInView";

/**
 * One dashboard card (plan 1.3): title, the parameters that differ from
 * the hub (a fixed season as a chip), chart, and one quiet footer row
 * ("Voir le tableau", "Exporter", "Ouvrir le rapport"). In edit mode the
 * footer gives way to the edit bar (Placer avant / après, Retirer,
 * Taille). The query runs once the card has been on screen.
 */

/** A third is a third from 1280 px only: half below (review 12). */
const SPAN: Record<DashboardItemSize, string> = {
  third: "lg:col-span-6 xl:col-span-4",
  half: "lg:col-span-6",
  full: "lg:col-span-12",
};
const HEIGHT: Record<DashboardItemSize, number> = {
  third: 220,
  half: 260,
  full: 300,
};

/** The card footer's quiet buttons (review 13). */
const ghostButtonClass =
  "min-h-11 px-3 rounded text-sm font-medium text-steel-blue-700 hover:bg-steel-blue-50 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500";

interface DashboardCardActions {
  onMove: (direction: "up" | "down") => void;
  onResize: (size: DashboardItemSize) => void;
  onRemove: () => void;
}

/** A key figures card is never a third: its tiles need the room (review 18). */
export const effectiveSize = (
  size: DashboardItemSize,
  spec: ChartSpec | null
): DashboardItemSize =>
  spec?.type === "kpi" && size === "third" ? "half" : size;

const CardFrame = ({
  title,
  subtitle,
  warning,
  children,
  footer,
  editBar,
  plain = false,
  editing = false,
  highlighted = false,
}: {
  title: string;
  subtitle?: ReactNode;
  warning?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  editBar?: ReactNode;
  /** No frame: the key figures tiles sit on the page (review 20). */
  plain?: boolean;
  editing?: boolean;
  /** Just moved: a short ring shows where it went (review 17). */
  highlighted?: boolean;
}) => {
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      className={
        "h-full min-w-0 flex flex-col gap-3 rounded-lg transition-shadow " +
        (plain && !editing
          ? "p-0 bg-transparent border-0 shadow-none"
          : "border border-gray-200 bg-white p-4 shadow-sm") +
        (editing
          ? " outline-dashed outline-2 outline-offset-2 outline-steel-blue-300"
          : "") +
        (highlighted ? " ring-2 ring-steel-blue-400" : "")
      }
    >
      <header className="flex flex-col gap-0.5 min-w-0">
        <h2 id={titleId} className="text-base font-semibold text-gray-900">
          {title}
        </h2>
        {subtitle}
        {warning && (
          <p className="flex items-center gap-1 text-xs text-yellow-800">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0" aria-hidden />
            {warning}
          </p>
        )}
      </header>
      <div className="flex-1 min-w-0 overflow-x-auto">{children}</div>
      {editing ? editBar : footer}
    </article>
  );
};

/** "Toujours la saison 2024-2025" chip, then the other parameters. */
const CardSubtitle = ({
  fixedSeason,
  summary,
}: {
  fixedSeason: string | null;
  summary: string;
}) => {
  const { t } = useTranslation();
  if (!fixedSeason && !summary) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
      {fixedSeason && (
        <span className="inline-flex items-center gap-1 rounded bg-steel-blue-50 px-1.5 py-0.5 text-steel-blue-800">
          <Pin className="w-3 h-3" aria-hidden />
          {t("analytics.dashboard.card.fixedSeason", { season: fixedSeason })}
        </span>
      )}
      {summary && <span>{summary}</span>}
    </p>
  );
};

const EditBar = ({
  title,
  size,
  sizes,
  isFirst,
  isLast,
  actions,
}: {
  title: string;
  size: DashboardItemSize;
  sizes: DashboardItemSize[];
  isFirst: boolean;
  isLast: boolean;
  actions: DashboardCardActions;
}) => {
  const { t } = useTranslation();
  const sizeLabelId = useId();
  return (
    <div
      role="group"
      aria-label={t("analytics.dashboard.editCard", { title })}
      className="flex flex-col gap-2 border-t border-dashed border-steel-blue-200 pt-3"
      data-edit-bar
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={isFirst}
          aria-label={t("analytics.dashboard.moveEarlierCard", { title })}
          data-move="up"
          onClick={() => actions.onMove("up")}
        >
          <ArrowLeftIcon className="w-4 h-4" aria-hidden />
          {t("analytics.dashboard.moveUp")}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={isLast}
          aria-label={t("analytics.dashboard.moveLaterCard", { title })}
          data-move="down"
          onClick={() => actions.onMove("down")}
        >
          {t("analytics.dashboard.moveDown")}
          <ArrowRightIcon className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          className={secondaryButtonClass + " ml-auto !text-error-700"}
          aria-label={t("analytics.dashboard.remove")}
          onClick={actions.onRemove}
        >
          <TrashIcon className="w-4 h-4" aria-hidden />
          {t("analytics.dashboard.removeShort")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span id={sizeLabelId} className="text-sm font-medium text-gray-700">
          {t("analytics.dashboard.size")}
        </span>
        <div
          role="group"
          aria-labelledby={sizeLabelId}
          className="inline-flex rounded border border-gray-300 divide-x divide-gray-300 overflow-hidden"
        >
          {sizes.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={size === option}
              className={
                "min-h-11 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-steel-blue-500 " +
                (size === option
                  ? "bg-steel-blue-800 text-white"
                  : "bg-white text-steel-blue-800 hover:bg-gray-50")
              }
              onClick={() => actions.onResize(option)}
            >
              {t(`analytics.dashboard.sizes.${option}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/** A card whose report or query no longer exists, with "Retirer". */
const GoneCard = ({
  message,
  editing,
  editBar,
  onRemove,
}: {
  message: string;
  editing: boolean;
  editBar: ReactNode;
  onRemove: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <CardFrame
      title={t("analytics.dashboard.card.unavailableTitle")}
      editBar={editBar}
      editing={editing}
    >
      <div className="flex flex-col items-center gap-3 p-4 text-center">
        <p className="text-sm text-gray-600">{message}</p>
        {!editing && (
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={onRemove}
          >
            <TrashIcon className="w-4 h-4" aria-hidden />
            {t("analytics.dashboard.remove")}
          </button>
        )}
      </div>
    </CardFrame>
  );
};

/** A card the viewer may not see: one line, no chart room (review 28). */
const LockedLine = ({ onUnlock }: { onUnlock: () => void }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LockClosedIcon className="w-4 h-4 text-gray-500" aria-hidden />
      <span className="text-sm text-gray-600">
        {t("analytics.common.admin.locked")}
      </span>
      <button
        type="button"
        className={secondaryButtonClass + " ml-auto"}
        onClick={onUnlock}
      >
        {t("analytics.common.admin.unlock")}
      </button>
    </div>
  );
};

/**
 * Visibility of a card (ADR 0008), checked before anything runs: a
 * report's own; a saved query is locked like the report it comes from
 * (unchanged SQL), or for officials only.
 */
export const cardVisibility = ({
  item,
  query,
}: DashboardEntry): ReportVisibility => {
  if (item.source.kind === "report") {
    return getReport(item.source.reportId)?.visibility ?? "admin";
  }
  if (!query) return "admin";
  return queryVisibility(
    query,
    query.basedOnReportId ? getReport(query.basedOnReportId) : null
  );
};

/**
 * The parameters a card's subtitle lists: never the season (the hub shows
 * it once, review 4; a fixed season is a chip), and for a locked report
 * card no free text: a saved query's title and text values are typed by
 * officials and can hold a name, so a locked query card shows neither; a
 * report keeps its catalogue title and its choices (review C, 3).
 */
const summaryDefs = (defs: ParamDef[], locked: boolean): ParamDef[] =>
  defs.filter(
    (def) => def.type !== "season" && !(locked && def.type === "text")
  );

/** The card's title for messages about it (toasts, announcements). */
export const cardTitle = (
  { item, query }: DashboardEntry,
  t: Parameters<typeof reportTitle>[1]
): string => {
  if (item.source.kind === "report") {
    return getReport(item.source.reportId)
      ? reportTitle(item.source.reportId, t)
      : t("analytics.dashboard.card.unavailableTitle");
  }
  return query?.title ?? t("analytics.dashboard.card.unavailableTitle");
};

interface CardSource {
  title: string;
  slug: string;
  sql: string;
  defs: ParamDef[];
  spec: ChartSpec | null;
  heavy: boolean;
  open: (values: Record<string, ParamValue>) => void;
}

export const DashboardCard = ({
  entry,
  hubSeason,
  editing,
  isFirst,
  isLast,
  actions,
  highlighted = false,
}: {
  entry: DashboardEntry;
  hubSeason: number;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  actions: DashboardCardActions;
  highlighted?: boolean;
}) => {
  const { t, i18n } = useTranslation();
  const { item, query } = entry;
  const { isUnlocked, unlock } = useAnalyticsAdmin();
  const publicRankings = useAnalyticsSettingsStore((s) => s.publicRankings);
  const seasonStartMonth = useAnalyticsSettingsStore((s) => s.seasonStartMonth);
  const availabilityOf = useReportAvailability();
  const rootRef = useRef<HTMLDivElement>(null);
  const chartRef = useChartSvgRef(rootRef);
  const inView = useInView(rootRef);
  const [mode, setMode] = useState<ChartViewMode>("chart");
  // The last result, kept while the next one runs (review 19): ResultBody
  // shows it dimmed; the footer keeps its buttons.
  const lastResult = useRef<QueryResult | null>(null);

  const removeWithUnlock = () => {
    void unlock().then((granted) => granted && actions.onRemove());
  };

  const report =
    item.source.kind === "report" ? getReport(item.source.reportId) : null;
  const source: CardSource | null = report
    ? {
        title: reportTitle(report.id, t),
        slug: report.id,
        sql: report.sql,
        defs: report.params,
        spec: report.chart,
        heavy: report.cost === "heavy",
        open: (values) => {
          const seasonNames = seasonParamNames(report.params);
          // A season fixed on the card opens the report on that season,
          // without changing the season of the whole hub.
          const fixed = seasonNames
            .map((name) => item.paramValues[name])
            .find((value): value is number => typeof value === "number");
          const rest = Object.fromEntries(
            Object.entries(values).filter(([key]) => !seasonNames.includes(key))
          );
          // "‹ Tableau de bord" brings the reader back here.
          openReportFrom("dashboard", report.id, rest, fixed ?? null);
        },
      }
    : query
      ? {
          title: query.title,
          slug: query.title,
          sql: query.sql,
          defs: query.params,
          spec: query.chart,
          heavy: false,
          // The Explorer is for officials: ask the password first.
          open: (values) =>
            void unlock().then(
              (granted) =>
                granted &&
                useAnalyticsHubStore.getState().openInExplorer({
                  queryId: query.id,
                  title: query.title,
                  sql: query.sql,
                  params: query.params,
                  chart: query.chart,
                  paramValues: values,
                })
            ),
        }
      : null;

  const visibility = cardVisibility(entry);
  const visible = canSeeReport({ visibility }, { isUnlocked, publicRankings });
  const availability: AvailabilityState = report
    ? availabilityOf(report)
    : { available: true };

  const ctx = { now: localNow(), seasonStartMonth };
  const resolved = source
    ? resolveCardParams(source.defs, item.paramValues, hubSeason, ctx)
    : { values: {}, invalid: false };
  const missingRequired = source
    ? source.defs.some(
        (def) => def.required && resolved.values[def.name] === null
      )
    : false;

  const cardTimeoutMs = useActivePerformance().limits.cardTimeoutMs;
  const queryState = useAnalyticsQuery({
    sql: source
      ? reportQuerySql(
          { sql: source.sql, visibility },
          { isUnlocked, publicRankings, availability, missingRequired }
        )
      : null,
    params: resolved.values,
    enabled: inView,
    // 20 s on Économe; more on the heavier performance profiles.
    timeoutMs: cardTimeoutMs,
    // A saved query (free SQL) or a heavy report runs alone.
    exclusive: !report || report.cost === "heavy",
  });

  if (queryState.status === "success" && queryState.result) {
    lastResult.current = queryState.result;
  } else if (queryState.status === "error") {
    lastResult.current = null;
  }
  const stale = queryState.status === "loading" ? lastResult.current : null;

  const spec = source ? (item.chartOverride ?? source.spec) : null;
  const sizes = sizeOptions(spec);
  const size = effectiveSize(item.size, spec);
  // scroll-mt: a moved card is not hidden under the sticky edit bar.
  const span = `col-span-12 ${SPAN[size]} min-w-0 scroll-mt-24`;

  const editBar = editing ? (
    <EditBar
      title={
        source && (visible || report)
          ? source.title
          : t(
              source
                ? "analytics.dashboard.card.lockedQuery"
                : "analytics.dashboard.card.unavailableTitle"
            )
      }
      size={size}
      sizes={sizes}
      isFirst={isFirst}
      isLast={isLast}
      actions={actions}
    />
  ) : null;

  if (!source) {
    return (
      <div ref={rootRef} className={span} data-dashboard-item={item.id}>
        <GoneCard
          message={t(
            item.source.kind === "report"
              ? "analytics.dashboard.card.reportGone"
              : "analytics.dashboard.card.queryGone"
          )}
          editing={editing}
          editBar={editBar}
          onRemove={removeWithUnlock}
        />
      </div>
    );
  }

  const result =
    visible && queryState.status === "success" ? queryState.result : null;
  const shown = visible ? (result ?? stale) : null;
  // As on the report page: a season-against-season chart without an empty
  // previous season, retention without the arrival season.
  const drawnSpec =
    report && spec ? dropEmptyPrevious(report, spec, shown) : spec;
  const transform =
    report && spec
      ? (raw: QueryResult) => pageResult(report, spec, raw, t)
      : undefined;
  const fmt = { t, locale: i18n.language, seasonStartMonth };
  const seasonNames = seasonParamNames(source.defs);
  const seasonLabel = (() => {
    const season = seasonNames
      .map((name) => resolved.values[name])
      .find((value): value is number => typeof value === "number");
    return season === undefined ? null : formatSeason(season, seasonStartMonth);
  })();
  // Only a season pinned on the card is worth saying (review 4).
  const fixedSeason = seasonNames.some(
    (name) => item.paramValues[name] !== undefined
  )
    ? seasonLabel
    : null;
  const openLabel = t(
    report
      ? "analytics.dashboard.card.openReport"
      : "analytics.dashboard.report.openInExplorer"
  );
  const openButton = (className: string) => (
    <button
      type="button"
      className={className}
      onClick={() => source.open(resolved.values)}
    >
      {openLabel}
      <ArrowRightIcon className="w-4 h-4" aria-hidden />
    </button>
  );

  let body: ReactNode;
  let footer: ReactNode = null;
  if (!visible) {
    body = <LockedLine onUnlock={() => void unlock()} />;
  } else if (availability === "pending") {
    body = (
      <ResultBody
        query={queryState}
        spec={drawnSpec}
        params={resolved.values}
        height={HEIGHT[size]}
      />
    );
  } else if (!availability.available) {
    body = <UnavailableReport availability={availability} />;
  } else if (missingRequired) {
    const def = source.defs.find(
      (d) => d.required && resolved.values[d.name] === null
    );
    body = (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-sm text-gray-600">
          {t("analytics.dashboard.card.missingParam", {
            name: def ? paramLabel(def, t) : "",
          })}
        </p>
        {openButton(secondaryButtonClass)}
      </div>
    );
  } else {
    body = (
      <ResultBody
        query={queryState}
        spec={drawnSpec}
        params={resolved.values}
        height={HEIGHT[size]}
        mode={mode}
        onModeChange={setMode}
        heavy={source.heavy}
        transform={transform}
        // Horizontal bars keep to the card: the top rows that fit, then
        // "Les 6 premiers sur 25" opens the full report (review 11).
        fitHeight
        onOpenFull={() => source.open(resolved.values)}
      />
    );
  }

  if (visible && !missingRequired) {
    // The month in progress of a season-against-season card (as the page).
    const hints = report
      ? dataHints(report, result, {
          t,
          locale: i18n.language,
          season:
            seasonNames
              .map((name) => resolved.values[name])
              .find((value): value is number => typeof value === "number") ??
            hubSeason,
          seasonStartMonth,
          now: ctx.now,
        })
      : [];
    footer = (
      <footer className="flex flex-col gap-2">
        <PartialSeasonNote result={result} />
        {hints.map((hint) => (
          <p key={hint} className="text-xs text-gray-600">
            {hint}
          </p>
        ))}
        <div
          className={
            "flex flex-wrap items-center gap-1 border-t pt-2 " +
            (spec?.type === "kpi" ? "border-gray-200" : "border-gray-100")
          }
        >
          {spec?.type !== "table" && (
            <button
              type="button"
              className={ghostButtonClass}
              disabled={!shown}
              onClick={() => setMode(mode === "chart" ? "table" : "chart")}
            >
              {mode === "chart" ? (
                <TableCellsIcon className="w-4 h-4" aria-hidden />
              ) : (
                <ChartBarIcon className="w-4 h-4" aria-hidden />
              )}
              {t(
                mode === "chart"
                  ? "analytics.common.actions.showTable"
                  : "analytics.common.actions.showChart"
              )}
            </button>
          )}
          {result && (
            <ExportMenu
              result={result}
              spec={spec}
              fileSlug={
                seasonLabel ? `${source.slug}-${seasonLabel}` : source.slug
              }
              chartRef={chartRef}
              params={resolved.values}
              title={source.title}
              triggerClassName={ghostButtonClass}
            />
          )}
          <span className="ml-auto" />
          {openButton(ghostButtonClass)}
        </div>
      </footer>
    );
  }

  const summary = visible
    ? paramsSummary(summaryDefs(source.defs, false), resolved.values, fmt)
    : report
      ? paramsSummary(summaryDefs(source.defs, true), resolved.values, fmt)
      : "";

  return (
    <div ref={rootRef} className={`${span} flex`} data-dashboard-item={item.id}>
      <div className="flex-1 min-w-0">
        <CardFrame
          title={
            visible || report
              ? source.title
              : t("analytics.dashboard.card.lockedQuery")
          }
          subtitle={
            visible || report ? (
              <CardSubtitle fixedSeason={fixedSeason} summary={summary} />
            ) : undefined
          }
          warning={
            resolved.invalid
              ? t("analytics.dashboard.card.invalidParams")
              : null
          }
          footer={footer}
          editBar={editBar}
          editing={editing}
          highlighted={highlighted}
          plain={spec?.type === "kpi" && visible}
        >
          {body}
        </CardFrame>
      </div>
    </div>
  );
};
