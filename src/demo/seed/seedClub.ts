// Builds the fake club in an empty database through Logbook's own
// migrations, repository writers and business rules, and tells the scenes
// which records to open.
import { applyMigrations } from "../../_common/database/migrations";
import {
  deleteAllClubData,
  insertIncident,
  insertOuting,
  type OutingToSave,
  saveBoat,
  saveBoatDamage,
  saveBoatLevelConfig,
  saveRoute,
  saveRower,
  saveSetting,
} from "../../_common/database/repositories/club.repository";
import type {
  ClubBoat,
  ClubRower,
} from "../../_common/database/repositories/club.types";
import {
  buildInsertStatements,
  type SqlClient,
} from "../../_common/database/sqlClient";
import { withSingleDefault } from "../../_common/business/boatConfiguration.rules";
import { simplifyString } from "../../_common/utils/string.utils";
import {
  MODULE_IDS,
  normalizeModuleIds,
} from "../../_common/business/modules.rules";
import { DEFAULT_BOAT_TYPE_LEVEL_CONFIGS } from "../../_common/store/boatLevelConfig.rules";
import { SETTING_BOAT_TYPE_LEVEL_CONFIGS } from "../../_common/store/boatLevelConfig.store";
import {
  SETTING_CLUB_LATITUDE,
  SETTING_CLUB_LONGITUDE,
} from "../../_common/store/boathouseSettings.store";
import {
  SETTING_COACH_NOTE,
  SETTING_PASSWORD_HASH,
} from "../../_common/store/clubOverview.store";
import {
  SETTING_MODULES_DISMISSED_SUGGESTIONS,
  SETTING_MODULES_ENABLED,
} from "../../_common/store/modules.store";
import { SETTING_ONBOARDING_DONE } from "../../onboarding/onboarding.store";
import { hashPassword } from "../../_common/utils/password";
import enGB from "../../_common/i18n/locales/en-GB.json";
import enUS from "../../_common/i18n/locales/en-US.json";
import deDE from "../../_common/i18n/locales/de-DE.json";
import frFR from "../../_common/i18n/locales/fr-FR.json";
import itIT from "../../_common/i18n/locales/it-IT.json";
import nlNL from "../../_common/i18n/locales/nl-NL.json";
import {
  addDays,
  parseLocalDateTime,
  seasonOf,
  toLocalDateTime,
} from "./calendar";
import {
  buildClubStructure,
  CLASS_SHAPES,
  ClubStructure,
  FEATURED,
  idFor,
  RowerSpec,
} from "./club";
import { CONTENT } from "./content";
import type { LocaleContent, StudioLocale } from "./content/types";
import {
  capRowerOutings,
  lendCoxes,
  outingEnd,
  outingEstimatedEnd,
  outingStart,
  PlannedOuting,
  planHistory,
} from "./history";
import { pickIncidentMessages, planIncidents } from "./incidents";
import { composeNames, type ClubNames } from "./names";
import { planToday } from "./ongoing";
import { AnalyticsHistory, planAnalyticsHistory } from "./analyticsHistory";
import {
  nameExtraRowers,
  saveExtraBoats,
  saveExtraRowers,
  seedAnalyticsData,
} from "./analytics";
import { seedDamages } from "./damages";
import { seedReservations } from "./reservations";
import type {
  AnalyticsScenario,
  DamageScenario,
  PastOutingScenario,
  ReservationScenario,
  Scenario,
  SeedClub,
  SeedOptions,
} from "./scenario";
import { validateContent } from "./validate";

/** The admin password of the fake club (parameters screens). */
export const ADMIN_PASSWORD = "admin";

/**
 * Where the fictional club is (the boathouse strip shows sunrise and sunset from it): the Loire
 * valley, on the Europe/Paris clock of every scene. Gestion › Club sets it in the real app.
 */
export const CLUB_LOCATION = { latitude: 47.4, longitude: 0.7 } as const;

/** The outing entered after the fact: Friday evening, a double and two masters (keys of the club). */
export const LATE_OUTING = {
  boat: "2x.C3",
  routeSlot: 1,
  crew: ["masters.F2", "masters.M2"],
  /** Minutes after midnight of the day before "now". */
  start: 18 * 60 + 15,
  end: 19 * 60 + 40,
} as const;

/** Rowing outings of the featured rower this season, cox outings apart. */
export const FEATURED_ROWER_OUTINGS = 98;

/**
 * Competition rowers at the top of the rankings who cox the junior and
 * recreational crews now and then this season (outings as cox).
 */
