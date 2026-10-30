import { v5 } from "uuid";
import { buildInsertStatements, sqlLiteral } from "../database/sqlClient";
import { V2_DATA_TABLES_IN_DELETE_ORDER } from "../database/v1Migration/planV1Migration";
import { ModuleId, normalizeModuleIds } from "../business/modules.rules";
import { SETTING_MODULES_ENABLED } from "../store/modules.store";
import {
  Efa2Project,
  Efa2StorageObject,
  findObject,
  findObjects,
} from "./efa2Project";
import { Efa2Fields } from "./efa2Xml";
import { damageFromEfa, efaDate } from "./efa2Damages";
import { getDateTimeWithoutTimezone } from "../utils/date.utils";
import {
  efaBoolean,
  efaDateToIso,
  efaDistanceToMetres,
  efaList,
  efaTimeToHhMm,
  efaTimestamp,
} from "./efa2Values";

/**
 * Turn an efa2 project into the statements that replace the club data
 * (ADR 0004). Pure: the caller makes a backup, then runs the statements as
 * one script (one transaction on one connection), which checks its own
 * row counts before committing.
 */

/** Namespace of the ids derived from efa keys (outings, guests, configurations…). */
const EFA2_ID_NAMESPACE = "6f1c2a52-3a0e-4a0e-9a8a-6c0f2c1f6e11";
export const deriveEfa2Id = (name: string) => v5(name, EFA2_ID_NAMESPACE);

/** Key fields of each storage object, as efa2 defines them. */
const KEY_FIELDS: Record<string, string[]> = {
  efa2project: ["Type", "Name"],
  efa2boats: ["Id", "ValidFrom"],
  efa2persons: ["Id", "ValidFrom"],
  efa2groups: ["Id", "ValidFrom"],
  efa2destinations: ["Id", "ValidFrom"],
  efa2status: ["Id"],
  efa2crews: ["Id"],
  efa2waters: ["Id"],
  efa2boatstatus: ["BoatId"],
  efa2boatdamages: ["BoatId", "Damage"],
  efa2boatreservations: ["BoatId", "Reservation"],
  efa2messages: ["MessageId"],
  efa2sessiongroups: ["Id"],
  efa2fahrtenabzeichen: ["PersonId"],
  efa2statistics: ["Id"],
  efa2autoincrement: ["Sequence"],
  efa2logbook: ["EntryId"],
  efa2clubwork: ["Id"],
};

export const getEfa2RecordKey = (
  type: string,
  record: Efa2Fields,
  position: number
) => {
  const fields = KEY_FIELDS[type];
  const parts = fields?.map((field) => record[field] ?? "");
  return parts && parts.some((part) => part !== "")
    ? parts.join("|")
    : `#${position}`;
};

/** efa2 session types → built-in outing types (outing_type table). */
const SESSION_TYPE_TO_OUTING_TYPE: Record<string, string> = {
  NORMAL: "normal",
  LATEENTRY: "normal",
  TRAINING: "training",
  REGATTA: "regatta",
  JUMREGATTA: "regatta",
  TRAININGCAMP: "training_camp",
  INSTRUCTION: "instruction",
  TOUR: "tour",
  CLUBTRIP: "club_trip",
  GROUPTRIP: "club_trip",
  ERG: "ergometer",
  MOTORBOAT: "motorboat",
};

export const toOutingTypeCode = (sessionType: string) =>
  SESSION_TYPE_TO_OUTING_TYPE[sessionType] ??
  `efa_${sessionType.toLowerCase()}`;

const STATUS_TYPE_TO_ROWER_STATUS: Record<
  string,
  "member" | "guest" | "other"
> = {
  USER: "member",
  GUEST: "guest",
  OTHER: "other",
};

export interface Efa2ImportLabels {
  /** Note of a boat created from a free boat name. */
  externalBoatNote: string;
  /** Prefix of the group made from each efa2 status, e.g. "Statut : ". */
  statusGroupPrefix: string;
  /** Comment added to an outing left open in efa before today, closed by the import. */
  closedOpenOutingNote: string;
}

export interface Efa2ImportPlan {
  statements: string[];
  /** Row counts to check after running the statements. */
  expected: Record<string, number>;
  /** Modules worth turning on because the project has their data. */
  modules: ModuleId[];
  report: {
    boats: number;
    externalBoats: number;
    rowers: number;
    guests: number;
    routes: number;
    outings: number;
    ongoingOutings: number;
    /** Outings left open in efa before today, closed by the import. */
    closedOpenOutings: number;
    /** Free names matching several records, attached to a guest instead. */
    ambiguousNames: number;
    /** Logbook entries without date or number: kept as is, not shown. */
    unreadableEntries: number;
    /** efa2 damage reports not fixed yet, imported as open damages. */
    openDamages: number;
    /** efa2 damage reports already fixed, imported as fixed damages. */
    fixedDamages: number;
    /** Boats efa2 shows as not available, imported as "unavailable" entries. */
    unavailableBoats: number;
    /** Reservations imported (past ones included). */
    reservations: number;
    groups: number;
    logbooks: string[];
    /** efa2 records kept without a screen, by storage type. */
    keptWithoutScreen: Record<string, number>;
  };
}

