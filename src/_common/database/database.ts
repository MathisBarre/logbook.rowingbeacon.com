import Database from "@tauri-apps/plugin-sql";
import { SimpleResult } from "../utils/error";

let db: Database | null = null;

const getDB = async () => {
  if (!db) {
    db = await Database.load("sqlite:main.db");
  }
  return db;
};

interface SaveSessionPayload {
  id: string;
  rowerIds: string[];
  boatId: string;
  startDateTime: string;
  routeId: string | null;
  estimatedEndDateTime: string | null;
  endDateTime: string | null;
  comment: string | null;
  incidentId: string | null;
}

interface ISessionRepository {
  getSessions(): Promise<
    {
      id: string;
      rowerIds: string[];
      boatId: string;
      startDateTime: string;
      routeId: string | null;
      estimatedEndDateTime: string | null;
      endDateTime: string | null;
      comment: string | null;
      incidentId: string | null;
    }[]
  >;

  saveSession(session: SaveSessionPayload): Promise<SimpleResult<string, void>>;
}

class SqliteSessionRepository implements ISessionRepository {
  constructor(private readonly db: Database) {}

  async saveSession(
    session: SaveSessionPayload
  ): Promise<SimpleResult<string, void>> {
    const response = await db?.execute(/*sql*/ `
BEGIN TRANSACTION;

INSERT INTO session (
  id, 
  boat_id, 
  start_date_time, 
  estimated_end_date_time, 
  route_id, 
  end_date_time, 
  incident_id, 
  comment
) VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6,
  $7,
  $8
);

-- Insert rowers associated with the session
INSERT INTO session_rowers (session_id, rower_id)
VALUES
    ('session-uuid-1', 'rower-uuid-1'),
    ('session-uuid-1', 'rower-uuid-2');

COMMIT;

      `);
  }
}
