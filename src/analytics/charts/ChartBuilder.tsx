import {
  KeyboardEvent,
  ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowTrendingUpIcon,
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChartPieIcon,
  HashtagIcon,
  PresentationChartLineIcon,
  Squares2X2Icon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { ChartSpec, ChartType } from "../chartSpec";
import type { QueryResult } from "../types";
import { autoChart } from "./autoChart";
import { chartFitsResult, chartTypeFits } from "./chartFits";
import { analyseColumns, ColumnInfo, numericColumns } from "./columns";
import { columnLabel } from "./format";
import { MAX_SERIES } from "./palette";

interface ChartBuilderProps {
  result: QueryResult;
  value: ChartSpec | null;
  onChange: (spec: ChartSpec) => void;
  /** The report's or query's own chart: shows "Revenir au graphique d'origine". */
  original?: ChartSpec | null;
  /** False hides the "Tableau" type (the caller shows the table itself). */
  allowTable?: boolean;
}

/**
 * Chart type and column pickers for a result (plan 1.3, level 2). Every
 * type is shown, with an icon; those that cannot represent the result are
 * disabled with the reason. Field names follow the type ("Catégories",
 * "Une courbe par", "Lignes"…); every change emits a valid ChartSpec that
 * keeps the labels and formats of the current one. The panel's title
 * (analytics.charts.builder.title) belongs to the caller.
 */

/** Type tiles, in the order a volunteer reaches for them. */
const TYPE_ORDER: { type: ChartType; Icon: typeof ChartBarIcon }[] = [
  { type: "bar", Icon: ChartBarIcon },
  { type: "line", Icon: ArrowTrendingUpIcon },
  { type: "area", Icon: PresentationChartLineIcon },
  { type: "pie", Icon: ChartPieIcon },
  { type: "heatmap", Icon: Squares2X2Icon },
  { type: "calendar", Icon: CalendarDaysIcon },
  { type: "kpi", Icon: HashtagIcon },
  { type: "table", Icon: TableCellsIcon },
];

/**
 * Radio chips with one tab stop: arrow keys move the choice (roving
 * tabindex), disabled options are skipped.
 */
const RadioChips = <T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  render,
  disabled,
  title,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelledBy?: string;
  render: (option: T, on: boolean) => ReactNode;
  disabled?: (option: T) => boolean;
  title?: (option: T) => string | undefined;
}) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !disabled?.(o));
  const focusable = enabled.includes(value) ? value : enabled[0];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta || enabled.length === 0) return;
    event.preventDefault();
    const at = Math.max(0, enabled.indexOf(value));
    const next = enabled[(at + delta + enabled.length) % enabled.length];
    onChange(next);
    refs.current[options.indexOf(next)]?.focus();
  };
  return (
    <div
      className="flex flex-wrap gap-1"
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => {
        const on = option === value;
        const off = disabled?.(option) ?? false;
        return (
          <button
            key={option}
            ref={(element) => {
              refs.current[i] = element;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={off || undefined}
            disabled={off}
            title={title?.(option)}
            tabIndex={option === focusable ? 0 : -1}
            className={chipClass(on, off)}
            onClick={() => !on && !off && onChange(option)}
          >
            {render(option, on)}
          </button>
        );
      })}
    </div>
  );
};

type Labels = Pick<
  ChartSpec,
  "title" | "note" | "labels" | "labelKeys" | "formats"
>;

const labelsOf = (spec: ChartSpec | null): Labels => {
  if (!spec) return {};
  const { title, note, labels, labelKeys, formats } = spec;
  return Object.fromEntries(
    Object.entries({ title, note, labels, labelKeys, formats }).filter(
      ([, v]) => v !== undefined
    )
  );
};

const firstOf = (list: ColumnInfo[], not: string[] = []) =>
  list.find((c) => !not.includes(c.name))?.name;

