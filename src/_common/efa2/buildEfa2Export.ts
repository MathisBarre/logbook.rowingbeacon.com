import { v4 } from "uuid";
import { SqlClient } from "../database/sqlClient";
import { DamageSeverity } from "../database/repositories/club.types";
import { Efa2Project, Efa2StorageObject } from "./efa2Project";
import { Efa2Fields } from "./efa2Xml";
import { SEVERITY_TO_EFA, damageFromEfa } from "./efa2Damages";
import {
  EFA2_FOREVER,
  efaBoolean,
  efaDateToIso,
  efaDistanceToMetres,
  efaList,
  efaTimeToHhMm,
  efaTimestamp,
  isoToEfaDate,
  localDateTimeToEfaTime,
  metresToEfaDistance,
  toEfaBoolean,
  toEfaList,
} from "./efa2Values";
import {
  RESERVATION_FAR_FUTURE,
  RESERVATION_FAR_PAST,
  configurationsFromEfa,
  deriveEfa2Id,
  efa2DayOfWeek,
  normalizeName,
  readEfa2ReservationTiming,
  toOutingTypeCode,
} from "./planEfa2Import";

/**
 * Build an efa2 project from the club data (ADR 0004). Fields Rowing
 * Beacon models are written from its tables; every other field, and every
 * record without a screen (messages, crews…), comes back from the
 * efa_record table as it was imported.
 */

export interface Efa2ExportLabels {
  /** Names of the efa2 statuses created when the club has none of a type. */
  statuses: { member: string; guest: string; other: string };
  /** Project name when the club was not imported from efa2. */
  defaultProjectName: string;
  boathouseName: string;
}

export interface Efa2ExportReport {
  boats: number;
  rowers: number;
  routes: number;
  outings: number;
  logbooks: string[];
  /** Damages written as efa2 damage reports (unavailable entries are the boat status). */
  damagesExported: number;
  /** Incidents have no efa2 equivalent (an efa2 damage is a lasting state). */
  incidentsNotExported: number;
  /** Outings with more than 24 rowers or several coxes: efa2 has no seat for the rest. */
  crewsCut: number;
  /** Reservations written from Rowing Beacon's table (unreadable efa2 ones come back apart). */
  reservations: number;
}

interface EfaRecordRow {
  object_type: string;
  object_name: string;
  position: number;
  rb_table: string | null;
  rb_id: string | null;
  fields: string;
}

/** Default object names, as efa2 names its files. */
const OBJECT_NAMES: Record<string, string> = {
  efa2boats: "boats",
  efa2persons: "persons",
  efa2status: "status",
  efa2groups: "groups",
  efa2crews: "crews",
  efa2destinations: "destinations",
  efa2waters: "waters",
  efa2boatstatus: "boatstatus",
  efa2boatdamages: "boatdamages",
  efa2boatreservations: "boatreservations",
  efa2messages: "messages",
  efa2sessiongroups: "sessiongroups",
  efa2fahrtenabzeichen: "fahrtenabzeichen",
  efa2statistics: "statistics",
  efa2autoincrement: "autoincrement",
};

/** Objects Rowing Beacon rewrites; the others come back untouched. */
const REWRITTEN = new Set([
  "efa2boats",
  "efa2persons",
  "efa2status",
  "efa2groups",
  "efa2destinations",
  "efa2boatstatus",
  "efa2boatreservations",
  "efa2logbook",
]);

/** Fields of a boat record that describe its variants. */
const TYPE_FIELDS = [
  "LastVariant",
  "DefaultVariant",
  "TypeVariant",
  "TypeDescription",
  "TypeType",
  "TypeSeats",
  "TypeRigging",
  "TypeCoxing",
];

/** Objects whose records have versions (key Id + ValidFrom). */
const VERSIONED = new Set([
  "efa2boats",
  "efa2persons",
  "efa2groups",
  "efa2destinations",
]);

/** Fields that only describe one version, rewritten on export. */
const VERSION_FIELDS = [
  "ValidFrom",
  "InvalidFrom",
  "Deleted",
  "ChangeCount",
  "LastModified",
];

const OUTING_TYPE_TO_SESSION_TYPE: Record<string, string> = {
  normal: "NORMAL",
  training: "TRAINING",
  regatta: "REGATTA",
  training_camp: "TRAININGCAMP",
  instruction: "INSTRUCTION",
  tour: "TOUR",
  club_trip: "CLUBTRIP",
  ergometer: "ERG",
  motorboat: "MOTORBOAT",
};

const toSessionType = (code: string | null, raw: string | undefined) => {
  if (raw && toOutingTypeCode(raw) === code) return raw;
  if (!code) return "NORMAL";
  if (OUTING_TYPE_TO_SESSION_TYPE[code])
    return OUTING_TYPE_TO_SESSION_TYPE[code];
  if (code.startsWith("efa_")) return code.slice(4).toUpperCase();
  return "NORMAL";
};

const isoToMs = (value: string | null | undefined) => {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? String(ms) : undefined;
};

const withoutUndefined = (fields: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );

/** Raw fields of a record, without its version bookkeeping. */
const baseOf = (raw: Efa2Fields | undefined, drop: string[] = []) => {
  const base: Record<string, string | undefined> = { ...(raw ?? {}) };
  for (const field of [...VERSION_FIELDS, ...drop]) delete base[field];
  return base;
};

/** Same record content, ignoring version bookkeeping and empty fields. */
/** The imported text when it still says the same date ("1985" stays "1985"). */
const efaDateOf = (raw: string | undefined, iso: string | null | undefined) =>
  raw && iso && efaDateToIso(raw) === iso.slice(0, 10)
    ? raw
    : isoToEfaDate(iso);

/** The imported text when it still says the same time ("14:45" stays "14:45"). */
const efaTimeOf = (raw: string | undefined, localDateTime: string | null) => {
  const time = localDateTimeToEfaTime(localDateTime);
  return raw && time && efaTimeToHhMm(raw) === efaTimeToHhMm(time) ? raw : time;
};

const nextIsoDay = (isoDate: string) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Same fields, apart from efa's change counter and timestamp. */
const sameFields = (a: Efa2Fields, b: Efa2Fields) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === "ChangeCount" || key === "LastModified") continue;
    if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  }
  return true;
};

const sameContent = (
  a: Record<string, string | undefined>,
  b: Record<string, string | undefined>
) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (VERSION_FIELDS.includes(key)) continue;
    if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  }
  return true;
};

const isEfaExpired = (record: Efa2Fields, nowMs: number) => {
  const invalidFrom = Number(record.InvalidFrom ?? EFA2_FOREVER);
  return record.Deleted === "true" || invalidFrom <= nowMs;
};

const nextChangeCount = (record: Efa2Fields | undefined) =>
  String(Number(record?.ChangeCount ?? 0) + 1);

/**
 * The versions of a versioned efa2 record (boat, person, group,
 * destination). efa2 keeps one version per period of validity, which its
 * statistics use for past years, so the imported versions come back as
 * they were. A change made in Rowing Beacon closes the latest version and
 * opens a new one; archiving closes the latest version.
 */
