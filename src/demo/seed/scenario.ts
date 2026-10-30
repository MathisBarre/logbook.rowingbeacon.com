// Contract between the seed (which builds the fake club) and the scenes and capture
// script (which open dialogs on the right boat, rower or outing).
import type { SqlClient } from "../../_common/database/sqlClient";
import type { ModuleId } from "../../_common/business/modules.rules";
import type { AnalyticsContent, StudioLocale } from "./content/types";

export interface SeedOptions {
  locale: StudioLocale;
  /** Local wall-clock time the app believes it is, e.g. "2026-06-20T09:47:00". */
  now: string;
  /**
   * Optional Logbook modules the club has turned on (settings "modules.enabled"); none by
   * default, as in a club onboarded with the simple profile. "reservations" also seeds the
   * boat reservations.
   */
  modules?: readonly ModuleId[];
  /**
   * The opt-in `analytics` profile (Statistiques scenes, `?analytics=1`):
   * a third season, turnover, guests, outing types, saved queries and the
   * dashboard. Absent: the landing club, unchanged.
   */
  analytics?: AnalyticsSeedOptions;
  /**
   * What is on the water at "now". Default: the club's morning (nine boats out). "one": only the
   * featured double (stopped in its dialog, it is the last outing: the "all boats back" reminder).
   */
  onWater?: "all" | "one";
  /** Write the pack's coach note (Gestion › Paramètres divers; the boathouse banner). Default: no note. */
  coachNote?: boolean;
}

export interface AnalyticsSeedOptions {
  /** false: boats and members but no outing yet (empty statistics). Default true. */
  outings?: boolean;
  /** Modules turned on. Default: distances, outingTypes, memberProfile and guests. */
  modules?: ModuleId[];
  /** Gestion › Statistiques et IA › "Autoriser les assistants IA…". Default false. */
  mcpEnabled?: boolean;
  /** The assistant's AI provider. Default: none written (Anthropic). */
  aiProvider?: "anthropic" | "openai" | "openai_compatible";
  /** Model name of the OpenAI-compatible server. Default: none. */
  aiCompatibleModel?: string;
}

/** What the analytics profile wrote, for the capture script. */
export interface AnalyticsScenario {
  /** Ids of the saved queries, by content key. */
  queryIds: Record<keyof AnalyticsContent["queries"], string>;
  /** First day of the oldest season on record. */
  historyStart: string;
  /** Seasons with outings, oldest first (start years). */
  seasons: number[];
  /** Members who stopped coming this season (inactive members report). */
  stoppedRowers: number;
  guests: number;
}

/** What the Reservations module scenes open; only seeded when that module is on. */
export interface ReservationScenario {
  /** Reservation dialog: a weekly slot of the junior group, limited to a period. */
  form: {
    boatId: string;
    boatName: string;
    /** ISO day of week, 1 = Monday. */
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    /** First and last day of the period, "YYYY-MM-DD". */
    periodStart: string;
    periodEnd: string;
    /** Free name typed as holder, and the reason typed. */
    holder: string;
    reason: string;
  };
  /** Boathouse: free boats showing the amber badge, one reserved now and one reserved soon. */
  badges: {
    now: { boatId: string; boatName: string };
    soon: { boatId: string; boatName: string };
  };
  /** Start dialog: the boat reserved soon, whose reservation overlaps the outing. */
  notice: { boatId: string; boatName: string; holder: string; seats: number };
  counts: { upcoming: number; past: number };
}

/** What the Damages module scenes open; only seeded when that module is on. */
export interface DamageScenario {
  /** Start dialog: the quad with two open damages (precaution, minor). */
  warning: { boatId: string; boatName: string; descriptions: string[] };
  /** Damage form: the boat picked, the text typed and the rower who reports. */
  form: {
    boatId: string;
    boatName: string;
    description: string;
    reporterId: string;
    reporterName: string;
  };
  /** Open damages (the two boats out of service included) and repaired ones. */
  counts: { open: number; fixed: number };
}

/** The outing entered after the fact (late outing form) and the one corrected (outing editor). */
export interface PastOutingScenario {
  /** Late outing form: yesterday evening, a double, two rowers typed. */
  late: {
    boatId: string;
    boatName: string;
    routeId: string;
    routeName: string;
    crew: { id: string; name: string }[];
    /** Local "YYYY-MM-DDTHH:mm" typed in the date fields. */
    start: string;
    end: string;
    comment: string;
  };
  /** Outing editor: the finished outing of this boat, the latest of the logbook's first rows. */
  edit: { outingId: string; boatName: string };
}

export interface Scenario {
  locale: StudioLocale;
  clubName: string;
  /** Start dialog: a free quad, the crew typed into it and the route picked. */
  start: {
    boatId: string;
    boatName: string;
    routeId: string;
    routeName: string;
    /** In seat order; `name` is what the crew combobox shows. */
    crew: { id: string; name: string }[];
    /** Rowers the start scene types: one seat is left, so the dialog counts the places remaining. */
    typed: number;
  };
  /** Stop dialog: a double on the water since 08:45. */
  stop: { outingId: string; boatId: string; boatName: string };
  /** Rower whose statistics dialog is captured (about 110 outings this season). */
  rower: { id: string; name: string };
  /** Boat whose statistics dialog is captured; it has a recent incident. */
  boat: { id: string; name: string };
  /** Reservations module scenes; null while that module is off. */
  reservations: ReservationScenario | null;
  /** Damages module scenes; null while that module is off. */
  damages: DamageScenario | null;
  /** Late outing form and outing editor. */
  past: PastOutingScenario;
  counts: {
    boats: number;
    rowers: number;
    routes: number;
    outings: number;
    incidents: number;
  };
  /** Only with the analytics profile. */
  analytics?: AnalyticsScenario;
}

export type SeedClub = (
  db: SqlClient,
  options: SeedOptions
) => Promise<Scenario>;