export const LENT_COXES: Record<string, number> = {
  "comp.F0": 16,
  "comp.F2": 11,
  "comp.M3": 7,
  "comp.M5": 5,
};

const APP_LOCALES: Record<
  StudioLocale,
  { seriousness: Record<string, string> }
> = {
  "fr-FR": frFR,
  "en-US": enUS,
  "en-GB": enGB,
  "de-DE": deDE,
  "it-IT": itIT,
  "nl-NL": nlNL,
};

/** The label the crew picker shows: "Name (Senior - Recreational)". */
export const crewOptionLabel = (
  locale: StudioLocale,
  fullName: string,
  rower: RowerSpec
) => {
  const append = [
    rower.category,
    rower.type ? APP_LOCALES[locale].seriousness[rower.type] : undefined,
  ].filter(Boolean);
  return `${fullName} ${append.length > 0 ? `(${append.join(" - ")})` : ""}`;
};

/** The e-mail address of a fictional member (initial.last, short enough for its field) at a domain reserved for tests. */
const emailOf = (firstName: string, lastName: string) =>
  `${simplifyString(firstName).charAt(0)}.${simplifyString(lastName)}@mail.test`.replace(
    /\s+/g,
    "-"
  );

/** The extra fields of the featured rower's file (Member profile module). */
const memberProfileOf = (
  content: LocaleContent,
  firstName: string,
  lastName: string
) => ({
  licenseNumber: content.scenario.memberProfile.licenseNumber,
  email: emailOf(firstName, lastName),
  phone: content.scenario.memberProfile.phone,
  address: content.scenario.memberProfile.address,
  note: content.scenario.memberProfile.note,
});

export interface SeedPlan {
  club: ClubStructure;
  outings: PlannedOuting[];
  stopOutingId: string;
  earlyDoubleId: string;
  earlyDoubleBoatKey: string;
  incidents: ReturnType<typeof planIncidents>;
}

/** Everything locale-independent the seed writes (exposed for the tests). */
export const planClub = (
  now: string,
  onWater: "all" | "one" = "all"
): SeedPlan => {
  const { day, minutes } = parseLocalDateTime(now);
  const club = buildClubStructure();
  const { outings } = planHistory(club, day);
  capRowerOutings(club, outings, FEATURED.rower, {
    from: `${seasonOf(day)}-08-01`,
    to: addDays(day, -1),
    max: FEATURED_ROWER_OUTINGS,
  });
  lendCoxes(outings, LENT_COXES, {
    from: `${seasonOf(day)}-08-01`,
    to: addDays(day, -1),
    groups: ["juniors", "recreational"],
    keep: [FEATURED.rower],
  });
  const today = planToday(club, day, minutes, onWater);
  const incidents = planIncidents(club, outings, day);
  return {
    club,
    outings: [...outings, ...today.outings],
    stopOutingId: today.stopOutingId,
    earlyDoubleId: today.earlyDoubleId,
    earlyDoubleBoatKey: today.earlyDoubleBoatKey,
    incidents,
  };
};

/** The rows `insertOuting` writes, in multi-row inserts (same values, far fewer statements). */
const insertOutingsInBulk = async (db: SqlClient, outings: OutingToSave[]) => {
  const now = new Date().toISOString();
  const rows = outings.map((outing) => [
    outing.id,
    outing.boatId,
    outing.boatConfigurationId ?? null,
    outing.routeId ?? null,
    outing.outingTypeCode ?? null,
    outing.startDateTime,
    outing.estimatedEndDateTime ?? null,
    outing.endDateTime ?? null,
    outing.distanceM ?? null,
    outing.comment || null,
    outing.hasBeenCoached === true
      ? 1
      : outing.hasBeenCoached === false
        ? 0
        : null,
    outing.captainRowerId ?? null,
    now,
    now,
  ]);
  for (const sql of buildInsertStatements(
    "outing",
    [
      "id",
      "boat_id",
      "boat_configuration_id",
      "route_id",
      "outing_type_code",
      "start_date_time",
      "estimated_end_date_time",
      "end_date_time",
      "distance_m",
      "comment",
      "has_been_coached",
      "captain_rower_id",
      "created_at",
      "updated_at",
    ],
    rows
  )) {
    await db.execute(sql);
  }
  const crewRows = outings.flatMap((outing) =>
    outing.crew
      .filter(
        (member, index) =>
          outing.crew.findIndex((other) => other.rowerId === member.rowerId) ===
          index
      )
      .map((member, position) => [
        outing.id,
        member.rowerId,
        member.role,
        position,
      ])
  );
  for (const sql of buildInsertStatements(
    "outing_crew",
    ["outing_id", "rower_id", "role", "position"],
    crewRows,
    { chunkSize: 500 }
  )) {
    await db.execute(sql);
  }
};

