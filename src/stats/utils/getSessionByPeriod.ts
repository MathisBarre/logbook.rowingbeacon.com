import { lte } from "drizzle-orm";
import { gte } from "drizzle-orm";
import { and, isNotNull } from "drizzle-orm";
import { getDatabase } from "../../_common/database/database";
import { DBOutings } from "../../_common/database/schema";

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
    .from(DBOutings)
    .where(
      and(
        isNotNull(DBOutings.endDateTime),
        gte(DBOutings.startDateTime, startDate.toISOString()),
        lte(DBOutings.endDateTime, endDate.toISOString())
      )
    );

  return sessions;
};
