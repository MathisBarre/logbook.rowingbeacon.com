import { ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ExclamationTriangleIcon,
  LockClosedIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { SimpleDialog } from "../../_common/components/SimpleDialog";
import type { SqlClient } from "../../_common/database/sqlClient";
import {
  getQuery,
  listDashboardItems,
  MAIN_DASHBOARD,
  readAnalytics,
  saveDashboardItem,
  saveQuery,
  writeAnalytics,
} from "../repository/analytics.repository";
import { dashboardAudience, queryVisibility } from "../access/canSee";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "../components/AnalyticsStates";
import { getReport } from "../reports/catalog";
import { paramsSummary, reportTitle } from "../reportsUi/reportHelpers";
import {
  useAnalyticsHubStore,
  useHubSeason,
} from "../store/analyticsHub.store";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import { formatSeason } from "../params/season";
import type {
  ChartSpec,
  DashboardItem,
  DashboardItemSize,
  ParamDef,
  ParamValue,
  ReportVisibility,
  SavedQuery,
} from "../types";
import type { PinSource } from "./PinButton";

/**
 * The pin dialog (plan 1.4): follow the hub season or keep the shown one,
 * the card size, and a title when an unsaved query is pinned (it is saved
 * first).
 */

export const DASHBOARD_SIZES: DashboardItemSize[] = ["third", "half", "full"];

/** Sizes offered for a chart: key figures need half or full (review 18). */
export const sizeOptions = (spec: ChartSpec | null): DashboardItemSize[] =>
  spec?.type === "kpi"
    ? DASHBOARD_SIZES.filter((size) => size !== "third")
    : DASHBOARD_SIZES;

/** True when the dashboard already holds a card of this report or query. */
export const isAlreadyPinned = (
  source: PinSource,
  items: Pick<DashboardItem, "source">[]
): boolean =>
  items.some((item) =>
    source.kind === "report"
      ? item.source.kind === "report" &&
        item.source.reportId === source.reportId
      : !!source.queryId &&
        item.source.kind === "query" &&
        item.source.queryId === source.queryId
  );

interface PinRequest {
  source: PinSource;
  paramValues: Record<string, ParamValue>;
  chartOverride: ChartSpec | null;
  size: DashboardItemSize;
  /** Season parameters: null follows the hub, a number fixes it. */
  season: number | null;
  seasonParams: string[];
  /** Title of an unsaved query (required for a draft). */
  title?: string;
  /** Called as soon as the draft is stored, before the item is added. */
  onQuerySaved?: (query: SavedQuery) => void;
}

/**
 * Saves the draft query if any, then adds the item at the end. Resolves
 * with the item id and the query saved from the draft (null otherwise).
 */
export const savePin = async (
  db: SqlClient,
  request: PinRequest
): Promise<{ itemId: string; savedQuery: SavedQuery | null }> => {
  const paramValues: Record<string, ParamValue> = {
    ...request.paramValues,
  };
  for (const name of request.seasonParams) {
    if (request.season === null) delete paramValues[name];
    else paramValues[name] = request.season;
  }
  const { source } = request;
  let savedQuery: SavedQuery | null = null;
  let itemSource:
    | { kind: "report"; reportId: string }
    | { kind: "query"; queryId: string };
  if (source.kind === "report") {
    itemSource = source;
  } else if (source.queryId) {
    itemSource = { kind: "query", queryId: source.queryId };
  } else if (source.draft) {
    const title = (request.title ?? source.draft.title).trim();
    if (!title) throw new Error("A pinned query needs a title");
    savedQuery = await saveQuery(db, {
      title,
      description: source.draft.description ?? null,
      sql: source.draft.sql,
      params: source.draft.params,
      chart: source.draft.chart,
      origin: source.draft.origin ?? "user",
      basedOnReportId: source.draft.basedOnReportId ?? null,
    });
    request.onQuerySaved?.(savedQuery);
    itemSource = { kind: "query", queryId: savedQuery.id };
  } else {
    throw new Error("Nothing to pin");
  }
  const itemId = await saveDashboardItem(db, {
    source: itemSource,
    size: request.size,
    paramValues,
    chartOverride: request.chartOverride,
  });
  return { itemId, savedQuery };
};

/** One choice of a radio group, drawn as a card (review 33). */
const RadioCard = ({
  name,
  checked,
  onChange,
  label,
  hint,
  center = false,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  hint?: string;
  center?: boolean;
}) => (
  <label className="block cursor-pointer">
    <input
      type="radio"
      name={name}
      className="peer sr-only"
      checked={checked}
      onChange={onChange}
    />
    <span
      className={
        "flex h-full min-h-11 gap-3 rounded border border-gray-300 bg-white p-3 text-sm text-gray-800 hover:bg-gray-50 peer-checked:border-steel-blue-700 peer-checked:bg-steel-blue-50 peer-checked:ring-1 peer-checked:ring-steel-blue-700 peer-focus-visible:ring-2 peer-focus-visible:ring-steel-blue-500 peer-focus-visible:ring-offset-1 " +
        (center ? "flex-col items-center text-center" : "items-start")
      }
    >
      {checked ? (
        <CheckCircleIcon
          className={
            "h-5 w-5 shrink-0 text-steel-blue-700" + (center ? " hidden" : "")
          }
          aria-hidden
        />
      ) : (
        <span
          className={
            "h-5 w-5 shrink-0 rounded-full border-2 border-gray-300" +
            (center ? " hidden" : "")
          }
          aria-hidden
        />
      )}
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-gray-900">{label}</span>
        {hint && <span className="text-gray-600">{hint}</span>}
      </span>
    </span>
  </label>
);

const SIZE_FILL: Record<DashboardItemSize, string> = {
  third: "w-1/3",
  half: "w-1/2",
  full: "w-full",
};

/** A 48 × 12 strip filled a third, a half or all the way. */
const SizeSchematic = ({ size }: { size: DashboardItemSize }) => (
  <span
    className="flex h-3 w-12 overflow-hidden rounded-sm bg-gray-200"
    aria-hidden
  >
    <span className={"h-full bg-steel-blue-300 " + SIZE_FILL[size]} />
  </span>
);

interface PinnedInfo {
  defs: ParamDef[];
  visibility: ReportVisibility;
  /** True for a query that does not keep a report's visibility. */
  queryOnly: boolean;
}

/**
 * Parameters and visibility of what is pinned (plan 1.4, ADR 0008): a
 * report's own; a query keeps the visibility of the report it comes from
 * while its SQL is unchanged, else it is for officials only.
 */
export const pinnedInfo = (
  source: PinSource,
  stored: {
    sql: string;
    basedOnReportId: string | null;
    params: ParamDef[];
  } | null
): PinnedInfo | null => {
  if (source.kind === "report") {
    const report = getReport(source.reportId);
    return {
      defs: report?.params ?? [],
      visibility: report?.visibility ?? "admin",
      queryOnly: false,
    };
  }
  const query = source.draft
    ? {
        sql: source.draft.sql,
        basedOnReportId: source.draft.basedOnReportId ?? null,
        params: source.draft.params,
      }
    : stored;
  if (!query) return null;
  const basedOn = query.basedOnReportId
    ? getReport(query.basedOnReportId)
    : undefined;
  const visibility = queryVisibility(query, basedOn);
  return {
    defs: query.params,
    visibility,
    // Locked because it is a query, not because its report is.
    queryOnly: visibility === "admin" && basedOn?.visibility !== "admin",
  };
};

/**
 * What is pinned; a saved query is read once (info null until then), with
 * its title for the dialog's subtitle.
 */
const usePinnedInfo = (
  source: PinSource,
  open: boolean
): {
  info: PinnedInfo | null;
  storedTitle: string | null;
  storedChart: ChartSpec | null;
} => {
  const [stored, setStored] = useState<SavedQuery | null | "failed">(null);
  const queryId =
    source.kind === "query" && !source.draft ? source.queryId : undefined;
  useEffect(() => {
    if (!open || !queryId) return;
    let alive = true;
    void readAnalytics((db) => getQuery(db, queryId)).then(
      (query) => alive && setStored(query ?? "failed"),
      () => alive && setStored("failed")
    );
    return () => {
      alive = false;
    };
  }, [open, queryId]);
  if (queryId && stored === "failed") {
    // Unreadable: pin it as an officials-only card without parameters.
    return {
      info: { defs: [], visibility: "admin", queryOnly: true },
      storedTitle: null,
      storedChart: null,
    };
  }
  const query = stored === "failed" ? null : stored;
  return {
    info: pinnedInfo(source, query),
    storedTitle: query?.title ?? null,
    storedChart: query?.chart ?? null,
  };
};

/** True once the dashboard was read and holds this source (review 34). */
const useAlreadyPinned = (source: PinSource, open: boolean): boolean => {
  const [already, setAlready] = useState(false);
  const key =
    source.kind === "report"
      ? `report:${source.reportId}`
      : `query:${source.queryId ?? ""}`;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void readAnalytics((db) => listDashboardItems(db, MAIN_DASHBOARD)).then(
      (items) => alive && setAlready(isAlreadyPinned(source, items)),
      // Unreadable: no warning, the pin itself still works.
      () => undefined
    );
    return () => {
      alive = false;
    };
    // `key` stands for the source.
  }, [open, key]);
  return already;
};