/** Records of a versioned object grouped by Id, latest version last. */
const groupVersions = (records: Efa2Fields[]) => {
  const byId = new Map<string, Efa2Fields[]>();
  for (const record of records) {
    if (!record.Id) continue;
    const list = byId.get(record.Id) ?? [];
    list.push(record);
    byId.set(record.Id, list);
  }
  for (const list of byId.values()) {
    list.sort(
      (a, b) =>
        (efaTimestamp(a.ValidFrom) ?? 0) - (efaTimestamp(b.ValidFrom) ?? 0)
    );
  }
  return byId;
};

const msToIso = (value: string | undefined, fallback: string) => {
  const ms = efaTimestamp(value);
  const date = ms === null ? null : new Date(ms);
  // A damaged timestamp out of the Date range falls back too.
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : fallback;
};

export const normalizeName = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

/** "Mustermann, Max" (efa's form) or "Max Mustermann" → first / last. */
export const splitFreeName = (name: string) => {
  const text = name.trim().replace(/\s+/g, " ");
  if (text.includes(",")) {
    const [last, ...rest] = text.split(",");
    const first = rest.join(",").trim();
    // "Max," has no first name: the name is all there is.
    return first
      ? { firstName: first, lastName: last.trim() }
      : { firstName: last.trim(), lastName: "" };
  }
  const index = text.lastIndexOf(" ");
  return index === -1
    ? { firstName: text, lastName: "" }
    : { firstName: text.slice(0, index), lastName: text.slice(index + 1) };
};

/** "4X" → 4 rowing seats, "8" → 8, "OTHER" → unknown. */
const seatsFromEfa = (value: string | undefined) => {
  const match = value ? /^(\d+)/.exec(value) : null;
  return match ? Number(match[1]) : null;
};

const riggingFromEfa = (value: string | undefined) =>
  value === "SCULL" ? "scull" : value === "SWEEP" ? "sweep" : null;

const genderFromEfa = (value: string | undefined) =>
  value === "MALE" ? "male" : value === "FEMALE" ? "female" : null;

/** The configurations a boat record describes, one per efa2 variant. */
export const configurationsFromEfa = (boatId: string, boat: Efa2Fields) => {
  const variants = efaList(boat.TypeVariant);
  const seats = efaList(boat.TypeSeats);
  const rigging = efaList(boat.TypeRigging);
  const coxing = efaList(boat.TypeCoxing);
  const hulls = efaList(boat.TypeType);
  const defaultVariant = boat.DefaultVariant || variants[0];
  return variants.flatMap((variant, index) => {
    // A lone variant saying nothing ("OTHER" everywhere) is no configuration.
    const unknown = [seats, rigging, coxing, hulls].every(
      (list) => !list[index] || list[index] === "OTHER"
    );
    if (unknown && variants.length === 1) return [];
    return [
      {
        id: deriveEfa2Id(`configuration:${boatId}:${variant}`),
        variant,
        position: index,
        seats: seatsFromEfa(seats[index]),
        rigging: riggingFromEfa(rigging[index]),
        coxed: coxing[index] === "COXED" ? 1 : 0,
        hullType: hulls[index] || null,
        isDefault: variant === defaultVariant ? 1 : 0,
      },
    ];
  });
};

const joinNonEmpty = (parts: (string | undefined)[], separator: string) => {
  const kept = parts.map((part) => part?.trim()).filter(Boolean);
  return kept.length ? kept.join(separator) : null;
};

/** "2025-12-31" → "2026-01-01". */
const nextDay = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Where each key last appears, to keep the last of repeated records. */
const lastPositionByKey = (
  records: Efa2Fields[],
  keyOf: (record: Efa2Fields) => string | undefined
) => {
  const last = new Map<string, number>();
  records.forEach((record, position) => {
    const key = keyOf(record);
    if (key !== undefined) last.set(key, position);
  });
  return last;
};

const isExpired = (record: Efa2Fields, nowMs: number) => {
  const invalidFrom = efaTimestamp(record.InvalidFrom);
  return invalidFrom !== null && invalidFrom <= nowMs;
};

/**
 * efa2 has no open-ended weekly reservation with only one bound, so Rowing
 * Beacon writes a missing bound of a limited weekly reservation as one of
 * these far dates; the import reads them back as "no bound".
 */
export const RESERVATION_FAR_PAST = "1970-01-01";
export const RESERVATION_FAR_FUTURE = "2999-12-31";

const EFA2_DAYS_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

/** The part of a reservation that is not its holder, as Rowing Beacon stores it. */
export interface Efa2ReservationTiming {
  recurrence: "once" | "weekly";
  startDate: string | null;
  endDate: string | null;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
}

