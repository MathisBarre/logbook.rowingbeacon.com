import {
  getLegacyTypeFromConfiguration,
  getDefaultConfiguration,
  withSingleDefault,
  Rigging,
} from "../../business/boatConfiguration.rules";
import { AgeCategoryEnum } from "../../business/ageCategory.rules";
import { SeriousnessCategoryEnum } from "../../business/seriousness.rules";
import { getRowerFullName } from "../../business/rower.rules";
import { getDateTimeWithoutTimezone } from "../../utils/date.utils";
import { SqlClient, sqlLiteral } from "../sqlClient";
import {
  ClubBoat,
  ClubIncident,
  ClubRoute,
  ClubRower,
  Gender,
  OngoingOuting,
  RowerStatus,
} from "./club.types";

/**
 * ----- Rows -----
 */

interface BoatRow {
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
}

interface BoatConfigurationRow {
  id: string;
  boat_id: string;
  position: number;
  seats: number | null;
  rigging: Rigging | null;
  coxed: number;
  hull_type: string | null;
  is_default: number;
  archived_at: string | null;
}

interface RowerRow {
  id: string;
  first_name: string;
  last_name: string;
  status: RowerStatus;
  age_category: AgeCategoryEnum | null;
  seriousness: SeriousnessCategoryEnum | null;
  gender: Gender | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  address: string | null;
  note: string | null;
  exclude_from_stats: number;
  archived_at: string | null;
  merged_into_id: string | null;
  anonymized_at: string | null;
}

interface RouteRow {
  id: string;
  name: string;
  distance_m: number | null;
  note: string | null;
  archived_at: string | null;
}

interface OngoingOutingRow {
  id: string;
  boat_id: string;
  boat_name: string;
  boat_configuration_id: string | null;
  route_id: string | null;
  route_name: string | null;
  outing_type_code: string | null;
  captain_rower_id: string | null;
  start_date_time: string;
  estimated_end_date_time: string | null;
  comment: string | null;
}

interface CrewRow {
  outing_id: string;
  rower_id: string;
  first_name: string;
  last_name: string;
  role: "rower" | "cox";
}

interface IncidentRow {
  id: string;
  outing_id: string | null;
  boat_id: string;
  message: string;
  occurred_at: string;
}

interface BoatLevelConfigRow {
  boat_id: string;
  minimal_rower_category: AgeCategoryEnum | null;
  minimal_rower_type: SeriousnessCategoryEnum | null;
}

export interface ClubData {
  boats: ClubBoat[];
  rowers: ClubRower[];
  routes: ClubRoute[];
  ongoingOutings: OngoingOuting[];
  incidents: ClubIncident[];
  boatLevelConfigs: {
    boatId: string;
    minimalRowerCategory: AgeCategoryEnum | null;
    minimalRowerType: SeriousnessCategoryEnum | null;
  }[];
  settings: Record<string, unknown>;
}

const undefinedIfNull = <T>(value: T | null): T | undefined =>
  value === null ? undefined : value;

/**
 * Stored dates are local wall-clock times; the stores use ISO strings. An
 * unreadable date must not stop the app from starting: it shows as now.
 */
const localToIso = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    console.error(`❌ Unreadable date in the database: ${value}`);
    return new Date().toISOString();
  }
  return date.toISOString();
};

/**
 * ----- Mapping -----
 */

const toClubBoat = (
  row: BoatRow,
  configurationRows: BoatConfigurationRow[]
): ClubBoat => {
  const configurations = configurationRows
    .filter((configuration) => configuration.archived_at === null)
    .map((configuration) => ({
      id: configuration.id,
      seats: configuration.seats,
      rigging: configuration.rigging,
      coxed: configuration.coxed === 1,
      hullType: configuration.hull_type,
      isDefault: configuration.is_default === 1,
      position: configuration.position,
    }))
    .sort((a, b) => a.position - b.position);

  return {
    id: row.id,
    name: row.name,
    note: row.note ?? "",
    isInMaintenance: row.is_in_maintenance === 1,
    type: getLegacyTypeFromConfiguration(
      getDefaultConfiguration(configurations)
    ),
    archivedAt: undefinedIfNull(row.archived_at),
    configurations,
    owner: row.owner,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serial_number,
    buildYear: row.build_year,
    purchaseDate: row.purchase_date,
    maxCrewWeightKg: row.max_crew_weight_kg,
    excludeFromStats: row.exclude_from_stats === 1,
  };
};