/** The current spec turned into `type`, keeping what can be kept. */
export const convertSpec = (
  current: ChartSpec,
  type: ChartType,
  result: QueryResult
): ChartSpec => {
  const info = analyseColumns(result.columns, result.rows);
  const numeric = numericColumns(info);
  const dims = info.filter((c) => c.isDimension);
  const guess = autoChart(result.columns, result.rows);
  const keep = labelsOf(current);

  // What the current spec says about x, values and series.
  let x: string | undefined;
  let ys: string[] = [];
  let series: string | undefined;
  switch (current.type) {
    case "bar":
    case "line":
    case "area":
      x = current.x;
      ys = current.y;
      series = current.series;
      break;
    case "pie":
      x = current.label;
      ys = [current.value];
      break;
    case "heatmap":
      x = current.x;
      ys = [current.value];
      series = current.y;
      break;
    case "calendar":
      x = current.date;
      ys = [current.value];
      break;
    case "kpi":
      ys = current.items.map((i) => i.value);
      break;
    case "table":
      break;
  }
  if (!x && (guess.type === "bar" || guess.type === "line")) x = guess.x;
  x ??= firstOf(dims) ?? result.columns[0]?.name;
  ys = ys.filter((y) => numeric.some((c) => c.name === y) && y !== x);
  if (ys.length === 0) {
    const y =
      firstOf(
        numeric.filter((c) => !c.isDimension),
        [x ?? ""]
      ) ?? firstOf(numeric, [x ?? ""]);
    if (y) ys = [y];
  }
  const y0 = ys[0] ?? numeric[0]?.name ?? "";
  const xName = x ?? "";

  switch (type) {
    case "table":
      return { type: "table", ...keep };
    case "kpi":
      return {
        type: "kpi",
        items: (ys.length ? ys : numeric.map((c) => c.name))
          .slice(0, 6)
          .map((value) => ({ value })),
        ...keep,
      };
    case "bar":
      return {
        type: "bar",
        x: xName,
        y: series ? [y0] : ys.slice(0, MAX_SERIES),
        ...(series ? { series } : {}),
        orientation: current.type === "bar" ? current.orientation : "vertical",
        stacked: current.type === "bar" ? current.stacked : Boolean(series),
        sort: current.type === "bar" ? current.sort : "none",
        ...(current.type === "bar" && current.limit
          ? { limit: current.limit }
          : {}),
        ...keep,
      };
    case "line":
    case "area":
      return {
        type,
        x: xName,
        y: series ? [y0] : ys.slice(0, MAX_SERIES),
        ...(series ? { series } : {}),
        cumulative:
          current.type === "line" || current.type === "area"
            ? current.cumulative
            : false,
        ...keep,
      };
    case "pie":
      return { type: "pie", label: xName, value: y0, ...keep };
    case "heatmap": {
      const yDim =
        series ?? firstOf(dims, [xName]) ?? firstOf(info, [xName, y0]) ?? xName;
      return { type: "heatmap", x: xName, y: yDim, value: y0, ...keep };
    }
    case "calendar": {
      const date =
        info.find((c) => c.kind === "date" && c.name === xName)?.name ??
        info.find((c) => c.kind === "date")?.name ??
        xName;
      return { type: "calendar", date, value: y0, ...keep };
    }
  }
};

const Field = ({
  label,
  children,
  hint,
  alert,
}: {
  label: string;
  children: ReactNode | ((labelId: string) => ReactNode);
  hint?: string;
  /** A hint said aloud (role="status"), e.g. "Au moins une valeur". */
  alert?: string;
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1" role="group" aria-labelledby={id}>
      <span
        id={id}
        className="text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        {label}
      </span>
      {typeof children === "function" ? children(id) : children}
      {hint && <span className="text-xs text-gray-500">{hint}</span>}
      <span role="status" className="text-xs font-medium text-gray-700">
        {alert}
      </span>
    </div>
  );
};

const selectClass =
  "min-h-11 w-full rounded border border-gray-300 bg-white pl-3 pr-10 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

const chipClass = (on: boolean, disabled = false) =>
  `min-h-11 min-w-11 rounded border px-3 text-sm font-medium ${
    on
      ? "border-steel-blue-700 bg-steel-blue-700 text-white"
      : disabled
        ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500"
        : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
  }`;