/** What a variant of the seed can read once the names are composed. */
export interface SeedContext {
  options: SeedOptions;
  content: LocaleContent;
  plan: SeedPlan;
  names: ClubNames;
  /** Incident reports, in the order of `plan.incidents`. */
  messages: string[];
  /** Id of a club rower or of an extra rower, by key. */
  rowerId: (key: string) => string;
  rowerName: (key: string) => {
    firstName: string;
    lastName: string;
    fullName: string;
  };
  boatName: (key: string) => string;
}

/**
 * The studio seeds the same club for every scene (`seedClub`). The Logbook's
 * demo mode starts from it and changes what it needs through a variant; the
 * studio never passes one, so its data does not depend on any of this.
 */
export interface SeedVariant {
  /** Replaces `planClub` (outings, incidents) for another calendar. */
  plan?: (now: string, onWater?: "all" | "one") => SeedPlan;
  /** Last word on the plan, after the `analytics` profile changed the crews. */
  afterPlan?: (plan: SeedPlan) => void;
  /** Writes outings and their crews in multi-row inserts: far fewer statements. */
  bulk?: boolean;
  /** Rowers outside the club structure (guests), named by the keys of the planned crews. */
  extraRowers?: (context: SeedContext) => { key: string; rower: ClubRower }[];
  /** Adds fields to a member record. */
  decorateRower?: (
    rower: ClubRower,
    spec: RowerSpec,
    context: SeedContext
  ) => ClubRower;
  /** The database is already migrated (and `db` may only record statements). */
  migrated?: boolean;
  /** The studio's reservations are written for its fixed clock: a variant brings its own. */
  skipStudioReservations?: boolean;
  /** Runs inside the transaction, after everything else is written. */
  finish?: (db: SqlClient, context: SeedContext) => Promise<void>;
}

