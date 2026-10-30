/**
 * Boat reservations (Reservations module). A one-time reservation runs
 * from start_date start_time to end_date end_time; a weekly one holds the
 * boat every day_of_week (1 = Monday … 7 = Sunday) from start_time to
 * end_time, between the optional start_date and end_date. The holder is a
 * rower or a free name (a crew, a group…). efa_number is the reservation
 * number efa2 keys it with, kept from one export to the next.
 */
export default /*sql*/ `
---
CREATE TABLE IF NOT EXISTS boat_reservation (
  id TEXT PRIMARY KEY,
  boat_id TEXT NOT NULL REFERENCES boat (id),
  recurrence TEXT NOT NULL CHECK (recurrence IN ('once', 'weekly')),
  start_date TEXT,
  end_date TEXT,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  rower_id TEXT REFERENCES rower (id),
  person_name TEXT,
  reason TEXT,
  contact TEXT,
  efa_number INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boat_reservation_boat_id ON boat_reservation (boat_id);
---
`;
