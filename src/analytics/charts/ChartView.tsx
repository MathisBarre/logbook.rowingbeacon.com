import { RefObject, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChartBarIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import type { BarSpec, ChartSpec, KpiSpec } from "../chartSpec";
import type { ParamValue, QueryResult } from "../types";
import { EmptyState } from "../components/AnalyticsStates";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { chartFitsResult } from "./chartFits";
import { columnIndex, isEmptyResult } from "./columns";
import { ChartContext, makeFormatter, seriesValueLabel } from "./model";
import { getChartMode, getChartTheme } from "./palette";
import { ResultTable } from "./ResultTable";
import { useIsoLayoutEffect } from "./Tooltip";
import { BarChart } from "./kinds/BarChart";
import { CalendarChart } from "./kinds/CalendarChart";
import { Heatmap } from "./kinds/Heatmap";
import { KpiTiles } from "./kinds/KpiTiles";
import { LineChart } from "./kinds/LineChart";
import { PieChart, pieSlices } from "./kinds/PieChart";
import type { KindProps } from "./kinds/ChartSvg";
// Registers the analytics strings (charts are also drawn on their own).
import "../i18n";

export type ChartViewMode = "chart" | "table";

interface ChartViewProps {
  spec: ChartSpec;
  result: QueryResult;
  params: Record<string, ParamValue>;
  /**
   * Plot height in px (default 320); horizontal bars grow to fit. "fill"
   * measures the parent (a dashboard card's body) and uses its height.
   */
  height?: number | "fill";
  /**
   * Horizontal bars keep to the height: the top rows that fit, then
   * "Les 9 premiers sur 25" with `onOpenFull` (a dashboard card).
   */
  fitHeight?: boolean;
  /** Opens the full report from a `fitHeight` chart's note. */
  onOpenFull?: () => void;
  /** Accessible name of the chart instead of the computed summary. */
  ariaLabel?: string;
  /**
   * Height of the table view: px (default: the chart's height, at least
   * 240), or "viewport" on a report page (the window less 160 px).
   */
  tableMaxHeight?: number | "viewport";
  /**
   * Controlled mode: the parent renders the "Voir le tableau" toggle
   * (dashboard card, report toolbar). Uncontrolled: ChartView renders it.
   */
  mode?: ChartViewMode;
  onModeChange?: (mode: ChartViewMode) => void;
  /** Receives the chart's <svg data-chart-root> (PNG export, HTML). */
  chartRef?: RefObject<SVGSVGElement>;
}

/** Size of an element, measured before paint and on every resize. */
const useElementWidth = (fallback = 640) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  const [boxHeight, setBoxHeight] = useState(0);
  useIsoLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = Math.floor(box.width);
      if (next > 0) setWidth((current) => (current === next ? current : next));
      const h = Math.floor(box.height);
      setBoxHeight((current) => (current === h ? current : h));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width, boxHeight };
};

/** Parameters that are a season or a choice of measure, not a filter. */
const NOT_FILTERS = new Set([
  "season",
  "metric",
  "measure",
  "dimension",
  "days",
  "min_outings",
  "max_outings",
  "tolerance_min",
]);

/** "Essayez une autre saison (ou retirez un filtre)" under an empty chart. */
const emptyHintKey = (params: Record<string, ParamValue>) => {
  const filtered = Object.entries(params).some(
    ([name, value]) =>
      !NOT_FILTERS.has(name) &&
      value !== null &&
      value !== "" &&
      value !== false
  );
  if (filtered) return "analytics.charts.emptyHintFilters";
  return params.season !== undefined && params.season !== null
    ? "analytics.charts.emptyHintSeason"
    : null;
};

/** "Voir le tableau" / "Voir le graphique". */
const ChartModeToggle = ({
  mode,
  onChange,
}: {
  mode: ChartViewMode;
  onChange: (mode: ChartViewMode) => void;
}) => {
  const { t } = useTranslation();
  const toTable = mode === "chart";
  const Icon = toTable ? TableCellsIcon : ChartBarIcon;
  return (
    <button
      type="button"
      onClick={() => onChange(toTable ? "table" : "chart")}
      className="inline-flex min-h-11 items-center gap-2 rounded border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {t(
        toTable
          ? "analytics.common.actions.showTable"
          : "analytics.common.actions.showChart"
      )}
    </button>
  );
};

