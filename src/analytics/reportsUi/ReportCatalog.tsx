import { ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRightIcon,
  ClockIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { canSeeReport } from "../access/canSee";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import { secondaryButtonClass } from "../components/AnalyticsStates";
import { getReportsByCategory } from "../reports/catalog";
import { useAnalyticsHubStore } from "../store/analyticsHub.store";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import type { ReportCategory, ReportDefinition } from "../types";
import { splitDescription } from "./reportDisplay";
import { matchesSearch, reportDescription, reportTitle } from "./reportHelpers";
import {
  cannotEverRun,
  EnableModuleButton,
  useUnavailableReason,
} from "./UnavailableReport";
import {
  AvailabilityState,
  useReportAvailability,
} from "./useReportAvailability";

/**
 * The report catalogue (plan 1.3): theme chips and a search above one
 * card per report, grouped by theme. A card shows the title and the
 * question the report answers; badges say when it shows names, is for
 * officials (with a padlock while locked) or takes long. A report whose
 * module is off is greyed with the way to turn it on; one whose data this
 * version does not record is not listed.
 */

/** Every badge in the same light style (review D 31). */
const Badge = ({ icon, label }: { icon: ReactNode; label: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-steel-blue-100 px-2 py-0.5 text-xs font-medium text-steel-blue-900">
    {icon}
    {label}
  </span>
);

export const ReportBadges = ({
  report,
  locked = false,
  showCost = true,
}: {
  report: ReportDefinition;
  /** The viewer may not open it yet: the padlock replaces the icon. */
  locked?: boolean;
  /** "Calcul long" is for the catalogue, not the report page (B 8). */
  showCost?: boolean;
}) => {
  const { t } = useTranslation();
  const lockIcon = <LockClosedIcon className="w-3.5 h-3.5" aria-hidden />;
  return (
    <span className="flex flex-wrap gap-1">
      {report.visibility === "nominative" && (
        <Badge
          icon={
            locked ? (
              lockIcon
            ) : (
              <UserGroupIcon className="w-3.5 h-3.5" aria-hidden />
            )
          }
          label={t("analytics.common.badges.nominative")}
        />
      )}
      {report.visibility === "admin" && (
        <Badge icon={lockIcon} label={t("analytics.common.badges.admin")} />
      )}
      {showCost && report.cost === "heavy" && (
        <Badge
          icon={<ClockIcon className="w-3.5 h-3.5" aria-hidden />}
          label={t("analytics.common.badges.heavy")}
        />
      )}
    </span>
  );
};

/** The question of a report, for its card (D 25). */
export const reportQuestion = (
  reportId: string,
  t: Parameters<typeof reportDescription>[1]
) => splitDescription(reportDescription(reportId, t)).question;

const ReportCard = ({
  report,
  availability,
  locked,
  onOpen,
}: {
  report: ReportDefinition;
  availability: AvailabilityState;
  locked: boolean;
  onOpen: (reportId: string) => void;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const reason = useUnavailableReason();
  const title = reportTitle(report.id, t);
  const question = reportQuestion(report.id, t);
  if (availability !== "pending" && !availability.available) {
    return (
      <li
        className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4"
        data-report={report.id}
        data-unavailable
      >
        <span className="font-semibold text-gray-600">{title}</span>
        {question && <span className="text-sm text-gray-600">{question}</span>}
        <span className="text-sm text-gray-700">{reason(availability)}</span>
        {availability.reason === "module" && (
          <span>
            <EnableModuleButton module={availability.module} />
          </span>
        )}
      </li>
    );
  }
  return (
    <li data-report={report.id}>
      <button
        type="button"
        className="group flex h-full min-h-[4.5rem] w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-steel-blue-300 hover:bg-steel-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-blue-500"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-question${locked ? ` ${id}-locked` : ""}`}
        data-report-open={report.id}
        onClick={() => onOpen(report.id)}
      >
        <span className="flex flex-1 flex-col gap-1 min-w-0">
          <span id={`${id}-title`} className="font-semibold text-gray-900">
            {title}
          </span>
          {question && (
            <span id={`${id}-question`} className="text-sm text-gray-600">
              {question}
            </span>
          )}
          <ReportBadges report={report} locked={locked} />
          {locked && (
            <span id={`${id}-locked`} className="sr-only">
              {t("analytics.reports.lockedBadge")}
            </span>
          )}
        </span>
        <ChevronRightIcon
          className="w-5 h-5 mt-0.5 shrink-0 text-gray-400 group-hover:text-steel-blue-700"
          aria-hidden
        />
      </button>
    </li>
  );
};

const chipClass = (active: boolean) =>
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500 focus-visible:ring-offset-1 " +
  (active
    ? "border-steel-blue-700 bg-steel-blue-700 text-white"
    : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50");

const countClass = (active: boolean) =>
  "rounded-full px-1.5 text-xs tabular-nums " +
  (active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-700");

const askAi = (search: string) =>
  useAnalyticsHubStore.getState().askAi(search.trim());

export const ReportCatalog = ({
  onOpen,
  search: controlledSearch,
  onSearchChange,
  category: controlledCategory,
  onCategoryChange,
}: {
  onOpen: (reportId: string) => void;
  /** The search, kept by the page while a report is open. */
  search?: string;
  onSearchChange?: (search: string) => void;
  /** The theme chosen above the cards; null shows them all. */
  category?: ReportCategory | null;
  onCategoryChange?: (category: ReportCategory | null) => void;
}) => {
  const { t } = useTranslation();
  const headingId = useId();
  const [ownSearch, setOwnSearch] = useState("");
  const [ownCategory, setOwnCategory] = useState<ReportCategory | null>(null);
  const search = controlledSearch ?? ownSearch;
  const setSearch = onSearchChange ?? setOwnSearch;
  const category =
    controlledCategory === undefined ? ownCategory : controlledCategory;
  const setCategory = onCategoryChange ?? setOwnCategory;
  const { isUnlocked } = useAnalyticsAdmin();
  const publicRankings = useAnalyticsSettingsStore((s) => s.publicRankings);
  const availabilityOf = useReportAvailability();

  // Reports this version cannot run at all are not listed (review D 29).
  const listed = getReportsByCategory()
    .map((group) => ({
      ...group,
      reports: group.reports.filter((report) => {
        const availability = availabilityOf(report);
        return (
          availability === "pending" ||
          availability.available ||
          !cannotEverRun(availability)
        );
      }),
    }))
    .filter((group) => group.reports.length > 0);
  const matching = listed
    .map((group) => ({
      ...group,
      reports: group.reports.filter((report) =>
        matchesSearch(search, report, t)
      ),
    }))
    .filter((group) => group.reports.length > 0);
  const groups = matching.filter(
    (group) => category === null || group.category === category
  );
  const total = matching.reduce((sum, group) => sum + group.reports.length, 0);
  const shownCount = groups.reduce(
    (sum, group) => sum + group.reports.length,
    0
  );
  const query = search.trim();
  const countOf = (value: ReportCategory) =>
    matching.find((group) => group.category === value)?.reports.length ?? 0;

  const aiButton = (
    <button
      type="button"
      className={secondaryButtonClass}
      onClick={() => askAi(search)}
    >
      <SparklesIcon className="w-5 h-5" aria-hidden />
      {t("analytics.reports.askAi")}
    </button>
  );

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xl flex-1 basis-72">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 w-5 h-5 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            className="min-h-11 w-full rounded border border-gray-300 bg-white pl-10 pr-12 text-base [&::-webkit-search-cancel-button]:appearance-none"
            placeholder={t("analytics.reports.search")}
            aria-label={t("analytics.reports.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded text-gray-500 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
              aria-label={t("analytics.reports.clearSearch")}
              onClick={() => setSearch("")}
            >
              <XMarkIcon className="w-5 h-5" aria-hidden />
            </button>
          )}
        </div>
        {aiButton}
      </div>

      <div
        role="group"
        aria-label={t("analytics.reports.categoryFilter")}
        className="flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          className={chipClass(category === null)}
          aria-pressed={category === null}
          onClick={() => setCategory(null)}
        >
          {t("analytics.reports.allCategories")}
          <span className={countClass(category === null)}>{total}</span>
        </button>
        {listed.map((group) => {
          const active = category === group.category;
          return (
            <button
              key={group.category}
              type="button"
              className={chipClass(active)}
              aria-pressed={active}
              onClick={() => setCategory(active ? null : group.category)}
            >
              {t(`analytics.reports.categories.${group.category}`)}
              <span className={countClass(active)}>
                {countOf(group.category)}
              </span>
            </button>
          );
        })}
        <span className="sr-only" role="status" aria-live="polite">
          {query || category !== null
            ? t("analytics.reports.resultCount", { count: shownCount })
            : ""}
        </span>
      </div>

      {shownCount === 0 && total > 0 && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-gray-700">
            {t("analytics.reports.noMatchInCategory", { query })}
          </p>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setCategory(null)}
          >
            {t("analytics.reports.showAllCategories")}
          </button>
        </div>
      )}
      {total === 0 && (
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-prose text-sm text-gray-700">
            {t("analytics.reports.noMatch", { query })}
          </p>
          <div className="flex flex-wrap gap-2">
            {aiButton}
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setSearch("")}
            >
              <XMarkIcon className="w-5 h-5" aria-hidden />
              {t("analytics.reports.clearSearch")}
            </button>
          </div>
        </div>
      )}

      {groups.map((group) => {
        const sectionHeading = `${headingId}-${group.category}`;
        return (
          <section
            key={group.category}
            className="flex flex-col gap-3"
            aria-labelledby={sectionHeading}
          >
            <h2
              id={sectionHeading}
              className="text-sm font-semibold uppercase tracking-wide text-gray-600"
            >
              {t(`analytics.reports.categories.${group.category}`)}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.reports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  availability={availabilityOf(report)}
                  locked={!canSeeReport(report, { isUnlocked, publicRankings })}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
