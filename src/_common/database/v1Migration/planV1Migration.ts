import { v4 } from "uuid";
import { BoatTypeEnum } from "../../business/boat.rules";
import { getConfigurationFromLegacyType } from "../../business/boatConfiguration.rules";
import { splitRowerName } from "../../business/rower.rules";
import { getDateTimeWithoutTimezone } from "../../utils/date.utils";
import { buildInsertStatements, sqlLiteral } from "../sqlClient";

/**
 * Shape of the v1 data found in localStorage (zustand persist) and in the
 * v1 `session` / `session_rowers` tables. Every field is optional because
 * persisted state from old versions can be partial.
 */
export interface V1LocalData {
  clubOverview?: {
    clubOverview?: {
      club?: { password?: string };
      boats?: {
        id: string;
        name: string;
        isInMaintenance?: boolean;
        type?: string;
        note?: string;
        archivedAt?: string;
      }[];
      routes?: { id: string; name: string; archivedAt?: string }[];
      rowers?: {
        id: string;
        name: string;
        archivedAt?: string;
        type?: string;
        category?: string;
      }[];
    };
    coachNote?: string;
  };
  sessions?: {
    session?: {
      id: string;
      rowers: { id: string; name?: string }[];
      route: { id: string; name?: string } | null;
      boat: { id: string; name?: string };
      startDateTime: string;
      estimatedEndDateTime?: string;
      comment?: string;
      endDateTime: string | null;
    }[];
  };
  incidents?: {
    incidents?: {
      id: string;
      boatId: string;
      message: string;
      sessionId: string;
      datetime: string;
    }[];
  };
  boatLevelConfigStore?: {
    boatTypeLevelConfigs?: Record<string, unknown>;
    boatLevelConfigs?: {
      boatId: string;
      minimalRowerCategory: string | null;
      minimalRowerType: string | null;
    }[];
  };
}

export interface V1SessionRow {
  id: string;
  boat_id: string;
  start_date_time: string;
  estimated_end_date_time: string | null;
  route_id: string | null;
  end_date_time: string | null;
  comment: string | null;
  has_been_coached: string | null;
}

export interface V1SessionRowerRow {
  session_id: string;
  rower_id: string;
}

export interface V1MigrationPlan {
  statements: string[];
  expected: Record<V2Table, number>;
  /** v1 records too damaged to copy, kept in the backup file. */
  skipped: { kind: string; reason: string; record: unknown }[];
  /** Archived records created for ids outings use but no list holds. */
  placeholders: { kind: "boat" | "rower" | "route"; v1Id: string; name: string }[];
}

type V2Table =
  | "boat"
  | "boat_configuration"
  | "rower"
  | "route"
  | "outing"
  | "outing_crew"
  | "incident"
  | "boat_level_config";

/** Tables wiped before a (re)run, children first. */
export const V2_DATA_TABLES_IN_DELETE_ORDER = [
  "change_log",
  "boat_level_config",
  "incident",
  "outing_crew",
  "outing",
  "rower_group_member",
  "rower_group",
  "boat_configuration",
  "boat",
  "rower",
  "route",
] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * v1 ids are "boat-<uuid>", "session-<uuid>"… or Math.random() strings.
 * A prefixed uuid keeps its uuid; anything else gets a new one.
 */
