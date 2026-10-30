import { RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownTrayIcon,
  DocumentTextIcon,
  PhotoIcon,
  PrinterIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../_common/components/Popover";
import type { ChartSpec } from "../chartSpec";
import type { ParamValue, QueryResult } from "../types";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { buildCsv } from "./export/csv";
import {
  canPrint,
  printableHtml,
  printHtml,
  resultTableHtml,
} from "./export/html";
import { exportChartPng, serializeChartSvg } from "./export/png";
import {
  ExportExtension,
  notifyFailed,
  notifySaved,
  saveDownload,
  slugify,
} from "./export/saveDownload";
import { buildWorkbook } from "./export/xlsx";
import { columnLabel, formatLocalDate, formatValue } from "./format";
import { getChartTheme } from "./palette";
import { formatSeason } from "../params/season";

interface ExportMenuProps {
  result: QueryResult;
  spec: ChartSpec | null;
  /**
   * Name of the file without prefix, date or extension, e.g.
   * "boat-usage-ranking-2025-2026": the file is
   * rowing-beacon-<fileSlug>-<YYYYMMDD>.<ext> (plan 2.10).
   */
  fileSlug: string;
  /** The chart's SVG, for the PNG export and the print. */
  chartRef?: RefObject<SVGSVGElement>;
  /** Parameter values (labels with placeholders, `category` codes). */
  params?: Record<string, ParamValue>;
  /** Heading of the printed page and Excel sheet name. */
  title?: string;
  /** Replaces the trigger button's default (bordered) classes. */
  triggerClassName?: string;
  /**
   * Context lines printed under the title of the image and the printed
   * page (default: the season and the active filters from `params`).
   */
  contextLines?: string[];
}

type Action = "csv" | "xlsx" | "png" | "print";

const SVG_KINDS = new Set([
  "bar",
  "line",
  "area",
  "pie",
  "heatmap",
  "calendar",
]);

const pad = (n: number) => String(n).padStart(2, "0");

/** rowing-beacon-<slug>-<YYYYMMDD>.<ext>, the slug kept as given. */
export const exportMenuFileName = (
  fileSlug: string,
  ext: ExportExtension,
  now: Date = new Date()
) => {
  const slug = slugify(fileSlug.replace(/^rowing-beacon-/, ""));
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `rowing-beacon-${slug}-${date}.${ext}`;
};

/** The chart's SVG when one is drawn now, else null. */
export const exportableChart = (
  chartRef: RefObject<SVGSVGElement> | undefined,
  spec: ChartSpec | null
): SVGSVGElement | null =>
  spec && SVG_KINDS.has(spec.type) ? (chartRef?.current ?? null) : null;

/** Parameters that are not filters (a choice of measure, a threshold). */
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

/** "Saison 2025-2026", then one "Label : value" line per active filter. */
export const exportContextLines = (
  params: Record<string, ParamValue> | undefined,
  ctx: { t: ExportT; locale: string; seasonStartMonth: number }
): string[] => {
  const lines: string[] = [];
  const season = params?.season;
  if (typeof season === "number") {
    lines.push(
      ctx.t("analytics.charts.export.season", {
        season: formatSeason(season, ctx.seasonStartMonth),
      })
    );
  }
  for (const [name, value] of Object.entries(params ?? {})) {
    if (NOT_FILTERS.has(name) || value === null || value === "") continue;
    if (value === false) continue;
    lines.push(
      `${columnLabel(name, ctx.t)}${ctx.t("analytics.charts.export.colon")}${formatValue(
        name,
        value === true ? 1 : value,
        {
          locale: ctx.locale,
          seasonStartMonth: ctx.seasonStartMonth,
          params,
          t: ctx.t,
        }
      )}`
    );
  }
  return lines;
};
type ExportT = ReturnType<typeof useTranslation>["t"];

/** Trigger style of the report toolbar's secondary actions. */
const TRIGGER_CLASS =
  "min-h-11 min-w-11 px-4 rounded text-sm font-medium border border-steel-blue-200 bg-steel-blue-50 text-steel-blue-800 hover:bg-steel-blue-100 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-1";

/**
 * "Exporter" (plan 2.10), in the order volunteers reach for: Excel, an
 * image of the chart (disabled with a hint in table mode), print or save
 * as PDF (where the webview can print), and CSV raw data. Images and
 * printed pages carry the title, season, filters and a footer. Files go
 * to Downloads, then a toast says where. A plain list of buttons (no
 * menu role: it has no menu keyboard model).
 */
export const ExportMenu = ({
  result,
  spec,
  fileSlug,
  chartRef,
  params,
  title,
  triggerClassName,
  contextLines,
}: ExportMenuProps) => {
  const { t, i18n } = useTranslation();
  const seasonStartMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const ctx = { t, locale: i18n.language, seasonStartMonth };
  const input = { result, spec, params };
  // Looked up when the menu renders (it re-renders when it opens): no SVG
  // in table mode or when one row is drawn as KPI tiles.
  const hasChart = exportableChart(chartRef, spec) !== null;
  const sheetName = title ?? t("analytics.charts.types.table");
  const today = () => {
    const now = new Date();
    return formatLocalDate(
      {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
      },
      i18n.language
    );
  };
  const lines = () => contextLines ?? exportContextLines(params, ctx);
  const footer = () => t("analytics.charts.export.footer", { date: today() });

  const run = async (action: Action) => {
    setBusy(action);
    try {
      if (action === "csv") {
        const name = exportMenuFileName(fileSlug, "csv");
        notifySaved(await saveDownload(name, buildCsv(input, ctx)), t);
      } else if (action === "xlsx") {
        const name = exportMenuFileName(fileSlug, "xlsx");
        const bytes = buildWorkbook([{ name: sheetName, ...input }], ctx);
        notifySaved(await saveDownload(name, bytes), t);
      } else if (action === "png") {
        const svg = exportableChart(chartRef, spec);
        if (!svg) throw new Error(t("analytics.charts.export.noChart"));
        const name = exportMenuFileName(fileSlug, "png");
        notifySaved(
          await exportChartPng(svg, name, {
            background: getChartTheme().surface,
            frame: { title, lines: lines(), footer: footer() },
          }),
          t
        );
      } else {
        const svg = exportableChart(chartRef, spec);
        await printHtml(
          printableHtml({
            title: title ?? fileSlug,
            lines: lines(),
            svg: svg ? serializeChartSvg(svg) : null,
            table: resultTableHtml(input, ctx),
            lang: i18n.language,
            footer: footer(),
          })
        );
      }
      setOpen(false);
    } catch (error) {
      notifyFailed(error, t);
    } finally {
      setBusy(null);
    }
  };

  const items: {
    action: Action;
    label: string;
    Icon: typeof DocumentTextIcon;
    /** Why the action is off now. */
    disabledHint?: string;
  }[] = [
    {
      action: "xlsx",
      label: t("analytics.charts.export.xlsx"),
      Icon: TableCellsIcon,
    },
    {
      action: "png",
      label: t("analytics.charts.export.png"),
      Icon: PhotoIcon,
      ...(hasChart
        ? {}
        : { disabledHint: t("analytics.charts.export.pngHint") }),
    },
    ...(canPrint()
      ? [
          {
            action: "print" as const,
            label: t("analytics.charts.export.print"),
            Icon: PrinterIcon,
          },
        ]
      : []),
    {
      action: "csv",
      label: t("analytics.charts.export.csv"),
      Icon: DocumentTextIcon,
    },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName ?? TRIGGER_CLASS}>
          <ArrowDownTrayIcon className="h-5 w-5" aria-hidden="true" />
          {t("analytics.common.actions.export")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 rounded-md border border-gray-200 p-1 dark:border-gray-700 dark:bg-gray-900"
      >
        <ul className="flex flex-col">
          {items.map(({ action, label, Icon, disabledHint }) => (
            <li key={action}>
              <button
                type="button"
                disabled={busy !== null || disabledHint !== undefined}
                onClick={() => void run(action)}
                className="flex min-h-11 w-full items-center gap-3 rounded px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:text-gray-100 dark:hover:bg-gray-800"
              >
                <Icon
                  className="h-5 w-5 shrink-0 text-gray-500"
                  aria-hidden="true"
                />
                <span className="flex flex-1 flex-col">
                  <span>{label}</span>
                  {disabledHint && (
                    <span className="text-xs text-gray-500">
                      {disabledHint}
                    </span>
                  )}
                </span>
                {busy === action && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-steel-blue-600" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
