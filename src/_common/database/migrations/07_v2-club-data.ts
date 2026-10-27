/**
 * v2: every club record lives in SQLite (ADR 0003), with a data model that
 * can hold what an efa2 project stores (ADR 0002). Records referenced by an
 * outing are archived, merged or anonymised, never deleted (ADR 0001).
 *
 * The v1 tables `session` and `session_rowers` are kept untouched; their
 * rows are copied into `outing` and `outing_crew` by the v1 data migration.
 */
export default /*sql*/ `
---
CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boat (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  is_in_maintenance INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  build_year INTEGER,
  purchase_date TEXT,
  max_crew_weight_kg REAL,
  exclude_from_stats INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  merged_into_id TEXT REFERENCES boat (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A boat can be rigged in several ways (4x / 4-). seats counts rowing seats only.
CREATE TABLE IF NOT EXISTS boat_configuration (
  id TEXT PRIMARY KEY,
  boat_id TEXT NOT NULL REFERENCES boat (id),
  position INTEGER NOT NULL DEFAULT 0,
  seats INTEGER,
  rigging TEXT CHECK (rigging IN ('scull', 'sweep')),
  coxed INTEGER NOT NULL DEFAULT 0,
  hull_type TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_boat_configuration_boat_id ON boat_configuration (boat_id);

CREATE TABLE IF NOT EXISTS rower (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'member' CHECK (status IN ('member', 'guest', 'other')),
  age_category TEXT,
  seriousness TEXT,
  gender TEXT CHECK (gender IN ('female', 'male', 'other')),
  birth_date TEXT,
  email TEXT,
  phone TEXT,
  license_number TEXT,
  address TEXT,
  note TEXT,
  exclude_from_stats INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  merged_into_id TEXT REFERENCES rower (id),
  anonymized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS route (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  distance_m INTEGER,
  note TEXT,
  archived_at TEXT,
  merged_into_id TEXT REFERENCES route (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Built-in codes are translated by the app; custom ones use their label.
CREATE TABLE IF NOT EXISTS outing_type (
  code TEXT PRIMARY KEY,
  label TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);
INSERT OR IGNORE INTO outing_type (code, position, is_builtin) VALUES
  ('normal', 0, 1),
  ('training', 1, 1),
  ('regatta', 2, 1),
  ('training_camp', 3, 1),
  ('instruction', 4, 1),
  ('tour', 5, 1),
  ('club_trip', 6, 1),
  ('ergometer', 7, 1),
  ('motorboat', 8, 1);

-- Dates are local wall-clock times "YYYY-MM-DDTHH:mm", as in v1.
-- An outing without end_date_time is ongoing.
CREATE TABLE IF NOT EXISTS outing (
  id TEXT PRIMARY KEY,
  boat_id TEXT NOT NULL REFERENCES boat (id),
  boat_configuration_id TEXT REFERENCES boat_configuration (id),
  route_id TEXT REFERENCES route (id),
  outing_type_code TEXT REFERENCES outing_type (code),
  start_date_time TEXT NOT NULL,
  estimated_end_date_time TEXT,
  end_date_time TEXT,
  distance_m INTEGER,
  comment TEXT,
  has_been_coached INTEGER,
  captain_rower_id TEXT REFERENCES rower (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outing_start_date_time ON outing (start_date_time);
CREATE INDEX IF NOT EXISTS idx_outing_boat_id ON outing (boat_id);
CREATE INDEX IF NOT EXISTS idx_outing_ongoing ON outing (end_date_time) WHERE end_date_time IS NULL;

CREATE TABLE IF NOT EXISTS outing_crew (
  outing_id TEXT NOT NULL REFERENCES outing (id) ON DELETE CASCADE,
  rower_id TEXT NOT NULL REFERENCES rower (id),
  role TEXT NOT NULL DEFAULT 'rower' CHECK (role IN ('rower', 'cox')),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (outing_id, rower_id)
);
CREATE INDEX IF NOT EXISTS idx_outing_crew_rower_id ON outing_crew (rower_id);

CREATE TABLE IF NOT EXISTS incident (
  id TEXT PRIMARY KEY,
  outing_id TEXT REFERENCES outing (id) ON DELETE SET NULL,
  boat_id TEXT NOT NULL REFERENCES boat (id),
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Groups are stored for efa2 imports; their UI comes with the rights redesign.
CREATE TABLE IF NOT EXISTS rower_group (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rower_group_member (
  group_id TEXT NOT NULL REFERENCES rower_group (id) ON DELETE CASCADE,
  rower_id TEXT NOT NULL REFERENCES rower (id),
  PRIMARY KEY (group_id, rower_id)
);

CREATE TABLE IF NOT EXISTS boat_level_config (
  boat_id TEXT PRIMARY KEY REFERENCES boat (id),
  minimal_rower_category TEXT,
  minimal_rower_type TEXT
);

-- Readable history of record changes.
CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log (entity, entity_id);
---
`;
