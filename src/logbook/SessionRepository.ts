import { getDatabase } from "../_common/database/database";

export const sessionRepository = {
  getSessions: async (payload: {
    pageSize: number;
    skip: number;
    order: {
      startDateTime: "DESC";
    };
    fromDate?: Date;
    toDate?: Date;
  }): Promise<
    {
      sessionId: string;
      boatId: string;
      startDateTime: Date;
      estimatedEndDateTime: Date | null;
      routeId: string | null;
      endDateTime: Date | null;
      incidentId: string | null;
      comment: string | null;
      rowerIds: string | null;
    }[]
  > => {
    const { pageSize, skip } = payload;

    const db = await getDatabase();

    const result = await db.select<
      {
        session_id: string;
        boat_id: string;
        start_date_time: string;
        estimated_end_date_time: string | null;
        route_id: string | null;
        end_date_time: string | null;
        incident_id: string | null;
        comment: string | null;
        rower_ids: string | null;
      }[]
    >(/* sql */ `
      SELECT 
        s.id AS session_id,
        s.boat_id,
        s.start_date_time,
        s.estimated_end_date_time,
        s.route_id,
        s.end_date_time,
        s.incident_id,
        s.comment,
        GROUP_CONCAT(sr.rower_id) AS rower_ids -- Combine rower IDs into a comma-separated string
      FROM 
        session s
      LEFT JOIN 
        session_rowers sr ON s.id = sr.session_id
      GROUP BY 
        s.id
      ORDER BY 
        s.start_date_time DESC
      LIMIT 
        ${pageSize}
      OFFSET
        ${skip}
  
      `);

    return result.map((session) => ({
      sessionId: session.session_id,
      boatId: session.boat_id,
      comment: session.comment,
      endDateTime: getDateOrNull(session.end_date_time),
      estimatedEndDateTime: getDateOrNull(session.estimated_end_date_time),
      incidentId: session.incident_id,
      routeId: session.route_id,
      rowerIds: session.rower_ids,
      startDateTime: new Date(session.start_date_time),
    }));
  },

  getTotalNumberOfSessions: async (): Promise<number> => {
    const db = await getDatabase();

    const result = await db.select<{ count: number }[]>(/* sql */ `
      SELECT 
        COUNT(*) as count
      FROM 
        session
    `);

    return result[0].count;
  },
};

const getDateOrNull = (date: string | null) => {
  return date ? new Date(date) : null;
};
