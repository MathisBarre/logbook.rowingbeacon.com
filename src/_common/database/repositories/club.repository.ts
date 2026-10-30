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
import { getUnusableBoatIds } from "../../business/damage.rules";
import {
  BoatDamage,
  ClubBoat,
  ClubIncident,
  ClubRoute,
  ClubRower,
  DamageKind,
  DamageSeverity,
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

interface BoatDamageRow {
  id: string;
  boat_id: string;
  kind: DamageKind;
  severity: DamageSeverity;
  description: string;
  reported_at: string;
  reported_by_rower_id: string | null;
  outing_id: string | null;
  incident_id: string | null;
  fixed_at: string | null;
  fixed_by_rower_id: string | null;
  repair_note: string | null;
  repair_cost: number | null;
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
  damages: BoatDamage[];
  /** Boats still blocked by the former maintenance flag (ADR 0007). */
  legacyMaintenanceBoatIds: string[];
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
  configurationRows: BoatConfigurationRow[],
  unusable: boolean
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
    // Derived from the damages (ADR 0007). The former flag still counts
    // until upgradeToBoatDamages has moved it.
    isInMaintenance: unusable || row.is_in_maintenance === 1,
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

const toBoatDamage = (row: BoatDamageRow): BoatDamage => ({
  id: row.id,
  boatId: row.boat_id,
  kind: row.kind,
  severity: row.severity,
  description: row.description,
  reportedAt: localToIso(row.reported_at),
  reportedByRowerId: row.reported_by_rower_id,
  outingId: row.outing_id,
  incidentId: row.incident_id,
  fixedAt: row.fixed_at ? localToIso(row.fixed_at) : null,
  fixedByRowerId: row.fixed_by_rower_id,
  repairNote: row.repair_note,
  repairCost: row.repair_cost,
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
  const damageRows = await db.select<BoatDamageRow[]>(
    "SELECT * FROM boat_damage ORDER BY reported_at DESC"
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

  const damages = damageRows.map(toBoatDamage);
  const unusableBoatIds = getUnusableBoatIds(damages);

  return {
    boats: boatRows.map((row) =>
      toClubBoat(
        row,
        configurationsByBoat.get(row.id) ?? [],
        unusableBoatIds.has(row.id)
      )
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
    damages,
    legacyMaintenanceBoatIds: boatRows
      .filter((row) => row.is_in_maintenance === 1)
      .map((row) => row.id),
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

const recordChange = (
  db: SqlClient,
  entity: string,
  id: string,
  field: string,
  before: string | null,
  after: string | null,
  changedAt: string
) =>
  db.execute(
    "INSERT INTO change_log (entity, entity_id, field, old_value, new_value, changed_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [entity, id, field, before, after, changedAt]
  );

/** Records the tracked columns whose value differs from the stored row. */
const recordColumnChanges = async (
  db: SqlClient,
  entity: string,
  id: string,
  previous: Record<string, unknown>,
  values: Record<string, unknown>,
  trackedColumns: string[],
  changedAt: string
) => {
  for (const column of trackedColumns) {
    const before = toHistoryValue(previous[column]);
    const after = toHistoryValue(values[column]);
    if (column in values && before !== after) {
      await recordChange(db, entity, id, column, before, after, changedAt);
    }
  }
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
      `UPDATE ${entity} SET ${assignments.join(", ")}, updated_at = $${
        assignments.length + 2
      } WHERE id = $1`,
      [
        id,
        ...columns.filter((column) => column !== "id").map((c) => values[c]),
        now,
      ]
    );

    await recordColumnChanges(
      db,
      entity,
      id,
      previous,
      values,
      trackedColumns,
      now
    );
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
    ["name", "note", "archived_at"]
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
/** Names typed in an efa logbook entry, as json_remove paths. */
const EFA_CREW_NAME_FIELDS = [
  "CoxName",
  "AllCrewNames",
  ...Array.from({ length: 24 }, (_, i) => `Crew${i + 1}Name`),
]
  .map((field) => `'$.${field}'`)
  .join(", ");

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
  // Their reservations stay, held by the anonymised record, without contact.
  await db.execute(
    "UPDATE boat_reservation SET contact = NULL WHERE rower_id = $1",
    [rowerId]
  );
  // The efa2 copies too: every version of the person, and the names typed
  // in the logbook entries of their outings. The export then writes the
  // anonymised record only.
  await db.execute(
    "DELETE FROM efa_record WHERE object_type = 'efa2persons' AND json_extract(fields, '$.Id') = $1",
    [rowerId]
  );
  await db.execute(
    /* sql */ `
    UPDATE efa_record SET fields = json_remove(fields, ${EFA_CREW_NAME_FIELDS})
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
        // Whole names only: "Marie Martin" must not cut "Marie Martinez".
        inText.push(
          new RegExp(
            `(?<![\\p{L}\\p{N}])${escapeRegExp(name.normalize("NFC"))}(?![\\p{L}\\p{N}])`,
            "giu"
          )
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
  const scrub = (text: string) =>
    inText.reduce(
      (result, name) => result.replace(name, label),
      text.normalize("NFC")
    );

  const rows = await db.select<
    {
      object_type: string;
      object_name: string;
      record_key: string;
      fields: string;
    }[]
  >(
    `SELECT object_type, object_name, record_key, fields FROM efa_record
    WHERE object_type IN (${EFA_TYPES_NAMING_PEOPLE.map(sqlLiteral).join(
      ", "
    )})`
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
          fields.Text = scrub(fields.Text);
        }
        break;
      case "efa2boatdamages":
        if (
          fields.ReportedByPersonId === rowerId ||
          isName(fields.ReportedByPersonName)
        ) {
          delete fields.ReportedByPersonName;
        }
        if (
          fields.FixedByPersonId === rowerId ||
          isName(fields.FixedByPersonName)
        ) {
          delete fields.FixedByPersonName;
        }
        for (const field of ["Description", "Notes"]) {
          if (mentions(fields[field])) fields[field] = scrub(fields[field]);
        }
        break;
      case "efa2boatreservations":
        if (fields.PersonId === rowerId || isName(fields.PersonName)) {
          delete fields.PersonName;
          delete fields.Contact;
        }
        if (mentions(fields.Reason)) {
          fields.Reason = inText.reduce(
            (text, name) => text.replace(name, label),
            fields.Reason.normalize("NFC")
          );
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

  // Damages typed in Rowing Beacon, and "unavailable" entries that carry an
  // efa2 status comment, name people in their texts too.
  const damageRows = await db.select<
    { id: string; description: string; repair_note: string | null }[]
  >("SELECT id, description, repair_note FROM boat_damage");
  for (const damage of damageRows) {
    const description = mentions(damage.description)
      ? scrub(damage.description)
      : damage.description;
    const repairNote =
      damage.repair_note !== null && mentions(damage.repair_note)
        ? scrub(damage.repair_note)
        : damage.repair_note;
    // Nothing replaced (a lone name, a longer name): keep the history.
    if (
      description === damage.description &&
      repairNote === damage.repair_note
    ) {
      continue;
    }
    await db.execute(
      "UPDATE boat_damage SET description = $2, repair_note = $3 WHERE id = $1",
      [damage.id, description, repairNote]
    );
    // The history keeps the former descriptions.
    await db.execute(
      "DELETE FROM change_log WHERE entity = 'boat_damage' AND entity_id = $1",
      [damage.id]
    );
  }

  // Reservations held by the person under a free name (an efa person RB did
  // not know): the export writes the table's holder, so blank it here too.
  // Their name is also taken out of every reason, their own reservations
  // included ("Training Jean Dupont").
  const reservations = await db.select<
    {
      id: string;
      rower_id: string | null;
      person_name: string | null;
      reason: string | null;
    }[]
  >("SELECT id, rower_id, person_name, reason FROM boat_reservation");
  for (const reservation of reservations) {
    const named = !reservation.rower_id && isName(reservation.person_name);
    const reason =
      reservation.reason && mentions(reservation.reason)
        ? inText.reduce(
            (text, name) => text.replace(name, label),
            reservation.reason.normalize("NFC")
          )
        : reservation.reason;
    if (!named && reason === reservation.reason) continue;
    await db.execute(
      /* sql */ `
      UPDATE boat_reservation SET person_name = $2, reason = $3,
        contact = CASE WHEN $4 THEN NULL ELSE contact END
      WHERE id = $1`,
      [
        reservation.id,
        named ? label : reservation.person_name,
        reason,
        named ? 1 : 0,
      ]
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

/** A rower appears once per outing (primary key); the first role wins. */
const withoutDuplicateMembers = (crew: OutingToSave["crew"]) =>
  crew.filter(
    (member, index) =>
      crew.findIndex((other) => other.rowerId === member.rowerId) === index
  );

const insertCrew = async (
  db: SqlClient,
  outingId: string,
  crew: OutingToSave["crew"]
) => {
  for (const [position, member] of crew.entries()) {
    await db.execute(
      "INSERT INTO outing_crew (outing_id, rower_id, role, position) VALUES ($1, $2, $3, $4)",
      [outingId, member.rowerId, member.role, position]
    );
  }
};

const upsertCrew = async (
  db: SqlClient,
  outingId: string,
  crew: OutingToSave["crew"],
  positions: number[]
) => {
  for (const [index, member] of crew.entries()) {
    await db.execute(
      `INSERT INTO outing_crew (outing_id, rower_id, role, position) VALUES ($1, $2, $3, $4)
      ON CONFLICT (outing_id, rower_id) DO UPDATE SET role = excluded.role, position = excluded.position`,
      [outingId, member.rowerId, member.role, positions[index]]
    );
  }
};

const deleteCrewExcept = (
  db: SqlClient,
  outingId: string,
  crew: OutingToSave["crew"]
) =>
  db.execute(
    `DELETE FROM outing_crew WHERE outing_id = $1 AND rower_id NOT IN (${crew
      .map((_, index) => `$${index + 2}`)
      .join(", ")})`,
    [outingId, ...crew.map((member) => member.rowerId)]
  );

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
  const crew = withoutDuplicateMembers(outing.crew);
  try {
    await insertCrew(db, outing.id, crew);
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

interface StoredOutingRow {
  id: string;
  boat_id: string;
  boat_configuration_id: string | null;
  route_id: string | null;
  outing_type_code: string | null;
  captain_rower_id: string | null;
  start_date_time: string;
  estimated_end_date_time: string | null;
  end_date_time: string | null;
  distance_m: number | null;
  comment: string | null;
  has_been_coached: number | null;
  updated_at: string;
}

interface StoredCrewRow {
  rower_id: string;
  role: "rower" | "cox";
  position: number;
}

/** An outing as stored: local "YYYY-MM-DDTHH:mm" dates, crew in seat order. */
export interface StoredOuting {
  id: string;
  boatId: string;
  boatConfigurationId: string | null;
  routeId: string | null;
  outingTypeCode: string | null;
  captainRowerId: string | null;
  startDateTime: string;
  estimatedEndDateTime: string | null;
  endDateTime: string | null;
  distanceM: number | null;
  comment: string;
  hasBeenCoached: boolean | null;
  crew: { rowerId: string; role: "rower" | "cox" }[];
}

const selectCrewRows = (db: SqlClient, outingId: string) =>
  db.select<StoredCrewRow[]>(
    "SELECT rower_id, role, position FROM outing_crew WHERE outing_id = $1 ORDER BY position",
    [outingId]
  );

export const loadOuting = async (
  db: SqlClient,
  outingId: string
): Promise<StoredOuting | null> => {
  const [row] = await db.select<StoredOutingRow[]>(
    "SELECT * FROM outing WHERE id = $1",
    [outingId]
  );
  if (!row) return null;

  const crewRows = await selectCrewRows(db, outingId);
  return {
    id: row.id,
    boatId: row.boat_id,
    boatConfigurationId: row.boat_configuration_id,
    routeId: row.route_id,
    outingTypeCode: row.outing_type_code,
    captainRowerId: row.captain_rower_id,
    startDateTime: row.start_date_time,
    estimatedEndDateTime: row.estimated_end_date_time,
    endDateTime: row.end_date_time,
    distanceM: row.distance_m,
    comment: row.comment ?? "",
    hasBeenCoached:
      row.has_been_coached === null ? null : row.has_been_coached === 1,
    crew: crewRows.map((member) => ({
      rowerId: member.rower_id,
      role: member.role,
    })),
  };
};

/**
 * Same rowers in the same seats and the same cox. Where the cox sits in the
 * list does not matter: the editor always puts the cox last, imports may not.
 */
const isSameCrew = (a: OutingToSave["crew"], b: OutingToSave["crew"]) => {
  const describe = (crew: OutingToSave["crew"]) =>
    JSON.stringify([
      crew.filter((member) => member.role === "rower").map((m) => m.rowerId),
      crew
        .filter((member) => member.role === "cox")
        .map((m) => m.rowerId)
        .sort(),
    ]);
  return describe(a) === describe(b);
};

/**
 * Positions of a corrected crew. An imported crew sits on efa seats (1 to
 * 24, gaps allowed, cox 0): rowers who stay keep their seat, a new rower
 * takes the first seat left free after the rower before them. When that
 * cannot follow the editor's order (rowers swapped, no seat left), the
 * rowers are seated 1, 2, 3… in that order. Any other crew is numbered in
 * the editor's order.
 */
export const getCorrectedCrewPositions = (
  previousCrew: { rowerId: string; role: "rower" | "cox"; position: number }[],
  crew: OutingToSave["crew"]
): number[] => {
  const previousSeats = new Map(
    previousCrew
      .filter((member) => member.role === "rower")
      .map((member) => [member.rowerId, member.position])
  );
  const seats = [...previousSeats.values()];
  const isOnEfaSeats =
    seats.length > 0 &&
    seats.every((seat) => seat >= 1 && seat <= 24) &&
    new Set(seats).size === seats.length;
  if (!isOnEfaSeats) {
    return crew.map((_, index) => index);
  }

  const taken = new Set(
    crew
      .filter((member) => member.role === "rower")
      .map((member) => previousSeats.get(member.rowerId))
      .filter((seat): seat is number => seat !== undefined)
  );
  let lastSeat = 0;
  const keptSeats: number[] = [];
  for (const member of crew) {
    if (member.role === "cox") {
      keptSeats.push(0);
      continue;
    }
    let seat = previousSeats.get(member.rowerId);
    if (seat === undefined) {
      seat = lastSeat + 1;
      while (taken.has(seat)) seat++;
      taken.add(seat);
    }
    if (seat <= lastSeat || seat > 24) {
      let next = 1;
      return crew.map((other) => (other.role === "cox" ? 0 : next++));
    }
    lastSeat = seat;
    keptSeats.push(seat);
  }
  return keptSeats;
};

/**
 * Correct an outing, ongoing or finished. Resolves with false when the
 * outing is not in the database. Every column is written; distanceM
 * undefined keeps the stored distance. The crew is rewritten only when it
 * changed, and rowers who stay keep their efa seat.
 * `onlyIfOngoing`: also false when the outing was finished meanwhile, so
 * that a correction never reopens it. `onlyIfFinished`: also false when the
 * outing is still ongoing, so that a correction never ends it.
 */
export const updateOuting = async (
  db: SqlClient,
  outing: OutingToSave,
  {
    onlyIfOngoing = false,
    onlyIfFinished = false,
  }: { onlyIfOngoing?: boolean; onlyIfFinished?: boolean } = {}
): Promise<boolean> => {
  const [previous] = await db.select<StoredOutingRow[]>(
    "SELECT * FROM outing WHERE id = $1",
    [outing.id]
  );
  if (
    !previous ||
    (onlyIfOngoing && previous.end_date_time !== null) ||
    (onlyIfFinished && previous.end_date_time === null)
  ) {
    return false;
  }
  const previousValues = previous as unknown as Record<string, unknown>;

  const values: Record<string, unknown> = {
    boat_id: outing.boatId,
    boat_configuration_id: outing.boatConfigurationId ?? null,
    route_id: outing.routeId ?? null,
    outing_type_code: outing.outingTypeCode ?? null,
    captain_rower_id: outing.captainRowerId ?? null,
    start_date_time: toLocal(outing.startDateTime),
    estimated_end_date_time: toLocal(outing.estimatedEndDateTime),
    end_date_time: toLocal(outing.endDateTime),
    comment: outing.comment || null,
    has_been_coached: coachedToInteger(outing.hasBeenCoached),
    ...(outing.distanceM !== undefined ? { distance_m: outing.distanceM } : {}),
  };
  const columns = Object.keys(values);
  const assignments = columns.map(
    (column, index) => `${column} = $${index + 2}`
  );
  const updateSql = `UPDATE outing SET ${assignments.join(
    ", "
  )}, updated_at = $${columns.length + 2} WHERE id = $1`;

  const previousCrew = await selectCrewRows(db, outing.id);
  // The editor has one cox: an imported crew with several keeps the others
  // while the one shown stays.
  const previousCoxIds = previousCrew
    .filter((member) => member.role === "cox")
    .map((member) => member.rower_id);
  const coxIds = outing.crew
    .filter((member) => member.role === "cox")
    .map((member) => member.rowerId);
  const crew = withoutDuplicateMembers(
    previousCoxIds.length > 1 &&
      coxIds.length === 1 &&
      previousCoxIds.includes(coxIds[0])
      ? [
          ...outing.crew,
          ...previousCoxIds.map((rowerId) => ({
            rowerId,
            role: "cox" as const,
          })),
        ]
      : outing.crew
  );
  const crewChanged = !isSameCrew(
    previousCrew.map((member) => ({
      rowerId: member.rower_id,
      role: member.role,
    })),
    crew
  );
  const now = nowIso();
  const [{ lastChangeId }] = await db.select<{ lastChangeId: number }[]>(
    "SELECT COALESCE(MAX(id), 0) AS lastChangeId FROM change_log"
  );
  let crewRewritten = false;

  // No transaction across calls with the Tauri SQL plugin: on a failure the
  // outing is put back as it was, so that it is never half corrected.
  try {
    await db.execute(updateSql, [
      outing.id,
      ...columns.map((column) => values[column]),
      now,
    ]);

    if (crewChanged) {
      crewRewritten = true;
      // Upsert first, then drop who left: the outing never has no crew.
      const positions = getCorrectedCrewPositions(
        previousCrew.map((member) => ({
          rowerId: member.rower_id,
          role: member.role,
          position: member.position,
        })),
        crew
      );
      await upsertCrew(db, outing.id, crew, positions);
      await deleteCrewExcept(db, outing.id, crew);
      await recordChange(
        db,
        "outing",
        outing.id,
        "crew",
        JSON.stringify(
          previousCrew.map((m) => ({ rowerId: m.rower_id, role: m.role }))
        ),
        JSON.stringify(crew),
        now
      );
    }

    await recordColumnChanges(
      db,
      "outing",
      outing.id,
      previousValues,
      values,
      columns,
      now
    );

    if (crewChanged) {
      // The names efa typed in the entry are rebuilt from the crew on export;
      // the old ones must not stay, nor name someone who left (GDPR). Last,
      // as the restore below does not bring them back.
      await db.execute(
        `UPDATE efa_record SET fields = json_remove(fields, ${EFA_CREW_NAME_FIELDS})
        WHERE object_type = 'efa2logbook' AND rb_table = 'outing' AND rb_id = $1`,
        [outing.id]
      );
    }
  } catch (error) {
    try {
      await db.execute(updateSql, [
        outing.id,
        ...columns.map((column) => previousValues[column]),
        previous.updated_at,
      ]);
      if (crewRewritten) {
        const before = previousCrew.map((member) => ({
          rowerId: member.rower_id,
          role: member.role,
        }));
        await upsertCrew(
          db,
          outing.id,
          before,
          previousCrew.map((member) => member.position)
        );
        await deleteCrewExcept(db, outing.id, before);
      }
      await db.execute(
        "DELETE FROM change_log WHERE entity = 'outing' AND entity_id = $1 AND id > $2",
        [outing.id, lastChangeId]
      );
    } catch (restoreError) {
      console.error("❌ Failed to restore the outing", restoreError);
    }
    throw error;
  }
  return true;
};

interface OverlapRow {
  id: string;
  boat_id: string;
  start_date_time: string;
  end_date_time: string | null;
}

export interface OutingOverlap {
  outingId: string;
  boatId: string;
  startDateTime: string;
  /** Null when the other outing is still ongoing. */
  endDateTime: string | null;
  /** Same boat as the outing checked. */
  boatOverlaps: boolean;
  /** Rowers of the outing checked who are also on the other outing. */
  rowerIds: string[];
}

/**
 * Other outings on the water at the same time with the same boat or some
 * of the same people. An outing without an end is open-ended, and an outing
 * ending when the next one starts does not overlap it.
 */
export const findOverlappingOutings = async (
  db: SqlClient,
  query: {
    excludeOutingId?: string | undefined;
    boatId: string;
    rowerIds: string[];
    startDateTime: string;
    /** Null for an ongoing outing. */
    endDateTime: string | null;
  }
): Promise<OutingOverlap[]> => {
  // Parameters 1 and 2 are the interval, then the optional exclusion.
  const params: unknown[] = [
    toLocal(query.startDateTime),
    toLocal(query.endDateTime),
  ];
  const conditions = [
    "(o.end_date_time IS NULL OR o.end_date_time > $1)",
    "($2 IS NULL OR o.start_date_time < $2)",
  ];
  if (query.excludeOutingId !== undefined) {
    params.push(query.excludeOutingId);
    conditions.push(`o.id <> $${params.length}`);
  }
  const where = conditions.join(" AND ");
  const columns = "o.id, o.boat_id, o.start_date_time, o.end_date_time";

  const sameBoat = await db.select<OverlapRow[]>(
    `SELECT ${columns} FROM outing o WHERE ${where} AND o.boat_id = $${
      params.length + 1
    }`,
    [...params, query.boatId]
  );

  const rowerIds = [...new Set(query.rowerIds)];
  const sameRowers =
    rowerIds.length === 0
      ? []
      : await db.select<(OverlapRow & { rower_id: string })[]>(
          `SELECT ${columns}, c.rower_id FROM outing o JOIN outing_crew c ON c.outing_id = o.id WHERE ${where} AND c.rower_id IN (${rowerIds
            .map((_, index) => `$${params.length + 1 + index}`)
            .join(", ")})`,
          [...params, ...rowerIds]
        );

  const overlaps = new Map<string, OutingOverlap>();
  const getOverlap = (row: OverlapRow) => {
    const known = overlaps.get(row.id);
    if (known) return known;
    const overlap: OutingOverlap = {
      outingId: row.id,
      boatId: row.boat_id,
      startDateTime: row.start_date_time,
      endDateTime: row.end_date_time,
      boatOverlaps: false,
      rowerIds: [],
    };
    overlaps.set(row.id, overlap);
    return overlap;
  };
  for (const row of sameBoat) getOverlap(row).boatOverlaps = true;
  for (const row of sameRowers) getOverlap(row).rowerIds.push(row.rower_id);

  return [...overlaps.values()].sort((a, b) =>
    a.startDateTime.localeCompare(b.startDateTime)
  );
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

/** Inserts or updates a damage; severity and repair are kept in the history. */
export const saveBoatDamage = async (db: SqlClient, damage: BoatDamage) => {
  await upsertWithHistory(
    db,
    "boat_damage",
    {
      id: damage.id,
      boat_id: damage.boatId,
      kind: damage.kind,
      severity: damage.severity,
      description: damage.description,
      reported_at: toLocal(damage.reportedAt),
      reported_by_rower_id: damage.reportedByRowerId,
      outing_id: damage.outingId,
      incident_id: damage.incidentId,
      fixed_at: toLocal(damage.fixedAt),
      fixed_by_rower_id: damage.fixedByRowerId,
      repair_note: damage.repairNote,
      repair_cost: damage.repairCost,
    },
    ["severity", "description", "fixed_at"]
  );
};

/**
 * Remove all club data, the v1 tables included. The v1 migration marker is
 * kept so that a reset does not re-import old localStorage data.
 */
export const deleteAllClubData = async (db: SqlClient) => {
  for (const table of [
    "analytics_dashboard_item",
    "analytics_query",
    "efa_record",
    "session_rowers",
    "session",
    "change_log",
    "boat_level_config",
    "boat_damage",
    "incident",
    "outing_crew",
    "outing",
    "rower_group_member",
    "rower_group",
    "boat_reservation",
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
