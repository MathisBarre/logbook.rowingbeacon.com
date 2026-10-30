import {
  KeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/outline";
import {
  ANALYTICS_TABS,
  AnalyticsTab,
  useAnalyticsHubStore,
} from "./store/analyticsHub.store";
import {
  useAnalyticsAdmin,
  useAnalyticsAutoLock,
} from "./access/useAnalyticsAdmin";
import { ensureMachineInfo } from "./engine/activePerformance";
import { useAnalyticsQuery } from "./engine/useAnalyticsQuery";
import { HubSeasonSelect } from "./HubSeasonSelect";
import {
  buttonBaseClass,
  DashboardSkeleton,
  DesktopOnlyState,
  LoadingState,
  LockedState,
  NoOutingsState,
  secondaryButtonClass,
} from "./components/AnalyticsStates";
import { HubHeaderSlotContext } from "./dashboard/headerSlot";
import { showReportsCatalog } from "./reportsUi/reportsSession.store";
// Registers the analytics strings with this chunk.
import "./i18n";

/**
 * The Statistiques screen (plan 1.2): one header row (tabs, the open tab's
 * own buttons, season, lock), then the open tab's panel, which scrolls on
 * its own. One lazy chunk per tab.
 */

const PANELS = {
  dashboard: lazy(() =>
    import("./dashboard/DashboardPage").then((m) => ({
      default: m.DashboardPage,
    }))
  ),
  reports: lazy(() =>
    import("./reportsUi/ReportsPage").then((m) => ({ default: m.ReportsPage }))
  ),
  annual: lazy(() =>
    import("./annual/AnnualReportPage").then((m) => ({
      default: m.AnnualReportPage,
    }))
  ),
  explorer: lazy(() =>
    import("./explorer/ExplorerPage").then((m) => ({ default: m.ExplorerPage }))
  ),
} satisfies Record<AnalyticsTab, unknown>;

const HAS_OUTINGS_SQL = "SELECT 1 FROM v_outings LIMIT 1";

/** Tabs sit in a segmented control, unlike the action buttons (review 9). */
const tabClass = (active: boolean) =>
  "min-h-11 px-4 rounded text-sm font-medium flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-1 " +
  (active
    ? "bg-steel-blue-800 text-white"
    : "bg-transparent text-steel-blue-800 hover:bg-gray-100");

/** Unlocked is a state worth seeing: names and edit tools are shown. */
const lockButtonClass = (unlocked: boolean) =>
  unlocked
    ? buttonBaseClass +
      " border border-steel-blue-600 bg-steel-blue-50 text-steel-blue-900 hover:bg-steel-blue-100"
    : secondaryButtonClass;

export const tabId = (tab: AnalyticsTab) => `analytics-tab-${tab}`;
const PANEL_ID = "analytics-panel";

/** The tab that arrow keys, Home and End move to (wrapping), or null. */
export const tabForKey = (
  current: AnalyticsTab,
  key: string
): AnalyticsTab | null => {
  const index = ANALYTICS_TABS.indexOf(current);
  const last = ANALYTICS_TABS.length - 1;
  const next =
    key === "ArrowRight"
      ? index === last
        ? 0
        : index + 1
      : key === "ArrowLeft"
        ? index === 0
          ? last
          : index - 1
        : key === "Home"
          ? 0
          : key === "End"
            ? last
            : null;
  return next === null ? null : ANALYTICS_TABS[next];
};

export const AnalyticsHub = () => {
  const { t } = useTranslation();
  useAnalyticsAutoLock();
  // Leaving the hub locks it: do not keep the Explorer tab for the next
  // member.
  useEffect(() => () => useAnalyticsHubStore.getState().leaveHub(), []);
  // The performance profile "auto" needs the machine (once per launch).
  useEffect(() => {
    void ensureMachineInfo();
  }, []);
  const { isUnlocked, unlock, lock } = useAnalyticsAdmin();
  const tab = useAnalyticsHubStore((state) => state.tab);
  const setTab = useAnalyticsHubStore((state) => state.setTab);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  // The idle lock is silent in the store: say it here (review 6). A lock
  // through the button is not announced.
  const lockedByButton = useRef(false);
  const wasUnlocked = useRef(isUnlocked);
  useEffect(() => {
    if (wasUnlocked.current && !isUnlocked && !lockedByButton.current) {
      toast(t("analytics.common.admin.autoLocked"));
    }
    lockedByButton.current = false;
    wasUnlocked.current = isUnlocked;
  }, [isUnlocked, t]);

  // Hub-level check (plan 1.5): no outing yet → one empty state, no other
  // query. Other errors are left to the panels, which show their own.
  const outings = useAnalyticsQuery({
    sql: HAS_OUTINGS_SQL,
    params: {},
    maxRows: 1,
    priority: "high",
  });
  const desktopOnly = outings.error?.code === "desktop_only";
  const noOutings =
    outings.status === "success" && outings.result?.rows.length === 0;

  const Panel = PANELS[tab];
  const body = desktopOnly ? (
    <DesktopOnlyState />
  ) : noOutings ? (
    <NoOutingsState />
  ) : tab === "explorer" && !isUnlocked ? (
    <LockedState
      onUnlock={() => void unlock()}
      hint={t("analytics.common.admin.lockedExplorerHint")}
    />
  ) : (
    <Suspense
      fallback={tab === "dashboard" ? <DashboardSkeleton /> : <LoadingState />}
    >
      <Panel />
    </Suspense>
  );

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = tabForKey(tab, event.key);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <HubHeaderSlotContext.Provider value={headerSlot}>
      <div className="flex flex-col h-full gap-2 p-3">
        <h1 className="sr-only">{t("analytics.common.hub.title")}</h1>
        <header className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label={t("analytics.common.hub.title")}
            className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm mr-auto"
            onKeyDown={onTabKeyDown}
          >
            {ANALYTICS_TABS.map((id) => (
              <button
                key={id}
                id={tabId(id)}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={PANEL_ID}
                tabIndex={tab === id ? 0 : -1}
                className={tabClass(tab === id)}
                onClick={() => {
                  // "Rapports" again: back to the catalogue.
                  if (id === "reports" && tab === "reports")
                    showReportsCatalog();
                  else setTab(id);
                }}
              >
                {id === "explorer" && !isUnlocked && (
                  <LockClosedIcon className="w-4 h-4" aria-hidden />
                )}
                {t(`analytics.common.tabs.${id}`)}
              </button>
            ))}
          </div>
          {/* The open tab's own buttons (DashboardPage's "Modifier"). */}
          <div ref={setHeaderSlot} className="contents" />
          {!noOutings && !desktopOnly && <HubSeasonSelect />}
          <button
            type="button"
            className={lockButtonClass(isUnlocked)}
            title={
              isUnlocked ? t("analytics.common.admin.autoLock") : undefined
            }
            onClick={() => {
              if (isUnlocked) {
                lockedByButton.current = true;
                lock();
              } else {
                void unlock();
              }
            }}
          >
            {isUnlocked ? (
              <LockOpenIcon className="w-5 h-5" aria-hidden />
            ) : (
              <LockClosedIcon className="w-5 h-5" aria-hidden />
            )}
            {t(
              isUnlocked
                ? "analytics.common.admin.lock"
                : "analytics.common.admin.unlock"
            )}
            {isUnlocked && (
              <span className="sr-only">
                {" "}
                {t("analytics.common.admin.autoLock")}
              </span>
            )}
          </button>
        </header>

        <div
          id={PANEL_ID}
          className="flex-1 min-h-0 overflow-auto -mx-1 px-1 pt-1"
          role="tabpanel"
          aria-labelledby={tabId(tab)}
          data-analytics-scroll
        >
          {body}
        </div>
      </div>
    </HubHeaderSlotContext.Provider>
  );
};