const createIdMapper = (generateId: () => string) => {
  const map = new Map<string, string>();
  const used = new Set<string>();

  return (oldId: string) => {
    const existing = map.get(oldId);
    if (existing) return existing;

    // "boat-<uuid>" and "<uuid>" are two records: the second gets a new id.
    const candidate = oldId.replace(/^[a-z]+-/, "").toLowerCase();
    const newId =
      UUID_REGEX.test(candidate) && !used.has(candidate)
        ? candidate
        : generateId();

    map.set(oldId, newId);
    used.add(newId);
    return newId;
  };
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** v1 local wall-clock "YYYY-MM-DDTHH:mm", or null when unreadable. */
const toLocalDateTime = (value: unknown): string | null => {
  if (!isNonEmptyString(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : getDateTimeWithoutTimezone(date);
};

const coachedToInteger = (value: string | null) => {
  if (value === "true") return 1;
  if (value === "false") return 0;
  return null;
};

export const planV1Migration = ({
  local,
  legacySessions,
  legacySessionRowers,
  now = new Date(),
  generateId = v4,
  unknownLabels = { boat: "?", rower: "?", route: "?" },
}: {
  local: V1LocalData;
  legacySessions: V1SessionRow[];
  legacySessionRowers: V1SessionRowerRow[];
  now?: Date;
  generateId?: () => string;
  unknownLabels?: { boat: string; rower: string; route: string };
}): V1MigrationPlan => {
  const nowIso = now.toISOString();
  const skipped: V1MigrationPlan["skipped"] = [];
  const skip = (kind: string, reason: string, record: unknown) => {
    skipped.push({ kind, reason, record });
  };
  /** The outing is kept without it; the lost value is reported. */
  const readEstimatedEnd = (value: unknown, outing: unknown) => {
    const estimatedEnd = toLocalDateTime(value);
    if (!estimatedEnd && isNonEmptyString(value)) {
      skip("outing", "unreadable estimated end, dropped", outing);
    }
    return estimatedEnd;
  };
  const asArray = <T>(value: T[] | undefined, name?: string): T[] => {
    if (Array.isArray(value)) return value;
    // Present but not a list: the whole list is lost, so it is reported.
    if (value !== undefined && value !== null && name) {
      skip("store", `${name} is not a list`, value);
    }
    return [];
  };
  const club = local.clubOverview?.clubOverview ?? {};
  const v1Boats = asArray(club.boats, "boats");
  const v1Rowers = asArray(club.rowers, "rowers");
  const v1Routes = asArray(club.routes, "routes");
  const ongoing = asArray(local.sessions?.session, "sessions");
  const v1Incidents = asArray(local.incidents?.incidents, "incidents");

  const boatId = createIdMapper(generateId);
  const rowerId = createIdMapper(generateId);
  const routeId = createIdMapper(generateId);
  const outingId = createIdMapper(generateId);
  const incidentId = createIdMapper(generateId);

  const boatRows: unknown[][] = [];
  const configurationRows: unknown[][] = [];
  const rowerRows: unknown[][] = [];
  const routeRows: unknown[][] = [];

  const knownBoats = new Set<string>();
  const knownRowers = new Set<string>();
  const knownRoutes = new Set<string>();
  const defaultConfigurationByBoat = new Map<string, string>();

  const addBoat = (boat: {
    id: string;
    name: string;
    note?: string | null;
    isInMaintenance?: boolean;
    type?: string;
    archivedAt?: string | null;
  }) => {
    if (knownBoats.has(boat.id)) return;
    knownBoats.add(boat.id);

    const id = boatId(boat.id);
    boatRows.push([
      id,
      boat.name,
      boat.note || null,
      boat.isInMaintenance ? 1 : 0,
      boat.archivedAt ?? null,
      nowIso,
      nowIso,
    ]);

    const configuration = getConfigurationFromLegacyType(
      boat.type as BoatTypeEnum | undefined
    );
    const configurationId = generateId();
    defaultConfigurationByBoat.set(boat.id, configurationId);
    configurationRows.push([
      configurationId,
      id,
      0,
      configuration.seats,
      configuration.rigging,
      configuration.coxed ? 1 : 0,
      1,
    ]);
  };

  const addRower = (rower: {
    id: string;
    name: string;
    type?: string;
    category?: string;
    archivedAt?: string | null;
    status?: "member" | "guest";
  }) => {
    if (knownRowers.has(rower.id)) return;
    knownRowers.add(rower.id);

    const { firstName, lastName } = splitRowerName(rower.name);
    rowerRows.push([
      rowerId(rower.id),
      firstName,
      lastName,
      rower.status ?? "member",
      rower.category ?? null,
      rower.type ?? null,
      rower.archivedAt ?? null,
      nowIso,
      nowIso,
    ]);
  };

  const addRoute = (route: {
    id: string;
    name: string;
    archivedAt?: string | null;
  }) => {
    if (knownRoutes.has(route.id)) return;
    knownRoutes.add(route.id);

    routeRows.push([
      routeId(route.id),
      route.name,
      route.archivedAt ?? null,
      nowIso,
      nowIso,
    ]);
  };

  // A record without id or name cannot be copied: it is reported, and
  // outings that used it get an archived "unknown" record instead.
  v1Boats.forEach((boat) => {
    if (!isNonEmptyString(boat?.id) || !isNonEmptyString(boat.name)) {
      return skip("boat", "missing id or name", boat);
    }
    if (knownBoats.has(boat.id)) return skip("boat", "duplicate id", boat);
    addBoat(boat);
  });
  v1Rowers.forEach((rower) => {
    if (!isNonEmptyString(rower?.id) || !isNonEmptyString(rower.name)) {
      return skip("rower", "missing id or name", rower);
    }
    if (knownRowers.has(rower.id)) return skip("rower", "duplicate id", rower);
    addRower(rower);
  });
  v1Routes.forEach((route) => {
    if (!isNonEmptyString(route?.id) || !isNonEmptyString(route.name)) {
      return skip("route", "missing id or name", route);
    }
    if (knownRoutes.has(route.id)) return skip("route", "duplicate id", route);
    addRoute(route);
  });

  // Outings can reference records that no longer exist in localStorage
  // (e.g. "NOT_FOUND" boats). They get archived placeholder records so that
  // every outing keeps valid references (ADR 0001), listed in the backup.
  // An ongoing outing carries names: a past outing of the same id uses them.
  const placeholders: V1MigrationPlan["placeholders"] = [];
  const ongoingNames = new Map<string, string>();
  const keepName = (kind: string, id: unknown, name: unknown) => {
    if (isNonEmptyString(id) && isNonEmptyString(name)) {
      ongoingNames.set(`${kind}|${id}`, name);
    }
  };
  for (const session of ongoing) {
    keepName("boat", session?.boat?.id, session?.boat?.name);
    keepName("route", session?.route?.id, session?.route?.name);
    for (const rower of Array.isArray(session?.rowers) ? session.rowers : []) {
      keepName("rower", rower?.id, rower?.name);
    }
  }
  const placeholderName = (
    kind: "boat" | "rower" | "route",
    known: Set<string>,
    id: string,
    name: unknown
  ) => {
    if (known.has(id)) return null;
    const placeholder = isNonEmptyString(name)
      ? name
      : (ongoingNames.get(`${kind}|${id}`) ?? unknownLabels[kind]);
    placeholders.push({ kind, v1Id: id, name: placeholder });
    return placeholder;
  };
  const unknownBoat = (id: string, name?: string) => {
    const placeholder = placeholderName("boat", knownBoats, id, name);
    if (placeholder) addBoat({ id, name: placeholder, archivedAt: nowIso });
  };
  const unknownRower = (id: string, name?: string) => {
    const placeholder = placeholderName("rower", knownRowers, id, name);
    if (placeholder) {
      addRower({ id, name: placeholder, archivedAt: nowIso, status: "guest" });
    }
  };
  const unknownRoute = (id: string, name?: string) => {
    const placeholder = placeholderName("route", knownRoutes, id, name);
    if (placeholder) addRoute({ id, name: placeholder, archivedAt: nowIso });
  };

  const outingRows: unknown[][] = [];
  const crewRows: unknown[][] = [];
  const knownOutings = new Set<string>();

  // A skipped outing is reported with its rowers.
  const rowerIdsBySession = new Map<string, string[]>();
  for (const row of legacySessionRowers) {
    const ids = rowerIdsBySession.get(row.session_id) ?? [];
    ids.push(row.rower_id);
    rowerIdsBySession.set(row.session_id, ids);
  }
  const skipLegacy = (reason: string, session: (typeof legacySessions)[number]) =>
    skip("outing", reason, {
      ...session,
      rower_ids: rowerIdsBySession.get(session.id) ?? [],
    });

  for (const session of legacySessions) {
    if (knownOutings.has(session.id)) {
      skipLegacy("duplicate id", session);
      continue;
    }

    // v1 rows default to "NOT_FOUND"; an outing without a readable start or
    // end would show as ongoing forever.
    const start = toLocalDateTime(session.start_date_time);
    const end = toLocalDateTime(session.end_date_time);
    if (!start || !end) {
      skipLegacy("unreadable start or end date", session);
      continue;
    }
    if (end < start) {
      skipLegacy("end before start", session);
      continue;
    }
    knownOutings.add(session.id);

    unknownBoat(session.boat_id);
    if (session.route_id) unknownRoute(session.route_id);

    outingRows.push([
      outingId(session.id),
      boatId(session.boat_id),
      defaultConfigurationByBoat.get(session.boat_id) ?? null,
      session.route_id ? routeId(session.route_id) : null,
      start,
      readEstimatedEnd(session.estimated_end_date_time, session),
      end,
      session.comment || null,
      coachedToInteger(session.has_been_coached),
      nowIso,
      nowIso,
    ]);
  }

  const crewPositions = new Map<string, number>();
  const knownCrew = new Set<string>();
  const addCrew = (sessionId: string, v1RowerId: string, name?: string) => {
    const key = `${sessionId}|${v1RowerId}`;
    if (knownCrew.has(key)) return;
    knownCrew.add(key);

    unknownRower(v1RowerId, name);
    const position = crewPositions.get(sessionId) ?? 0;
    crewPositions.set(sessionId, position + 1);
    crewRows.push([outingId(sessionId), rowerId(v1RowerId), "rower", position]);
  };

  const legacySessionIds = new Set(legacySessions.map((session) => session.id));
  for (const row of legacySessionRowers) {
    if (!knownOutings.has(row.session_id)) {
      // Rowers of a skipped outing are reported with that outing.
      if (!legacySessionIds.has(row.session_id)) {
        skip("crew", "unknown outing", row);
      }
      continue;
    }
    addCrew(row.session_id, row.rower_id);
  }

  for (const session of ongoing) {
    if (!isNonEmptyString(session?.id)) {
      skip("outing", "missing id", session);
      continue;
    }
    if (knownOutings.has(session.id)) {
      skip("outing", "duplicate id", session);
      continue;
    }

    const start = toLocalDateTime(session.startDateTime);
    if (!isNonEmptyString(session.boat?.id) || !start) {
      skip("outing", "missing boat or unreadable start date", session);
      continue;
    }
    // An unreadable end would show the outing as ongoing forever.
    const end = toLocalDateTime(session.endDateTime);
    if (isNonEmptyString(session.endDateTime) && !end) {
      skip("outing", "unreadable end date", session);
      continue;
    }
    if (end && end < start) {
      skip("outing", "end before start", session);
      continue;
    }
    knownOutings.add(session.id);

    unknownBoat(session.boat.id, session.boat.name);
    const route = isNonEmptyString(session.route?.id) ? session.route : null;
    if (!route && session.route) {
      skip("outing", "route without id, dropped", session);
    }
    if (route) unknownRoute(route.id, route.name);

    outingRows.push([
      outingId(session.id),
      boatId(session.boat.id),
      defaultConfigurationByBoat.get(session.boat.id) ?? null,
      route ? routeId(route.id) : null,
      start,
      readEstimatedEnd(session.estimatedEndDateTime, session),
      end,
      session.comment || null,
      null,
      nowIso,
      nowIso,
    ]);

    for (const rower of asArray(session.rowers)) {
      if (!isNonEmptyString(rower?.id)) {
        skip("crew", "missing rower id", { outing: session.id, rower });
        continue;
      }
      addCrew(session.id, rower.id, rower.name);
    }
  }

  const knownIncidents = new Set<string>();
  const incidentRows = v1Incidents.flatMap((incident) => {
    const occurredAt = toLocalDateTime(incident?.datetime);
    if (
      !isNonEmptyString(incident?.id) ||
      !isNonEmptyString(incident.boatId) ||
      !occurredAt
    ) {
      skip("incident", "missing id, boat or date", incident);
      return [];
    }
    if (knownIncidents.has(incident.id)) {
      skip("incident", "duplicate id", incident);
      return [];
    }
    knownIncidents.add(incident.id);
    unknownBoat(incident.boatId);
    if (typeof incident.message !== "string") {
      skip("incident", "message is not text, dropped", incident);
    }
    if (
      isNonEmptyString(incident.sessionId) &&
      !knownOutings.has(incident.sessionId)
    ) {
      skip("incident", "outing not found, link dropped", incident);
    }
    return [
      [
        incidentId(incident.id),
        knownOutings.has(incident.sessionId)
          ? outingId(incident.sessionId)
          : null,
        boatId(incident.boatId),
        typeof incident.message === "string" ? incident.message : "",
        occurredAt,
        nowIso,
      ],
    ];
  });

  // v1 upserted by boat: the last entry for a boat is the one in effect.
  const levelConfigByBoat = new Map<
    string,
    { minimalRowerCategory: string | null; minimalRowerType: string | null }
  >();
  asArray(local.boatLevelConfigStore?.boatLevelConfigs, "boatLevelConfigs").forEach((config) => {
    if (!knownBoats.has(config?.boatId)) {
      return skip("boatLevelConfig", "unknown boat", config);
    }
    const previous = levelConfigByBoat.get(config.boatId);
    if (previous) skip("boatLevelConfig", "duplicate boat", previous);
    levelConfigByBoat.set(config.boatId, config);
  });
  const levelRows = [...levelConfigByBoat].map(([v1BoatId, config]) => [
    boatId(v1BoatId),
    config.minimalRowerCategory ?? null,
    config.minimalRowerType ?? null,
  ]);

  const settings: [string, unknown][] = [
    ["club.passwordHash", club.club?.password ?? ""],
    ["club.coachNote", local.clubOverview?.coachNote ?? ""],
    ["modules.enabled", []],
  ];
  if (local.boatLevelConfigStore?.boatTypeLevelConfigs) {
    settings.push([
      "levels.boatTypeLevelConfigs",
      local.boatLevelConfigStore.boatTypeLevelConfigs,
    ]);
  }

  const statements = [
    ...V2_DATA_TABLES_IN_DELETE_ORDER.map((table) => `DELETE FROM ${table};`),
    ...buildInsertStatements(
      "boat",
      [
        "id",
        "name",
        "note",
        "is_in_maintenance",
        "archived_at",
        "created_at",
        "updated_at",
      ],
      boatRows
    ),
    ...buildInsertStatements(
      "boat_configuration",
      ["id", "boat_id", "position", "seats", "rigging", "coxed", "is_default"],
      configurationRows
    ),
    ...buildInsertStatements(
      "rower",
      [
        "id",
        "first_name",
        "last_name",
        "status",
        "age_category",
        "seriousness",
        "archived_at",
        "created_at",
        "updated_at",
      ],
      rowerRows
    ),
    ...buildInsertStatements(
      "route",
      ["id", "name", "archived_at", "created_at", "updated_at"],
      routeRows
    ),
    ...buildInsertStatements(
      "outing",
      [
        "id",
        "boat_id",
        "boat_configuration_id",
        "route_id",
        "start_date_time",
        "estimated_end_date_time",
        "end_date_time",
        "comment",
        "has_been_coached",
        "created_at",
        "updated_at",
      ],
      outingRows
    ),
    ...buildInsertStatements(
      "outing_crew",
      ["outing_id", "rower_id", "role", "position"],
      crewRows
    ),
    ...buildInsertStatements(
      "incident",
      ["id", "outing_id", "boat_id", "message", "occurred_at", "created_at"],
      incidentRows
    ),
    ...buildInsertStatements(
      "boat_level_config",
      ["boat_id", "minimal_rower_category", "minimal_rower_type"],
      levelRows
    ),
    ...settings.map(
      ([key, value]) =>
        `INSERT OR REPLACE INTO setting (key, value) VALUES (${sqlLiteral(key)}, ${sqlLiteral(JSON.stringify(value))});`
    ),
  ];

  return {
    statements,
    skipped,
    placeholders,
    expected: {
      boat: boatRows.length,
      boat_configuration: configurationRows.length,
      rower: rowerRows.length,
      route: routeRows.length,
      outing: outingRows.length,
      outing_crew: crewRows.length,
      incident: incidentRows.length,
      boat_level_config: levelRows.length,
    },
  };
};