/** Columns the chart draws values from. */
const valueColumns = (spec: ChartSpec): string[] => {
  switch (spec.type) {
    case "bar":
    case "line":
    case "area":
      return spec.y;
    case "pie":
    case "heatmap":
    case "calendar":
      return [spec.value];
    case "kpi":
      return spec.items.map((item) => item.value);
    case "table":
      return [];
  }
};

const allNull = (result: QueryResult, columns: string[]) =>
  columns.length > 0 &&
  columns.every((name) => {
    const i = columnIndex(result.columns, name);
    return i === -1 || result.rows.every((row) => (row[i] ?? null) === null);
  });

/**
 * KPI tiles for a one-row bar, line or pie, or a pie of one slice (a chart
 * of one number is a number).
 */
const oneRowKpi = (
  spec: ChartSpec,
  result: QueryResult,
  ctx: ChartContext
): { spec: KpiSpec; caption?: string; result?: QueryResult } | null => {
  if (spec.type === "pie" && result.rows.length > 1) {
    const slices = pieSlices(spec, result);
    if (slices?.length !== 1) return null;
    const slice = slices[0];
    return {
      spec: {
        type: "kpi",
        items: [{ value: spec.value }],
        labels: spec.labels,
        labelKeys: spec.labelKeys,
        formats: spec.formats,
      },
      caption: seriesValueLabel(spec, ctx, spec.label, slice.raw),
      result: {
        ...result,
        columns: [{ name: spec.value, declType: null }],
        rows: [[slice.value]],
      },
    };
  }
  if (result.rows.length !== 1) return null;
  const format = makeFormatter(spec, ctx);
  const row = result.rows[0];
  const text = (column: string) => {
    const i = columnIndex(result.columns, column);
    return i === -1 ? undefined : format(column, row[i] ?? null);
  };
  const base = {
    labels: spec.labels,
    labelKeys: spec.labelKeys,
    formats: spec.formats,
  };
  if (spec.type === "bar" || spec.type === "line" || spec.type === "area") {
    const series =
      spec.series !== undefined
        ? seriesValueLabel(
            spec,
            ctx,
            spec.series,
            row[columnIndex(result.columns, spec.series)] ?? null
          )
        : undefined;
    return {
      spec: { type: "kpi", items: spec.y.map((value) => ({ value })), ...base },
      caption: [text(spec.x), series].filter(Boolean).join(" · "),
    };
  }
  if (spec.type === "pie") {
    return {
      spec: { type: "kpi", items: [{ value: spec.value }], ...base },
      caption: text(spec.label),
    };
  }
  return null;
};

/**
 * Renders a result as its ChartSpec says (plan 2.9). It handles the
 * empty result (EmptyState), a spec whose columns are gone (table and
 * analytics.charts.mismatch), one-row results (KPI tiles), pies of more
 * than 6 slices (horizontal bars) and the table view. It does not render
 * spec.title, spec.note or ResultNotices: the card or report does.
 */
