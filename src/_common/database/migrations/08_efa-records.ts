/**
 * Every record read from an efa2 project, kept as is (ADR 0004). Records
 * that produced a Rowing Beacon row point to it (rb_table, rb_id); the
 * others (reservations, messages, crews…) wait for their module. The
 * efa2 export rewrites the fields Rowing Beacon does not model.
 */
export default /*sql*/ `
---
CREATE TABLE IF NOT EXISTS efa_record (
  object_type TEXT NOT NULL,
  object_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  rb_table TEXT,
  rb_id TEXT,
  fields TEXT NOT NULL,
  PRIMARY KEY (object_type, object_name, record_key)
);
CREATE INDEX IF NOT EXISTS idx_efa_record_rb ON efa_record (rb_table, rb_id);
---
`;