const toClubRower = (row: RowerRow): ClubRower => ({
  id: row.id,
  name: getRowerFullName({
    firstName: row.first_name,
    lastName: row.last_name,
  }),
  firstName: row.first_name,
  lastName: row.last_name,
  status: row.status,
  category: undefinedIfNull(row.age_category),
  type: undefinedIfNull(row.seriousness),
  gender: row.gender,
  birthDate: row.birth_date,
  email: row.email,
  phone: row.phone,
  licenseNumber: row.license_number,
  address: row.address,
  note: row.note,
  excludeFromStats: row.exclude_from_stats === 1,
  archivedAt: undefinedIfNull(row.archived_at),
  mergedIntoId: row.merged_into_id,
  anonymizedAt: row.anonymized_at,
});

const toClubRoute = (row: RouteRow): ClubRoute => ({
  id: row.id,
  name: row.name,
  distanceM: row.distance_m,
  note: row.note,
  archivedAt: undefinedIfNull(row.archived_at),
});

/**
 * ----- Reads -----
 */

export const loadClubData = async (db: SqlClient): Promise<ClubData> => {
  const boatRows = await db.select<BoatRow[]>(
    "SELECT * FROM boat WHERE merged_into_id IS NULL ORDER BY name"
  );
  const configurationRows = await db.select<BoatConfigurationRow[]>(
    "SELECT * FROM boat_configuration"
  );
  const rowerRows = await db.select<RowerRow[]>(
    "SELECT * FROM rower WHERE merged_into_id IS NULL ORDER BY first_name, last_name"
  );
  const routeRows = await db.select<RouteRow[]>(
    "SELECT * FROM route WHERE merged_into_id IS NULL ORDER BY name"
  );
  const ongoingRows = await db.select<OngoingOutingRow[]>(/* sql */ `
    SELECT o.id, o.boat_id, b.name AS boat_name, o.boat_configuration_id,
      o.route_id, r.name AS route_name, o.outing_type_code, o.captain_rower_id,
      o.start_date_time, o.estimated_end_date_time, o.comment
    FROM outing o
    JOIN boat b ON b.id = o.boat_id
    LEFT JOIN route r ON r.id = o.route_id
    WHERE o.end_date_time IS NULL
    ORDER BY o.start_date_time
  `);
  const crewRows = await db.select<CrewRow[]>(/* sql */ `
    SELECT c.outing_id, c.rower_id, ro.first_name, ro.last_name, c.role
    FROM outing_crew c
    JOIN outing o ON o.id = c.outing_id
    JOIN rower ro ON ro.id = c.rower_id
    WHERE o.end_date_time IS NULL
    ORDER BY c.position
  `);
  const incidentRows = await db.select<IncidentRow[]>(
    "SELECT id, outing_id, boat_id, message, occurred_at FROM incident ORDER BY occurred_at DESC"
  );
  const levelRows = await db.select<BoatLevelConfigRow[]>(
    "SELECT * FROM boat_level_config"
  );
  const settingRows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM setting"
  );

  const configurationsByBoat = new Map<string, BoatConfigurationRow[]>();
  for (const configuration of configurationRows) {
    const list = configurationsByBoat.get(configuration.boat_id) ?? [];
    list.push(configuration);
    configurationsByBoat.set(configuration.boat_id, list);
  }

  return {
    boats: boatRows.map((row) =>
      toClubBoat(row, configurationsByBoat.get(row.id) ?? [])
    ),
    rowers: rowerRows.map(toClubRower),
    routes: routeRows.map(toClubRoute),
    ongoingOutings: ongoingRows.map((row) => ({
      id: row.id,
      boat: { id: row.boat_id, name: row.boat_name },
      boatConfigurationId: row.boat_configuration_id,
      route:
        row.route_id && row.route_name !== null
          ? { id: row.route_id, name: row.route_name }
          : null,
      outingTypeCode: row.outing_type_code,
      captainRowerId: row.captain_rower_id,
      startDateTime: localToIso(row.start_date_time),
      estimatedEndDateTime: row.estimated_end_date_time
        ? localToIso(row.estimated_end_date_time)
        : undefined,
      comment: row.comment ?? "",
      endDateTime: null,
      rowers: crewRows
        .filter((crew) => crew.outing_id === row.id)
        .map((crew) => ({
          id: crew.rower_id,
          name: getRowerFullName({
            firstName: crew.first_name,
            lastName: crew.last_name,
          }),
          role: crew.role,
        })),
    })),
    incidents: incidentRows.map((row) => ({
      id: row.id,
      boatId: row.boat_id,
      message: row.message,
      sessionId: row.outing_id ?? "",
      datetime: localToIso(row.occurred_at),
    })),
    boatLevelConfigs: levelRows.map((row) => ({
      boatId: row.boat_id,
      minimalRowerCategory: row.minimal_rower_category,
      minimalRowerType: row.minimal_rower_type,
    })),
    settings: Object.fromEntries(
      settingRows.map((row) => {
        try {
          return [row.key, JSON.parse(row.value) as unknown];
        } catch {
          return [row.key, row.value];
        }
      })
    ),
  };
};

