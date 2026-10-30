// The `analytics` seed profile, the part with words and Logbook writes:
// names of the former members and guests, the modules and analytics
// settings, saved queries (one per origin badge), the default dashboard and
// the Claude Desktop proposal waiting in the MCP inbox. The structure (who
// rowed when) is in analyticsHistory.ts.
import {
  saveBoat,
  saveRower,
  saveSetting,
} from "../../_common/database/repositories/club.repository";
import { withSingleDefault } from "../../_common/business/boatConfiguration.rules";
import type { SqlClient } from "../../_common/database/sqlClient";
import { getRowerFullName } from "../../_common/business/rower.rules";
import type { ModuleId } from "../../_common/business/modules.rules";
import { SETTING_MODULES_ENABLED } from "../../_common/store/modules.store";
import { simplifyString } from "../../_common/utils/string.utils";
import {
  ChartSpec,
  ChartSpecInput,
  ParamDefs,
} from "../../analytics/chartSpec";
import type { InboxProposal } from "../../analytics/engine/ipc";
import { DEFAULT_DASHBOARD, getReport } from "../../analytics/reports/catalog";
import {
  saveDashboardItem,
  writeQuery,
} from "../../analytics/repository/analytics.repository";
import { ANALYTICS_SETTINGS } from "../../analytics/store/analyticsSettings.store";
import type { QueryOrigin } from "../../analytics/types";
import { seasonOf } from "./calendar";
import { CLASS_SHAPES, SEED, idFor } from "./club";
import type { AnalyticsContent, LocaleContent } from "./content/types";
import type {
  AnalyticsHistory,
  ExtraBoat,
  ExtraRower,
} from "./analyticsHistory";
import type { ClubNames } from "./names";
import { createRng } from "./prng";
import type { AnalyticsScenario, AnalyticsSeedOptions } from "./scenario";

/** Modules on in the Statistiques scenes (reports that need them are available). */
export const ANALYTICS_MODULES: ModuleId[] = [
  "distances",
  "outingTypes",
  "memberProfile",
  "guests",
];

type QueryKey = keyof AnalyticsContent["queries"];

interface QueryPlan {
  key: QueryKey;
  origin: QueryOrigin;
  basedOnReportId?: string;
  /** Last change, ISO (the list shows "Modifiée le …"). */
  updatedAt: string;
  sql: string;
  chart: ChartSpecInput;
}

const SEASON_PARAM = [
  { name: "season", type: "season", required: true, default: "current" },
];

/** Saved queries, most recent last; one per origin badge, two written by hand. */
export const ANALYTICS_QUERIES: QueryPlan[] = [
  {
    key: "tuesdayEvenings",
    origin: "user",
    updatedAt: "2026-02-03T20:41:00.000Z",
    sql: `SELECT start_month_key AS month, COUNT(*) AS outings
FROM v_outings
WHERE season = :season AND start_weekday = 2 AND start_hour >= 17 AND is_rowing = 1
GROUP BY start_month_key
ORDER BY month`,
    chart: { type: "bar", x: "month", y: ["outings"] },
  },
  {
    key: "youthMonthly",
    origin: "ai",
    updatedAt: "2026-03-17T19:05:00.000Z",
    sql: `SELECT start_month_key AS month, COUNT(DISTINCT rower_id) AS active_rowers
FROM v_outing_rowers
WHERE season = :season AND counts_in_stats = 1 AND is_rowing = 1
  AND age_category IN ('J10', 'J12', 'J14', 'J16', 'J18')
GROUP BY start_month_key
ORDER BY month`,
    chart: { type: "line", x: "month", y: ["active_rowers"] },
  },
  {
    key: "hoursPerClass",
    origin: "mcp",
    updatedAt: "2026-04-28T07:52:00.000Z",
    sql: `SELECT boat_class, ROUND(SUM(duration_min) / 60.0, 1) AS hours, COUNT(*) AS outings
FROM v_outings
WHERE season = :season AND counts_in_stats = 1 AND is_rowing = 1
  AND is_multi_day = 0 AND duration_min > 0
GROUP BY boat_class
ORDER BY hours DESC`,
    chart: {
      type: "bar",
      x: "boat_class",
      y: ["hours"],
      orientation: "horizontal",
    },
  },
  {
    key: "scullingBoats",
    origin: "report",
    basedOnReportId: "boat-usage-ranking",
    updatedAt: "2026-05-26T18:14:00.000Z",
    sql: `SELECT boat_name, boat_class, COUNT(*) AS outings, ROUND(SUM(distance_km), 0) AS km
FROM v_outings
WHERE season = :season AND counts_in_stats = 1 AND rigging = 'scull'
GROUP BY boat_id
ORDER BY outings DESC
LIMIT 25`,
    chart: {
      type: "bar",
      x: "boat_name",
      y: ["outings"],
      orientation: "horizontal",
      limit: 25,
    },
  },
  {
    key: "kmPerRoute",
    origin: "user",
    updatedAt: "2026-06-14T16:30:00.000Z",
    sql: `SELECT route_name, ROUND(SUM(distance_km), 0) AS km
FROM v_outings
WHERE season = :season AND counts_in_stats = 1 AND is_rowing = 1 AND route_id IS NOT NULL
GROUP BY route_id
ORDER BY km DESC`,
    chart: { type: "pie", label: "route_name", value: "km" },
  },
];