const Toggle = ({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={() => onChange(!on)}
    className="flex min-h-11 items-center justify-between gap-3 rounded border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
  >
    <span>{label}</span>
    <span
      aria-hidden="true"
      className={`relative inline-block h-6 w-11 rounded-full transition-colors ${on ? "bg-steel-blue-700" : "bg-gray-300"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`}
      />
    </span>
  </button>
);

/** Names of the x, values and series fields for a chart type. */
const fieldKeys = (type: ChartType) =>
  type === "line" || type === "area"
    ? { x: "lineX", y: "y", series: "lineSeries" }
    : type === "heatmap"
      ? { x: "heatmapX", y: "heatmapY", series: "heatmapValue" }
      : { x: "barX", y: "y", series: "barSeries" };

export const ChartBuilder = ({
  result,
  value,
  onChange,
  original = null,
  allowTable = true,
}: ChartBuilderProps) => {
  const { t } = useTranslation();
  const info = useMemo(
    () => analyseColumns(result.columns, result.rows),
    [result]
  );
  const fitsByType = useMemo(
    () => chartTypeFits(result.columns, result.rows, info),
    [result, info]
  );
  const spec = useMemo<ChartSpec>(
    () => value ?? autoChart(result.columns, result.rows),
    [value, result]
  );
  const [needsValue, setNeedsValue] = useState(false);
  const numeric = numericColumns(info);
  const label = (name: string) =>
    columnLabel(name, t, spec.labels, spec.labelKeys);
  const fits = chartFitsResult(spec, result.columns);
  const emit = (next: ChartSpec) => {
    setNeedsValue(false);
    const parsed = ChartSpec.safeParse(next);
    if (parsed.success) onChange(parsed.data);
  };
  const keys = fieldKeys(spec.type);
  const fieldLabel = (key: string) => t(`analytics.charts.builder.${key}`);

  /** A column picker, its options grouped as dimensions then measures. */
  const columnSelect = (
    current: string,
    options: ColumnInfo[],
    onSelect: (name: string) => void,
    none?: string
  ) => {
    const dims = options.filter((c) => c.isDimension);
    const measures = options.filter((c) => !c.isDimension);
    const optionsOf = (list: ColumnInfo[]) =>
      list.map((c) => (
        <option key={`${c.name}-${c.index}`} value={c.name}>
          {label(c.name)}
        </option>
      ));
    return (
      <select
        className={selectClass}
        value={current}
        onChange={(event) => onSelect(event.target.value)}
      >
        {none !== undefined && <option value="">{none}</option>}
        {!options.some((o) => o.name === current) && current && (
          <option value={current}>{current}</option>
        )}
        {dims.length > 0 && measures.length > 0 ? (
          <>
            <optgroup label={t("analytics.charts.builder.dimensions")}>
              {optionsOf(dims)}
            </optgroup>
            <optgroup label={t("analytics.charts.builder.measures")}>
              {optionsOf(measures)}
            </optgroup>
          </>
        ) : (
          optionsOf(options)
        )}
      </select>
    );
  };

  const multi = (
    selected: string[],
    options: ColumnInfo[],
    max: number,
    onSelect: (names: string[]) => void
  ) => (
    <div className="flex flex-wrap gap-1">
      {options.map((c) => {
        const on = selected.includes(c.name);
        return (
          <button
            key={`${c.name}-${c.index}`}
            type="button"
            aria-pressed={on}
            className={chipClass(on)}
            onClick={() => {
              if (on) {
                if (selected.length > 1) {
                  onSelect(selected.filter((n) => n !== c.name));
                } else {
                  setNeedsValue(true);
                }
              } else if (selected.length < max) {
                // Keep the result's column order.
                onSelect(
                  options
                    .map((o) => o.name)
                    .filter((n) => n === c.name || selected.includes(n))
                );
              }
            }}
          >
            {label(c.name)}
          </button>
        );
      })}
    </div>
  );

  const shownTypes = TYPE_ORDER.filter(
    ({ type }) => allowTable || type !== "table"
  );
  const reason = (type: ChartType) => {
    const why = fitsByType[type];
    return why ? t(`analytics.charts.builder.unfit.${why}`) : undefined;
  };
  const typeButtons = (
    <Field label={t("analytics.charts.builder.type")}>
      {(labelId) => (
        <>
          <RadioChips
            options={shownTypes.map((o) => o.type)}
            value={spec.type}
            labelledBy={labelId}
            onChange={(type) => emit(convertSpec(spec, type, result))}
            disabled={(type) => fitsByType[type] !== null && type !== spec.type}
            title={reason}
            render={(type) => {
              const Icon =
                TYPE_ORDER.find((o) => o.type === type)?.Icon ?? ChartBarIcon;
              const why = reason(type);
              return (
                <span className="flex items-center gap-1.5">
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {t(`analytics.charts.types.${type}`)}
                  {why && type !== spec.type && (
                    <span className="sr-only">{`, ${why}`}</span>
                  )}
                </span>
              );
            }}
          />
          {numeric.length === 0 && (
            <p className="text-sm text-gray-600">
              {t("analytics.charts.builder.noNumeric")}
            </p>
          )}
          {(fitsByType[spec.type] !== null || !fits) && (
            <p className="text-sm text-gray-600" role="note">
              {reason(spec.type) ?? t("analytics.charts.builder.notFit")}
            </p>
          )}
        </>
      )}
    </Field>
  );

  const alert = needsValue ? t("analytics.charts.builder.atLeastOne") : "";

  const fields = (() => {
    switch (spec.type) {
      case "table": {
        const all = result.columns.map((c) => c.name);
        const selected = spec.columns?.length ? spec.columns : all;
        return (
          <Field label={t("analytics.charts.builder.columns")} alert={alert}>
            {multi(selected, info, 50, (names) =>
              emit({
                ...spec,
                columns: names.length === all.length ? undefined : names,
              })
            )}
          </Field>
        );
      }
      case "kpi":
        return (
          <Field
            label={t("analytics.charts.builder.y")}
            hint={t("analytics.charts.builder.yHint")}
            alert={alert}
          >
            {multi(
              spec.items.map((i) => i.value),
              numeric,
              6,
              (names) =>
                emit({
                  ...spec,
                  items: names.map(
                    (name) =>
                      spec.items.find((i) => i.value === name) ??
                      (numeric.some((c) => c.name === `${name}_prev`)
                        ? { value: name, compare: `${name}_prev` }
                        : { value: name })
                  ),
                })
            )}
          </Field>
        );
      case "bar":
      case "line":
      case "area": {
        const seriesOptions = info.filter(
          (c) => c.isDimension && c.name !== spec.x
        );
        const valueOptions = numeric.filter((c) => c.name !== spec.x);
        return (
          <>
            <Field label={fieldLabel(keys.x)}>
              {columnSelect(spec.x, info, (x) =>
                emit({
                  ...spec,
                  x,
                  y: spec.y.filter((y) => y !== x).length
                    ? spec.y.filter((y) => y !== x)
                    : spec.y,
                  series: spec.series === x ? undefined : spec.series,
                })
              )}
            </Field>
            <Field
              label={fieldLabel(keys.y)}
              hint={
                spec.series
                  ? t("analytics.charts.builder.yOneHint")
                  : t("analytics.charts.builder.yHint")
              }
              alert={alert}
            >
              {(labelId) =>
                // With a series column, one value only: a single choice.
                spec.series ? (
                  <RadioChips
                    options={valueOptions.map((c) => c.name)}
                    value={spec.y[0]}
                    labelledBy={labelId}
                    onChange={(y) => emit({ ...spec, y: [y] })}
                    render={(name) => label(name)}
                  />
                ) : (
                  multi(spec.y, valueOptions, MAX_SERIES, (y) =>
                    emit({ ...spec, y })
                  )
                )
              }
            </Field>
            <Field label={fieldLabel(keys.series)}>
              {columnSelect(
                spec.series ?? "",
                seriesOptions,
                (name) =>
                  emit({
                    ...spec,
                    series: name || undefined,
                    y: name ? [spec.y[0]] : spec.y,
                    ...(spec.type === "bar" && name ? { stacked: true } : {}),
                  }),
                t("analytics.charts.builder.none")
              )}
            </Field>
            {spec.type === "bar" ? (
              <>
                {(spec.series || spec.y.length > 1) && (
                  <Toggle
                    label={t("analytics.charts.builder.stacked")}
                    on={spec.stacked}
                    onChange={(stacked) => emit({ ...spec, stacked })}
                  />
                )}
                <Toggle
                  label={t("analytics.charts.builder.horizontal")}
                  on={spec.orientation === "horizontal"}
                  onChange={(on) =>
                    emit({
                      ...spec,
                      orientation: on ? "horizontal" : "vertical",
                    })
                  }
                />
                <Field label={t("analytics.charts.builder.sort")}>
                  {(labelId) => (
                    <RadioChips
                      options={["none", "desc", "asc"] as const}
                      value={spec.sort}
                      labelledBy={labelId}
                      onChange={(sort) => emit({ ...spec, sort })}
                      render={(sort) =>
                        t(
                          sort === "none"
                            ? "analytics.charts.builder.sortNone"
                            : sort === "asc"
                              ? "analytics.charts.builder.sortAsc"
                              : "analytics.charts.builder.sortDesc"
                        )
                      }
                    />
                  )}
                </Field>
                <Field label={t("analytics.charts.builder.limit")}>
                  <input
                    className={selectClass}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    placeholder={t("analytics.charts.builder.limitAll")}
                    value={spec.limit ?? ""}
                    onChange={(event) => {
                      const n = Number(event.target.value);
                      if (event.target.value === "")
                        emit({ ...spec, limit: undefined });
                      else if (Number.isInteger(n) && n >= 1 && n <= 100)
                        emit({ ...spec, limit: n });
                    }}
                  />
                </Field>
              </>
            ) : (
              <Toggle
                label={t("analytics.charts.builder.cumulative")}
                on={spec.cumulative}
                onChange={(cumulative) => emit({ ...spec, cumulative })}
              />
            )}
          </>
        );
      }
      case "pie":
        return (
          <>
            <Field label={t("analytics.charts.builder.label")}>
              {columnSelect(spec.label, info, (name) =>
                emit({ ...spec, label: name })
              )}
            </Field>
            <Field label={t("analytics.charts.builder.value")}>
              {columnSelect(spec.value, numeric, (name) =>
                emit({ ...spec, value: name })
              )}
            </Field>
          </>
        );
      case "heatmap":
        return (
          <>
            <Field label={fieldLabel(keys.x)}>
              {columnSelect(spec.x, info, (name) => emit({ ...spec, x: name }))}
            </Field>
            <Field label={fieldLabel(keys.y)}>
              {columnSelect(spec.y, info, (name) => emit({ ...spec, y: name }))}
            </Field>
            <Field label={fieldLabel(keys.series)}>
              {columnSelect(spec.value, numeric, (name) =>
                emit({ ...spec, value: name })
              )}
            </Field>
          </>
        );
      case "calendar":
        return (
          <>
            <Field label={t("analytics.charts.builder.date")}>
              {columnSelect(
                spec.date,
                info.filter((c) => c.kind === "date"),
                (name) => emit({ ...spec, date: name })
              )}
            </Field>
            <Field label={t("analytics.charts.builder.value")}>
              {columnSelect(spec.value, numeric, (name) =>
                emit({ ...spec, value: name })
              )}
            </Field>
          </>
        );
    }
  })();

  const canReset =
    original !== null && JSON.stringify(original) !== JSON.stringify(spec);
  return (
    <div className="flex flex-col gap-4" data-chart-builder="true">
      {typeButtons}
      {fields}
      {canReset && original && (
        <button
          type="button"
          onClick={() => emit(original)}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded px-3 text-sm font-medium text-steel-blue-700 hover:underline"
        >
          <ArrowUturnLeftIcon className="h-5 w-5" aria-hidden="true" />
          {t("analytics.charts.builder.reset")}
        </button>
      )}
    </div>
  );
};
