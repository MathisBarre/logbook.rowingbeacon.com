import { desc, eq } from "drizzle-orm";
import { getDatabase } from "../_common/database/database";
import { DBSessionOnRowers, DBSessions } from "../_common/database/schema";
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
  }) => {
    const fromDateTime = getStartOfDay(payload.fromDate);
    const toDateTime = getEndOfDay(payload.toDate);

    const { maxPageSize: pageSize, skip } = payload;

    const { drizzle } = await getDatabase();

    const result = await drizzle.query.DBSessions.findMany({
      where: (DBSessions, { lte, gte, and }) =>
        and(
          fromDateTime
            ? gte(
                DBSessions.startDateTime,
                getDateTimeWithoutTimezone(fromDateTime)
              )
            : undefined,
          toDateTime
            ? lte(
                DBSessions.startDateTime,
                getDateTimeWithoutTimezone(toDateTime)
              )
            : undefined
        ),
      offset: skip,
      limit: pageSize,
      orderBy: [desc(DBSessions.startDateTime)],
      with: {
        sessionOnRowers: true,
      },
    });

    return result.map((session) => ({
      ...session,
      sessionId: session.id,
      endDateTime: getDateOrNull(session.endDateTime),
      estimatedEndDateTime: getDateOrNull(session.estimatedEndDateTime),
      startDateTime: new Date(session.startDateTime),
      rowerIds: session.sessionOnRowers
        .map((rower) => rower.rower_id)
        .join(","),
    }));
  },

  getTotalNumberOfSessions: async (): Promise<number> => {
    const { db } = await getDatabase();

    const result = await db.select<{ count: number }[]>(/* sql */ `
      SELECT 
        COUNT(*) as count
      FROM 
        session
    `);

    console.log(result);

    return result[0].count;
  },

  removeSession: async (sessionId: string) => {
    const { drizzle } = await getDatabase();

    await drizzle.delete(DBSessions).where(eq(DBSessions.id, sessionId));

    await drizzle
      .delete(DBSessionOnRowers)
      .where(eq(DBSessionOnRowers.session_id, sessionId));
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