export const queryIdOf = (key: QueryKey) => idFor("analytics-query", key);

/** The proposal Claude Desktop left in the inbox (analytics_inbox_list). */
export const PROPOSAL_ID = idFor("analytics-inbox", "late-returns");
export const PROPOSAL_SQL = `SELECT start_weekday AS weekday, start_hour AS hour, COUNT(*) AS late_returns
FROM v_outings
WHERE season = :season AND is_rowing = 1 AND return_delay_min > 15
GROUP BY start_weekday, start_hour
ORDER BY weekday, hour`;

export const inboxProposal = (content: LocaleContent): InboxProposal => ({
  id: PROPOSAL_ID,
  createdAt: "2026-06-19T21:12:00Z",
  // clientInfo.name of Claude Desktop.
  client: "claude-ai",
  title: content.analytics.proposal.title,
  description: content.analytics.proposal.description,
  sql: PROPOSAL_SQL,
  params: SEASON_PARAM,
  chart: { type: "heatmap", x: "hour", y: "weekday", value: "late_returns" },
  error: null,
});

/**
 * Names of the former members and guests: common names of the pack, never
 * a member's full name, never the start of one (the crew picker filters by
 * "starts with"). First names may repeat members' ones, as in any club.
 */
export const nameExtraRowers = (
  content: LocaleContent,
  names: ClubNames,
  extras: ExtraRower[]
): Map<string, { firstName: string; lastName: string; fullName: string }> => {
  const rng = createRng(`${SEED}:analytics-names`);
  const taken = [...names.rowers.values()].map((name) =>
    simplifyString(name.fullName)
  );
  const clashes = (candidate: string) =>
    taken.some(
      (other) => other.startsWith(candidate) || candidate.startsWith(other)
    );
  const result = new Map<
    string,
    { firstName: string; lastName: string; fullName: string }
  >();
  for (const { spec } of extras) {
    // Adults' first names (after the 20 given to juniors).
    const firstNames = content.firstNames[spec.gender].slice(20);
    for (let attempt = 0; ; attempt++) {
      if (attempt > 500)
        throw new Error(`${content.locale}: no free name for ${spec.key}`);
      const firstName = rng.pick(firstNames);
      const lastName = rng.pick(content.lastNames);
      const fullName = getRowerFullName({ firstName, lastName });
      const simplified = simplifyString(fullName);
      if (clashes(simplified)) continue;
      taken.push(simplified);
      result.set(spec.key, { firstName, lastName, fullName });
      break;
    }
  }
  return result;
};

/** Writes the former members (archived) and guests, before the outings that name them. */
export const saveExtraRowers = async (
  db: SqlClient,
  extras: ExtraRower[],
  extraNames: Map<
    string,
    { firstName: string; lastName: string; fullName: string }
  >
) => {
  for (const { spec, status, archivedAt, birthDateKnown } of extras) {
    const name = extraNames.get(spec.key)!;
    await saveRower(db, {
      id: spec.id,
      name: name.fullName,
      firstName: name.firstName,
      lastName: name.lastName,
      status,
      archivedAt: archivedAt ?? undefined,
      category: spec.category,
      type: spec.type,
      gender: spec.gender,
      // Guests (and some occasional members) leave no birth date at the boathouse.
      birthDate: birthDateKnown ? spec.birthDate : null,
    });
  }
};