/**
 * ----- Writes -----
 */

const nowIso = () => new Date().toISOString();

const toHistoryValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
};

/**
 * Upsert a row and record changed columns in the readable history.
 */
const upsertWithHistory = async (
  db: SqlClient,
  entity: string,
  values: Record<string, unknown>,
  trackedColumns: string[]
) => {
  const id = values.id as string;
  const [previous] = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM ${entity} WHERE id = $1`,
    [id]
  );
  const now = nowIso();
  const columns = Object.keys(values);

  if (previous) {
    const assignments = columns
      .filter((column) => column !== "id")
      .map((column, index) => `${column} = $${index + 2}`);
    await db.execute(
      `UPDATE ${entity} SET ${assignments.join(", ")}, updated_at = $${assignments.length + 2} WHERE id = $1`,
      [
        id,
        ...columns.filter((column) => column !== "id").map((c) => values[c]),
        now,
      ]
    );

    for (const column of trackedColumns) {
      const before = toHistoryValue(previous[column]);
      const after = toHistoryValue(values[column]);
      if (column in values && before !== after) {
        await db.execute(
          "INSERT INTO change_log (entity, entity_id, field, old_value, new_value, changed_at) VALUES ($1, $2, $3, $4, $5, $6)",
          [entity, id, column, before, after, now]
        );
      }
    }
    return;
  }

  const allColumns = [...columns, "created_at", "updated_at"];
  await db.execute(
    `INSERT INTO ${entity} (${allColumns.join(", ")}) VALUES (${allColumns
      .map((_, index) => `$${index + 1}`)
      .join(", ")})`,
    [...columns.map((column) => values[column]), now, now]
  );
};

export const saveBoat = async (db: SqlClient, boat: ClubBoat) => {
  await upsertWithHistory(
    db,
    "boat",
    {
      id: boat.id,
      name: boat.name,
      note: boat.note || null,
      is_in_maintenance: boat.isInMaintenance ? 1 : 0,
      owner: boat.owner ?? null,
      manufacturer: boat.manufacturer ?? null,
      model: boat.model ?? null,
      serial_number: boat.serialNumber ?? null,
      build_year: boat.buildYear ?? null,
      purchase_date: boat.purchaseDate ?? null,
      max_crew_weight_kg: boat.maxCrewWeightKg ?? null,
      exclude_from_stats: boat.excludeFromStats ? 1 : 0,
      archived_at: boat.archivedAt ?? null,
    },
    ["name", "note", "is_in_maintenance", "archived_at"]
  );

  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM boat_configuration WHERE boat_id = $1 AND archived_at IS NULL",
    [boat.id]
  );

  for (const configuration of withSingleDefault(boat.configurations)) {
    await db.execute(
      /* sql */ `
      INSERT INTO boat_configuration (id, boat_id, position, seats, rigging, coxed, hull_type, is_default)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET position = excluded.position, seats = excluded.seats,
        rigging = excluded.rigging, coxed = excluded.coxed, hull_type = excluded.hull_type,
        is_default = excluded.is_default, archived_at = NULL`,
      [
        configuration.id,
        boat.id,
        configuration.position,
        configuration.seats,
        configuration.rigging,
        configuration.coxed ? 1 : 0,
        configuration.hullType ?? null,
        configuration.isDefault ? 1 : 0,
      ]
    );
  }

  // Configurations may be referenced by outings: removed ones are archived.
  const keptIds = new Set(boat.configurations.map((c) => c.id));
  for (const { id } of existing) {
    if (!keptIds.has(id)) {
      await db.execute(
        "UPDATE boat_configuration SET archived_at = $1, is_default = 0 WHERE id = $2",
        [nowIso(), id]
      );
    }
  }
};

export const saveRower = async (db: SqlClient, rower: ClubRower) => {
  await upsertWithHistory(
    db,
    "rower",
    {
      id: rower.id,
      first_name: rower.firstName,
      last_name: rower.lastName,
      status: rower.status,
      age_category: rower.category ?? null,
      seriousness: rower.type ?? null,
      gender: rower.gender ?? null,
      birth_date: rower.birthDate ?? null,
      email: rower.email ?? null,
      phone: rower.phone ?? null,
      license_number: rower.licenseNumber ?? null,
      address: rower.address ?? null,
      note: rower.note ?? null,
      exclude_from_stats: rower.excludeFromStats ? 1 : 0,
      archived_at: rower.archivedAt ?? null,
    },
    [
      "first_name",
      "last_name",
      "status",
      "age_category",
      "seriousness",
      "license_number",
      "archived_at",
    ]
  );
};

/**
 * GDPR: blank a rower's personal data, keep their outings for the club's
 * statistics, and purge the readable history that still holds old values.
 */
export const anonymizeRower = async (
  db: SqlClient,
  rowerId: string,
  label: string
) => {
  const now = nowIso();
  // Read before blanking: efa2 records name people as free text, with the
  // names of Rowing Beacon and of every efa version (affix apart).
  const formerNames = await db.select<
    { first_name: string | null; last_name: string | null }[]
  >(
    /* sql */ `
    SELECT first_name, last_name FROM rower WHERE id = $1
    UNION
    SELECT json_extract(fields, '$.FirstName'), json_extract(fields, '$.LastName')
    FROM efa_record
    WHERE object_type = 'efa2persons' AND json_extract(fields, '$.Id') = $1`,
    [rowerId]
  );
  // First, while the names can still be read again if the app stops here.
  await anonymizeEfaRecordsOf(
    db,
    rowerId,
    formerNames.map((name) => ({
      first_name: name.first_name ?? "",
      last_name: name.last_name ?? "",
    })),
    label
  );
  await db.execute(
    /* sql */ `
    UPDATE rower SET first_name = $2, last_name = '', gender = NULL,
      birth_date = NULL, email = NULL, phone = NULL, license_number = NULL,
      address = NULL, note = NULL, anonymized_at = $3,
      archived_at = COALESCE(archived_at, $3), updated_at = $3
    WHERE id = $1`,
    [rowerId, label, now]
  );
  await db.execute(
    "DELETE FROM change_log WHERE entity = 'rower' AND entity_id = $1",
    [rowerId]
  );
  // The efa2 copies too: every version of the person, and the names typed
  // in the logbook entries of their outings. The export then writes the
  // anonymised record only.
  await db.execute(
    "DELETE FROM efa_record WHERE object_type = 'efa2persons' AND json_extract(fields, '$.Id') = $1",
    [rowerId]
  );
  const nameFields = [
    "CoxName",
    "AllCrewNames",
    ...Array.from({ length: 24 }, (_, i) => `Crew${i + 1}Name`),
  ]
    .map((field) => `'$.${field}'`)
    .join(", ");
  await db.execute(
    /* sql */ `
    UPDATE efa_record SET fields = json_remove(fields, ${nameFields})
    WHERE object_type = 'efa2logbook' AND rb_table = 'outing'
      AND rb_id IN (SELECT outing_id FROM outing_crew WHERE rower_id = $1)`,
    [rowerId]
  );
};

/** Case-insensitive beyond ASCII: SQLite's lower() only folds A-Z. */
const foldName = (text: string) => text.normalize("NFC").trim().toLowerCase();

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const EFA_TYPES_NAMING_PEOPLE = [
  "efa2messages",
  "efa2boatdamages",
  "efa2boatreservations",
  "efa2sessiongroups",
  "efa2boatstatus",
];

/**
 * Records kept from efa2 without a screen that name a person: messages,
 * damage reports, reservations, session groups, boat status comments.
 * Matched in JavaScript, which folds accented capitals (É, Ö…).
 */
const anonymizeEfaRecordsOf = async (
  db: SqlClient,
  rowerId: string,
  names: { first_name: string; last_name: string }[],
  label: string
) => {
  const needles = new Set<string>();
  const inText: RegExp[] = [];
  for (const { first_name, last_name } of names) {
    const [first, last] = [first_name.trim(), last_name.trim()];
    // A version without any name would match every unnamed record.
    if (!first && !last) continue;
    needles.add(foldName([first, last].filter(Boolean).join(" ")));
    needles.add(foldName([last, first].filter(Boolean).join(", ")));
    // A lone first or last name is too common to replace inside a text.
    if (first && last) {
      for (const name of [`${first} ${last}`, `${last}, ${first}`]) {
        inText.push(
          new RegExp(escapeRegExp(name.normalize("NFC")), "giu")
        );
      }
    }
  }
  if (needles.size === 0) return;
  const isName = (value: unknown) =>
    typeof value === "string" && needles.has(foldName(value));
  const mentions = (value: unknown) =>
    typeof value === "string" &&
    [...needles].some((needle) => foldName(value).includes(needle));

  const rows = await db.select<
    {
      object_type: string;
      object_name: string;
      record_key: string;
      fields: string;
    }[]
  >(
    `SELECT object_type, object_name, record_key, fields FROM efa_record
    WHERE object_type IN (${EFA_TYPES_NAMING_PEOPLE.map(sqlLiteral).join(", ")})`
  );
  for (const row of rows) {
    const fields = JSON.parse(row.fields) as Record<string, string>;
    const before = row.fields;
    switch (row.object_type) {
      case "efa2messages":
        if (isName(fields.From)) {
          fields.From = label;
          delete fields.ReplyTo;
        }
        // Message texts (efa's audit reports…) mention people by name.
        if (mentions(fields.Text)) {
          fields.Text = inText.reduce(
            (text, name) => text.replace(name, label),
            fields.Text.normalize("NFC")
          );
        }
        break;
      case "efa2boatdamages":
        if (
          fields.ReportedByPersonId === rowerId ||
          isName(fields.ReportedByPersonName)
        ) {
          delete fields.ReportedByPersonName;
        }
        break;
      case "efa2boatreservations":
        if (fields.PersonId === rowerId || isName(fields.PersonName)) {
          delete fields.PersonName;
          delete fields.Contact;
        }
        break;
      case "efa2sessiongroups":
        if (isName(fields.Organizer)) delete fields.Organizer;
        break;
      case "efa2boatstatus":
        if (mentions(fields.Comment)) delete fields.Comment;
        break;
    }
    const after = JSON.stringify(fields);
    if (after === JSON.stringify(JSON.parse(before))) continue;
    await db.execute(
      "UPDATE efa_record SET fields = $1 WHERE object_type = $2 AND object_name = $3 AND record_key = $4",
      [after, row.object_type, row.object_name, row.record_key]
    );
  }
};

export const saveRoute = async (db: SqlClient, route: ClubRoute) => {
  await upsertWithHistory(
    db,
    "route",
    {
      id: route.id,
      name: route.name,
      distance_m: route.distanceM ?? null,
      note: route.note ?? null,
      archived_at: route.archivedAt ?? null,
    },
    ["name", "distance_m", "archived_at"]
  );
};

export const saveSetting = async (
  db: SqlClient,
  key: string,
  value: unknown
) => {
  await db.execute(
    "INSERT INTO setting (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)]
  );
};

export const saveBoatLevelConfig = async (
  db: SqlClient,
  config: ClubData["boatLevelConfigs"][number]
) => {
  await db.execute(
    /* sql */ `
    INSERT INTO boat_level_config (boat_id, minimal_rower_category, minimal_rower_type)
    VALUES ($1, $2, $3)
    ON CONFLICT (boat_id) DO UPDATE SET minimal_rower_category = excluded.minimal_rower_category,
      minimal_rower_type = excluded.minimal_rower_type`,
    [config.boatId, config.minimalRowerCategory, config.minimalRowerType]
  );
};

export const deleteBoatLevelConfig = async (db: SqlClient, boatId: string) => {
  await db.execute("DELETE FROM boat_level_config WHERE boat_id = $1", [
    boatId,
  ]);
};

export const deleteAllBoatLevelConfigs = async (db: SqlClient) => {
  await db.execute("DELETE FROM boat_level_config");
};

export interface OutingToSave {
  id: string;
  boatId: string;
  boatConfigurationId?: string | null;
  routeId?: string | null;
  outingTypeCode?: string | null;
  startDateTime: string;
  estimatedEndDateTime?: string | null;
  endDateTime?: string | null;
  distanceM?: number | null;
  comment?: string | null;
  hasBeenCoached?: boolean | null;
  captainRowerId?: string | null;
  crew: { rowerId: string; role: "rower" | "cox" }[];
}

const toLocal = (value: string | null | undefined) =>
  value ? getDateTimeWithoutTimezone(value) : null;

const coachedToInteger = (value: boolean | null | undefined) =>
  value === true ? 1 : value === false ? 0 : null;

export const insertOuting = async (db: SqlClient, outing: OutingToSave) => {
  const now = nowIso();
  await db.execute(
    /* sql */ `
    INSERT INTO outing (id, boat_id, boat_configuration_id, route_id, outing_type_code,
      start_date_time, estimated_end_date_time, end_date_time, distance_m, comment,
      has_been_coached, captain_rower_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      outing.id,
      outing.boatId,
      outing.boatConfigurationId ?? null,
      outing.routeId ?? null,
      outing.outingTypeCode ?? null,
      toLocal(outing.startDateTime),
      toLocal(outing.estimatedEndDateTime),
      toLocal(outing.endDateTime),
      outing.distanceM ?? null,
      outing.comment || null,
      coachedToInteger(outing.hasBeenCoached),
      outing.captainRowerId ?? null,
      now,
      now,
    ]
  );

  // No transaction across calls with the Tauri SQL plugin: an outing whose
  // crew could not be saved is removed so that it is never half written.
  const crew = outing.crew.filter(
    (member, index) =>
      outing.crew.findIndex((other) => other.rowerId === member.rowerId) ===
      index
  );
  try {
    for (const [position, member] of crew.entries()) {
      await db.execute(
        "INSERT INTO outing_crew (outing_id, rower_id, role, position) VALUES ($1, $2, $3, $4)",
        [outing.id, member.rowerId, member.role, position]
      );
    }
  } catch (error) {
    await db.execute("DELETE FROM outing_crew WHERE outing_id = $1", [
      outing.id,
    ]);
    await db.execute("DELETE FROM outing WHERE id = $1", [outing.id]);
    throw error;
  }
};

