import { getDatabase } from "../_common/database/database";
import { getDateTimeWithoutTimezone } from "../_common/utils/date.utils";

export const sessionRepository = {
  getSessions: async (payload: {
    maxPageSize: number;
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
    const _fromDateTime = getStartOfDay(payload.fromDate);
    const fromDateTime = _fromDateTime
      ? getDateTimeWithoutTimezone(_fromDateTime)
      : undefined;
    const _toDateTime = getEndOfDay(payload.toDate);
    const toDateTime = _toDateTime
      ? getDateTimeWithoutTimezone(_toDateTime)
      : undefined;

    let fromDateFilter = "";
    let toDateFilter = "";

    if (fromDateTime) {
      fromDateFilter = `AND s.start_date_time >= '${fromDateTime}'`;
    }

    if (toDateTime) {
      toDateFilter = `AND s.end_date_time <= '${toDateTime}'`;
    }

    const { maxPageSize: pageSize, skip } = payload;

    const db = await getDatabase();

    const query = /* sql */ `
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
      WHERE
        1=1
        ${fromDateFilter}
        ${toDateFilter}
      GROUP BY 
        s.id
      ORDER BY 
        s.start_date_time DESC
      LIMIT 
        ${pageSize}
      OFFSET
        ${skip}
    `;

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
    >(query);

    console.log(result);

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

const getStartOfDay = (date: Date | undefined) => {
  if (!date) {
    return undefined;
  }

  const dateObject = new Date(date);
  dateObject.setHours(0, 0, 0, 0);
  return dateObject;
};

const getEndOfDay = (date: Date | undefined) => {
  if (!date) {
    return undefined;
  }

  const dateObject = new Date(date);
  dateObject.setHours(23, 59, 59, 999);
  return dateObject;
};