const writeVersions = (
  versions: Efa2Fields[],
  fields: Record<string, string | undefined>,
  archivedAt: string | null,
  updatedAt: string,
  nowMs: number,
  /** Archived in efa by other means, e.g. a boat hidden by its status. */
  hiddenInEfa = false
): Efa2Fields[] => {
  const current = withoutUndefined(fields);
  const updatedMs = Number(isoToMs(updatedAt) ?? nowMs);
  const archivedMs = archivedAt
    ? Number(isoToMs(archivedAt) ?? nowMs)
    : undefined;
  const latest = versions[versions.length - 1];

  if (!latest) {
    return [
      {
        ...current,
        ValidFrom: "0",
        InvalidFrom:
          archivedMs === undefined ? EFA2_FOREVER : String(archivedMs),
        ChangeCount: "1",
        LastModified: String(updatedMs),
      },
    ];
  }

  const older = versions.slice(0, -1);
  const latestFrom = Number(latest.ValidFrom ?? 0) || 0;
  const latestUntil = Number(latest.InvalidFrom ?? EFA2_FOREVER);
  const unchanged = sameContent(current, latest);
  const deletedInEfa = latest.Deleted === "true";
  // An end efa had planned (InvalidFrom set ahead) still holds while Rowing
  // Beacon has not touched the record since: the import saw it active.
  const scheduledEnd =
    !deletedInEfa &&
    latest.InvalidFrom !== undefined &&
    latest.InvalidFrom !== EFA2_FOREVER &&
    latestUntil > updatedMs;
  const archivedInRb = archivedMs !== undefined;
  // Ended in efa: deleted, expired, or closed exactly when RB archived it.
  const endedInEfa =
    deletedInEfa ||
    (isEfaExpired(latest, nowMs) && !scheduledEnd) ||
    (archivedInRb && archivedMs === latestUntil);
  const archivedInEfa = hiddenInEfa || endedInEfa;
  const bump = (record: Efa2Fields): Efa2Fields => ({
    ...record,
    ChangeCount: nextChangeCount(record),
    LastModified: String(updatedMs),
  });
  /** Close the latest version and open one with the RB content at `from`. */
  const newVersion = (from: number, until: string, closeAt = from) => {
    const closed = bump({ ...latest, InvalidFrom: String(closeAt) });
    delete closed.Deleted;
    return [
      ...older,
      closed,
      {
        ...current,
        ValidFrom: String(from),
        InvalidFrom: until,
        ChangeCount: "1",
        LastModified: String(updatedMs),
      },
    ];
  };
  /**
   * Edit the latest version in place, e.g. to close or reopen it. A field
   * Rowing Beacon emptied (undefined) is removed.
   */
  const editLatest = (
    changes: Record<string, string | undefined>,
    keepDeleted: boolean
  ) => {
    const edited = bump({ ...latest, ...changes } as Efa2Fields);
    if (!keepDeleted) delete edited.Deleted;
    return [...older, withoutUndefined(edited)];
  };
  const untilAfterChange = scheduledEnd ? String(latestUntil) : EFA2_FOREVER;

  if (archivedInRb === archivedInEfa) {
    if (unchanged) return versions;
    // Still archived in both: a deleted or expired record keeps its end,
    // even when efa also hides it.
    if (archivedInRb && endedInEfa) {
      return editLatest(fields, deletedInEfa);
    }
    // Active in both, or a boat efa only hides: a new version from the change.
    return newVersion(Math.max(updatedMs, latestFrom + 1), untilAfterChange);
  }

  if (archivedInRb) {
    // Changed, then archived: the change gets its own version until the
    // archive (archiving usually stamps both at once), so past periods keep
    // what efa had.
    if (!unchanged) {
      const from = Math.max(Math.min(updatedMs, archivedMs), latestFrom + 1);
      return newVersion(from, String(Math.max(archivedMs, from + 1)));
    }
    return editLatest(
      { InvalidFrom: String(Math.max(archivedMs, latestFrom + 1)) },
      false
    );
  }

  // Brought back in Rowing Beacon; when changed, the time it was archived
  // stays a gap between the two versions.
  if (unchanged) return editLatest({ InvalidFrom: EFA2_FOREVER }, false);
  const from = Math.max(updatedMs, latestFrom + 1);
  return newVersion(from, EFA2_FOREVER, Math.min(latestUntil, from));
};

const seatsToEfa = (seats: number | null, rigging: string | null) => {
  if (!seats) return "OTHER";
  return rigging === "scull" && seats > 1 ? `${seats}X` : String(seats);
};

