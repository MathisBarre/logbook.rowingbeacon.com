import type { AdminPage } from "../_common/store/navigation.store";
import type { ModuleId } from "../_common/business/modules.rules";
import type { AnalyticsTab } from "../analytics/store/analyticsHub.store";

/** The tabs of the Gestion page that a guide step can open. */
export type ParametersTab = "rowers" | "boats" | "misc" | "modules" | "data";

export const DEMO_GUIDE_GROUPS = [
  "boathouse",
  "logbook",
  "reservations",
  "damages",
  "stats",
  "management",
  "efa2",
] as const;

export type DemoGuideGroup = (typeof DEMO_GUIDE_GROUPS)[number];

export interface DemoGuideStep {
  /** Stored in the checklist: never rename a step that has shipped. */
  id: string;
  group: DemoGuideGroup;
  page: AdminPage;
  /** Gestion pages are protected by the admin password. */
  parametersTab?: ParametersTab;
  /** Tab of the Statistiques page to open (the dashboard by default). */
  analyticsTab?: AnalyticsTab;
  /** The step only exists when this module is on. */
  module?: ModuleId;
}

/**
 * What to try in the demo club. Titles and descriptions live in the locale
 * files under `demo.guide.steps.<id>`, groups under `demo.guide.groups`.
 */
export const DEMO_GUIDE_STEPS: readonly DemoGuideStep[] = [
  { id: "startOuting", group: "boathouse", page: "boathouse" },
  { id: "stopOuting", group: "boathouse", page: "boathouse" },
  { id: "pastOuting", group: "boathouse", page: "boathouse" },
  { id: "history", group: "logbook", page: "logbook" },
  { id: "editOuting", group: "logbook", page: "logbook" },
  {
    id: "reservations",
    group: "reservations",
    page: "reservations",
    module: "reservations",
  },
  {
    id: "reservedBoats",
    group: "reservations",
    page: "boathouse",
    module: "reservations",
  },
  { id: "damagesList", group: "damages", page: "logbook", module: "damages" },
  {
    id: "declareDamage",
    group: "damages",
    page: "parameters",
    parametersTab: "boats",
    module: "damages",
  },
  // Keeps the id of the first statistics step: ticks of earlier visits stay.
  { id: "stats", group: "stats", page: "stats", analyticsTab: "dashboard" },
  {
    id: "statsReports",
    group: "stats",
    page: "stats",
    analyticsTab: "reports",
  },
  {
    id: "statsAnnual",
    group: "stats",
    page: "stats",
    analyticsTab: "annual",
  },
  {
    id: "statsExplorer",
    group: "stats",
    page: "stats",
    analyticsTab: "explorer",
  },
  { id: "statsAi", group: "stats", page: "stats", analyticsTab: "explorer" },
  {
    id: "rowerStats",
    group: "stats",
    page: "parameters",
    parametersTab: "rowers",
  },
  {
    id: "modules",
    group: "management",
    page: "parameters",
    parametersTab: "modules",
  },
  {
    id: "boatsAndRowers",
    group: "management",
    page: "parameters",
    parametersTab: "boats",
  },
  {
    id: "efa2Export",
    group: "efa2",
    page: "parameters",
    parametersTab: "data",
  },
  {
    id: "efa2Import",
    group: "efa2",
    page: "parameters",
    parametersTab: "data",
  },
];

/**
 * The step is behind the admin password: the Gestion pages, and the Explorer
 * tab of Statistiques (SQL and AI are for the club's officials).
 */
export const stepNeedsAdmin = (step: DemoGuideStep) =>
  step.page === "parameters" || step.analyticsTab === "explorer";

/** The steps whose module is on, in order, grouped for display. */
export const getGuideGroups = (
  isModuleOn: (module: ModuleId) => boolean,
  steps: readonly DemoGuideStep[] = DEMO_GUIDE_STEPS
) =>
  DEMO_GUIDE_GROUPS.map((group) => ({
    group,
    steps: steps.filter(
      (step) =>
        step.group === group && (!step.module || isModuleOn(step.module))
    ),
  })).filter(({ steps: groupSteps }) => groupSteps.length > 0);

/** Ticked steps that still exist (a step can disappear between versions). */
export const countDone = (
  doneIds: readonly string[],
  steps: readonly DemoGuideStep[]
) => steps.filter((step) => doneIds.includes(step.id)).length;