/**
 * Close an ongoing outing. Resolves with false when the outing is not in the
 * database. distanceM undefined keeps the stored distance, null clears it.
 */
export const finishOuting = async (
  db: SqlClient,
  payload: {
    id: string;
    endDateTime: string;
    comment: string | null;
    hasBeenCoached: boolean | null;
    distanceM?: number | null;
  }
): Promise<boolean> => {
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM outing WHERE id = $1",
    [payload.id]
  );
  if (existing.length === 0) {
    return false;
  }

  await db.execute(
    /* sql */ `
    UPDATE outing SET end_date_time = $2, comment = $3, has_been_coached = $4,
      distance_m = CASE WHEN $7 = 1 THEN $5 ELSE distance_m END, updated_at = $6
    WHERE id = $1`,
    [
      payload.id,
      toLocal(payload.endDateTime),
      payload.comment || null,
      coachedToInteger(payload.hasBeenCoached),
      payload.distanceM ?? null,
      nowIso(),
      payload.distanceM === undefined ? 0 : 1,
    ]
  );
  return true;
};

/**
 * One statement, so a failure cannot leave an outing without its crew: the
 * crew goes by ON DELETE CASCADE and incidents are unlinked by ON DELETE
 * SET NULL (sqlx turns foreign keys on by default).
 */
export const deleteOuting = async (db: SqlClient, outingId: string) => {
  await db.execute("DELETE FROM outing WHERE id = $1", [outingId]);
};

export const insertIncident = async (db: SqlClient, incident: ClubIncident) => {
  await db.execute(
    "INSERT INTO incident (id, outing_id, boat_id, message, occurred_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      incident.id,
      incident.sessionId || null,
      incident.boatId,
      incident.message,
      toLocal(incident.datetime),
      nowIso(),
    ]
  );
};

/**
 * Remove all club data, the v1 tables included. The v1 migration marker is
 * kept so that a reset does not re-import old localStorage data.
 */
export const deleteAllClubData = async (db: SqlClient) => {
  for (const table of [
    "efa_record",
    "session_rowers",
    "session",
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
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("DELETE FROM outing_type WHERE is_builtin = 0");
  await db.execute("DELETE FROM setting WHERE key <> 'migration.v1'");
};