/**
 * What an efa2 reservation record means for Rowing Beacon, or null when it
 * cannot be read (a one-time reservation without date, a weekly one without
 * a day of the week, no times…): such a record is only kept.
 */
export const readEfa2ReservationTiming = (
  record: Efa2Fields
): Efa2ReservationTiming | null => {
  const startTime = efaTimeToHhMm(record.TimeFrom);
  const endTime = efaTimeToHhMm(record.TimeTo);
  if (!startTime || !endTime) return null;
  const dateFrom = efaDateToIso(record.DateFrom);
  const dateTo = efaDateToIso(record.DateTo);

  if (record.Type === "ONETIME") {
    const startDate = dateFrom ?? dateTo;
    if (!startDate) return null;
    return {
      recurrence: "once",
      startDate,
      endDate: dateTo ?? startDate,
      dayOfWeek: null,
      startTime,
      endTime,
    };
  }
  if (record.Type === "WEEKLY" || record.Type === "WEEKLY_LIMITED") {
    const dayIndex = EFA2_DAYS_OF_WEEK.indexOf(record.DayOfWeek ?? "");
    if (dayIndex === -1) return null;
    const limited = record.Type === "WEEKLY_LIMITED";
    return {
      recurrence: "weekly",
      startDate:
        limited && dateFrom && dateFrom > RESERVATION_FAR_PAST
          ? dateFrom
          : null,
      endDate:
        limited && dateTo && dateTo < RESERVATION_FAR_FUTURE ? dateTo : null,
      dayOfWeek: dayIndex + 1,
      startTime,
      endTime,
    };
  }
  return null;
};

/**
 * A schedule the app can show and edit: times within the day and an end
 * after the start. Other ones (an overnight weekly slot, a "24:00") stay
 * as efa records and come back unchanged in the export.
 */
const isUsableReservationTiming = (timing: Efa2ReservationTiming) => {
  const withinDay = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!withinDay(timing.startTime) || !withinDay(timing.endTime)) return false;
  if (timing.startDate && timing.endDate && timing.endDate < timing.startDate)
    return false;
  if (timing.recurrence === "once")
    return (
      `${timing.endDate}T${timing.endTime}` >
      `${timing.startDate}T${timing.startTime}`
    );
  return timing.endTime > timing.startTime;
};

export const efa2DayOfWeek = (dayOfWeek: number) =>
  EFA2_DAYS_OF_WEEK[dayOfWeek - 1];