export const ChartView = ({
  spec,
  result,
  params,
  height: heightProp = 320,
  mode,
  onModeChange,
  chartRef,
  fitHeight,
  onOpenFull,
  ariaLabel,
  tableMaxHeight,
}: ChartViewProps) => {
  const { t, i18n } = useTranslation();
  const seasonStartMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const [innerMode, setInnerMode] = useState<ChartViewMode>("chart");
  const controlled = mode !== undefined;
  const current = mode ?? innerMode;
  const setMode = (next: ChartViewMode) => {
    if (!controlled) setInnerMode(next);
    onModeChange?.(next);
  };
  const { ref, width, boxHeight } = useElementWidth();
  const fill = heightProp === "fill";
  const chartMode = getChartMode();
  // Parents often pass a new params object with the same values.
  const paramsKey = JSON.stringify(params ?? {});
  const ctx = useMemo<ChartContext>(
    () => ({
      t,
      locale: i18n.language,
      seasonStartMonth,
      params: JSON.parse(paramsKey) as Record<string, ParamValue>,
      theme: getChartTheme(chartMode),
    }),
    [t, i18n.language, seasonStartMonth, paramsKey, chartMode]
  );

  const fits = chartFitsResult(spec, result.columns);
  const empty =
    isEmptyResult(result.rows) || (fits && allNull(result, valueColumns(spec)));
  const showToggle = !controlled && !empty && fits && spec.type !== "table";
  // "fill": the measured box, less the toggle row.
  const height =
    typeof heightProp === "number"
      ? heightProp
      : boxHeight > 120
        ? boxHeight - (showToggle ? 52 : 0)
        : 320;
  const hintKey = emptyHintKey(ctx.params);

  const body = (() => {
    if (empty) {
      return <EmptyState hint={hintKey ? t(hintKey) : undefined} />;
    }
    if (!fits) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-gray-600 dark:text-gray-300" role="note">
            {t("analytics.charts.mismatch")}
          </p>
          <ResultTable result={result} params={params} />
        </div>
      );
    }
    if (spec.type === "table") {
      return (
        <ResultTable
          result={result}
          columns={spec.columns}
          spec={spec}
          params={params}
          maxHeight={tableMaxHeight ?? Math.max(height, 240)}
        />
      );
    }
    if (current === "table") {
      return (
        <ResultTable
          result={result}
          spec={spec}
          params={params}
          maxHeight={tableMaxHeight ?? Math.max(height, 240)}
        />
      );
    }
    return renderChart(spec, result, ctx, width, height, chartRef, {
      fitHeight,
      onOpenFull,
      ariaLabel,
    });
  })();

  return (
    <div
      ref={ref}
      className={`flex min-w-0 w-full flex-col gap-2 ${fill ? "h-full min-h-0" : ""}`}
    >
      {body}
      {showToggle && (
        <div className="flex justify-end">
          <ChartModeToggle mode={current} onChange={setMode} />
        </div>
      )}
    </div>
  );
};

const renderChart = (
  spec: Exclude<ChartSpec, { type: "table" }>,
  result: QueryResult,
  ctx: ChartContext,
  width: number,
  height: number,
  chartRef: RefObject<SVGSVGElement> | undefined,
  options: Pick<KindProps<unknown>, "fitHeight" | "onOpenFull" | "ariaLabel">
) => {
  const kpi = oneRowKpi(spec, result, ctx);
  if (kpi) {
    return (
      <KpiTiles
        spec={kpi.spec}
        result={kpi.result ?? result}
        ctx={ctx}
        caption={kpi.caption}
        width={width}
      />
    );
  }
  const common = { result, ctx, width, height, svgRef: chartRef, ...options };
  switch (spec.type) {
    case "kpi":
      return <KpiTiles spec={spec} result={result} ctx={ctx} width={width} />;
    case "bar":
      return <BarChart spec={spec} {...common} />;
    case "line":
    case "area":
      return <LineChart spec={spec} {...common} />;
    case "pie": {
      const slices = pieSlices(spec, result);
      if (slices && slices.length === 0) return <EmptyState />;
      if (slices && slices.length > 1) {
        return <PieChart spec={spec} slices={slices} {...common} />;
      }
      // More than 6 slices, negative values or a single slice: bars.
      const bars: BarSpec = {
        type: "bar",
        x: spec.label,
        y: [spec.value],
        orientation: "horizontal",
        stacked: false,
        sort: "desc",
        labels: spec.labels,
        labelKeys: spec.labelKeys,
        formats: spec.formats,
      };
      return <BarChart spec={bars} {...common} />;
    }
    case "heatmap":
      return <Heatmap spec={spec} {...common} />;
    case "calendar":
      return <CalendarChart spec={spec} {...common} />;
  }
};
