import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  LockClosedIcon,
} from "@heroicons/react/20/solid";
import type { ChartSpec } from "../chartSpec";
import type { ParamValue, QueryResult, SqlValue } from "../types";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import {
  columnDecimals,
  columnLabel,
  formatValue,
  labelWithUnit,
  resolveFormatByName,
  unitOfFormat,
} from "./format";
import { specFormat } from "./model";

interface ResultTableProps {
  result: QueryResult;
  /** Columns to show, in this order (default: all). */
  columns?: string[];
  /**
   * Height of the scroll box: px (default 480), or "viewport" (a report
   * page: the window height less 160 px, at least 380).
   */
  maxHeight?: number | "viewport";
  /** Labels and formats of the chart (literal labels, label keys, formats). */
  spec?: ChartSpec | null;
  /** Report parameters (label placeholders, `category` codes). */
  params?: Record<string, ParamValue>;
  /** As wide as its columns (a narrow result), not the whole width. */
  fit?: boolean;
  /** Second header line with the SQL name when it differs (Explorer). */
  showColumnNames?: boolean;
  /** No "N lignes" line under the table. */
  hideFooter?: boolean;
}

/**
 * The table view of every result (plan 1.5 and 2.9): translated headers
 * on up to 2 lines with the unit once ("Distance (km)"), bare numbers
 * right-aligned with tabular figures and one precision per column, a
 * sticky header and first column, tap a header to sort (numbers and dates
 * from the largest, text from A; then the other way; then query order),
 * columns masked for privacy marked with a lock, a fade and "N autres
 * lignes" while rows hide below, and windowed rendering beyond 200 rows so
 * that 5,000 rows never freeze a Raspberry Pi.
 */

const ROW_HEIGHT = 37;
const WINDOW_FROM = 200;
const OVERSCAN = 30;

const TEXT_FORMATS = new Set([
  "date",
  "datetime",
  "month",
  "week",
  "weekday",
  "hour",
  "season",
  "code",
  "text",
  "boolean",
  "year",
]);

/** Formats whose first sort goes from the latest or largest. */
const DESC_FIRST = new Set([
  "date",
  "datetime",
  "month",
  "week",
  "season",
  "year",
]);

type Sort = { index: number; dir: "asc" | "desc" } | null;

const compareValues = (a: SqlValue, b: SqlValue): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

/** Column names the engine read as NULL for privacy ("rower.email" → email). */
const maskedNames = (result: QueryResult) =>
  new Set(result.ignoredColumns.map((c) => c.split(".").pop() ?? c));

/** Height of a report's table: the window less 160 px, at least 380. */
const useViewportHeight = (enabled: boolean) => {
  const read = () =>
    typeof window === "undefined"
      ? 480
      : Math.max(380, window.innerHeight - 160);
  const [height, setHeight] = useState(read);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const update = () => setHeight(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [enabled]);
  return height;
};

