import {
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import ReactSelectBase from "react-select";
import type { ParamDef } from "../chartSpec";
import type { ParamValue, SqlValue } from "../types";
import { useAnalyticsQuery } from "../engine/useAnalyticsQuery";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { getOutingTypeLabel } from "../../_common/business/outingType.rules";
import { BUILTIN_OUTING_TYPE_CODES } from "../../_common/business/outingType.rules";
import { compareBoatClass } from "../charts/foldSeries";
import { currentSeason, formatSeason, localNow } from "./season";
import { paramLabel } from "./labels";
import type { ParamError } from "./resolveParams";

export { paramLabel };

/**
 * One control per parameter type (plan 1.3 and 2.7), touch first: 44 px
 * targets, segmented buttons for 6 choices or fewer, a searchable list
 * otherwise; numbers and text are applied when the field is left, on
 * Enter, or after a short pause, so that a query does not run at every
 * keystroke.
 */

interface ParamOption {
  value: string;
  label: string;
}

const SEGMENTED_MAX = 6;
const TYPING_DELAY_MS = 700;

/** "Tous les bateaux": the empty value of an optional parameter. */
export const allLabel = (def: ParamDef, t: TFunction): string => {
  const specific = t(`analytics.params.all.${def.name}`, { defaultValue: "" });
  return specific || t("analytics.params.all.default");
};

/** Option labels: literal, else analytics.codes.<param>.<value>. */
export const optionLabel = (
  def: ParamDef,
  option: { value: string; label?: string },
  t: TFunction
): string => {
  if (option.label) return option.label;
  if (option.value === "unknown") return t("analytics.codes.unknown");
  return t(`analytics.codes.${def.name}.${option.value}`, {
    defaultValue: option.value,
  });
};

const formatInteger = (value: number, locale: string) =>
  new Intl.NumberFormat(locale).format(value);

const paramErrorText = (
  error: ParamError,
  t: TFunction,
  locale: string
): string => {
  if (error.code === "required")
    return t("analytics.params.validation.required");
  if (error.code === "range") {
    const min =
      error.min === undefined ? undefined : formatInteger(error.min, locale);
    const max =
      error.max === undefined ? undefined : formatInteger(error.max, locale);
    if (min !== undefined && max !== undefined) {
      return t("analytics.params.validation.range", { min, max });
    }
    if (min !== undefined) return t("analytics.charts.params.min", { min });
    if (max !== undefined) return t("analytics.charts.params.max", { max });
  }
  return t("analytics.charts.params.invalid");
};

/**
 * Step of the − / + buttons of a number (review E 35): `step` when the
 * definition carries one, else a step that suits the parameter (a month
 * for a period, a week for an absence, 5 minutes for a tolerance).
 */
export const paramStep = (def: ParamDef): number => {
  const own = (def as ParamDef & { step?: unknown }).step;
  if (typeof own === "number" && own > 0) return own;
  if (def.labelKey === "analytics.params.periodDays") return 30;
  if (def.labelKey === "analytics.params.absentDays") return 7;
  if (def.name === "tolerance_min") return 5;
  return 1;
};

/** A typed integer brought within min / max, and what was done. */
export const clampInteger = (
  value: number,
  def: Pick<ParamDef, "min" | "max">
): { value: number; clamped: "min" | "max" | null } => {
  if (def.min !== undefined && value < def.min)
    return { value: def.min, clamped: "min" };
  if (def.max !== undefined && value > def.max)
    return { value: def.max, clamped: "max" };
  return { value, clamped: null };
};

const SEASONS_SQL = "SELECT season FROM v_seasons ORDER BY season DESC";

const LOOKUPS: Partial<Record<ParamDef["type"], string>> = {
  boat: "SELECT boat_id, boat_name FROM v_boats WHERE is_archived = 0 ORDER BY lower(boat_name)",
  rower:
    "SELECT rower_id, display_name FROM v_rowers WHERE is_archived = 0 AND is_anonymized = 0 ORDER BY lower(display_name)",
  route:
    "SELECT route_id, route_name FROM v_routes WHERE is_archived = 0 ORDER BY lower(route_name)",
  outing_type:
    "SELECT outing_type_code, custom_label FROM v_outing_types WHERE is_archived = 0 ORDER BY position",
  boat_class:
    "SELECT DISTINCT boat_class FROM v_boats WHERE boat_class IS NOT NULL AND is_archived = 0",
  season: SEASONS_SQL,
};

const text = (value: SqlValue) => (value === null ? "" : String(value));

/** Options of a lookup parameter, read through the analytics engine. */
const useLookupOptions = (def: ParamDef): ParamOption[] | null => {
  const sql = LOOKUPS[def.type] ?? null;
  const startMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const { status, result } = useAnalyticsQuery({
    sql,
    params: {},
    priority: "high",
  });
  return useMemo(() => {
    if (!sql) return null;
    const rows = result?.rows ?? [];
    switch (def.type) {
      case "season": {
        const current = currentSeason(localNow(), startMonth);
        const seasons = new Set<number>([current]);
        for (const [season] of rows)
          if (typeof season === "number") seasons.add(season);
        return [...seasons]
          .sort((a, b) => b - a)
          .map((season) => ({
            value: String(season),
            label: formatSeason(season, startMonth),
          }));
      }
      case "outing_type": {
        if (status === "error" || (status === "success" && rows.length === 0)) {
          return BUILTIN_OUTING_TYPE_CODES.map((code) => ({
            value: code,
            label: getOutingTypeLabel(code),
          }));
        }
        return rows.map(([code, custom]) => ({
          value: text(code),
          label: (BUILTIN_OUTING_TYPE_CODES as readonly string[]).includes(
            text(code)
          )
            ? getOutingTypeLabel(text(code))
            : text(custom) || text(code),
        }));
      }
      case "boat_class":
        return rows
          .map(([boatClass]) => text(boatClass))
          .sort(compareBoatClass)
          .map((value) => ({ value, label: value }));
      default:
        return rows.map(([id, label]) => ({
          value: text(id),
          label: text(label) || text(id),
        }));
    }
  }, [sql, result, status, def.type, startMonth]);
};

const fieldClass =
  "min-h-11 w-full rounded border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-steel-blue-500 focus:ring-steel-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";
/**
 * A native select: the forms plugin draws its chevron in the right
 * padding (2.5rem), which `px-3` would take back, so the text ran under
 * it.
 */
const selectClass =
  "min-h-11 w-full rounded border border-gray-300 bg-white pl-3 pr-10 text-base text-gray-900 focus:border-steel-blue-500 focus:ring-steel-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

/**
 * Choice buttons as a radio group (review E 37): one tab stop, the arrow
 * keys, Home and End move the choice.
 */
const Segmented = ({
  options,
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  options: ParamOption[];
  value: string;
  onChange: (value: string) => void;
  labelledBy: string;
  describedBy?: string;
}) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const focusable = selectedIndex === -1 ? 0 : selectedIndex;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const from = selectedIndex === -1 ? 0 : selectedIndex;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? from === last
          ? 0
          : from + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? from === 0
            ? last
            : from - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex flex-wrap gap-1"
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusable ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`min-h-11 min-w-11 rounded border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-1 ${
              selected
                ? "border-steel-blue-700 bg-steel-blue-700 text-white"
                : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

const SearchSelect = ({
  options,
  value,
  onChange,
  labelledBy,
  loading,
  invalid = false,
  describedBy,
}: {
  options: ParamOption[];
  value: string;
  onChange: (value: string) => void;
  labelledBy: string;
  loading: boolean;
  invalid?: boolean;
  describedBy?: string;
}) => {
  const { t } = useTranslation();
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <ReactSelectBase<ParamOption, false>
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      options={options}
      value={selected}
      isLoading={loading}
      onChange={(option) => onChange(option?.value ?? "")}
      placeholder={t("analytics.charts.params.search")}
      noOptionsMessage={() => t("analytics.charts.params.noOptions")}
      menuPlacement="auto"
      theme={(theme) => ({
        ...theme,
        colors: {
          ...theme.colors,
          // steel-blue-600, -200, -50 (tailwind.config).
          primary: "#2d5f9c",
          primary75: "#6296ce",
          primary50: "#c9d9ee",
          primary25: "#f3f6fc",
        },
      })}
      styles={{
        control: (base, state) => ({
          ...base,
          minHeight: 44,
          borderColor: invalid
            ? "#dc2626"
            : state.isFocused
              ? "#4480c1"
              : "#d1d5db",
        }),
        option: (base) => ({
          ...base,
          minHeight: 44,
          display: "flex",
          alignItems: "center",
        }),
        menu: (base) => ({ ...base, zIndex: 30 }),
      }}
    />
  );
};

/**
 * A text or number field applied on blur, Enter or after a pause. A
 * number is applied after a pause only when it is within its range: on
 * blur or Enter it is brought within it (review E 34).
 */
const DraftInput = ({
  value,
  onCommit,
  type,
  min,
  max,
  labelledBy,
  describedBy,
  invalid = false,
  inRange = () => true,
}: {
  value: string;
  onCommit: (value: string) => void;
  type: "number" | "text";
  min?: number;
  max?: number;
  labelledBy: string;
  describedBy?: string;
  invalid?: boolean;
  /** False while a typed number is out of range: wait for blur or Enter. */
  inRange?: (draft: string) => boolean;
}) => {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  // The parent passes new functions at each render: keep the pause going.
  const latest = useRef({ onCommit, inRange });
  latest.current = { onCommit, inRange };
  useEffect(() => {
    committed.current = value;
    setDraft(value);
  }, [value]);
  useEffect(() => {
    if (draft === committed.current || !latest.current.inRange(draft)) return;
    const timer = setTimeout(() => {
      committed.current = draft;
      latest.current.onCommit(draft);
    }, TYPING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);
  const commit = () => {
    if (draft === committed.current) return;
    committed.current = draft;
    onCommit(draft);
  };
  return (
    <input
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={
        type === "number"
          ? `${fieldClass} min-w-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`
          : fieldClass
      }
      type={type}
      inputMode={type === "number" ? "numeric" : undefined}
      min={min}
      max={max}
      step={type === "number" ? 1 : undefined}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
};

const stepperClass =
  "flex min-h-11 w-11 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-lg font-semibold text-steel-blue-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

/** What happened to the last number typed, shown under the field. */
type IntegerNotice =
  | { kind: "clamped"; bound: "min" | "max"; value: number }
  | { kind: "restored"; value: number }
  | null;

interface ParamInputProps {
  def: ParamDef;
  value: ParamValue | undefined;
  onChange: (value: ParamValue) => void;
  error?: ParamError | null;
  /** Label of the "current" option of a season (Explorer). */
  currentLabel?: string;
  /**
   * The label is given elsewhere (Explorer): the control is labelled by
   * this id and draws no label of its own.
   */
  labelledBy?: string;
}

export const ParamInput = ({
  def,
  value,
  onChange,
  error,
  currentLabel,
  labelledBy,
}: ParamInputProps) => {
  const { t, i18n } = useTranslation();
  const id = useId();
  const labelId = labelledBy ?? `${id}-label`;
  const messageId = `${id}-message`;
  const lookup = useLookupOptions(def);
  const [notice, setNotice] = useState<IntegerNotice>(null);
  const optional = !def.required;
  const current = value === undefined ? def.default : value;
  const currentText =
    current === null || current === undefined ? "" : String(current);
  const invalid = !!error;
  const describedBy = error || notice ? messageId : undefined;

  const control = (() => {
    switch (def.type) {
      case "choice":
      case "boolean":
      case "outing_type":
      case "boat_class":
      case "boat":
      case "rower":
      case "route":
      case "season": {
        let options: ParamOption[];
        if (def.type === "choice") {
          options = (def.options ?? []).map((option) => ({
            value: option.value,
            label: optionLabel(def, option, t),
          }));
        } else if (def.type === "boolean") {
          options = [
            { value: "1", label: t("analytics.common.values.yes") },
            { value: "0", label: t("analytics.common.values.no") },
          ];
        } else {
          options = lookup ?? [];
        }
        let selected = currentText;
        if (def.type === "boolean") {
          selected =
            current === true ||
            current === 1 ||
            current === "1" ||
            current === "true"
              ? "1"
              : current === false ||
                  current === 0 ||
                  current === "0" ||
                  current === "false"
                ? "0"
                : "";
        }
        if (def.type === "season") {
          // "current" follows the season when a new one starts.
          options = [
            {
              value: "current",
              label: currentLabel ?? t("analytics.common.season.current"),
            },
            ...options,
          ];
        }
        if (optional && def.type !== "season") {
          options = [{ value: "", label: allLabel(def, t) }, ...options];
        }
        if (selected && !options.some((o) => o.value === selected)) {
          options = [...options, { value: selected, label: selected }];
        }
        const emit = (next: string) => {
          if (next === "") onChange(null);
          else if (def.type === "boolean") onChange(next === "1");
          else if (def.type === "season" && next !== "current")
            onChange(Number(next));
          else onChange(next);
        };
        const segmented =
          def.type !== "season" &&
          def.type !== "boat" &&
          def.type !== "rower" &&
          def.type !== "route" &&
          options.length <= SEGMENTED_MAX + (optional ? 1 : 0);
        if (segmented) {
          return (
            <Segmented
              options={options}
              value={selected}
              onChange={emit}
              labelledBy={labelId}
              describedBy={describedBy}
            />
          );
        }
        if (def.type === "season" || options.length <= 12) {
          // A required value not chosen yet: an empty first line, so the
          // list does not pretend that its first option is chosen.
          const placeholder =
            selected === "" && !options.some((o) => o.value === "");
          return (
            <select
              aria-labelledby={labelId}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={selectClass}
              value={selected}
              onChange={(event) => emit(event.target.value)}
            >
              {placeholder && (
                <option value="" disabled>
                  —
                </option>
              )}
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          );
        }
        return (
          <SearchSelect
            options={options}
            value={selected}
            onChange={emit}
            labelledBy={labelId}
            describedBy={describedBy}
            invalid={invalid}
            loading={
              lookup === null || (lookup.length === 0 && def.type !== "choice")
            }
          />
        );
      }
      case "date":
        return (
          <input
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={fieldClass}
            type="date"
            value={/^\d{4}-\d{2}-\d{2}$/.test(currentText) ? currentText : ""}
            onChange={(event) => onChange(event.target.value || null)}
          />
        );
      case "integer": {
        const step = paramStep(def);
        const number =
          typeof current === "number"
            ? current
            : currentText.trim() !== "" && Number.isFinite(Number(currentText))
              ? Number(currentText)
              : null;
        const commitNumber = (next: number) => {
          const clamped = clampInteger(next, def);
          setNotice(
            clamped.clamped
              ? {
                  kind: "clamped",
                  bound: clamped.clamped,
                  value: clamped.value,
                }
              : null
          );
          onChange(clamped.value);
        };
        const label = paramLabel(def, t);
        const base =
          number ??
          (typeof def.default === "number" ? def.default : (def.min ?? 0));
        return (
          <div className="flex items-stretch gap-1">
            <button
              type="button"
              className={stepperClass}
              aria-label={t("analytics.params.stepper.decrease", { label })}
              disabled={def.min !== undefined && base <= def.min}
              onClick={() => commitNumber(base - step)}
            >
              −
            </button>
            <DraftInput
              type="number"
              value={currentText}
              min={def.min}
              max={def.max}
              labelledBy={labelId}
              describedBy={describedBy}
              invalid={invalid}
              inRange={(draft) => {
                const parsed = Number(draft.trim());
                return (
                  draft.trim() !== "" &&
                  Number.isInteger(parsed) &&
                  clampInteger(parsed, def).clamped === null
                );
              }}
              onCommit={(next) => {
                const trimmed = next.trim();
                if (trimmed === "") {
                  // An empty required number goes back to its default.
                  if (def.required && typeof def.default === "number") {
                    setNotice({ kind: "restored", value: def.default });
                    onChange(def.default);
                  } else {
                    setNotice(null);
                    onChange(null);
                  }
                  return;
                }
                const parsed = Number(trimmed);
                if (!Number.isFinite(parsed)) {
                  setNotice(null);
                  onChange(trimmed);
                  return;
                }
                commitNumber(Math.round(parsed));
              }}
            />
            <button
              type="button"
              className={stepperClass}
              aria-label={t("analytics.params.stepper.increase", { label })}
              disabled={def.max !== undefined && base >= def.max}
              onClick={() => commitNumber(base + step)}
            >
              +
            </button>
          </div>
        );
      }
      case "text":
        return (
          <DraftInput
            type="text"
            value={currentText}
            labelledBy={labelId}
            describedBy={describedBy}
            invalid={invalid}
            onCommit={(next) => onChange(next.trim() === "" ? null : next)}
          />
        );
    }
  })();

  const noticeText =
    notice === null
      ? null
      : notice.kind === "restored"
        ? t("analytics.params.validation.restored", {
            value: formatInteger(notice.value, i18n.language),
          })
        : t(
            notice.bound === "min"
              ? "analytics.params.validation.clampedMin"
              : "analytics.params.validation.clampedMax",
            { value: formatInteger(notice.value, i18n.language) }
          );

  const wide =
    def.type === "boat" || def.type === "rower" || def.type === "route";
  return (
    <div
      className={`flex flex-col gap-1 ${wide ? "min-w-[14rem] flex-1 max-w-sm" : "min-w-[9rem]"} ${
        def.type === "integer" ? "max-w-[13rem]" : ""
      }`}
      data-param={def.name}
    >
      {!labelledBy && (
        <span
          id={labelId}
          className="text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          {paramLabel(def, t)}
        </span>
      )}
      {control}
      {error ? (
        <span id={messageId} className="text-sm text-error-700" role="alert">
          {paramErrorText(error, t, i18n.language)}
        </span>
      ) : (
        noticeText && (
          <span
            id={messageId}
            className="text-sm text-gray-600 dark:text-gray-300"
            role="status"
          >
            {noticeText}
          </span>
        )
      )}
    </div>
  );
};
