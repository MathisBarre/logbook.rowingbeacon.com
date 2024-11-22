export default /*sql*/ `
---
ALTER TABLE session ADD COLUMN boat_id TEXT NOT NULL DEFAULT 'NOT_FOUND';
ALTER TABLE session ADD COLUMN start_date_time TEXT NOT NULL DEFAULT 'NOT_FOUND';
ALTER TABLE session ADD COLUMN estimated_end_date_time TEXT;
ALTER TABLE session ADD COLUMN route_id TEXT;
ALTER TABLE session ADD COLUMN end_date_time TEXT;
ALTER TABLE session ADD COLUMN incident_id TEXT;
ALTER TABLE session ADD COLUMN comment TEXT;
---
`;