export const planEfa2Import = ({
  project,
  labels,
  now = new Date(),
  enabledModules = [],
}: {
  project: Efa2Project;
  labels: Efa2ImportLabels;
  now?: Date;
  /** Modules already on; the import adds the ones it brings data for. */
  enabledModules?: ModuleId[];
}): Efa2ImportPlan => {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const records = (type: string) => findObject(project, type)?.records ?? [];

  const efaRows: unknown[][] = [];
  const keepEfaRecord = (
    object: Pick<Efa2StorageObject, "type" | "name">,
    record: Efa2Fields,
    position: number,
    rb?: { table: string; id: string }
  ) => {
    efaRows.push([
      object.type,
      object.name,
      getEfa2RecordKey(object.type, record, position),
      position,
      rb?.table ?? null,
      rb?.id ?? null,
      JSON.stringify(record),
    ]);
  };
  /** rb links decided while mapping, by "type|name|key". */
  const links = new Map<string, { table: string; id: string }>();
  const link = (
    type: string,
    name: string,
    record: Efa2Fields,
    position: number,
    rb: { table: string; id: string }
  ) =>
    links.set(
      `${type}|${name}|${getEfa2RecordKey(type, record, position)}`,
      rb
    );

  // ----- Persons -----
  const statuses = new Map(
    records("efa2status").map((status) => [status.Id, status])
  );
  const personVersions = groupVersions(records("efa2persons"));
  const rowerRows: unknown[][] = [];
  const rowerIds = new Set<string>();
  const personsByStatus = new Map<string, string[]>();
  const activeRowerIds = new Set<string>();
  let hasMemberProfile = false;

  const personsObject = findObject(project, "efa2persons");
  for (const [id, versions] of personVersions) {
    const latest = versions[versions.length - 1];
    const status = statuses.get(latest.StatusId ?? "");
    const archived = efaBoolean(latest.Deleted) || isExpired(latest, nowMs);
    const lastName =
      joinNonEmpty([latest.LastName, latest.NameAffix], " ") ?? "";
    const address = joinNonEmpty(
      [
        latest.AddressStreet,
        latest.AddressAdditional,
        joinNonEmpty([latest.AddressZip, latest.AddressCity], " ") ?? undefined,
        latest.AddressCountry,
      ],
      ", "
    );
    const profile = [
      latest.Birthday,
      latest.Email,
      address,
      latest.MembershipNo,
    ];
    if (profile.some(Boolean)) hasMemberProfile = true;

    rowerRows.push([
      id,
      latest.FirstName || latest.LastName || "?",
      latest.FirstName ? lastName : "",
      STATUS_TYPE_TO_ROWER_STATUS[status?.Type ?? ""] ?? "member",
      genderFromEfa(latest.Gender),
      efaDateToIso(latest.Birthday),
      latest.Email || null,
      latest.MembershipNo || null,
      address,
      efaBoolean(latest.ExcludeFromStatistics) ? 1 : 0,
      archived ? msToIso(latest.InvalidFrom, nowIso) : null,
      msToIso(versions[0].LastModified, nowIso),
      msToIso(latest.LastModified, nowIso),
    ]);
    rowerIds.add(id);
    if (!archived) activeRowerIds.add(id);
    if (latest.StatusId) {
      personsByStatus.set(latest.StatusId, [
        ...(personsByStatus.get(latest.StatusId) ?? []),
        id,
      ]);
    }
    if (personsObject) {
      const position = personsObject.records.indexOf(latest);
      link("efa2persons", personsObject.name, latest, position, {
        table: "rower",
        id,
      });
    }
  }

  // ----- Boats and their variants -----
  const boatVersions = groupVersions(records("efa2boats"));
  const boatStatuses = new Map(
    records("efa2boatstatus")
      .filter((status) => !efaBoolean(status.UnknownBoat))
      .map((status) => [status.BoatId, status])
  );
  const boatRows: unknown[][] = [];
  const configurationRows: unknown[][] = [];
  const boatIds = new Set<string>();
  const configurationIds = new Map<string, string>();

  const boatsObject = findObject(project, "efa2boats");
  for (const [id, versions] of boatVersions) {
    const latest = versions[versions.length - 1];
    const boatStatus = boatStatuses.get(id);
    const archived =
      efaBoolean(latest.Deleted) ||
      isExpired(latest, nowMs) ||
      boatStatus?.BaseStatus === "HIDE";
    boatRows.push([
      id,
      latest.Name || "?",
      null,
      0,
      latest.Owner || null,
      latest.Manufacturer || null,
      latest.Model || null,
      latest.SerialNo || null,
      efaDateToIso(latest.ManufactionDate)?.slice(0, 4) ?? null,
      efaDateToIso(latest.PurchaseDate),
      latest.MaxCrewWeight ? Number(latest.MaxCrewWeight) : null,
      efaBoolean(latest.ExcludeFromStatistics) ? 1 : 0,
      archived ? msToIso(latest.InvalidFrom, nowIso) : null,
      msToIso(versions[0].LastModified, nowIso),
      msToIso(latest.LastModified, nowIso),
    ]);
    boatIds.add(id);

    for (const configuration of configurationsFromEfa(id, latest)) {
      configurationIds.set(`${id}:${configuration.variant}`, configuration.id);
      configurationRows.push([
        configuration.id,
        id,
        configuration.position,
        configuration.seats,
        configuration.rigging,
        configuration.coxed,
        configuration.hullType,
        configuration.isDefault,
      ]);
    }
    if (boatsObject) {
      const position = boatsObject.records.indexOf(latest);
      link("efa2boats", boatsObject.name, latest, position, {
        table: "boat",
        id,
      });
    }
  }

  // ----- Destinations -----
  const destinationVersions = groupVersions(records("efa2destinations"));
  const routeRows: unknown[][] = [];
  const routeIds = new Set<string>();
  let hasDistances = false;
  const destinationsObject = findObject(project, "efa2destinations");
  for (const [id, versions] of destinationVersions) {
    const latest = versions[versions.length - 1];
    const distance = efaDistanceToMetres(latest.Distance);
    if (distance) hasDistances = true;
    const archived = efaBoolean(latest.Deleted) || isExpired(latest, nowMs);
    routeRows.push([
      id,
      latest.Name || "?",
      distance,
      null,
      archived ? msToIso(latest.InvalidFrom, nowIso) : null,
      msToIso(versions[0].LastModified, nowIso),
      msToIso(latest.LastModified, nowIso),
    ]);
    routeIds.add(id);
    if (destinationsObject) {
      const position = destinationsObject.records.indexOf(latest);
      link("efa2destinations", destinationsObject.name, latest, position, {
        table: "route",
        id,
      });
    }
  }

  // ----- Free names become guests, external boats and archived routes -----
  // A free name that matches a record (typed by hand in efa, or left by
  // efa when it purged a deleted record) points to that record instead.
  const knownRowers = new Map<string, Set<string>>();
  for (const [id, versions] of personVersions) {
    for (const person of versions) {
      const first = person.FirstName ?? "";
      for (const last of [
        person.LastName ?? "",
        joinNonEmpty([person.LastName, person.NameAffix], " ") ?? "",
      ]) {
        for (const name of [`${first} ${last}`, `${last}, ${first}`]) {
          const key = normalizeName(name);
          knownRowers.set(key, (knownRowers.get(key) ?? new Set()).add(id));
        }
      }
    }
  }
  /** The one record a free name means: the active one among homonyms. */
  const ambiguousNames = new Set<string>();
  const knownRowerFor = (key: string) => {
    const candidates = [...(knownRowers.get(key) ?? [])];
    const active = candidates.filter((id) => activeRowerIds.has(id));
    if (active.length === 1) return active[0];
    if (active.length === 0 && candidates.length === 1) return candidates[0];
    if (candidates.length > 1) ambiguousNames.add(key);
    return undefined;
  };
  /** Name → id, the active record winning over archived homonyms. */
  const byName = (rows: unknown[][], archivedAt: number) =>
    new Map(
      [
        ...rows.filter((row) => row[archivedAt] !== null),
        ...rows.filter((row) => row[archivedAt] === null),
      ].map((row) => [normalizeName(String(row[1])), String(row[0])])
    );
  const knownBoats = byName(boatRows, 12);
  const knownRoutes = byName(routeRows, 4);

  const guestIds = new Map<string, string>();
  const guestFor = (name: string) => {
    const key = normalizeName(name);
    const known = knownRowerFor(key);
    if (known) return known;
    let id = guestIds.get(key);
    if (!id) {
      id = deriveEfa2Id(`guest:${key}`);
      guestIds.set(key, id);
      const { firstName, lastName } = splitFreeName(name);
      rowerRows.push([
        id,
        firstName,
        lastName,
        "guest",
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        nowIso,
        nowIso,
      ]);
      rowerIds.add(id);
    }
    return id;
  };
  const externalBoatIds = new Map<string, string>();
  const externalBoatFor = (name: string) => {
    const key = normalizeName(name);
    const known = knownBoats.get(key);
    if (known) return known;
    let id = externalBoatIds.get(key);
    if (!id) {
      id = deriveEfa2Id(`boat:${key}`);
      externalBoatIds.set(key, id);
      boatRows.push([
        id,
        name.trim(),
        labels.externalBoatNote,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        nowIso,
        nowIso,
        nowIso,
      ]);
      boatIds.add(id);
    }
    return id;
  };
  const freeRouteIds = new Map<string, string>();
  const freeRouteFor = (name: string) => {
    const key = normalizeName(name);
    const known = knownRoutes.get(key);
    if (known) return known;
    let id = freeRouteIds.get(key);
    if (!id) {
      id = deriveEfa2Id(`route:${key}`);
      freeRouteIds.set(key, id);
      routeRows.push([id, name.trim(), null, null, nowIso, nowIso, nowIso]);
      routeIds.add(id);
    }
    return id;
  };

  // ----- Logbooks -----
  const outingRows: unknown[][] = [];
  const crewRows: unknown[][] = [];
  const customOutingTypes = new Map<string, string>();
  let ongoingOutings = 0;
  let closedOpenOutings = 0;
  let unreadableEntries = 0;
  // An outing still open in efa on an earlier day was never closed there.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
  let hasOutingTypes = false;
  let hasCaptain = false;
  const logbooks = findObjects(project, "efa2logbook");

  for (const logbook of logbooks) {
    const lastPosition = lastPositionByKey(logbook.records, (e) => e.EntryId);
    logbook.records.forEach((entry, position) => {
      // A repeated EntryId can only come from a damaged file: keep the last.
      if (entry.EntryId && lastPosition.get(entry.EntryId) !== position) return;
      const date = efaDateToIso(entry.Date);
      if (!date || !entry.EntryId) {
        unreadableEntries++;
        return;
      }
      const id = deriveEfa2Id(`outing:${logbook.name}:${entry.EntryId}`);

      const boatId =
        entry.BoatId && boatIds.has(entry.BoatId)
          ? entry.BoatId
          : externalBoatFor(entry.BoatName || "?");
      const configurationId = entry.BoatVariant
        ? (configurationIds.get(`${boatId}:${entry.BoatVariant}`) ?? null)
        : null;

      let routeId: string | null = null;
      if (entry.DestinationId && routeIds.has(entry.DestinationId)) {
        routeId = entry.DestinationId;
      } else if (entry.DestinationName) {
        routeId = freeRouteFor(entry.DestinationName);
      }

      const sessionType = entry.SessionType || "NORMAL";
      const outingType = toOutingTypeCode(sessionType);
      if (outingType !== "normal") hasOutingTypes = true;
      if (!SESSION_TYPE_TO_OUTING_TYPE[sessionType]) {
        customOutingTypes.set(
          outingType,
          project.sessionTypeLabels[sessionType] ?? sessionType
        );
      }

      const startTime = efaTimeToHhMm(entry.StartTime) ?? "00:00";
      const leftOpen = efaBoolean(entry.Open) && date < today;
      const open = efaBoolean(entry.Open) && !leftOpen;
      const endTime = efaTimeToHhMm(entry.EndTime) ?? startTime;
      // Without an end date, an end time before the start is the next day.
      const endDate =
        efaDateToIso(entry.EndDate) ??
        (endTime < startTime ? nextDay(date) : date);
      if (open) ongoingOutings++;
      if (leftOpen) closedOpenOutings++;

      // Seat 0 is the cox, then Crew1…Crew24.
      const seats: { seat: number; rowerId: string }[] = [];
      for (let seat = 0; seat <= 24; seat++) {
        const prefix = seat === 0 ? "Cox" : `Crew${seat}`;
        const personId = entry[`${prefix}Id`];
        const freeName = entry[`${prefix}Name`];
        if (personId && rowerIds.has(personId)) {
          seats.push({ seat, rowerId: personId });
        } else if (freeName) {
          seats.push({ seat, rowerId: guestFor(freeName) });
        }
      }
      const seen = new Set<string>();
      for (const { seat, rowerId } of seats) {
        if (seen.has(rowerId)) continue;
        seen.add(rowerId);
        crewRows.push([id, rowerId, seat === 0 ? "cox" : "rower", seat]);
      }
      const captainSeat = entry.BoatCaptain ? Number(entry.BoatCaptain) : null;
      const captain =
        captainSeat === null
          ? null
          : (seats.find((seat) => seat.seat === captainSeat)?.rowerId ?? null);
      if (captain) hasCaptain = true;

      outingRows.push([
        id,
        boatId,
        configurationId,
        routeId,
        outingType,
        `${date}T${startTime}`,
        open ? null : `${endDate}T${endTime}`,
        efaDistanceToMetres(entry.Distance),
        leftOpen
          ? joinNonEmpty([entry.Comments, labels.closedOpenOutingNote], " ")
          : entry.Comments || null,
        captain,
        msToIso(entry.LastModified, nowIso),
        msToIso(entry.LastModified, nowIso),
      ]);
      link("efa2logbook", logbook.name, entry, position, {
        table: "outing",
        id,
      });
    });
  }
  if (outingRows.some((row) => row[7] !== null)) hasDistances = true;

  // ----- Damages, and boats efa2 shows as not available -----
  const damageRows: unknown[][] = [];
  let openDamages = 0;
  let fixedDamages = 0;
  const damagesObject = findObject(project, "efa2boatdamages");
  const lastDamage = lastPositionByKey(
    damagesObject?.records ?? [],
    (damage) => `${damage.BoatId}:${damage.Damage}`
  );
  const damageColumns = (
    id: string,
    kind: "damage" | "unavailable",
    values: ReturnType<typeof damageFromEfa>,
    timestamp: string
  ) => [
    id,
    values.boatId,
    kind,
    values.severity,
    values.description,
    values.reportedAt,
    values.reportedByRowerId,
    values.fixedAt,
    values.fixedByRowerId,
    values.repairNote,
    values.repairCost,
    timestamp,
    timestamp,
  ];
  damagesObject?.records.forEach((damage, position) => {
    if (lastDamage.get(`${damage.BoatId}:${damage.Damage}`) !== position)
      return;
    if (!boatIds.has(damage.BoatId)) return;
    const id = deriveEfa2Id(`damage:${damage.BoatId}:${damage.Damage}`);
    const values = damageFromEfa(damage, { rowerIds, now });
    damageRows.push(
      damageColumns(id, "damage", values, msToIso(damage.LastModified, nowIso))
    );
    if (values.fixedAt) fixedDamages++;
    else openDamages++;
    link("efa2boatdamages", damagesObject.name, damage, position, {
      table: "boat_damage",
      id,
    });
  });
  // The reason of an unavailable boat is the comment of its status.
  let unavailableBoats = 0;
  for (const [boatId, status] of boatStatuses) {
    if (status.BaseStatus !== "NOTAVAILABLE" || !boatIds.has(boatId)) continue;
    const reportedAt = getDateTimeWithoutTimezone(
      efaDate(status.LastModified) ?? now
    );
    damageRows.push(
      damageColumns(
        deriveEfa2Id(`unavailable:${boatId}`),
        "unavailable",
        {
          boatId,
          severity: "unusable",
          description: status.Comment ?? "",
          reportedAt,
          reportedByRowerId: null,
          fixedAt: null,
          fixedByRowerId: null,
          repairNote: null,
          repairCost: null,
        },
        msToIso(status.LastModified, nowIso)
      )
    );
    unavailableBoats++;
  }

  // ----- Reservations -----
  // Past ones too (history). A record that cannot be read, or whose boat
  // is unknown, is only kept in efa_record and comes back unchanged.
  const reservationRows: unknown[][] = [];
  const reservationsObject = findObject(project, "efa2boatreservations");
  const lastReservation = lastPositionByKey(
    reservationsObject?.records ?? [],
    (reservation) => `${reservation.BoatId}:${reservation.Reservation}`
  );
  reservationsObject?.records.forEach((reservation, position) => {
    if (
      lastReservation.get(
        `${reservation.BoatId}:${reservation.Reservation}`
      ) !== position
    )
      return;
    const number = Number(reservation.Reservation);
    const timing = readEfa2ReservationTiming(reservation);
    if (
      !timing ||
      !isUsableReservationTiming(timing) ||
      !reservation.Reservation ||
      !Number.isInteger(number) ||
      !boatIds.has(reservation.BoatId)
    )
      return;
    const id = deriveEfa2Id(
      `reservation:${reservation.BoatId}:${reservation.Reservation}`
    );
    // A holder efa knows by id, else by name: never a guest rower.
    const rowerId =
      reservation.PersonId && rowerIds.has(reservation.PersonId)
        ? reservation.PersonId
        : null;
    reservationRows.push([
      id,
      reservation.BoatId,
      timing.recurrence,
      timing.startDate,
      timing.endDate,
      timing.dayOfWeek,
      timing.startTime,
      timing.endTime,
      rowerId,
      rowerId ? null : reservation.PersonName || null,
      reservation.Reason || null,
      reservation.Contact || null,
      number,
      msToIso(reservation.LastModified, nowIso),
      msToIso(reservation.LastModified, nowIso),
    ]);
    link(
      "efa2boatreservations",
      reservationsObject.name,
      reservation,
      position,
      {
        table: "boat_reservation",
        id,
      }
    );
  });

  // ----- Groups, plus one group per efa2 status -----
  const groupRows: unknown[][] = [];
  const memberRows: unknown[][] = [];
  const groupsObject = findObject(project, "efa2groups");
  for (const [id, versions] of groupVersions(records("efa2groups"))) {
    const latest = versions[versions.length - 1];
    const archived = efaBoolean(latest.Deleted) || isExpired(latest, nowMs);
    groupRows.push([
      id,
      latest.Name || "?",
      latest.Color ? `#${latest.Color}` : null,
      archived ? msToIso(latest.InvalidFrom, nowIso) : null,
      msToIso(versions[0].LastModified, nowIso),
      msToIso(latest.LastModified, nowIso),
    ]);
    for (const member of new Set(efaList(latest.MemberIdList))) {
      if (rowerIds.has(member)) memberRows.push([id, member]);
    }
    if (groupsObject) {
      const position = groupsObject.records.indexOf(latest);
      link("efa2groups", groupsObject.name, latest, position, {
        table: "rower_group",
        id,
      });
    }
  }
  for (const [statusId, status] of statuses) {
    // efa always has statuses such as guest and other, often with nobody.
    if (!personsByStatus.has(statusId)) continue;
    const id = deriveEfa2Id(`status:${statusId}`);
    groupRows.push([
      id,
      `${labels.statusGroupPrefix}${status.Name || "?"}`,
      null,
      null,
      msToIso(status.LastModified, nowIso),
      msToIso(status.LastModified, nowIso),
    ]);
    for (const member of personsByStatus.get(statusId) ?? []) {
      memberRows.push([id, member]);
    }
  }

  // ----- Every efa2 record, kept as is -----
  const keptWithoutScreen: Record<string, number> = {};
  const projectObject = { type: "efa2project", name: project.name };
  project.projectRecords.forEach((record, position) =>
    keepEfaRecord(projectObject, record, position)
  );
  for (const object of project.objects) {
    object.records.forEach((record, position) => {
      const rb = links.get(
        `${object.type}|${object.name}|${getEfa2RecordKey(object.type, record, position)}`
      );
      keepEfaRecord(object, record, position, rb);
    });
  }
  // Duplicate keys can only come from a damaged file: keep the last one.
  const uniqueEfaRows = [
    ...new Map(efaRows.map((row) => [row.slice(0, 3).join("|"), row])).values(),
  ];
  // Logbook entries left aside have their own line in the preview.
  for (const [type, , , , rbTable] of uniqueEfaRows) {
    if (
      rbTable === null &&
      ![
        "efa2project",
        "efa2boats",
        "efa2persons",
        "efa2destinations",
        "efa2groups",
        "efa2status",
        "efa2boatstatus",
        "efa2autoincrement",
        "efa2logbook",
      ].includes(String(type))
    ) {
      keptWithoutScreen[String(type)] =
        (keptWithoutScreen[String(type)] ?? 0) + 1;
    }
  }

  const modules: ModuleId[] = [];
  if (hasDistances) modules.push("distances");
  if (hasOutingTypes) modules.push("outingTypes");
  if (hasMemberProfile) modules.push("memberProfile");
  if (guestIds.size > 0 || rowerRows.some((row) => row[3] === "guest"))
    modules.push("guests");
  if (hasCaptain) modules.push("captain");
  if (damageRows.length > 0) modules.push("damages");
  if (reservationRows.length > 0) modules.push("reservations");

  const expected: Record<string, number> = {
    boat: boatRows.length,
    boat_configuration: configurationRows.length,
    rower: rowerRows.length,
    route: routeRows.length,
    outing: outingRows.length,
    outing_crew: crewRows.length,
    boat_damage: damageRows.length,
    boat_reservation: reservationRows.length,
    rower_group: groupRows.length,
    efa_record: uniqueEfaRows.length,
  };

  const statements = [
    "BEGIN;",
    "DELETE FROM efa_record;",
    ...V2_DATA_TABLES_IN_DELETE_ORDER.map((table) => `DELETE FROM ${table};`),
    "DELETE FROM outing_type WHERE is_builtin = 0;",
    ...buildInsertStatements(
      "outing_type",
      ["code", "label", "position", "is_builtin"],
      [...customOutingTypes].map(([code, label], index) => [
        code,
        label,
        100 + index,
        0,
      ])
    ),
    ...buildInsertStatements(
      "boat",
      [
        "id",
        "name",
        "note",
        "is_in_maintenance",
        "owner",
        "manufacturer",
        "model",
        "serial_number",
        "build_year",
        "purchase_date",
        "max_crew_weight_kg",
        "exclude_from_stats",
        "archived_at",
        "created_at",
        "updated_at",
      ],
      boatRows
    ),
    ...buildInsertStatements(
      "boat_configuration",
      [
        "id",
        "boat_id",
        "position",
        "seats",
        "rigging",
        "coxed",
        "hull_type",
        "is_default",
      ],
      configurationRows
    ),
    ...buildInsertStatements(
      "rower",
      [
        "id",
        "first_name",
        "last_name",
        "status",
        "gender",
        "birth_date",
        "email",
        "license_number",
        "address",
        "exclude_from_stats",
        "archived_at",
        "created_at",
        "updated_at",
      ],
      rowerRows
    ),
    ...buildInsertStatements(
      "route",
      [
        "id",
        "name",
        "distance_m",
        "note",
        "archived_at",
        "created_at",
        "updated_at",
      ],
      routeRows
    ),
    ...buildInsertStatements(
      "outing",
      [
        "id",
        "boat_id",
        "boat_configuration_id",
        "route_id",
        "outing_type_code",
        "start_date_time",
        "end_date_time",
        "distance_m",
        "comment",
        "captain_rower_id",
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
      "boat_damage",
      [
        "id",
        "boat_id",
        "kind",
        "severity",
        "description",
        "reported_at",
        "reported_by_rower_id",
        "fixed_at",
        "fixed_by_rower_id",
        "repair_note",
        "repair_cost",
        "created_at",
        "updated_at",
      ],
      damageRows
    ),
    ...buildInsertStatements(
      "boat_reservation",
      [
        "id",
        "boat_id",
        "recurrence",
        "start_date",
        "end_date",
        "day_of_week",
        "start_time",
        "end_time",
        "rower_id",
        "person_name",
        "reason",
        "contact",
        "efa_number",
        "created_at",
        "updated_at",
      ],
      reservationRows
    ),
    ...buildInsertStatements(
      "rower_group",
      ["id", "name", "color", "archived_at", "created_at", "updated_at"],
      groupRows
    ),
    ...buildInsertStatements(
      "rower_group_member",
      ["group_id", "rower_id"],
      memberRows,
      { orIgnore: true }
    ),
    ...buildInsertStatements(
      "efa_record",
      [
        "object_type",
        "object_name",
        "record_key",
        "position",
        "rb_table",
        "rb_id",
        "fields",
      ],
      uniqueEfaRows
    ),
    // An import turns on the modules it brings data for (ADR 0002).
    `INSERT INTO setting (key, value) VALUES (${sqlLiteral(SETTING_MODULES_ENABLED)}, ${sqlLiteral(
      JSON.stringify(normalizeModuleIds([...enabledModules, ...modules]))
    )}) ON CONFLICT (key) DO UPDATE SET value = excluded.value;`,
    // Counts are checked before COMMIT: a failed check rolls everything back.
    "CREATE TEMP TABLE IF NOT EXISTS efa_import_check (name TEXT NOT NULL, ok INTEGER NOT NULL CHECK (ok = 1));",
    ...Object.entries(expected).map(
      ([table, count]) =>
        `INSERT INTO efa_import_check SELECT ${sqlLiteral(table)}, (SELECT COUNT(*) FROM ${table}) = ${count};`
    ),
    "DELETE FROM efa_import_check;",
    "COMMIT;",
  ];

  return {
    statements,
    expected,
    modules,
    report: {
      boats: boatVersions.size,
      externalBoats: externalBoatIds.size,
      rowers: personVersions.size,
      guests: guestIds.size,
      routes: routeIds.size,
      outings: outingRows.length,
      ongoingOutings,
      closedOpenOutings,
      ambiguousNames: ambiguousNames.size,
      unreadableEntries,
      openDamages,
      fixedDamages,
      unavailableBoats,
      reservations: reservationRows.length,
      groups: groupRows.length,
      logbooks: logbooks.map((logbook) => logbook.name),
      keptWithoutScreen,
    },
  };
};