export const seedClubWith = async (
  db: SqlClient,
  options: SeedOptions,
  variant: SeedVariant = {}
) => {
  const content = CONTENT[options.locale];
  if (!content) throw new Error(`No content pack for ${options.locale}`);
  validateContent(content);

  const plan = (variant.plan ?? planClub)(options.now, options.onWater);
  const { club } = plan;
  // Opt-in profile of the Statistiques scenes; the landing club is left as is without it.
  let analyticsHistory: AnalyticsHistory | null = null;
  if (options.analytics?.outings === false) {
    plan.outings = [];
    plan.incidents = [];
  } else if (options.analytics) {
    const extended = planAnalyticsHistory({
      club,
      outings: plan.outings,
      today: parseLocalDateTime(options.now).day,
      incidentOutingIds: new Set(
        plan.incidents.map((incident) => incident.outingId)
      ),
      keep: [FEATURED.rower, ...FEATURED.startCrew, ...Object.keys(LENT_COXES)],
    });
    plan.outings = extended.outings;
    analyticsHistory = extended.history;
  }
  variant.afterPlan?.(plan);
  const names = composeNames(club, content);
  const messages = pickIncidentMessages(
    club,
    plan.incidents,
    content.incidents,
    content.locale
  );
  const rowerName = (key: string) => names.rowers.get(key)!;
  const boatName = (key: string) => names.boats.get(key)!;
  const extraRowerIds = new Map<string, string>();
  const rowerId = (key: string) => {
    const id = club.rowerByKey.get(key)?.id ?? extraRowerIds.get(key);
    if (id === undefined) throw new Error(`Unknown rower ${key}`);
    return id;
  };
  const context: SeedContext = {
    options,
    content,
    plan,
    names,
    messages,
    rowerId,
    rowerName,
    boatName,
  };
  const extraRowers = variant.extraRowers?.(context) ?? [];
  for (const { key, rower } of extraRowers) extraRowerIds.set(key, rower.id);

  const modules = normalizeModuleIds(options.modules ?? []);
  let reservations: ReservationScenario | null = null;
  let damages: DamageScenario | null = null;

  if (!variant.migrated) await applyMigrations(db);
  let analyticsScenario: AnalyticsScenario | null = null;
  await db.execute("BEGIN");
  try {
    // An empty database is expected; a second seed replaces the first.
    await deleteAllClubData(db);

    await saveSetting(db, SETTING_ONBOARDING_DONE, true);
    await saveSetting(db, SETTING_PASSWORD_HASH, hashPassword(ADMIN_PASSWORD));
    // What a club onboarded with the simple profile has (no module), unless the scene turns some
    // on; suggestions answered.
    await saveSetting(db, SETTING_MODULES_ENABLED, modules);
    await saveSetting(db, SETTING_MODULES_DISMISSED_SUGGESTIONS, [
      ...MODULE_IDS,
    ]);
    await saveSetting(
      db,
      SETTING_BOAT_TYPE_LEVEL_CONFIGS,
      DEFAULT_BOAT_TYPE_LEVEL_CONFIGS
    );
    await saveSetting(db, SETTING_CLUB_LATITUDE, CLUB_LOCATION.latitude);
    await saveSetting(db, SETTING_CLUB_LONGITUDE, CLUB_LOCATION.longitude);
    // A scene of the coach note only: the other scenes show no banner.
    if (options.coachNote)
      await saveSetting(db, SETTING_COACH_NOTE, content.coachNote);

    for (const boat of club.boats) {
      const clubBoat: ClubBoat = {
        id: boat.id,
        name: boatName(boat.key),
        note: "",
        isInMaintenance: boat.maintenanceFrom !== null,
        configurations: withSingleDefault(
          boat.configurations.map((configuration) => ({
            id: configuration.id,
            ...CLASS_SHAPES[configuration.cls],
            hullType: null,
            isDefault: configuration.position === 0,
            position: configuration.position,
          }))
        ),
      };
      await saveBoat(db, clubBoat);
      if (boat.level)
        await saveBoatLevelConfig(db, { boatId: boat.id, ...boat.level });
    }

    for (const rower of club.rowers) {
      const { firstName, lastName, fullName } = rowerName(rower.key);
      // With the Member profile module, the featured rower's file is complete.
      const profile =
        modules.includes("memberProfile") && rower.key === FEATURED.rower
          ? memberProfileOf(content, firstName, lastName)
          : {};
      const clubRower: ClubRower = {
        id: rower.id,
        name: fullName,
        firstName,
        lastName,
        status: "member",
        category: rower.category,
        type: rower.type,
        gender: rower.gender,
        birthDate: rower.birthDate,
        ...profile,
      };
      await saveRower(
        db,
        variant.decorateRower?.(clubRower, rower, context) ?? clubRower
      );
    }
    for (const { rower } of extraRowers) await saveRower(db, rower);

    if (analyticsHistory) {
      const extras = analyticsHistory.extraRowers;
      await saveExtraRowers(
        db,
        extras,
        nameExtraRowers(content, names, extras)
      );
      await saveExtraBoats(db, analyticsHistory.extraBoats);
    }

    for (const route of club.routes) {
      await saveRoute(db, {
        id: route.id,
        name: names.routes[route.slot],
        distanceM: route.distanceM,
      });
    }

    const toSave = plan.outings.map(
      (outing): OutingToSave => ({
        id: outing.id,
        boatId: club.boatByKey.get(outing.boatKey)!.id,
        boatConfigurationId: outing.configurationId,
        routeId:
          outing.routeSlot === null ? null : club.routes[outing.routeSlot].id,
        outingTypeCode: outing.outingTypeCode,
        startDateTime: outingStart(outing),
        estimatedEndDateTime: outingEstimatedEnd(outing),
        endDateTime: outingEnd(outing),
        distanceM: outing.distanceM,
        comment:
          outing.commentSlot === null
            ? null
            : content.outingComments[outing.commentSlot],
        hasBeenCoached: outing.hasBeenCoached,
        captainRowerId: outing.captainKey ? rowerId(outing.captainKey) : null,
        crew: outing.crew.map((member) => ({
          rowerId: rowerId(member.rowerKey),
          role: member.role,
        })),
      })
    );
    if (variant.bulk) {
      await insertOutingsInBulk(db, toSave);
    } else {
      for (const outing of toSave) await insertOuting(db, outing);
    }

    for (const [index, incident] of plan.incidents.entries()) {
      await insertIncident(db, {
        id: incident.id,
        boatId: club.boatByKey.get(incident.boatKey)!.id,
        message: messages[index],
        sessionId: incident.outingId,
        datetime: incident.occurredAt,
      });
    }

    // A boat in maintenance is out of service through an unusable damage,
    // reported with the incident of its last outing.
    for (const boat of club.boats) {
      if (boat.maintenanceFrom === null) continue;
      const index = plan.incidents.reduce(
        (last, incident, i) =>
          incident.boatKey === boat.key &&
          incident.occurredAt < boat.maintenanceFrom!
            ? i
            : last,
        -1
      );
      const incident = plan.incidents[index];
      await saveBoatDamage(db, {
        id: idFor("damage", boat.key),
        boatId: boat.id,
        kind: "damage",
        severity: "unusable",
        description: index === -1 ? "" : messages[index],
        reportedAt: incident?.occurredAt ?? `${boat.maintenanceFrom}T00:00`,
        reportedByRowerId: null,
        outingId: incident?.outingId ?? null,
        incidentId: incident?.id ?? null,
        fixedAt: null,
        fixedByRowerId: null,
        repairNote: null,
        repairCost: null,
      });
    }

    if (modules.includes("reservations") && !variant.skipStudioReservations) {
      const { day, minutes } = parseLocalDateTime(options.now);
      reservations = await seedReservations(db, {
        club,
        content,
        day,
        minutes,
        rowerNames: (key) => rowerName(key).fullName,
        boatNames: boatName,
      });
    }

    if (modules.includes("damages")) {
      const { day } = parseLocalDateTime(options.now);
      damages = await seedDamages(db, {
        club,
        content,
        day,
        boatNames: boatName,
        rowerNames: (key) => rowerName(key).fullName,
      });
    }

    if (options.analytics) {
      analyticsScenario = await seedAnalyticsData(db, {
        content,
        options: options.analytics,
        now: options.now,
        history: analyticsHistory,
        boatIds: club.boats.map((boat) => boat.id),
      });
    }
    await variant.finish?.(db, context);

    await db.execute("COMMIT");
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }

  const startBoat = club.boatByKey.get(FEATURED.startBoat)!;
  const startRoute = club.routes[FEATURED.startRouteSlot];
  const stopBoat = club.boatByKey.get(FEATURED.stopBoat)!;
  const statsBoat = club.boatByKey.get(FEATURED.statsBoat)!;
  const featuredRower = club.rowerByKey.get(FEATURED.rower)!;

  const lateBoat = club.boatByKey.get(LATE_OUTING.boat)!;
  const lateRoute = club.routes[LATE_OUTING.routeSlot];
  const { day: today } = parseLocalDateTime(options.now);
  const yesterday = addDays(today, -1);
  const past: PastOutingScenario = {
    late: {
      boatId: lateBoat.id,
      boatName: boatName(lateBoat.key),
      routeId: lateRoute.id,
      routeName: names.routes[lateRoute.slot],
      crew: LATE_OUTING.crew.map((key) => {
        const rower = club.rowerByKey.get(key)!;
        return {
          id: rower.id,
          name: crewOptionLabel(content.locale, rowerName(key).fullName, rower),
        };
      }),
      start: toLocalDateTime(yesterday, LATE_OUTING.start),
      end: toLocalDateTime(yesterday, LATE_OUTING.end),
      comment: content.scenario.lateComment,
    },
    edit: {
      outingId: plan.earlyDoubleId,
      boatName: boatName(plan.earlyDoubleBoatKey),
    },
  };

  const scenario: Scenario = {
    locale: content.locale,
    clubName: content.clubName,
    start: {
      boatId: startBoat.id,
      boatName: boatName(startBoat.key),
      routeId: startRoute.id,
      routeName: names.routes[startRoute.slot],
      crew: FEATURED.startCrew.map((key) => {
        const rower = club.rowerByKey.get(key)!;
        return {
          id: rower.id,
          name: crewOptionLabel(content.locale, rowerName(key).fullName, rower),
        };
      }),
      typed: FEATURED.startCrew.length - 1,
    },
    stop: {
      outingId: plan.stopOutingId,
      boatId: stopBoat.id,
      boatName: boatName(stopBoat.key),
    },
    rower: {
      id: featuredRower.id,
      name: rowerName(featuredRower.key).fullName,
    },
    boat: { id: statsBoat.id, name: boatName(statsBoat.key) },
    reservations,
    damages,
    past,
    counts: {
      boats: club.boats.length,
      rowers: club.rowers.length,
      routes: club.routes.length,
      outings: plan.outings.length,
      incidents: plan.incidents.length,
    },
    ...(analyticsScenario ? { analytics: analyticsScenario } : {}),
  };
  return scenario;
};

export const seedClub: SeedClub = (db, options) => seedClubWith(db, options);
