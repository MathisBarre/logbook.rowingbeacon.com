import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowPathIcon,
  CheckIcon,
  PencilSquareIcon,
  PlusIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../_common/components/Alert";
import { useModulesStore } from "../../_common/store/modules.store";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import {
  DashboardSkeleton,
  ErrorState,
  primaryButtonClass,
  secondaryButtonClass,
} from "../components/AnalyticsStates";
import { AnalyticsError } from "../engine/errors";
import { writeAnalytics } from "../repository/analytics.repository";
import {
  useAnalyticsHubStore,
  useHubSeason,
} from "../store/analyticsHub.store";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import type { ReportDefinition } from "../types";
import {
  availabilityOf,
  loadEngineObjects,
} from "../reportsUi/useReportAvailability";
import { cardTitle, DashboardCard } from "./DashboardCard";
import {
  defaultDashboardItems,
  initialiseDashboardOnce,
  writeDefaultDashboard,
} from "./defaultDashboard";
import { HubHeaderActions } from "./headerSlot";
import type { DashboardEntry } from "./useDashboard";
import { useDashboard, useLoadDashboardWhen } from "./useDashboard";

/** Availability check of the default dashboard, once the engine answered. */
const loadAvailability = async () => {
  const objects = await loadEngineObjects();
  const enabled = useModulesStore.getState().enabled;
  return (report: ReportDefinition) => {
    const availability = availabilityOf(report, objects, enabled);
    return availability !== "pending" && availability.available;
  };
};

const tertiaryButtonClass =
  "min-h-11 px-2 rounded text-sm text-steel-blue-700 underline-offset-2 hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500";