/** Who will see the card: "Visible par tous au hangar" or officials. */
export const AudienceNote = ({
  info,
  publicRankings,
}: {
  info: PinnedInfo;
  publicRankings: boolean;
}) => {
  const { t } = useTranslation();
  const audience = dashboardAudience(info.visibility, publicRankings);
  const Icon = audience === "everyone" ? UserGroupIcon : LockClosedIcon;
  return (
    <div
      className="flex items-start gap-3 rounded border border-steel-blue-100 bg-steel-blue-50 p-3 text-sm text-steel-blue-950"
      data-audience={audience}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          {t(`analytics.dashboard.pin.audience.${audience}`)}
        </p>
        <p>
          {audience === "everyone"
            ? t(
                info.visibility === "nominative"
                  ? "analytics.dashboard.pin.audience.everyoneRankingsHint"
                  : "analytics.dashboard.pin.audience.everyoneHint"
              )
            : t("analytics.dashboard.pin.audience.officialsHint")}
        </p>
        {audience === "officials" && info.queryOnly && (
          <p>{t("analytics.dashboard.pin.audience.queryHint")}</p>
        )}
      </div>
    </div>
  );
};

export const PinDialog = ({
  open,
  onOpenChange,
  source,
  paramValues,
  chartOverride,
  onDraftSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: PinSource;
  paramValues: Record<string, ParamValue>;
  chartOverride: ChartSpec | null;
  onDraftSaved?: (query: SavedQuery) => void;
}) => {
  const { t, i18n } = useTranslation();
  const { unlock } = useAnalyticsAdmin();
  const hubSeason = useHubSeason();
  const startMonth = useAnalyticsSettingsStore((s) => s.seasonStartMonth);
  const publicRankings = useAnalyticsSettingsStore((s) => s.publicRankings);
  const { info, storedTitle, storedChart } = usePinnedInfo(source, open);
  const alreadyPinned = useAlreadyPinned(source, open);
  const radioName = useId();
  // The season choice needs the definitions: no pin before they are read.
  const loading = info === null;
  const defs = info?.defs ?? [];
  const seasonParams = defs
    .filter((def) => def.type === "season")
    .map((def) => def.name);
  const shown = seasonParams
    .map((name) => paramValues[name])
    .find((value): value is number => typeof value === "number");
  const shownSeason = shown ?? hubSeason;
  const chart =
    chartOverride ??
    (source.kind === "report" ? getReport(source.reportId)?.chart : null) ??
    (source.kind === "query" ? (source.draft?.chart ?? storedChart) : null);
  const sizes = sizeOptions(chart ?? null);

  // Mounted when the dialog opens (PinButton), so the state starts fresh.
  const [followSeason, setFollowSeason] = useState(true);
  const [chosenSize, setSize] = useState<DashboardItemSize>(
    chart?.type === "kpi" ? "full" : "half"
  );
  // A stored query read late can turn out to be key figures.
  const size = sizes.includes(chosenSize) ? chosenSize : "half";
  const [title, setTitle] = useState(
    source.kind === "query" ? (source.draft?.title ?? "") : ""
  );
  const [saving, setSaving] = useState(false);
  const isDraft = source.kind === "query" && !source.queryId && !!source.draft;

  const titleMissing = isDraft && title.trim() === "";

  // What is pinned, and the choices that go with it (review 32).
  const pinnedTitle =
    source.kind === "report"
      ? reportTitle(source.reportId, t)
      : isDraft
        ? title.trim()
        : (storedTitle ?? source.draft?.title ?? "");
  const choices = paramsSummary(
    defs.filter((def) => def.type !== "season"),
    paramValues,
    { t, locale: i18n.language, seasonStartMonth: startMonth }
  );
  const subtitle = [pinnedTitle, choices].filter(Boolean).join(" · ");

  const confirm = async () => {
    if (titleMissing || saving || loading) return;
    setSaving(true);
    // The hub may have locked itself while the dialog was open.
    if (!(await unlock())) {
      setSaving(false);
      return;
    }
    // On failure the write queue logs the error and shows its toast.
    let savedQuery: SavedQuery | null = null;
    const ok = await writeAnalytics("pin", (db) =>
      savePin(db, {
        source,
        paramValues,
        chartOverride,
        size,
        season: followSeason ? null : shownSeason,
        seasonParams,
        title,
        onQuerySaved: (query) => {
          savedQuery = query;
        },
      })
    );
    setSaving(false);
    if (savedQuery) onDraftSaved?.(savedQuery);
    if (ok) {
      toast.success(
        t("analytics.dashboard.pin.done", {
          title: pinnedTitle || t("analytics.dashboard.title"),
        }),
        {
          action: {
            label: t("analytics.dashboard.pin.view"),
            onClick: () => useAnalyticsHubStore.getState().setTab("dashboard"),
          },
        }
      );
      onOpenChange(false);
    }
  };

  return (
    <SimpleDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("analytics.dashboard.pin.title")}
      subtitle={subtitle || undefined}
      className="w-[36rem]"
      modal
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        {isDraft && (
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-800">
            {t("analytics.dashboard.pin.queryTitle")}
            <input
              type="text"
              className="min-h-11 rounded border border-gray-300 px-3 text-base font-normal"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={titleMissing}
            />
            {titleMissing && (
              <span className="text-xs font-normal text-error-700">
                {t("analytics.dashboard.pin.titleRequired")}
              </span>
            )}
          </label>
        )}

        {seasonParams.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-gray-800 mb-1">
              {t("analytics.common.season.label")}
            </legend>
            <RadioCard
              name={`${radioName}-season`}
              checked={followSeason}
              onChange={() => setFollowSeason(true)}
              label={t("analytics.dashboard.pin.followSeason")}
              hint={t("analytics.dashboard.pin.followSeasonHint")}
            />
            <RadioCard
              name={`${radioName}-season`}
              checked={!followSeason}
              onChange={() => setFollowSeason(false)}
              label={t("analytics.dashboard.pin.fixedSeason", {
                season: formatSeason(shownSeason, startMonth),
              })}
              hint={t("analytics.dashboard.pin.fixedSeasonHint")}
            />
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-800 mb-1">
            {t("analytics.dashboard.pin.size")}
          </legend>
          <div
            className={
              "grid gap-2 " +
              (sizes.length === 3 ? "grid-cols-3" : "grid-cols-2")
            }
          >
            {sizes.map((option) => (
              <RadioCard
                key={option}
                name={`${radioName}-size`}
                checked={size === option}
                onChange={() => setSize(option)}
                center
                label={
                  <span className="flex flex-col items-center gap-2">
                    <SizeSchematic size={option} />
                    {t(`analytics.dashboard.sizes.${option}`)}
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>

        {info && <AudienceNote info={info} publicRankings={publicRankings} />}

        {chartOverride && (
          <p className="text-sm text-gray-600">
            {t("analytics.dashboard.pin.customised")}
          </p>
        )}

        {alreadyPinned && (
          <p className="flex items-start gap-2 text-sm text-yellow-800">
            <ExclamationTriangleIcon
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden
            />
            {t(
              source.kind === "report"
                ? "analytics.dashboard.pin.alreadyPinned"
                : "analytics.dashboard.pin.alreadyPinnedQuery"
            )}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={secondaryButtonClass + " px-4"}
            onClick={() => onOpenChange(false)}
          >
            {t("analytics.common.actions.cancel")}
          </button>
          <button
            type="submit"
            disabled={titleMissing || saving || loading}
            aria-busy={loading}
            className={primaryButtonClass + " px-4"}
          >
            {t("analytics.dashboard.pin.confirm")}
          </button>
        </div>
      </form>
    </SimpleDialog>
  );
};
