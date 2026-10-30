import {
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
} from "@heroicons/react/24/outline";
import type { KpiSpec } from "../../chartSpec";
import type { QueryResult } from "../../types";
import { columnIndex } from "../columns";
import {
  columnDecimals,
  formatValue,
  numberFormatter,
  resolveFormatByName,
  unitOfFormat,
  withMinus,
} from "../format";
import { ChartContext, labelOf, specFormat } from "../model";
import { toNumberOrNull } from "../pivot";

/**
 * Stat tiles for single values (plan 2.9): label, the value large (its
 * unit smaller), and, with a comparison column, a chip with the trend
 * arrow and the change (in percent, or in points for a percentage; the
 * trend's words for screen readers), then "contre 2 619 la saison
 * précédente". Chip colour: green when the change goes the good way, red
 * the other way, grey when `higherIsBetter` is not set; never colour
 * alone. `buildKpiTiles` also feeds the annual report.
 */

type Trend = "up" | "down" | "flat";

export interface KpiTileModel {
  key: string;
  label: string;
  /** The value with its unit ("39 876 km"). */
  value: string;
  /** The value without its unit ("39 876"), and the unit ("km"). */
  number: string;
  unit: string | null;
  compare: {
    trend: Trend;
    /** "+12 %" or "+3 pts", null when it cannot be computed (zero). */
    change: string | null;
    previous: string;
    tone: "good" | "bad" | "neutral";
  } | null;
}

export const buildKpiTiles = (
  spec: KpiSpec,
  result: QueryResult,
  ctx: ChartContext
): KpiTileModel[] => {
  const row = result.rows[0] ?? [];
  const tiles: KpiTileModel[] = [];
  spec.items.forEach((item, i) => {
    const vi = columnIndex(result.columns, item.value);
    const raw = vi === -1 ? null : (row[vi] ?? null);
    if (raw === null && item.hideWhenNull) return;
    const ci = item.compare ? columnIndex(result.columns, item.compare) : -1;
    const previousRaw = ci === -1 ? null : (row[ci] ?? null);
    const valueFormat =
      item.format ??
      specFormat(spec, item.value) ??
      resolveFormatByName(item.value);
    // One precision for the value and its comparison.
    const decimals = columnDecimals([raw, previousRaw]);
    const formatAs = (value: typeof raw, bare = false) =>
      formatValue(item.value, value, {
        locale: ctx.locale,
        seasonStartMonth: ctx.seasonStartMonth,
        params: ctx.params,
        format:
          valueFormat === "boolean" ? undefined : (valueFormat ?? undefined),
        t: ctx.t,
        decimals,
        bare,
      });
    const unit = raw === null ? null : unitOfFormat(valueFormat);
    let compare: KpiTileModel["compare"] = null;
    if (item.compare) {
      const current = toNumberOrNull(raw);
      const previous = toNumberOrNull(previousRaw);
      if (current !== null && previous !== null) {
        const diff = current - previous;
        const scale = Math.max(Math.abs(previous), Math.abs(current), 1e-9);
        const isPercent = valueFormat === "percent";
        const trend: Trend = isPercent
          ? Math.abs(diff) < 0.5
            ? "flat"
            : diff > 0
              ? "up"
              : "down"
          : Math.abs(diff) / scale < 0.005
            ? "flat"
            : diff > 0
              ? "up"
              : "down";
        let change: string | null = null;
        if (trend !== "flat" && isPercent) {
          // A percentage changes by points, not by percent.
          const points = Math.abs(diff);
          const digits = points < 10 && !Number.isInteger(points) ? 1 : 0;
          const text = numberFormatter(ctx.locale, {
            maximumFractionDigits: digits,
            minimumFractionDigits: digits,
          }).format(points);
          change = ctx.t("analytics.charts.kpi.points", {
            count: Number(points.toFixed(digits)),
            value: `${diff > 0 ? "+" : "\u2212"}${text}`,
          });
        } else if (trend !== "flat" && previous !== 0) {
          change = withMinus(
            numberFormatter(ctx.locale, {
              style: "percent",
              maximumFractionDigits: 0,
              signDisplay: "always",
            }).format(diff / Math.abs(previous))
          ).replace(/^-/, "\u2212");
        }
        const good =
          item.higherIsBetter === undefined
            ? null
            : item.higherIsBetter
              ? trend === "up"
              : trend === "down";
        compare = {
          trend,
          change,
          previous: formatAs(previousRaw),
          tone:
            trend === "flat" || good === null
              ? "neutral"
              : good
                ? "good"
                : "bad",
        };
      } else if (previous !== null) {
        compare = {
          trend: "flat",
          change: null,
          previous: formatAs(previousRaw),
          tone: "neutral",
        };
      }
    }
    tiles.push({
      key: `${item.value}-${i}`,
      label: item.label ?? labelOf(spec, ctx, item.value),
      value: formatAs(raw),
      number: unit ? formatAs(raw, true) : formatAs(raw),
      unit,
      compare,
    });
  });
  return tiles;
};