export const ResultTable = ({
  result,
  columns,
  maxHeight: maxHeightProp = 480,
  spec = null,
  params,
  fit = false,
  showColumnNames = false,
  hideFooter = false,
}: ResultTableProps) => {
  const { t, i18n } = useTranslation();
  const seasonStartMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const viewportHeight = useViewportHeight(maxHeightProp === "viewport");
  const maxHeight =
    maxHeightProp === "viewport" ? viewportHeight : maxHeightProp;
  const [sort, setSort] = useState<Sort>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0, client: 0, full: 0 });
  const boxRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const names = columns?.length ? columns : result.columns.map((c) => c.name);
    return names
      .map((name, order) => {
        // Duplicate names: the n-th occurrence maps to the n-th column.
        const all = result.columns
          .map((c, i) => (c.name === name ? i : -1))
          .filter((i) => i !== -1);
        const nth = names.slice(0, order).filter((n) => n === name).length;
        return { name, index: all[nth] ?? all[0] ?? -1, order };
      })
      .filter((c) => c.index !== -1);
  }, [columns, result.columns]);

  const masked = useMemo(() => maskedNames(result), [result]);

  const meta = useMemo(
    () =>
      shown.map((c) => {
        const values = result.rows.map((r) => r[c.index] ?? null);
        const sample = values.slice(0, 100);
        const explicit = spec ? specFormat(spec, c.name) : undefined;
        const format =
          (explicit && explicit !== "auto" ? explicit : undefined) ??
          resolveFormatByName(c.name, sample);
        const numeric =
          !TEXT_FORMATS.has(format ?? "") &&
          sample.some((v) => typeof v === "number") &&
          sample.every((v) => v === null || typeof v === "number");
        const unit = numeric ? unitOfFormat(format) : null;
        const label = columnLabel(
          c.name,
          t,
          spec?.labels,
          spec?.labelKeys,
          params
        );
        return {
          ...c,
          numeric,
          format: explicit,
          resolved: format,
          decimals: numeric ? columnDecimals(values) : undefined,
          label: labelWithUnit(label, unit),
          bare: unit !== null,
          masked: masked.has(c.name) && values.every((v) => v === null),
          descFirst: numeric || DESC_FIRST.has(format ?? ""),
        };
      }),
    [shown, result.rows, spec, params, t, masked]
  );

  const ctx = {
    locale: i18n.language,
    seasonStartMonth,
    params,
    t,
  };
  type Meta = (typeof meta)[number];
  const cellText = (c: Meta, value: SqlValue) =>
    formatValue(c.name, value, {
      ...ctx,
      format: c.format,
      decimals: c.decimals,
      bare: c.bare,
    });

  const order = useMemo(() => {
    const indices = result.rows.map((_, i) => i);
    if (!sort) return indices;
    const sign = sort.dir === "asc" ? 1 : -1;
    const column = meta.find((c) => c.index === sort.index);
    // Codes (boat class, category) sort by the label shown.
    const byLabel = column?.resolved === "code";
    const key = (row: SqlValue[]): SqlValue => {
      const value = row[sort.index] ?? null;
      return byLabel && column && value !== null
        ? cellText(column, value)
        : value;
    };
    return indices.sort((a, b) => {
      const va = key(result.rows[a]);
      const vb = key(result.rows[b]);
      // Nulls stay last both ways.
      if (va === null || vb === null) return compareValues(va, vb) || a - b;
      return sign * compareValues(va, vb) || a - b;
    });
    // cellText depends on ctx, which follows the language.
  }, [result.rows, sort, meta, i18n.language]);

  const windowed = order.length > WINDOW_FROM;
  const start = windowed
    ? Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const end = windowed
    ? Math.min(
        order.length,
        Math.ceil((scroll.top + maxHeight) / ROW_HEIGHT) + OVERSCAN
      )
    : order.length;
  const visible = order.slice(start, end);

  const measure = () => {
    const box = boxRef.current;
    if (!box) return;
    setScroll((current) => {
      const next = {
        top: box.scrollTop,
        left: box.scrollLeft,
        client: box.clientHeight,
        full: box.scrollHeight,
      };
      return current.top === next.top &&
        current.left === next.left &&
        current.client === next.client &&
        current.full === next.full
        ? current
        : next;
    });
  };
  useEffect(measure, [result.rows, maxHeight, meta.length]);

  // Rows still below the visible part of the box.
  const hiddenBelow =
    scroll.full - scroll.top - scroll.client > 4
      ? Math.min(
          order.length,
          Math.max(
            1,
            Math.ceil((scroll.full - scroll.top - scroll.client) / ROW_HEIGHT)
          )
        )
      : 0;

  const toggleSort = (index: number, descFirst: boolean) =>
    setSort((current) => {
      const first = descFirst ? "desc" : "asc";
      const second = descFirst ? "asc" : "desc";
      if (!current || current.index !== index) return { index, dir: first };
      return current.dir === first ? { index, dir: second } : null;
    });

  const stickyShadow = scroll.left > 0;
  const firstCell = (i: number) =>
    i === 0
      ? `sticky left-0 ${stickyShadow ? "shadow-[2px_0_4px_-2px_rgba(17,24,39,0.18)] border-r border-gray-200 dark:border-gray-700" : ""}`
      : "";

  return (
    <div className={`flex flex-col gap-1 ${fit ? "max-w-full" : ""}`}>
      <div className={`relative ${fit ? "w-fit max-w-full" : ""}`}>
        <div
          ref={boxRef}
          className="overflow-auto overscroll-contain rounded border border-gray-200 dark:border-gray-700"
          style={{ maxHeight }}
          onScroll={measure}
        >
          <table
            className={`text-sm border-separate border-spacing-0 ${
              fit ? "w-auto min-w-[24rem] max-w-full" : "min-w-full"
            }`}
          >
            <thead>
              <tr>
                {meta.map((c, i) => {
                  const active = sort?.index === c.index ? sort.dir : null;
                  return (
                    <th
                      key={`${c.name}-${c.order}`}
                      scope="col"
                      aria-sort={
                        active === "asc"
                          ? "ascending"
                          : active === "desc"
                            ? "descending"
                            : "none"
                      }
                      className={`sticky top-0 ${i === 0 ? "z-20" : "z-10"} bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-0 align-bottom font-medium text-gray-700 dark:text-gray-200 ${firstCell(i)}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(c.index, c.descFirst)}
                        title={t("analytics.charts.table.sortBy", {
                          column: c.label,
                        })}
                        className={`flex min-h-11 w-full items-center gap-1 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                          c.numeric ? "justify-end text-right" : "text-left"
                        }`}
                      >
                        {c.masked && (
                          <LockClosedIcon
                            className="h-3.5 w-3.5 shrink-0 text-gray-400"
                            aria-label={t(
                              "analytics.charts.table.maskedColumn"
                            )}
                          />
                        )}
                        <span className="block min-w-0 max-w-[9rem]">
                          <span
                            className="line-clamp-3 break-words"
                            title={c.label}
                          >
                            {c.label}
                          </span>
                          {showColumnNames && c.label !== c.name && (
                            <span className="block truncate font-mono text-[11px] font-normal text-gray-500">
                              {c.name}
                            </span>
                          )}
                        </span>
                        {active === "asc" ? (
                          <ChevronUpIcon
                            className="h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                        ) : active === "desc" ? (
                          <ChevronDownIcon
                            className="h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronUpDownIcon
                            className="h-4 w-4 shrink-0 text-gray-300"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {windowed && start > 0 && (
                <tr aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />
              )}
              {visible.map((rowIndex) => {
                const row = result.rows[rowIndex];
                return (
                  <tr
                    key={rowIndex}
                    className="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-900 dark:even:bg-gray-800"
                    style={windowed ? { height: ROW_HEIGHT } : undefined}
                  >
                    {meta.map((c, i) => {
                      const value = row[c.index] ?? null;
                      const isMasked = c.masked && value === null;
                      const text = isMasked
                        ? t("analytics.charts.table.masked")
                        : cellText(c, value);
                      return (
                        <td
                          key={`${c.name}-${c.order}`}
                          title={text.length > 40 ? text : undefined}
                          className={`px-3 py-2 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap max-w-[28rem] truncate bg-inherit ${firstCell(i)} ${
                            c.numeric ? "text-right tabular-nums" : ""
                          } ${
                            isMasked
                              ? "italic text-gray-400"
                              : value === null
                                ? "text-gray-400"
                                : "text-gray-900 dark:text-gray-100"
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {windowed && end < order.length && (
                <tr
                  aria-hidden="true"
                  style={{ height: (order.length - end) * ROW_HEIGHT }}
                />
              )}
            </tbody>
          </table>
        </div>
        {hiddenBelow > 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-px bottom-px h-8 rounded-b bg-gradient-to-t from-white to-transparent dark:from-gray-900"
          />
        )}
      </div>
      {!hideFooter && (
        <p className="flex flex-wrap gap-x-3 text-xs text-gray-500 dark:text-gray-400">
          <span>
            {t("analytics.charts.table.rows", { count: result.rows.length })}
          </span>
          {hiddenBelow > 0 && (
            <span aria-hidden="true">
              {t("analytics.charts.table.scrollMore", { count: hiddenBelow })}
            </span>
          )}
        </p>
      )}
    </div>
  );
};
