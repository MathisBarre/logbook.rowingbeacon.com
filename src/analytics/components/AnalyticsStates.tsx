import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownTrayIcon,
  ChartBarIcon,
  ComputerDesktopIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import useNavigationStore from "../../_common/store/navigation.store";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import { requestParametersPage } from "../reportsUi/parametersRequest";
import { AnalyticsError, formatAnalyticsError } from "../engine/errors";
import type { QueryResult } from "../types";
import { columnLabel } from "../charts/format";

/**
 * The states every analytics view renders (plan 1.5). Shared by the hub
 * and the packages: render them instead of writing new ones.
 */

/** Size, shape and focus ring shared by the hub's buttons (review 40). */
export const buttonBaseClass =
  "min-h-11 min-w-11 px-3 rounded text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-1";

/** The one secondary button of the hub: white, grey border. */
export const secondaryButtonClass =
  buttonBaseClass +
  " border border-gray-300 bg-white text-steel-blue-800 hover:bg-gray-50";

/** The primary button of the hub: filled steel blue. */
export const primaryButtonClass =
  buttonBaseClass + " bg-steel-blue-700 text-white hover:bg-steel-blue-800";

const buttonClass = secondaryButtonClass;

const Centered = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-3 p-6 text-center h-full">
    {children}
  </div>
);

/** Skeleton; after 1.5 s (`isSlow`) the message and the stop button. */
export const LoadingState = ({
  isSlow = false,
  heavy = false,
  onStop,
  height = 160,
}: {
  isSlow?: boolean;
  heavy?: boolean;
  onStop?: () => void;
  height?: number;
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="relative w-full rounded bg-gray-100 animate-pulse motion-reduce:animate-none"
      style={{ minHeight: height }}
      aria-busy="true"
    >
      {!isSlow && (
        <span className="sr-only">{t("analytics.common.states.loading")}</span>
      )}
      {isSlow && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-gray-700">
            {t(
              heavy
                ? "analytics.common.states.loadingHeavy"
                : "analytics.common.states.loading"
            )}
          </p>
          {onStop && (
            <button type="button" className={buttonClass} onClick={onStop}>
              {t("analytics.common.actions.stop")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The dashboard's placeholder: the key figures row, then two half cards.
 * Used by the hub while the tab's chunk loads and by the dashboard while
 * its cards are read, so the page keeps one shape (review 30).
 */
export const DashboardSkeleton = () => (
  <div className="grid grid-cols-12 gap-4" aria-busy="true">
    <div className="col-span-12">
      <LoadingState height={140} />
    </div>
    <div className="col-span-12 lg:col-span-6">
      <LoadingState height={260} />
    </div>
    <div className="col-span-12 lg:col-span-6">
      <LoadingState height={260} />
    </div>
  </div>
);

/** 0 rows, or all values null. */
export const EmptyState = ({ hint }: { hint?: ReactNode }) => {
  const { t } = useTranslation();
  return (
    <Centered>
      <p className="text-sm text-gray-600">
        {t("analytics.common.states.empty")}
      </p>
      {hint && <div className="text-sm text-gray-500">{hint}</div>}
    </Centered>
  );
};

/** An engine error, with "Réessayer". */
export const ErrorState = ({
  error,
  message,
  onRetry,
}: {
  error: AnalyticsError;
  /** Replaces the engine's message (an error outside the engine). */
  message?: string;
  onRetry?: () => void;
}) => {
  const { t } = useTranslation();
  if (error.code === "desktop_only") {
    return <DesktopOnlyState />;
  }
  return (
    <Centered>
      <ExclamationTriangleIcon className="w-8 h-8 text-error-600" aria-hidden />
      <p className="text-sm text-error-700 max-w-prose" role="alert">
        {message ?? formatAnalyticsError(error, t)}
      </p>
      {onRetry && (
        <button type="button" className={buttonClass} onClick={onRetry}>
          {t("analytics.common.actions.retry")}
        </button>
      )}
    </Centered>
  );
};

/** A report or a tab that needs the admin password. */
export const LockedState = ({
  onUnlock,
  hint,
}: {
  onUnlock: () => void;
  /** Replaces "… pour voir ce rapport" (the Explorer tab). */
  hint?: string;
}) => {
  const { t } = useTranslation();
  return (
    <Centered>
      <LockClosedIcon className="w-8 h-8 text-steel-blue-700" aria-hidden />
      <p className="font-semibold text-gray-900">
        {t("analytics.common.admin.locked")}
      </p>
      <p className="text-sm text-gray-600">
        {hint ?? t("analytics.common.admin.lockedHint")}
      </p>
      <button type="button" className={buttonClass} onClick={onUnlock}>
        {t("analytics.common.admin.unlock")}
      </button>
    </Centered>
  );
};

/** Outside the installed app (plain browser). */
export const DesktopOnlyState = () => {
  const { t } = useTranslation();
  return (
    <Centered>
      <ComputerDesktopIcon className="w-8 h-8 text-gray-500" aria-hidden />
      <p className="text-sm text-gray-700">
        {t("analytics.common.states.desktopOnly")}
      </p>
    </Centered>
  );
};

/**
 * Hub-level empty state: the club has no outing yet. "Importer un
 * historique efa2" asks the password, then opens Gestion › Données.
 */
export const NoOutingsState = () => {
  const { t } = useTranslation();
  const { unlock } = useAnalyticsAdmin();
  return (
    <Centered>
      <ChartBarIcon className="w-12 h-12 text-steel-blue-300" aria-hidden />
      <p className="text-xl font-semibold text-gray-900">
        {t("analytics.common.states.noOutingsTitle")}
      </p>
      <p className="text-sm text-gray-600 max-w-md text-balance">
        {t("analytics.common.states.noOutingsBody")}
      </p>
      <button
        type="button"
        className={primaryButtonClass + " px-4"}
        onClick={() => {
          void unlock().then((granted) => {
            if (!granted) return;
            requestParametersPage("data");
            useNavigationStore.getState().setPage("parameters");
          });
        }}
      >
        <ArrowDownTrayIcon className="w-5 h-5" aria-hidden />
        {t("analytics.common.states.importEfa2")}
      </button>
    </Centered>
  );
};

/** Truncated result and hidden personal columns notices. */
/** Intl.ListFormat, missing from the TypeScript lib this app targets. */
type ListFormatConstructor = new (
  locale: string,
  options: { style: "long"; type: "conjunction" }
) => { format: (items: string[]) => string };

/** "a, b et c" in the reader's language (Intl.ListFormat when available). */
export const joinList = (items: string[], locale: string): string => {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatConstructor })
    .ListFormat;
  if (!ListFormat) return items.join(", ");
  try {
    return new ListFormat(locale, {
      style: "long",
      type: "conjunction",
    }).format(items);
  } catch {
    return items.join(", ");
  }
};

export const ResultNotices = ({ result }: { result: QueryResult }) => {
  const { t, i18n } = useTranslation();
  if (!result.truncated && result.ignoredColumns.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 text-xs text-gray-600">
      {result.truncated && (
        <p>
          {t("analytics.common.states.truncated", {
            count: result.rows.length,
          })}
        </p>
      )}
      {result.ignoredColumns.length > 0 && (
        <p>
          {t("analytics.common.states.hiddenColumns", {
            columns: joinList(
              result.ignoredColumns.map((column) => columnLabel(column, t)),
              i18n.language
            ),
          })}
        </p>
      )}
    </div>
  );
};