const TREND_ICON = {
  up: ArrowUpRightIcon,
  down: ArrowDownRightIcon,
  flat: ArrowRightIcon,
};

const TREND_KEY = {
  up: "analytics.charts.kpi.trendUp",
  down: "analytics.charts.kpi.trendDown",
  flat: "analytics.charts.kpi.trendFlat",
} as const;

const CHIP_CLASS = {
  good: "bg-success-50 text-success-800 dark:bg-success-900/40 dark:text-success-200",
  bad: "bg-error-50 text-error-800 dark:bg-error-900/40 dark:text-error-200",
  neutral: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
} as const;

const TILE_MIN = 168;
const TILE_GAP = 12;

/**
 * Flex basis of the tiles: as many per row as fit at 10.5rem, then evened
 * out over the rows needed (5 tiles that fit 4 per row go 3 + 2; 4 that
 * fit 3 go 2 + 2), so that a last row never holds a lone stretched tile.
 */
export const balancedBasis = (count: number, width?: number): string => {
  if (!width || count <= 1) return "10.5rem";
  const fit = Math.max(
    1,
    Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP))
  );
  if (fit >= count) return "10.5rem";
  const rows = Math.ceil(count / fit);
  const perRow = Math.ceil(count / rows);
  // Half a pixel of slack: rounding never pushes a tile to the next row.
  const gaps = ((perRow - 1) * TILE_GAP) / perRow + 0.5;
  return `calc(${(100 / perRow).toFixed(4)}% - ${gaps.toFixed(2)}px)`;
};

export const KpiTiles = ({
  spec,
  result,
  ctx,
  caption,
  width,
}: {
  spec: KpiSpec;
  result: QueryResult;
  ctx: ChartContext;
  /** Shown above the tiles (e.g. the category of a one-row chart). */
  caption?: string;
  /** Available width in px: balances wrapped rows (5 tiles: 3 + 2). */
  width?: number;
}) => {
  const tiles = buildKpiTiles(spec, result, ctx);
  const basis = balancedBasis(tiles.length, width);
  const { theme } = ctx;
  if (tiles.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {caption && (
        <p className="text-sm" style={{ color: theme.textSecondary }}>
          {caption}
        </p>
      )}
      {/* Wrapping flex, balanced rows: 5 tiles wrap as 3 + 2, never 4 + 1. */}
      <ul className="flex flex-wrap gap-3" data-kpi="true">
        {tiles.map((tile) => {
          const compare = tile.compare;
          const Icon = compare ? TREND_ICON[compare.trend] : null;
          const words = compare ? ctx.t(TREND_KEY[compare.trend]) : "";
          return (
            <li
              key={tile.key}
              className="flex min-w-0 flex-col gap-1.5 rounded-lg border px-4 py-3"
              style={{
                flex: `1 1 ${basis}`,
                borderColor: theme.border,
                background: theme.surface,
              }}
            >
              <span className="text-sm" style={{ color: theme.textSecondary }}>
                {tile.label}
              </span>
              <span
                className="text-3xl font-semibold leading-tight break-words tabular-nums"
                style={{ color: theme.textPrimary }}
              >
                {tile.number}
                {tile.unit && (
                  <span
                    className="font-medium"
                    style={{ fontSize: "0.6em", color: theme.textSecondary }}
                  >
                    {tile.unit === "%" ? "\u202f%" : `\u00a0${tile.unit}`}
                  </span>
                )}
              </span>
              {compare && Icon && (
                <>
                  <span
                    className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium tabular-nums ${CHIP_CLASS[compare.tone]}`}
                    data-tone={compare.tone}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {compare.change ? (
                      <>
                        <span className="sr-only">{words} </span>
                        {compare.change}
                      </>
                    ) : (
                      words
                    )}
                  </span>
                  <span className="text-sm" style={{ color: theme.textMuted }}>
                    {ctx.t("analytics.charts.kpi.previous", {
                      value: compare.previous,
                    })}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
