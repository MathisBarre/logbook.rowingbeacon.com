import { lte } from "drizzle-orm";
import { gte } from "drizzle-orm";
import { and } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBSessions } from "../../_common/database/schema";

export const getSessionsInPeriod = async ({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}) => {
  const { drizzle } = await getDatabase();

  const sessions = await drizzle
    .select()
    .from(DBSessions)
    .where(
      and(
        gte(DBSessions.startDateTime, startDate.toISOString()),
        lte(DBSessions.endDateTime, endDate.toISOString())
      )
    );

  return sessions;
};