/** Writes the old, rarely used boats, before the outings that use them. */
export const saveExtraBoats = async (db: SqlClient, boats: ExtraBoat[]) => {
  for (const { spec, name, buildYear } of boats) {
    await saveBoat(db, {
      id: spec.id,
      name,
      note: "",
      isInMaintenance: false,
      buildYear,
      configurations: withSingleDefault(
        spec.configurations.map((configuration) => ({
          id: configuration.id,
          ...CLASS_SHAPES[configuration.cls],
          hullType: null,
          isDefault: configuration.position === 0,
          position: configuration.position,
        }))
      ),
    });
  }
};

/** Settings, saved queries and dashboard of the profile; outings are already written. */
export const seedAnalyticsData = async (
  db: SqlClient,
  {
    content,
    options,
    now,
    history,
    boatIds,
  }: {
    content: LocaleContent;
    options: AnalyticsSeedOptions;
    now: string;
    history: AnalyticsHistory | null;
    /** The boats of the club structure, the ones written without a build year. */
    boatIds: string[];
  }
): Promise<AnalyticsScenario> => {
  const season = seasonOf(now.slice(0, 10));
  const modules = options.modules ?? ANALYTICS_MODULES;
  await saveSetting(db, SETTING_MODULES_ENABLED, modules);
  await saveSetting(db, ANALYTICS_SETTINGS.annualClubName, content.clubName);
  await saveSetting(db, ANALYTICS_SETTINGS.annualNotes, {
    [String(season)]: content.analytics.annualNote,
  });
  await saveSetting(
    db,
    ANALYTICS_SETTINGS.mcpEnabled,
    options.mcpEnabled ?? false
  );
  if (options.aiProvider) {
    await saveSetting(db, ANALYTICS_SETTINGS.aiProvider, options.aiProvider);
  }
  if (options.aiCompatibleModel) {
    await saveSetting(
      db,
      ANALYTICS_SETTINGS.aiCompatibleModel,
      options.aiCompatibleModel
    );
  }

  // Build years of the fleet ("Kilomètres, heures et incidents par bateau").
  const rng = createRng(`${SEED}:analytics-boats`);
  // (Not read back from the database: the demo's script recorder answers
  // "no row" to every read.)
  for (const id of [...boatIds].sort()) {
    await db.execute("UPDATE boat SET build_year = $1 WHERE id = $2", [
      rng.int(1998, 2024),
      id,
    ]);
  }

  for (const plan of ANALYTICS_QUERIES) {
    const text = content.analytics.queries[plan.key];
    const id = queryIdOf(plan.key);
    await writeQuery(db, {
      id,
      title: text.title,
      description: text.description,
      sql: plan.sql,
      params: ParamDefs.parse(SEASON_PARAM),
      chart: ChartSpec.parse(plan.chart),
      origin: plan.origin,
      status: "saved",
      basedOnReportId: plan.basedOnReportId ?? null,
    });
    // saveQuery stamps the frozen clock: give each query its own history.
    await db.execute(
      "UPDATE analytics_query SET created_at = $1, updated_at = $1 WHERE id = $2",
      [plan.updatedAt, id]
    );
  }

  // The dashboard of a first visit (plan 1.3), written up front so that
  // every capture starts from the same items.
  let position = 0;
  for (const [index, entry] of DEFAULT_DASHBOARD.entries()) {
    const report = getReport(entry.reportId);
    const missingModule = report?.requires.modules?.some(
      (module) => !(modules as string[]).includes(module)
    );
    if (!report || missingModule) continue;
    await saveDashboardItem(db, {
      id: idFor("analytics-dashboard", `${index}:${entry.reportId}`),
      position: position++,
      source: { kind: "report", reportId: entry.reportId },
      size: entry.size,
      paramValues: { ...entry.paramValues },
      chartOverride: null,
    });
  }
  await saveSetting(db, ANALYTICS_SETTINGS.dashboardInitialised, true);

  const seasons = history
    ? [seasonOf(history.historyStart), season - 1, season]
    : options.outings === false
      ? []
      : [season - 1, season];
  return {
    queryIds: Object.fromEntries(
      ANALYTICS_QUERIES.map((plan) => [plan.key, queryIdOf(plan.key)])
    ) as Record<QueryKey, string>,
    historyStart: history?.historyStart ?? "",
    seasons,
    stoppedRowers: history?.stoppedRowers.length ?? 0,
    guests:
      history?.extraRowers.filter((extra) => extra.status === "guest").length ??
      0,
  };
};
