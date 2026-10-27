import { v4 } from "uuid";
import { SqlClient } from "../database/sqlClient";
import { Efa2Project, Efa2StorageObject } from "./efa2Project";
import { Efa2Fields } from "./efa2Xml";
import {
  EFA2_FOREVER,
  efaDateToIso,
  efaDistanceToMetres,
  efaList,
  efaTimeToHhMm,
  isoToEfaDate,
  localDateTimeToEfaTime,
  metresToEfaDistance,
  toEfaBoolean,
  toEfaList,
} from "./efa2Values";
import {
  configurationsFromEfa,
  deriveEfa2Id,
  normalizeName,
  toOutingTypeCode,
} from "./planEfa2Import";

/**
 * Build an efa2 project from the club data (ADR 0004). Fields Rowing
 * Beacon models are written from its tables; every other field, and every
 * record without a screen (reservations, messages…), comes back from the
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
  /** Incidents have no efa2 equivalent (an efa2 damage is a lasting state). */
  incidentsNotExported: number;
  /** Outings with more than 24 rowers or several coxes: efa2 has no seat for the rest. */
  crewsCut: number;
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
  return raw && time && efaTimeToHhMm(raw) === efaTimeToHhMm(time)
    ? raw
    : time;
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
      is_in_maintenance: number;
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
          !Object.values(ROWER_STATUS_TO_TYPE).some((t) => t === rawStatusType)))
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
          efaList(rawGroup?.MemberIdList).filter((id) => exportedRowerIds.has(id))
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
      const from = logbook.StartDate?.split(".").reverse().join("-");
      const to = logbook.EndDate?.split(".").reverse().join("-");
      return from && to && from <= efaDate && efaDate <= to;
    });
    return covering?.Name ?? date.slice(0, 4);
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
  const openEntries = new Map<string, { logbook: string; entryId: string }>();
  const unknownBoatEntries = new Set<string>();
  let crewsCut = 0;

  for (const outing of outings) {
    const rawEntry = raw("outing", outing.id);
    const logbook =
      outingLogbook.get(outing.id) ?? logbookForDate(outing.start_date_time);
    let entryId = rawEntry?.EntryId;
    if (!entryId || outingLogbook.get(outing.id) !== logbook) {
      const next = nextEntryId.get(logbook) ?? 1;
      entryId = String(next);
      nextEntryId.set(logbook, next + 1);
    }

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
    if (unknownBoatOnWater) unknownBoatEntries.add(`${logbook}|${entryId}`);
    else if (ongoing) openEntries.set(outing.boat_id, { logbook, entryId });

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
    const entries = logbooks.get(logbook) ?? [];
    entries.push(rawEntry && sameFields(entry, rawEntry) ? rawEntry : entry);
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

  // ----- Boat status: availability from the boat, on the water from ongoing outings -----
  const rawStatuses = new Map(
    rawObjectsOfType("efa2boatstatus")
      .flatMap((object) => object.records)
      .map((record) => [record.BoatId, record])
  );
  const blockingDamageBoatIds = new Set(
    rawObjectsOfType("efa2boatdamages")
      .flatMap((object) => object.records)
      .filter((d) => d.Fixed !== "true" && d.Severity === "NOTUSEABLE")
      .map((d) => d.BoatId)
  );
  const boatStatusRecords: Efa2Fields[] = boats.map((boat) => {
    const rawStatus = rawStatuses.get(boat.id);
    const latestVersion = versionsOf("efa2boats", boat.id).at(-1);
    // A boat archived because efa itself expired it keeps efa's status.
    const expiredInEfa =
      !!latestVersion && isEfaExpired(latestVersion, nowNumber);
    // The import also blocks a boat for an open NOTUSEABLE damage, which
    // efa shows through the damage, not the status.
    const blockedByDamage =
      boat.is_in_maintenance === 1 &&
      rawStatus?.BaseStatus === "AVAILABLE" &&
      blockingDamageBoatIds.has(boat.id);
    const base =
      boat.archived_at && expiredInEfa && rawStatus?.BaseStatus
        ? rawStatus.BaseStatus
        : boat.archived_at
          ? "HIDE"
          : boat.is_in_maintenance && !blockedByDamage
            ? "NOTAVAILABLE"
            : "AVAILABLE";
    const open = openEntries.get(boat.id);
    const fields = baseOf(rawStatus, ["Logbook", "EntryNo", "UnknownBoat"]);
    // efa's "on the water since…" text goes once the outing is over, and
    // the reason a boat was unavailable once it is back in service.
    const rawComment =
      (rawStatus?.CurrentStatus === "ONTHEWATER" && !open) ||
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
      // The reason is the boat's note, emptied in Rowing Beacon or not.
      Comment:
        base === "NOTAVAILABLE" && !blockedByDamage
          ? boat.note || undefined
          : rawComment,
      ChangeCount: String(Number(rawStatus?.ChangeCount ?? 0) + 1),
      LastModified: nowMs,
    });
    return rawStatus && sameFields(status, rawStatus) ? rawStatus : status;
  });
  // Status records of boats efa only knew by name, while still on the water.
  for (const object of rawObjectsOfType("efa2boatstatus")) {
    for (const record of object.records) {
      if (
        record.UnknownBoat === "true" &&
        unknownBoatEntries.has(`${record.Logbook}|${record.EntryNo}`)
      ) {
        boatStatusRecords.push(record);
      }
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
  for (const [name, entries] of logbooks) add("efa2logbook", entries, name);
  // A boat put back in service in Rowing Beacon has its blocking damages
  // repaired, or efa would still show them and a re-import block the boat.
  const boatsInService = new Set(
    boats.filter((boat) => !boat.is_in_maintenance).map((boat) => boat.id)
  );
  const today = isoToEfaDate(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`
  );
  const withRepairs = (records: Efa2Fields[]) =>
    records.map((damage) =>
      damage.Fixed !== "true" &&
      damage.Severity === "NOTUSEABLE" &&
      boatsInService.has(damage.BoatId)
        ? withoutUndefined({
            ...damage,
            Fixed: "true",
            FixDate: today,
            ChangeCount: String(Number(damage.ChangeCount ?? 0) + 1),
            LastModified: nowMs,
          })
        : damage
    );
  for (const type of Object.keys(OBJECT_NAMES)) {
    if (REWRITTEN.has(type)) continue;
    const kept = rawObjectsOfType(type);
    if (kept.length === 0) add(type, []);
    for (const object of kept) {
      add(
        type,
        type === "efa2boatdamages"
          ? withRepairs(object.records)
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
    "SELECT COUNT(*) AS incidents FROM incident WHERE id NOT IN (SELECT rb_id FROM efa_record WHERE rb_table = 'incident')"
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
      incidentsNotExported: Number(incidents),
      crewsCut,
    },
  };
};
