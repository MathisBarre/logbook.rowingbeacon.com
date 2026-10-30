/**
 * Damages module (ADR 0007): a damage is reported on a boat, has a
 * severity and is followed until it is fixed. A boat is out of service
 * while it has an open "unusable" damage, which replaces the former
 * `boat.is_in_maintenance` flag (the column stays, unused, for older
 * backups). An "unavailable" entry is a boat put out of service without a
 * damage (efa2's NOTAVAILABLE status).
 *
 * Existing data (maintenance flags, efa2 damages kept by the import) is
 * moved by `upgradeToBoatDamages`, run once after the migrations.
 */
export default /*sql*/ `
---
CREATE TABLE IF NOT EXISTS boat_damage (
  id TEXT PRIMARY KEY,
  boat_id TEXT NOT NULL REFERENCES boat (id),
  kind TEXT NOT NULL DEFAULT 'damage' CHECK (kind IN ('damage', 'unavailable')),
  severity TEXT NOT NULL CHECK (severity IN ('usable', 'limited', 'unusable')),
  description TEXT NOT NULL DEFAULT '',
  reported_at TEXT NOT NULL,
  reported_by_rower_id TEXT REFERENCES rower (id),
  outing_id TEXT REFERENCES outing (id) ON DELETE SET NULL,
  incident_id TEXT REFERENCES incident (id) ON DELETE SET NULL,
  fixed_at TEXT,
  fixed_by_rower_id TEXT REFERENCES rower (id),
  repair_note TEXT,
  repair_cost REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boat_damage_boat_id ON boat_damage (boat_id);
CREATE INDEX IF NOT EXISTS idx_boat_damage_open ON boat_damage (boat_id) WHERE fixed_at IS NULL;
---
`;