const HIGHLIGHT_MS = 1200;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const cardElement = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-dashboard-item="${CSS.escape(id)}"]`
  );

/**
 * Hub tab "Tableau de bord" (plan 1.3): the pinned cards in a 12-column
 * grid (one column below 1024 px), the default selection written on the
 * first visit, and an edit mode for club officials. "Modifier" lives in
 * the hub header; edit mode has its own sticky bar.
 */
export const DashboardPage = () => {
  const { t } = useTranslation();
  const hubSeason = useHubSeason();
  const { isUnlocked, unlock } = useAnalyticsAdmin();
  const initialised = useAnalyticsSettingsStore((s) => s.dashboardInitialised);
  const { status, entries, controller } = useDashboard();
  const [ready, setReady] = useState(initialised);
  const [editRequested, setEditRequested] = useState(false);
  const editing = editRequested && isUnlocked;
  const [confirmReset, setConfirmReset] = useState(false);
  // After a move: the card to show and announce (review 17).
  const [moved, setMoved] = useState<{ id: string; at: number } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // After a removal: the card whose edit bar takes the focus (review 24).
  const [focusAfterRemove, setFocusAfterRemove] = useState<string | null>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  // A lock (by hand or after 15 minutes) ends edit mode for good: the next
  // unlock does not bring it back (review 23).
  useEffect(() => {
    if (!isUnlocked) setEditRequested(false);
  }, [isUnlocked]);

  useEffect(() => {
    if (useAnalyticsSettingsStore.getState().dashboardInitialised) {
      setReady(true);
      return;
    }
    let alive = true;
    void initialiseDashboardOnce({
      isInitialised: () =>
        useAnalyticsSettingsStore.getState().dashboardInitialised,
      availability: loadAvailability,
      write: writeAnalytics,
      // The flag is written in the same job: only the store is updated.
      onInitialised: () =>
        useAnalyticsSettingsStore.setState({ dashboardInitialised: true }),
    }).finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  useLoadDashboardWhen(controller, ready);

  // The moved card: scrolled into view, ringed for a moment, announced,
  // and its move button keeps the focus.
  useEffect(() => {
    if (!moved) return;
    const index = entries.findIndex((entry) => entry.item.id === moved.id);
    if (index === -1) return;
    const element = cardElement(moved.id);
    element?.scrollIntoView?.({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    if (element && !element.contains(document.activeElement)) {
      element
        .querySelector<HTMLButtonElement>("[data-move]:not([disabled])")
        ?.focus();
    }
    setAnnouncement(
      t("analytics.dashboard.moved", {
        title: cardTitle(entries[index], t),
        position: index + 1,
        total: entries.length,
      })
    );
    setHighlightId(moved.id);
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
    // Once per move, on the order shown right after it.
  }, [moved]);

  useEffect(() => {
    if (focusAfterRemove === null) return;
    const target =
      focusAfterRemove === ""
        ? doneRef.current
        : cardElement(focusAfterRemove)?.querySelector<HTMLButtonElement>(
            "[data-edit-bar] button:not([disabled])"
          );
    target?.focus();
    setFocusAfterRemove(null);
  }, [focusAfterRemove, entries]);

  const moveCard = (entry: DashboardEntry, direction: "up" | "down") => {
    // The order changes at once; the write follows.
    void controller.move(entry.item.id, direction);
    setMoved({ id: entry.item.id, at: Date.now() });
  };

  // "Retirer" acts at once; the toast offers to put the card back.
  const removeCard = async (entry: DashboardEntry) => {
    const index = entries.findIndex((e) => e.item.id === entry.item.id);
    const neighbour = entries[index + 1] ?? entries[index - 1];
    const removal = controller.remove(entry.item.id);
    setFocusAfterRemove(neighbour ? neighbour.item.id : "");
    if (!(await removal)) return;
    toast(t("analytics.dashboard.removed", { title: cardTitle(entry, t) }), {
      duration: 10_000,
      action: {
        label: t("analytics.dashboard.undo"),
        onClick: () => void controller.restore(entry),
      },
    });
  };

  const askReset = () => {
    void unlock().then((granted) => granted && setConfirmReset(true));
  };

  const reset = async () => {
    setConfirmReset(false);
    const items = defaultDashboardItems(await loadAvailability());
    const ok = await writeAnalytics("dashboard reset", (db) =>
      writeDefaultDashboard(db, items)
    );
    if (ok) useAnalyticsSettingsStore.setState({ dashboardInitialised: true });
    await controller.load();
  };

  const goToReports = () => useAnalyticsHubStore.getState().setTab("reports");

  if (!ready || (status === "loading" && entries.length === 0)) {
    return <DashboardSkeleton />;
  }

  if (status === "error" && entries.length === 0) {
    return (
      <ErrorState
        error={
          new AnalyticsError({
            code: "internal",
            message: "the dashboard could not be read",
          })
        }
        message={t("analytics.dashboard.loadError")}
        onRetry={() => void controller.load()}
      />
    );
  }

  // Built from the alert parts: SimpleAlertDialog's Cancel and Action
  // drop `asChild` and would nest our buttons in theirs.
  const resetDialog = (
    <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("analytics.dashboard.reset")}</AlertDialogTitle>
          <AlertDialogDescription>
            {entries.length === 0
              ? t("analytics.dashboard.resetConfirmEmpty")
              : t("analytics.dashboard.resetConfirm", {
                  count: entries.length,
                })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button
            type="button"
            className={secondaryButtonClass + " px-4"}
            onClick={() => setConfirmReset(false)}
          >
            {t("analytics.common.actions.cancel")}
          </button>
          <button
            type="button"
            className={
              primaryButtonClass + " px-4 !bg-error-700 hover:!bg-error-800"
            }
            onClick={() => void reset()}
          >
            {t("analytics.dashboard.resetAction")}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="flex flex-col gap-4 pb-6">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {!editing && entries.length > 0 && (
        <HubHeaderActions>
          <button
            type="button"
            className={secondaryButtonClass}
            aria-label={t("analytics.dashboard.edit")}
            title={t("analytics.dashboard.edit")}
            onClick={() => {
              void unlock().then(
                (granted) => granted && setEditRequested(true)
              );
            }}
          >
            <PencilSquareIcon className="w-4 h-4" aria-hidden />
            {t("analytics.dashboard.editShort")}
          </button>
        </HubHeaderActions>
      )}

      {editing && (
        // The page colour behind the bar hides the cards scrolling under
        // its rounded corners and the panel's top padding.
        <div className="sticky -top-1 z-10 -mx-1 -mt-1 bg-gray-100 px-1 pt-1 pb-1">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-steel-blue-200 bg-steel-blue-50 p-2 shadow-sm">
            <p className="flex-1 min-w-[16rem] px-2 text-sm text-steel-blue-900">
              {t("analytics.dashboard.editingHint")}
            </p>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={goToReports}
            >
              <PlusIcon className="w-4 h-4" aria-hidden />
              {t("analytics.dashboard.addCard")}
            </button>
            <button
              ref={doneRef}
              type="button"
              className={primaryButtonClass + " px-4"}
              onClick={() => setEditRequested(false)}
            >
              <CheckIcon className="w-5 h-5" aria-hidden />
              {t("analytics.dashboard.done")}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <Squares2X2Icon
            className="w-10 h-10 text-steel-blue-300"
            aria-hidden
          />
          <p className="text-base font-semibold text-gray-900">
            {t("analytics.dashboard.emptyTitle")}
          </p>
          <p className="text-sm text-gray-700 max-w-md text-balance">
            {t("analytics.dashboard.empty")}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button
              type="button"
              className={primaryButtonClass + " px-4"}
              onClick={goToReports}
            >
              {t("analytics.dashboard.browseReports")}
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={askReset}
            >
              <ArrowPathIcon className="w-4 h-4" aria-hidden />
              {t("analytics.dashboard.reset")}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {entries.map((entry, index) => (
            <DashboardCard
              key={entry.item.id}
              entry={entry}
              hubSeason={hubSeason}
              editing={editing}
              isFirst={index === 0}
              isLast={index === entries.length - 1}
              highlighted={highlightId === entry.item.id}
              actions={{
                onMove: (direction) => moveCard(entry, direction),
                onResize: (size) => void controller.resize(entry.item.id, size),
                onRemove: () => void removeCard(entry),
              }}
            />
          ))}
          {editing && (
            <button
              type="button"
              className="col-span-12 lg:col-span-6 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-6 text-center text-sm text-gray-700 hover:border-steel-blue-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
              onClick={goToReports}
            >
              <PlusIcon className="w-6 h-6 text-steel-blue-700" aria-hidden />
              <span className="font-medium text-steel-blue-800">
                {t("analytics.dashboard.addCard")}
              </span>
              <span className="max-w-xs text-balance">
                {t("analytics.dashboard.addCardHint")}
              </span>
            </button>
          )}
        </div>
      )}

      {editing && entries.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className={tertiaryButtonClass}
            onClick={askReset}
          >
            <ArrowPathIcon className="w-4 h-4" aria-hidden />
            {t("analytics.dashboard.reset")}
          </button>
        </div>
      )}

      {resetDialog}
    </div>
  );
};