export const buildEfa2Export = async (
  db: SqlClient,
  { labels, now = new Date() }: { labels: Efa2ExportLabels; now?: Date }
): Promise<{ project: Efa2Project; report: Efa2ExportReport }> => {
  const nowMs = String(now.getTime());

  const efaRows = await db.select<EfaRecordRow[]>(
    "SELECT object_type, object_name, position, rb_table, rb_id, fields FROM efa_record ORDER BY object_type, object_name, position"
  );
  const rawByRb = new Map<string, Efa2Fields>();
  const rawObjects = new Map<
    string,
    { type: string; name: string; records: Efa2Fields[] }
  >();
  for (const row of efaRows) {
    const fields = JSON.parse(row.fields) as Efa2Fields;
    if (row.rb_table && row.rb_id)
      rawByRb.set(`${row.rb_table}:${row.rb_id}`, fields);
    const key = `${row.object_type}|${row.object_name}`;
    const object = rawObjects.get(key) ?? {
      type: row.object_type,
      name: row.object_name,
      records: [],
    };
    object.records.push(fields);
    rawObjects.set(key, object);
  }
  const raw = (table: string, id: string) => rawByRb.get(`${table}:${id}`);
  const nowNumber = now.getTime();
  /** Every imported version of a versioned record, oldest first. */
  const rawVersions = new Map<string, Efa2Fields[]>();
  for (const row of efaRows) {
    if (!VERSIONED.has(row.object_type)) continue;
    const fields = JSON.parse(row.fields) as Efa2Fields;
    if (!fields.Id) continue;
    const key = `${row.object_type}|${fields.Id}`;
    rawVersions.set(key, [...(rawVersions.get(key) ?? []), fields]);
  }
  for (const list of rawVersions.values()) {
    list.sort((a, b) => Number(a.ValidFrom ?? 0) - Number(b.ValidFrom ?? 0));
  }
  const versionsOf = (type: string, id: string) =>
    rawVersions.get(`${type}|${id}`) ?? [];
  const rawObjectsOfType = (type: string) =>
    [...rawObjects.values()].filter((object) => object.type === type);
  const objectName = (type: string) =>
    rawObjectsOfType(type)[0]?.name ?? OBJECT_NAMES[type] ?? type;

  // ----- Boats -----
  const boats = await db.select<
    {
      id: string;
      name: string;
      note: string | null;
      owner: string | null;
      manufacturer: string | null;
      model: string | null;
      serial_number: string | null;
      build_year: number | null;
      purchase_date: string | null;
      max_crew_weight_kg: number | null;
      exclude_from_stats: number;
      archived_at: string | null;
      updated_at: string;
    }[]
  >("SELECT * FROM boat WHERE merged_into_id IS NULL ORDER BY name");
  const configurations = await db.select<
    {
      id: string;
      boat_id: string;
      position: number;
      seats: number | null;
      rigging: string | null;
      coxed: number;
      hull_type: string | null;
      is_default: number;
    }[]
  >(
    "SELECT * FROM boat_configuration WHERE archived_at IS NULL ORDER BY boat_id, position"
  );

  // A hidden boat is archived in Rowing Beacon but stays valid in efa.
  const hiddenBoatIds = new Set(
    rawObjectsOfType("efa2boatstatus")
      .flatMap((object) => object.records)
      .filter((record) => record.BaseStatus === "HIDE")
      .map((record) => record.BoatId)
  );
  const variantOfConfiguration = new Map<string, string>();
  const boatRecords: Efa2Fields[] = boats.flatMap((boat) => {
    const rawBoat = raw("boat", boat.id);
    const rawVariants = efaList(rawBoat?.TypeVariant);
    const rawDescriptions = efaList(rawBoat?.TypeDescription);
    const own = configurations.filter((c) => c.boat_id === boat.id);
    const used = new Set<string>();
    const variants = own.map((configuration) => {
      const kept = rawVariants.find(
        (variant) =>
          deriveEfa2Id(`configuration:${boat.id}:${variant}`) ===
          configuration.id
      );
      let variant = kept;
      if (!variant) {
        let next = 1;
        while (used.has(String(next)) || rawVariants.includes(String(next)))
          next++;
        variant = String(next);
      }
      used.add(variant);
      variantOfConfiguration.set(configuration.id, variant);
      return {
        variant,
        description: kept
          ? (rawDescriptions[rawVariants.indexOf(kept)] ?? "")
          : "",
        configuration,
      };
    });
    if (variants.length === 0) {
      variants.push({
        variant: "1",
        description: "",
        configuration: {
          id: "",
          boat_id: boat.id,
          position: 0,
          seats: null,
          rigging: null,
          coxed: 0,
          hull_type: null,
          is_default: 1,
        },
      });
    }
    const defaultVariant =
      variants.find((v) => v.configuration.is_default === 1) ?? variants[0];

    // Configurations unchanged since the import: efa's own type fields.
    const imported = rawBoat ? configurationsFromEfa(boat.id, rawBoat) : [];
    const sameConfigurations =
      rawBoat &&
      imported.length === own.length &&
      imported.every((configuration) => {
        const mine = own.find((c) => c.id === configuration.id);
        return (
          mine &&
          mine.seats === configuration.seats &&
          mine.rigging === configuration.rigging &&
          mine.coxed === configuration.coxed &&
          mine.hull_type === configuration.hullType &&
          mine.is_default === configuration.isDefault
        );
      });
    const typeFields = sameConfigurations
      ? Object.fromEntries(TYPE_FIELDS.map((field) => [field, rawBoat[field]]))
      : {};
    const fields = {
      ...baseOf(rawBoat),
      Id: boat.id,
      Name: boat.name,
      Owner: boat.owner ?? undefined,
      LastVariant: String(
        Math.max(...variants.map((v) => Number(v.variant) || 0))
      ),
      DefaultVariant: defaultVariant.variant,
      TypeVariant: variants.map((v) => v.variant).join(";"),
      TypeDescription:
        variants.length === 1
          ? variants[0].description.replace(/;/g, ",")
          : toEfaList(variants.map((v) => v.description)),
      TypeType: toEfaList(
        variants.map((v) => v.configuration.hull_type || "OTHER")
      ),
      TypeSeats: variants
        .map((v) => seatsToEfa(v.configuration.seats, v.configuration.rigging))
        .join(";"),
      TypeRigging: variants
        .map((v) =>
          v.configuration.rigging === "scull"
            ? "SCULL"
            : v.configuration.rigging === "sweep"
              ? "SWEEP"
              : "OTHER"
        )
        .join(";"),
      TypeCoxing: variants
        .map((v) =>
          !v.configuration.id
            ? "OTHER"
            : v.configuration.coxed
              ? "COXED"
              : "COXLESS"
        )
        .join(";"),
      Manufacturer: boat.manufacturer ?? undefined,
      Model: boat.model ?? undefined,
      SerialNo: boat.serial_number ?? undefined,
      ManufactionDate:
        rawBoat?.ManufactionDate &&
        rawBoat.ManufactionDate.endsWith(String(boat.build_year))
          ? rawBoat.ManufactionDate
          : boat.build_year
            ? String(boat.build_year)
            : undefined,
      PurchaseDate: efaDateOf(rawBoat?.PurchaseDate, boat.purchase_date),
      MaxCrewWeight:
        boat.max_crew_weight_kg === null
          ? undefined
          : String(boat.max_crew_weight_kg),
      ExcludeFromStatistics: toEfaBoolean(boat.exclude_from_stats === 1),
      ...typeFields,
    };
    return writeVersions(
      versionsOf("efa2boats", boat.id),
      fields,
      boat.archived_at,
      boat.updated_at,
      nowNumber,
      hiddenBoatIds.has(boat.id)
    );
  });

  // ----- Statuses: the imported ones, plus one per missing type -----
  const statusRecords: Efa2Fields[] = rawObjectsOfType("efa2status").flatMap(
    (object) => object.records
  );
  // A person created in Rowing Beacon gets the status most of efa's current
  // persons of that type have, never by chance "Passive" or an age class.
  const statusUse = new Map<string, number>();
  for (const [key, versions] of rawVersions) {
    if (!key.startsWith("efa2persons|")) continue;
    const latest = versions[versions.length - 1];
    if (!latest.StatusId || isEfaExpired(latest, nowNumber)) continue;
    statusUse.set(latest.StatusId, (statusUse.get(latest.StatusId) ?? 0) + 1);
  }
  const statusRank = (status: Efa2Fields) =>
    (statusUse.get(status.Id ?? "") ?? 0) * 4 +
    (status.Membership === "1" || status.Type !== "USER" ? 2 : 0) +
    (status.AutoSetOnAge === "true" ? 0 : 1);
  const statusFor = (type: "USER" | "GUEST" | "OTHER") => {
    let status = statusRecords
      .filter((record) => record.Type === type)
      .sort((a, b) => statusRank(b) - statusRank(a))[0];
    if (!status) {
      const name =
        type === "USER"
          ? labels.statuses.member
          : type === "GUEST"
            ? labels.statuses.guest
            : labels.statuses.other;
      status = {
        Id: deriveEfa2Id(`rb-status:${type}`),
        Name: name,
        Type: type,
        Membership: type === "USER" ? "1" : "0",
        ChangeCount: "1",
        LastModified: nowMs,
      };
      statusRecords.push(status);
    }
    return status;
  };
  for (const type of ["USER", "GUEST", "OTHER"] as const) statusFor(type);
  const statusType = (id: string | undefined) =>
    statusRecords.find((record) => record.Id === id)?.Type;
  const ROWER_STATUS_TO_TYPE = {
    member: "USER",
    guest: "GUEST",
    other: "OTHER",
  } as const;

  // ----- Persons -----
  const rowers = await db.select<
    {
      id: string;
      first_name: string;
      last_name: string;
      status: "member" | "guest" | "other";
      gender: string | null;
      birth_date: string | null;
      email: string | null;
      license_number: string | null;
      address: string | null;
      exclude_from_stats: number;
      archived_at: string | null;
      updated_at: string;
    }[]
  >(
    "SELECT * FROM rower WHERE merged_into_id IS NULL ORDER BY last_name, first_name"
  );

  const exportedRowerIds = new Set(rowers.map((rower) => rower.id));
  const personRecords: Efa2Fields[] = rowers.flatMap((rower) => {
    const rawPerson = raw("rower", rower.id);
    const type = ROWER_STATUS_TO_TYPE[rower.status];
    // The import reads a missing or unknown status as "member": the raw
    // value stays while it still means the same.
    const rawStatusType = statusType(rawPerson?.StatusId);
    const statusId =
      rawPerson &&
      (rawStatusType === type ||
        (rower.status === "member" &&
          !Object.values(ROWER_STATUS_TO_TYPE).some(
            (t) => t === rawStatusType
          )))
        ? rawPerson.StatusId
        : statusFor(type).Id;

    // The import joins LastName and NameAffix, and uses the last name as
    // first name when there is none; write the raw name back when unchanged.
    const joinedRawLastName = [rawPerson?.LastName, rawPerson?.NameAffix]
      .filter(Boolean)
      .join(" ");
    const keepRawName =
      rawPerson &&
      (rawPerson.FirstName
        ? rower.first_name === rawPerson.FirstName &&
          rower.last_name === joinedRawLastName
        : rower.first_name === (rawPerson.LastName || "?") &&
          rower.last_name === "");
    const rawAddress = [
      rawPerson?.AddressStreet,
      rawPerson?.AddressAdditional,
      [rawPerson?.AddressZip, rawPerson?.AddressCity].filter(Boolean).join(" "),
      rawPerson?.AddressCountry,
    ]
      .filter(Boolean)
      .join(", ");
    const keepRawAddress = rawPerson && rawAddress === (rower.address ?? "");
    const addressFields = keepRawAddress
      ? {}
      : {
          AddressStreet: rower.address ?? undefined,
          AddressAdditional: undefined,
          AddressZip: undefined,
          AddressCity: undefined,
          AddressCountry: undefined,
        };

    const fields = {
      ...baseOf(rawPerson),
      Id: rower.id,
      FirstName: keepRawName ? rawPerson.FirstName : rower.first_name,
      LastName: keepRawName ? rawPerson.LastName : rower.last_name || undefined,
      NameAffix: keepRawName ? rawPerson.NameAffix : undefined,
      Gender:
        rower.gender === "male"
          ? "MALE"
          : rower.gender === "female"
            ? "FEMALE"
            : undefined,
      Birthday: efaDateOf(rawPerson?.Birthday, rower.birth_date),
      StatusId: statusId,
      ...addressFields,
      Email: rower.email ?? undefined,
      MembershipNo: rower.license_number ?? undefined,
      ExcludeFromStatistics: toEfaBoolean(rower.exclude_from_stats === 1),
    };
    return writeVersions(
      versionsOf("efa2persons", rower.id),
      fields,
      rower.archived_at,
      rower.updated_at,
      nowNumber
    );
  });

  // ----- Destinations -----
  const routes = await db.select<
    {
      id: string;
      name: string;
      distance_m: number | null;
      archived_at: string | null;
      updated_at: string;
    }[]
  >("SELECT * FROM route WHERE merged_into_id IS NULL ORDER BY name");
  const destinationRecords: Efa2Fields[] = routes.flatMap((route) =>
    writeVersions(
      versionsOf("efa2destinations", route.id),
      {
        ...baseOf(raw("route", route.id)),
        Id: route.id,
        Name: route.name,
        // efa's own text ("1000 m") when the distance did not change.
        Distance:
          efaDistanceToMetres(raw("route", route.id)?.Distance) ===
          route.distance_m
            ? raw("route", route.id)?.Distance
            : metresToEfaDistance(route.distance_m),
      },
      route.archived_at,
      route.updated_at,
      nowNumber
    )
  );

  // ----- Groups (status groups made by the import are not written back) -----
  const groups = await db.select<
    {
      id: string;
      name: string;
      color: string | null;
      archived_at: string | null;
      updated_at: string;
    }[]
  >("SELECT * FROM rower_group ORDER BY name");
  const members = await db.select<{ group_id: string; rower_id: string }[]>(
    "SELECT group_id, rower_id FROM rower_group_member"
  );
  const statusGroupIds = new Set(
    statusRecords.map((status) => deriveEfa2Id(`status:${status.Id}`))
  );
  const groupRecords: Efa2Fields[] = groups
    .filter((group) => !statusGroupIds.has(group.id))
    .flatMap((group) => {
      const rawGroup = raw("rower_group", group.id);
      const memberIds = members
        .filter((member) => member.group_id === group.id)
        .map((member) => member.rower_id);
      // Keep efa's member order when the members are the same.
      // Ids the import could not resolve stay in efa's list too.
      const rawMemberIds = [
        ...new Set(
          efaList(rawGroup?.MemberIdList).filter((id) =>
            exportedRowerIds.has(id)
          )
        ),
      ];
      const sameMembers =
        rawGroup !== undefined &&
        rawMemberIds.length === memberIds.length &&
        memberIds.every((id) => rawMemberIds.includes(id));
      return writeVersions(
        versionsOf("efa2groups", group.id),
        {
          ...baseOf(rawGroup),
          Id: group.id,
          Name: group.name,
          Color: group.color ? group.color.replace(/^#/, "") : undefined,
          MemberIdList: sameMembers
            ? rawGroup?.MemberIdList
            : memberIds.join(";") || undefined,
        },
        group.archived_at,
        group.updated_at,
        nowNumber
      );
    });

  // ----- Logbooks: imported outings go back to their logbook, others by year -----
  const outings = await db.select<
    {
      id: string;
      boat_id: string;
      boat_configuration_id: string | null;
      route_id: string | null;
      outing_type_code: string | null;
      start_date_time: string;
      end_date_time: string | null;
      distance_m: number | null;
      comment: string | null;
      captain_rower_id: string | null;
      updated_at: string;
    }[]
  >("SELECT * FROM outing ORDER BY start_date_time");
  const crew = await db.select<
    {
      outing_id: string;
      rower_id: string;
      role: "rower" | "cox";
      position: number;
    }[]
  >(
    "SELECT outing_id, rower_id, role, position FROM outing_crew ORDER BY outing_id, position"
  );
  const crewByOuting = new Map<string, typeof crew>();
  for (const member of crew) {
    crewByOuting.set(member.outing_id, [
      ...(crewByOuting.get(member.outing_id) ?? []),
      member,
    ]);
  }
  const outingLogbook = new Map(
    efaRows
      .filter(
        (row) => row.object_type === "efa2logbook" && row.rb_table === "outing"
      )
      .map((row) => [row.rb_id, row.object_name])
  );

  const rawProject = rawObjectsOfType("efa2project")[0];
  const rawLogbookRecords = (rawProject?.records ?? []).filter(
    (r) => r.Type === "Logbook"
  );
  const logbookForDate = (date: string) => {
    const efaDate = date.slice(0, 10);
    const covering = rawLogbookRecords.find((logbook) => {
      const from = efaDateToIso(logbook.StartDate);
      const to = efaDateToIso(logbook.EndDate);
      return from && to && from <= efaDate && efaDate <= to;
    });
    return covering?.Name ?? date.slice(0, 4);
  };
  /**
   * Without the logbook's dates, a logbook named after a year holds that
   * year; any other one holds every date: nothing to compare.
   */
  const isInLogbook = (name: string, date: string) => {
    const logbook = rawLogbookRecords.find((record) => record.Name === name);
    const from = efaDateToIso(logbook?.StartDate);
    const to = efaDateToIso(logbook?.EndDate);
    if (!from || !to) return !/^\d{4}$/.test(name) || date.startsWith(name);
    const efaDate = date.slice(0, 10);
    return from <= efaDate && efaDate <= to;
  };

  const logbooks = new Map<string, Efa2Fields[]>();
  const nextEntryId = new Map<string, number>();
  for (const [, object] of rawObjects) {
    if (object.type !== "efa2logbook") continue;
    // A loop, not Math.max(...): a big logbook overflows the call stack.
    let max = 0;
    for (const record of object.records) {
      max = Math.max(max, Number(record.EntryId) || 0);
    }
    nextEntryId.set(object.name, max + 1);
  }
  /** Entry id of each exported outing, for the damages reported from it. */
  const entryIdOfOuting = new Map<string, string>();
  const openEntries = new Map<
    string,
    { logbook: string; entryId: string; unchanged: boolean }
  >();
  // Keyed by the entry's logbook and number in efa's file: a correction may
  // have moved the entry since.
  const unknownBoatEntries = new Map<
    string,
    { logbook: string; entryId: string; unchanged: boolean }
  >();
  // The routes the import made of efa's destinations, as it made them: a
  // route renamed or added since does not change which one an entry meant.
  const efaDestinations = [...rawVersions]
    .filter(([key]) => key.startsWith("efa2destinations|"))
    .map(([, versions]) => versions[versions.length - 1]);
  // A typed name matches the destination of that name the import picked:
  // which homonym was valid then is not known now, so any of them.
  const routeIdsByName = new Map<string, string[]>();
  for (const destination of efaDestinations) {
    const name = normalizeName(destination.Name || "?");
    routeIdsByName.set(name, [
      ...(routeIdsByName.get(name) ?? []),
      destination.Id,
    ]);
  }
  const routeIdsKnown = new Set(efaDestinations.map((d) => d.Id));
  let crewsCut = 0;

  for (const outing of outings) {
    const rawEntry = raw("outing", outing.id);
    // An imported outing stays in its logbook, unless a correction moved its
    // date out of it: it then gets a new entry in the logbook of that date.
    const storedLogbook = outingLogbook.get(outing.id);
    const sameDate =
      !!rawEntry &&
      efaDateToIso(rawEntry.Date) === outing.start_date_time.slice(0, 10);
    const logbook =
      storedLogbook &&
      (sameDate || isInLogbook(storedLogbook, outing.start_date_time))
        ? storedLogbook
        : logbookForDate(outing.start_date_time);
    let entryId = rawEntry?.EntryId;
    const moved = storedLogbook !== logbook;
    if (!entryId || moved) {
      const next = nextEntryId.get(logbook) ?? 1;
      entryId = String(next);
      nextEntryId.set(logbook, next + 1);
    }

    entryIdOfOuting.set(outing.id, entryId);
    const base = baseOf(rawEntry, ["ChangeCount", "LastModified"]);
    for (const field of Object.keys(base)) {
      if (/^(Cox|Crew\d+)(Id|Name)$/.test(field)) delete base[field];
    }
    for (const field of [
      "BoatName",
      "DestinationName",
      "AllCrewNames",
      "BoatCaptain",
      "Open",
      "EndDate",
      "EndTime",
    ]) {
      delete base[field];
    }
    // Session groups belong to one logbook.
    if (moved) delete base.SessionGroupId;
    // The route the import made of efa's destination: when it changed, the
    // old destination's variant and waters do not stay on the new one.
    const rawRouteIds: (string | null)[] =
      rawEntry?.DestinationId && routeIdsKnown.has(rawEntry.DestinationId)
        ? [rawEntry.DestinationId]
        : rawEntry?.DestinationName
          ? (routeIdsByName.get(normalizeName(rawEntry.DestinationName)) ?? [
              deriveEfa2Id(`route:${normalizeName(rawEntry.DestinationName)}`),
            ])
          : [null];
    const sameRoute = rawRouteIds.includes(outing.route_id);
    if (!sameRoute) {
      for (const field of [
        "DestinationVariantName",
        "WatersIdList",
        "WatersNameList",
      ]) {
        delete base[field];
      }
    }

    const seats: Record<string, string> = {};
    const members = crewByOuting.get(outing.id) ?? [];
    const cox = members.find((member) => member.role === "cox");
    if (
      members.filter((member) => member.role === "cox").length > 1 ||
      members.filter((member) => member.role === "rower").length > 24
    ) {
      crewsCut++;
    }
    let captain: string | undefined;
    if (cox) {
      seats.CoxId = cox.rower_id;
      if (cox.rower_id === outing.captain_rower_id) captain = "0";
    }
    const rowersOnBoard = members
      .filter((member) => member.role === "rower")
      .slice(0, 24);
    // Imported crews keep their efa seats (gaps included); others are
    // numbered from 1.
    const seatPositions = rowersOnBoard.map((member) => member.position);
    const keepSeats =
      seatPositions.every((seat) => seat >= 1 && seat <= 24) &&
      new Set(seatPositions).size === seatPositions.length;
    rowersOnBoard.forEach((member, index) => {
      const seat = keepSeats ? member.position : index + 1;
      seats[`Crew${seat}Id`] = member.rower_id;
      if (member.rower_id === outing.captain_rower_id) captain = String(seat);
    });

    // The import fills a missing start time with 00:00 and a missing end
    // time with the start: those defaults do not go back to efa.
    const startTime = localDateTimeToEfaTime(outing.start_date_time);
    const endTime = localDateTimeToEfaTime(outing.end_date_time);
    const noRawStart = rawEntry && !efaTimeToHhMm(rawEntry.StartTime);
    const noRawEnd = rawEntry && !efaTimeToHhMm(rawEntry.EndTime);

    const ongoing = outing.end_date_time === null;
    const startDate = outing.start_date_time.slice(0, 10);
    const endDate = outing.end_date_time?.slice(0, 10);
    // Without an end date, efa reads an end before the start as the next day.
    const impliedNextDay =
      rawEntry &&
      !rawEntry.EndDate &&
      endDate === nextIsoDay(startDate) &&
      endTime !== undefined &&
      startTime !== undefined &&
      endTime < startTime;
    // A boat efa only knew by its name, still on the water: efa closes such
    // a session through the name and its own status record.
    const unknownBoatOnWater =
      ongoing &&
      rawEntry !== undefined &&
      !rawEntry.BoatId &&
      !!rawEntry.BoatName &&
      deriveEfa2Id(`boat:${normalizeName(rawEntry.BoatName)}`) ===
        outing.boat_id;

    const entry = withoutUndefined({
      ...base,
      EntryId: entryId,
      Date: efaDateOf(rawEntry?.Date, outing.start_date_time),
      EndDate:
        endDate && endDate !== startDate && !impliedNextDay
          ? efaDateOf(rawEntry?.EndDate, endDate)
          : undefined,
      BoatId: unknownBoatOnWater ? undefined : outing.boat_id,
      BoatName: unknownBoatOnWater ? rawEntry.BoatName : undefined,
      // A configuration archived since (rig changed in Rowing Beacon) has
      // no current variant: the outing keeps the one efa recorded.
      BoatVariant:
        (outing.boat_configuration_id
          ? variantOfConfiguration.get(outing.boat_configuration_id)
          : undefined) ??
        (rawEntry && (!rawEntry.BoatId || rawEntry.BoatId === outing.boat_id)
          ? rawEntry.BoatVariant
          : undefined),
      ...seats,
      BoatCaptain: captain,
      StartTime:
        noRawStart && startTime === "00:00:00"
          ? undefined
          : efaTimeOf(rawEntry?.StartTime, outing.start_date_time),
      EndTime:
        noRawEnd && endTime === startTime
          ? undefined
          : efaTimeOf(rawEntry?.EndTime, outing.end_date_time),
      DestinationId: outing.route_id ?? undefined,
      Distance:
        rawEntry?.Distance &&
        efaDistanceToMetres(rawEntry.Distance) === outing.distance_m
          ? rawEntry.Distance
          : metresToEfaDistance(outing.distance_m),
      Comments: outing.comment || undefined,
      SessionType: toSessionType(
        outing.outing_type_code,
        rawEntry?.SessionType
      ),
      Open: toEfaBoolean(ongoing),
      ChangeCount: String(Number(rawEntry?.ChangeCount ?? 0) + 1),
      LastModified: isoToMs(outing.updated_at) ?? nowMs,
    });
    const unchanged = !!rawEntry && sameFields(entry, rawEntry);
    // efa's "on the water since… with…" status text tells where the boat
    // went, when, and with whom: it holds while those are what efa recorded,
    // whatever else a correction changed. The import turned efa's typed
    // names into records: a typed seat holds while efa's name is still
    // stored (a crew change removes it), a typed destination while the
    // route is the one the import made of it.
    const onWaterTextFields = (fields: Efa2Fields) =>
      Object.fromEntries(
        Object.entries(fields).filter(([key]) => {
          const seat = /^(Cox|Crew\d+)(Id|Name)$/.exec(key);
          if (seat) return !rawEntry?.[`${seat[1]}Name`];
          if (/^Destination(Id|Name)$/.test(key)) return false;
          return /^(Date|StartTime|BoatId|BoatName)$/.test(key);
        })
      );
    const onWaterTextHolds =
      !!rawEntry &&
      sameRoute &&
      sameFields(onWaterTextFields(entry), onWaterTextFields(rawEntry));
    if (unknownBoatOnWater) {
      unknownBoatEntries.set(`${storedLogbook}|${rawEntry.EntryId}`, {
        logbook,
        entryId,
        unchanged: onWaterTextHolds,
      });
    }
    if (ongoing && !unknownBoatOnWater) {
      openEntries.set(outing.boat_id, {
        logbook,
        entryId,
        unchanged: onWaterTextHolds,
      });
    }
    const entries = logbooks.get(logbook) ?? [];
    entries.push(unchanged ? rawEntry : entry);
    logbooks.set(logbook, entries);
  }
  // Entries the import could not read (no date…) come back as they were.
  for (const row of efaRows) {
    if (row.object_type !== "efa2logbook" || row.rb_table) continue;
    const entries = logbooks.get(row.object_name) ?? [];
    entries.push(JSON.parse(row.fields) as Efa2Fields);
    logbooks.set(row.object_name, entries);
  }
  for (const entries of logbooks.values()) {
    entries.sort((a, b) => (Number(a.EntryId) || 0) - (Number(b.EntryId) || 0));
  }
  // A logbook without entries (one prepared for next year) has no
  // efa_record row: the project file still lists it.
  for (const record of rawLogbookRecords) {
    if (record.Name && !logbooks.has(record.Name)) {
      logbooks.set(record.Name, []);
    }
  }
  if (logbooks.size === 0) logbooks.set(String(now.getFullYear()), []);
  const logbookNames = [...logbooks.keys()].sort();
  const lastLogbook = logbookNames[logbookNames.length - 1];

  // ----- Reservations: from the table, unreadable efa2 ones as they were -----
  const reservations = await db.select<
    {
      id: string;
      boat_id: string;
      recurrence: "once" | "weekly";
      start_date: string | null;
      end_date: string | null;
      day_of_week: number | null;
      start_time: string;
      end_time: string;
      rower_id: string | null;
      person_name: string | null;
      reason: string | null;
      contact: string | null;
      efa_number: number | null;
      updated_at: string;
    }[]
  >("SELECT * FROM boat_reservation ORDER BY efa_number, created_at, id");
  const reservationPositions = new Map(
    efaRows
      .filter(
        (row) =>
          row.object_type === "efa2boatreservations" &&
          row.rb_table === "boat_reservation"
      )
      .map((row) => [row.rb_id, row.position])
  );
  const keptReservations: { position: number; record: Efa2Fields }[] = [];
  for (const row of efaRows) {
    if (row.object_type === "efa2boatreservations" && !row.rb_table) {
      keptReservations.push({
        position: row.position,
        record: JSON.parse(row.fields) as Efa2Fields,
      });
    }
  }
  const sequenceKey = "efa2boatreservations";
  const rawSequence = rawObjectsOfType("efa2autoincrement")
    .flatMap((object) => object.records)
    .find((record) => record.Sequence === sequenceKey);
  /** The highest reservation number in use, efa's own counter included. */
  let highestReservation =
    Number(rawSequence?.IntValue ?? rawSequence?.LongValue) || 0;
  for (const { record } of keptReservations) {
    highestReservation = Math.max(
      highestReservation,
      Number(record.Reservation) || 0
    );
  }
  for (const reservation of reservations) {
    highestReservation = Math.max(
      highestReservation,
      reservation.efa_number ?? 0
    );
  }
  const reservationRecords: { position: number; record: Efa2Fields }[] = [
    ...keptReservations,
  ];
  reservations.forEach((reservation, index) => {
    const rawReservation = raw("boat_reservation", reservation.id);
    // A reservation made without a number (not by the app) gets the next one.
    const number = reservation.efa_number ?? ++highestReservation;
    const startTime =
      efaTimeToHhMm(reservation.start_time) ?? reservation.start_time;
    const endTime = efaTimeToHhMm(reservation.end_time) ?? reservation.end_time;

    // The schedule efa had keeps its own text while it means what the table says.
    const rawTiming = rawReservation
      ? readEfa2ReservationTiming(rawReservation)
      : null;
    const sameSchedule =
      !!rawTiming &&
      rawTiming.recurrence === reservation.recurrence &&
      rawTiming.startDate === reservation.start_date &&
      rawTiming.endDate === reservation.end_date &&
      rawTiming.dayOfWeek === reservation.day_of_week;
    let schedule: Record<string, string | undefined>;
    if (sameSchedule) {
      schedule = {
        Type: rawReservation?.Type,
        DateFrom: rawReservation?.DateFrom,
        DateTo: rawReservation?.DateTo,
        DayOfWeek: rawReservation?.DayOfWeek,
      };
    } else if (reservation.recurrence === "once") {
      schedule = {
        Type: "ONETIME",
        DateFrom: efaDateOf(rawReservation?.DateFrom, reservation.start_date),
        DateTo: efaDateOf(rawReservation?.DateTo, reservation.end_date),
        DayOfWeek: undefined,
      };
    } else {
      const limited = !!reservation.start_date || !!reservation.end_date;
      // efa2 has no weekly reservation with a single bound: the missing one
      // is a date so far from any real one that it never limits anything
      // (the import reads these dates as "no bound").
      schedule = {
        Type: limited ? "WEEKLY_LIMITED" : "WEEKLY",
        DateFrom: limited
          ? efaDateOf(
              rawReservation?.DateFrom,
              reservation.start_date ?? RESERVATION_FAR_PAST
            )
          : undefined,
        DateTo: limited
          ? efaDateOf(
              rawReservation?.DateTo,
              reservation.end_date ?? RESERVATION_FAR_FUTURE
            )
          : undefined,
        DayOfWeek: reservation.day_of_week
          ? efa2DayOfWeek(reservation.day_of_week)
          : undefined,
      };
    }

    // The holder efa had keeps its own fields while it means the same
    // (the import kept only the PersonName of an unknown PersonId).
    const rawRower =
      rawReservation?.PersonId && exportedRowerIds.has(rawReservation.PersonId)
        ? rawReservation.PersonId
        : null;
    const rawName = rawRower ? null : rawReservation?.PersonName || null;
    const sameHolder =
      !!rawReservation &&
      rawRower === reservation.rower_id &&
      rawName === (reservation.rower_id ? null : reservation.person_name);
    const holder = sameHolder
      ? {
          PersonId: rawReservation.PersonId,
          PersonName: rawReservation.PersonName,
        }
      : {
          PersonId: reservation.rower_id ?? undefined,
          PersonName: reservation.rower_id
            ? undefined
            : (reservation.person_name ?? undefined),
        };

    const entry = withoutUndefined({
      ...baseOf(rawReservation, ["ChangeCount", "LastModified"]),
      BoatId: reservation.boat_id,
      Reservation:
        rawReservation && Number(rawReservation.Reservation) === number
          ? rawReservation.Reservation
          : String(number),
      ...schedule,
      TimeFrom:
        rawReservation && efaTimeToHhMm(rawReservation.TimeFrom) === startTime
          ? rawReservation.TimeFrom
          : `${startTime}:00`,
      TimeTo:
        rawReservation && efaTimeToHhMm(rawReservation.TimeTo) === endTime
          ? rawReservation.TimeTo
          : `${endTime}:00`,
      ...holder,
      Reason: reservation.reason ?? undefined,
      Contact: reservation.contact ?? undefined,
      ChangeCount: nextChangeCount(rawReservation),
      LastModified: isoToMs(reservation.updated_at) ?? nowMs,
    });
    reservationRecords.push({
      // Unchanged records keep efa's order, new ones come last.
      position: reservationPositions.get(reservation.id) ?? 1e9 + index,
      record:
        rawReservation && sameFields(entry, rawReservation)
          ? rawReservation
          : entry,
    });
  });
  reservationRecords.sort((a, b) => a.position - b.position);
  for (const { record } of reservationRecords) {
    highestReservation = Math.max(
      highestReservation,
      Number(record.Reservation) || 0
    );
  }
  /** efa hands out numbers from its counter: it must not fall behind ours. */
  const withReservationSequence = (records: Efa2Fields[]): Efa2Fields[] => {
    const field =
      rawSequence?.LongValue !== undefined && rawSequence.IntValue === undefined
        ? "LongValue"
        : "IntValue";
    const current = records.find((record) => record.Sequence === sequenceKey);
    if (current) {
      if ((Number(current[field]) || 0) >= highestReservation) return records;
      return records.map((record) =>
        record === current
          ? {
              ...record,
              [field]: String(highestReservation),
              ChangeCount: nextChangeCount(record),
              LastModified: nowMs,
            }
          : record
      );
    }
    if (reservationRecords.length === 0) return records;
    return [
      ...records,
      {
        Sequence: sequenceKey,
        IntValue: String(highestReservation),
        ChangeCount: "1",
        LastModified: nowMs,
      },
    ];
  };

  // ----- Boat status: availability from the boat, on the water from ongoing outings -----
  const rawStatuses = new Map(
    rawObjectsOfType("efa2boatstatus")
      .flatMap((object) => object.records)
      .map((record) => [record.BoatId, record])
  );
  // A boat is not available while it has an open "unavailable" entry, whose
  // description is the reason efa shows (the newest one that has a reason).
  // Open damages are not part of the status: efa shows them through the
  // damage reports.
  const unavailableEntries = await db.select<
    { boat_id: string; description: string; reported_at: string }[]
  >(
    "SELECT boat_id, description, reported_at FROM boat_damage WHERE kind = 'unavailable' AND fixed_at IS NULL ORDER BY reported_at DESC, id DESC"
  );
  const unavailableByBoat = new Map<string, string[]>();
  // efa dates the status by its last change: the newest entry.
  const unavailableSince = new Map<string, string>();
  for (const entry of unavailableEntries) {
    if (!unavailableSince.has(entry.boat_id)) {
      unavailableSince.set(entry.boat_id, entry.reported_at);
    }
    const descriptions = unavailableByBoat.get(entry.boat_id) ?? [];
    descriptions.push(entry.description);
    unavailableByBoat.set(entry.boat_id, descriptions);
  }
  const boatStatusRecords: Efa2Fields[] = boats.map((boat) => {
    const rawStatus = rawStatuses.get(boat.id);
    const latestVersion = versionsOf("efa2boats", boat.id).at(-1);
    // A boat archived because efa itself expired it keeps efa's status.
    const expiredInEfa =
      !!latestVersion && isEfaExpired(latestVersion, nowNumber);
    const unavailable = unavailableByBoat.get(boat.id);
    const base =
      boat.archived_at && expiredInEfa && rawStatus?.BaseStatus
        ? rawStatus.BaseStatus
        : boat.archived_at
          ? "HIDE"
          : unavailable !== undefined
            ? "NOTAVAILABLE"
            : "AVAILABLE";
    const open = openEntries.get(boat.id);
    const fields = baseOf(rawStatus, ["Logbook", "EntryNo", "UnknownBoat"]);
    // efa's "on the water since… with…" text goes once the outing is over
    // or corrected, and the reason a boat was unavailable once it is back in
    // service.
    const rawComment =
      (rawStatus?.CurrentStatus === "ONTHEWATER" &&
        !(open?.unchanged && rawStatus.EntryNo === open.entryId)) ||
      (rawStatus?.BaseStatus === "NOTAVAILABLE" && base !== "NOTAVAILABLE")
        ? undefined
        : rawStatus?.Comment;
    const status = withoutUndefined({
      ...fields,
      BoatId: boat.id,
      // efa's text carries the name affix: "Lahn (ex Donau)".
      BoatText:
        rawStatus?.BoatText && raw("boat", boat.id)?.Name === boat.name
          ? rawStatus.BoatText
          : boat.name,
      BaseStatus: base,
      CurrentStatus: open ? "ONTHEWATER" : base,
      Logbook: open?.logbook,
      EntryNo: open?.entryId,
      // The reason of the entries: an untouched imported entry still holds
      // efa's comment, and one emptied in Rowing Beacon clears it. Efa's
      // comment stays only for a status kept from efa, without entries.
      Comment:
        base === "NOTAVAILABLE"
          ? unavailable
            ? unavailable.find((description) => description)
            : rawStatus?.BaseStatus === "NOTAVAILABLE"
              ? rawStatus.Comment
              : undefined
          : rawComment,
      ChangeCount: String(Number(rawStatus?.ChangeCount ?? 0) + 1),
      LastModified:
        (base === "NOTAVAILABLE" &&
          isoToMs(unavailableSince.get(boat.id))) ||
        nowMs,
    });
    return rawStatus && sameFields(status, rawStatus) ? rawStatus : status;
  });
  // Status records of boats efa only knew by name, while still on the water.
  for (const object of rawObjectsOfType("efa2boatstatus")) {
    for (const record of object.records) {
      const open =
        record.UnknownBoat === "true"
          ? unknownBoatEntries.get(`${record.Logbook}|${record.EntryNo}`)
          : undefined;
      if (!open) continue;
      // Follows the entry if a correction moved it, and loses efa's
      // "on the water since…" text once corrected, as for known boats.
      const status = withoutUndefined({
        ...record,
        Logbook: open.logbook,
        EntryNo: open.entryId,
        Comment: open.unchanged ? record.Comment : undefined,
      });
      boatStatusRecords.push(
        sameFields(status, record)
          ? record
          : {
              ...status,
              ChangeCount: String(Number(record.ChangeCount ?? 0) + 1),
              LastModified: nowMs,
            }
      );
    }
  }

  // ----- Project file -----
  const projectName =
    rawProject?.name ??
    (labels.defaultProjectName.replace(/[^\w-]+/g, "") || "RowingBeacon");
  const logbookRecords = logbookNames.map((name) => {
    const rawLogbook = rawLogbookRecords.find((record) => record.Name === name);
    return withoutUndefined({
      ...(rawLogbook ?? {}),
      Type: "Logbook",
      Name: name,
      StartDate:
        rawLogbook?.StartDate ??
        (/^\d{4}$/.test(name) ? `01.01.${name}` : undefined),
      EndDate:
        rawLogbook?.EndDate ??
        (/^\d{4}$/.test(name) ? `31.12.${name}` : undefined),
      ChangeCount: rawLogbook?.ChangeCount ?? "1",
      LastModified: rawLogbook?.LastModified ?? nowMs,
    });
  });
  const otherProjectRecords = (rawProject?.records ?? []).filter(
    (record) => record.Type !== "Logbook"
  );
  const ensure = (type: string, fields: Efa2Fields) => {
    const existing = otherProjectRecords.find((record) => record.Type === type);
    if (existing) return { ...existing, ...fields };
    return { Type: type, ...fields, ChangeCount: "1", LastModified: nowMs };
  };
  const rawBoathouse = otherProjectRecords.find((r) => r.Type === "Boathouse");
  /** The logbook efa had open, while it still exists. */
  // The logbook covering today, so that efa writes new entries in the
  // right year; else the one efa had open, while it still exists.
  const todaysLogbook = logbookForDate(
    [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-")
  );
  const currentLogbook = (raw: string | undefined) =>
    logbooks.has(todaysLogbook)
      ? todaysLogbook
      : raw && logbooks.has(raw)
        ? raw
        : lastLogbook;
  const projectRecords: Efa2Fields[] = [
    // Only the first boathouse is the club's: any other stays as it was.
    ...otherProjectRecords.filter(
      (record) =>
        !["Project", "Club"].includes(record.Type) && record !== rawBoathouse
    ),
    ensure("Project", { ProjectName: projectName, StorageType: "file/xml" }),
    ensure("Club", rawProject ? {} : { ProjectID: v4() }),
    ensure("Boathouse", {
      Name: rawBoathouse?.Name ?? labels.boathouseName,
      CurrentLogbookEfaBase: currentLogbook(
        rawBoathouse?.CurrentLogbookEfaBase
      ),
      CurrentLogbookEfaBoathouse: currentLogbook(
        rawBoathouse?.CurrentLogbookEfaBoathouse
      ),
      BoathouseId: rawBoathouse?.BoathouseId ?? "1",
    }),
    ...logbookRecords,
  ];

  // ----- Damage reports: efa2 damages from the damages of Rowing Beacon -----
  const damages = await db.select<
    {
      id: string;
      boat_id: string;
      severity: DamageSeverity;
      description: string;
      reported_at: string;
      reported_by_rower_id: string | null;
      outing_id: string | null;
      fixed_at: string | null;
      fixed_by_rower_id: string | null;
      repair_note: string | null;
      repair_cost: number | null;
      created_at: string;
      updated_at: string;
    }[]
  >(
    "SELECT * FROM boat_damage WHERE kind = 'damage' ORDER BY reported_at, id"
  );
  // The import knew every rower, merged ones included: a person reference to
  // a rower that is not exported is no change.
  const allRowerIds = new Set(
    (await db.select<{ id: string }[]>("SELECT id FROM rower")).map(
      (rower) => rower.id
    )
  );
  const exportedBoatIds = new Set(boats.map((boat) => boat.id));
  const exportedDamages = damages.filter((damage) =>
    exportedBoatIds.has(damage.boat_id)
  );
  const damageById = new Map(damages.map((d) => [d.id, d]));
  const personId = (id: string | null) =>
    id && exportedRowerIds.has(id) ? id : undefined;
  /** Rewrites the fields Rowing Beacon models; the others stay as efa wrote them. */
  const writeDamage = (
    rawDamage: Efa2Fields,
    damage: (typeof damages)[number]
  ): Efa2Fields => {
    const imported = damageFromEfa(rawDamage, { rowerIds: allRowerIds, now });
    // Without a date, the import dated the damage with its own time: there
    // is nothing to compare the dates with.
    const undated = efaTimestamp(rawDamage.LastModified) === null;
    const reportedAtUnknown = undated && !efaDateToIso(rawDamage.ReportDate);
    const fixedAtUnknown =
      undated &&
      efaBoolean(rawDamage.Fixed) &&
      !efaDateToIso(rawDamage.FixDate);
    const next: Record<string, string | undefined> = { ...rawDamage };
    if (damage.severity !== imported.severity) {
      next.Severity = SEVERITY_TO_EFA[damage.severity];
    }
    if (damage.description !== imported.description) {
      next.Description = damage.description || undefined;
    }
    if (!reportedAtUnknown && damage.reported_at !== imported.reportedAt) {
      next.ReportDate = isoToEfaDate(damage.reported_at);
      next.ReportTime = localDateTimeToEfaTime(damage.reported_at);
    }
    if (damage.reported_by_rower_id !== imported.reportedByRowerId) {
      next.ReportedByPersonId = personId(damage.reported_by_rower_id);
      // efa's free name of the reporter gives way to the person.
      if (next.ReportedByPersonId) next.ReportedByPersonName = undefined;
    }
    if (
      fixedAtUnknown
        ? damage.fixed_at === null
        : damage.fixed_at !== imported.fixedAt
    ) {
      next.Fixed = toEfaBoolean(damage.fixed_at !== null);
      next.FixDate = isoToEfaDate(damage.fixed_at);
      next.FixTime = localDateTimeToEfaTime(damage.fixed_at);
      if (damage.fixed_at === null) next.FixedByPersonName = undefined;
    }
    if (damage.fixed_by_rower_id !== imported.fixedByRowerId) {
      next.FixedByPersonId = personId(damage.fixed_by_rower_id);
      if (next.FixedByPersonId) next.FixedByPersonName = undefined;
    }
    if (damage.repair_note !== imported.repairNote) {
      next.Notes = damage.repair_note || undefined;
    }
    if (damage.repair_cost !== imported.repairCost) {
      next.RepairCosts =
        damage.repair_cost === null ? undefined : String(damage.repair_cost);
    }
    const changed = withoutUndefined(next);
    if (sameFields(changed, rawDamage)) return rawDamage;
    return {
      ...changed,
      ChangeCount: nextChangeCount(rawDamage),
      LastModified: isoToMs(damage.updated_at) ?? nowMs,
    };
  };

  const rawDamageRows = efaRows.filter(
    (row) => row.object_type === "efa2boatdamages"
  );
  const keptDamages: Efa2Fields[] = [];
  const linkedDamageIds = new Set<string>();
  let highestDamage = 0;
  for (const row of rawDamageRows) {
    const rawDamage = JSON.parse(row.fields) as Efa2Fields;
    highestDamage = Math.max(highestDamage, Number(rawDamage.Damage) || 0);
    const damage =
      row.rb_table === "boat_damage" && row.rb_id
        ? damageById.get(row.rb_id)
        : undefined;
    if (damage) {
      linkedDamageIds.add(damage.id);
      keptDamages.push(writeDamage(rawDamage, damage));
    } else if (row.rb_table !== "boat_damage") {
      // Reports of boats efa only knew by name come back as they were; a
      // damage deleted in Rowing Beacon does not.
      keptDamages.push(rawDamage);
    }
  }
  // A damage reported in Rowing Beacon takes the next numbers efa has not
  // used (its counter holds the last one issued), in the order they were
  // entered: a late entry backdated later does not shift the numbers of
  // damages already exported.
  const counter = rawObjectsOfType("efa2autoincrement")
    .flatMap((object) => object.records)
    .find((record) => record.Sequence === "efa2boatdamages");
  let lastDamageNumber = Math.max(highestDamage, Number(counter?.IntValue) || 0);
  const issuedFrom = lastDamageNumber;
  const byEntryOrder = (
    a: (typeof damages)[number],
    b: (typeof damages)[number]
  ) =>
    a.created_at.localeCompare(b.created_at) ||
    a.reported_at.localeCompare(b.reported_at) ||
    a.id.localeCompare(b.id);
  const createdDamages = exportedDamages
    .filter((damage) => !linkedDamageIds.has(damage.id))
    .sort(byEntryOrder)
    .map((damage): Efa2Fields => {
      const entryId = damage.outing_id
        ? entryIdOfOuting.get(damage.outing_id)
        : undefined;
      lastDamageNumber++;
      return withoutUndefined({
        BoatId: damage.boat_id,
        Damage: String(lastDamageNumber),
        Description: damage.description || undefined,
        Severity: SEVERITY_TO_EFA[damage.severity],
        Fixed: toEfaBoolean(damage.fixed_at !== null),
        ReportDate: isoToEfaDate(damage.reported_at),
        ReportTime: localDateTimeToEfaTime(damage.reported_at),
        FixDate: isoToEfaDate(damage.fixed_at),
        FixTime: localDateTimeToEfaTime(damage.fixed_at),
        ReportedByPersonId: personId(damage.reported_by_rower_id),
        FixedByPersonId: personId(damage.fixed_by_rower_id),
        RepairCosts:
          damage.repair_cost === null ? undefined : String(damage.repair_cost),
        Notes: damage.repair_note || undefined,
        LogbookText: entryId ? `#${entryId}` : undefined,
        ChangeCount: "1",
        LastModified: isoToMs(damage.updated_at) ?? nowMs,
      });
    });
  const damageReports = [...keptDamages, ...createdDamages];
  const damagesExported = linkedDamageIds.size + createdDamages.length;
  /** The counter efa keeps for its damage numbers, moved past the new ones. */
  const withDamageCounter = (records: Efa2Fields[]): Efa2Fields[] => {
    if (lastDamageNumber === issuedFrom) return records;
    if (!counter) {
      return [
        ...records,
        {
          Sequence: "efa2boatdamages",
          IntValue: String(lastDamageNumber),
          ChangeCount: "1",
          LastModified: nowMs,
        },
      ];
    }
    return records.map((record) =>
      record === counter
        ? {
            ...record,
            IntValue: String(lastDamageNumber),
            ChangeCount: nextChangeCount(record),
            LastModified: nowMs,
          }
        : record
    );
  };

  // ----- Assemble -----
  const objects: Efa2StorageObject[] = [];
  const add = (type: string, records: Efa2Fields[], name = objectName(type)) =>
    objects.push({ type, name, header: {}, records });

  add("efa2boats", boatRecords);
  add("efa2persons", personRecords);
  add("efa2status", statusRecords);
  add("efa2groups", groupRecords);
  add("efa2destinations", destinationRecords);
  add("efa2boatstatus", boatStatusRecords);
  add(
    "efa2boatreservations",
    reservationRecords.map(({ record }) => record)
  );
  for (const [name, entries] of logbooks) add("efa2logbook", entries, name);
  for (const type of Object.keys(OBJECT_NAMES)) {
    if (REWRITTEN.has(type)) continue;
    const kept = rawObjectsOfType(type);
    if (kept.length === 0) {
      add(
        type,
        type === "efa2boatdamages"
          ? damageReports
          : type === "efa2autoincrement"
            ? withDamageCounter(withReservationSequence([]))
            : []
      );
    }
    for (const object of kept) {
      add(
        type,
        type === "efa2boatdamages"
          ? damageReports
          : type === "efa2autoincrement"
            ? withDamageCounter(withReservationSequence(object.records))
            : object.records,
        object.name
      );
    }
  }
  const clubworkBooks = rawObjectsOfType("efa2clubwork");
  for (const object of clubworkBooks) {
    add("efa2clubwork", object.records, object.name);
  }
  // Like logbooks, an empty clubwork book is only listed in the project file.
  for (const record of otherProjectRecords) {
    if (
      record.Type === "ClubworkBook" &&
      record.Name &&
      !clubworkBooks.some((object) => object.name === record.Name)
    ) {
      add("efa2clubwork", [], record.Name);
    }
  }

  const [{ incidents }] = await db.select<{ incidents: number }[]>(
    "SELECT COUNT(*) AS incidents FROM incident WHERE id NOT IN (SELECT rb_id FROM efa_record WHERE rb_table = 'incident') AND id NOT IN (SELECT incident_id FROM boat_damage WHERE incident_id IS NOT NULL)"
  );

  return {
    project: {
      name: projectName,
      projectRecords,
      objects,
      sessionTypeLabels: {},
    },
    report: {
      boats: boatRecords.length,
      rowers: personRecords.length,
      routes: destinationRecords.length,
      outings: outings.length,
      logbooks: logbookNames,
      damagesExported,
      incidentsNotExported: Number(incidents),
      crewsCut,
      reservations: reservations.length,
    },
  };
};
