import { BoatReservation, DayOfWeek } from "../../business/reservation.rules";
import { SqlClient } from "../sqlClient";

interface BoatReservationRow {
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
}

const toBoatReservation = (row: BoatReservationRow): BoatReservation => ({
  id: row.id,
  boatId: row.boat_id,
  recurrence: row.recurrence,
  startDate: row.start_date,
  endDate: row.end_date,
  dayOfWeek: row.day_of_week as DayOfWeek | null,
  startTime: row.start_time,
  endTime: row.end_time,
  rowerId: row.rower_id,
  personName: row.person_name,
  reason: row.reason,
  contact: row.contact,
});

export const loadReservations = async (
  db: SqlClient
): Promise<BoatReservation[]> => {
  const rows = await db.select<BoatReservationRow[]>(
    "SELECT * FROM boat_reservation ORDER BY start_date, start_time"
  );
  return rows.map(toBoatReservation);
};

/**
 * Insert or update a reservation. A new one takes the next efa2
 * reservation number, after the imported ones, the ones efa kept as they
 * were and efa's own counter, so that the export keys it the same way every
 * time.
 */
export const saveReservation = async (
  db: SqlClient,
  reservation: BoatReservation
) => {
  const now = new Date().toISOString();
  const values = [
    reservation.id,
    reservation.boatId,
    reservation.recurrence,
    reservation.recurrence === "once" || reservation.startDate
      ? reservation.startDate
      : null,
    reservation.endDate,
    reservation.recurrence === "weekly" ? reservation.dayOfWeek : null,
    reservation.startTime,
    reservation.endTime,
    reservation.rowerId,
    reservation.rowerId ? null : reservation.personName?.trim() || null,
    reservation.reason?.trim() || null,
    reservation.contact?.trim() || null,
    now,
  ];
  await db.execute(
    /* sql */ `
    INSERT INTO boat_reservation (id, boat_id, recurrence, start_date, end_date,
      day_of_week, start_time, end_time, rower_id, person_name, reason, contact,
      efa_number, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      1 + MAX(
        COALESCE((SELECT MAX(efa_number) FROM boat_reservation), 0),
        COALESCE((SELECT CAST(COALESCE(json_extract(fields, '$.IntValue'), json_extract(fields, '$.LongValue')) AS INTEGER)
          FROM efa_record WHERE object_type = 'efa2autoincrement'
            AND json_extract(fields, '$.Sequence') = 'efa2boatreservations'), 0),
        COALESCE((SELECT MAX(CAST(json_extract(fields, '$.Reservation') AS INTEGER))
          FROM efa_record WHERE object_type = 'efa2boatreservations'), 0)
      ),
      $13, $13)
    ON CONFLICT (id) DO UPDATE SET
      boat_id = excluded.boat_id, recurrence = excluded.recurrence,
      start_date = excluded.start_date, end_date = excluded.end_date,
      day_of_week = excluded.day_of_week, start_time = excluded.start_time,
      end_time = excluded.end_time, rower_id = excluded.rower_id,
      person_name = excluded.person_name, reason = excluded.reason,
      contact = excluded.contact, updated_at = excluded.updated_at`,
    values
  );
};

/**
 * A reservation names no outing: it is deleted, its efa2 copy too. No
 * transaction across calls with the Tauri SQL plugin, so the reservation
 * goes first: a failure leaves an orphan raw record, never a reservation
 * that lost its raw efa2 fields.
 */
export const deleteReservation = async (db: SqlClient, id: string) => {
  await db.execute("DELETE FROM boat_reservation WHERE id = $1", [id]);
  await db.execute(
    "DELETE FROM efa_record WHERE rb_table = 'boat_reservation' AND rb_id = $1",
    [id]
  );
};
