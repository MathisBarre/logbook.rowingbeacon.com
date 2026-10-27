import { asc, desc, isNotNull } from "drizzle-orm";
import { getDatabase } from "../_common/database/database";
import { deleteOuting } from "../_common/database/repositories/club.repository";
import { enqueueWrite } from "../_common/database/writeQueue";
import useIncidentStore from "../_common/store/incident.store";
import { DBOutingCrew, DBOutings } from "../_common/database/schema";
import { getDateTimeWithoutTimezone } from "../_common/utils/date.utils";

const INCIDENT_QUERY_CHUNK = 500;

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

    const result = await drizzle.query.DBOutings.findMany({
      where: (DBOutings, { lte, gte, and }) =>
        and(
          isNotNull(DBOutings.endDateTime),
          fromDateTime
            ? gte(
                DBOutings.startDateTime,
                getDateTimeWithoutTimezone(fromDateTime)
              )
            : undefined,
          toDateTime
            ? lte(
                DBOutings.startDateTime,
                getDateTimeWithoutTimezone(toDateTime)
              )
            : undefined
        ),
      offset: skip,
      limit: pageSize,
      orderBy: [desc(DBOutings.startDateTime)],
      with: {
        crew: { orderBy: [asc(DBOutingCrew.position)] },
      },
    });

    const { db } = await getDatabase();
    const outingIds = result.map((session) => session.id);
    // Chunked: SQLite caps the number of bound parameters per query.
    const incidents: { id: string; outing_id: string }[] = [];
    for (let i = 0; i < outingIds.length; i += INCIDENT_QUERY_CHUNK) {
      const chunk = outingIds.slice(i, i + INCIDENT_QUERY_CHUNK);
      incidents.push(
        ...(await db.select<{ id: string; outing_id: string }[]>(
          `SELECT id, outing_id FROM incident WHERE outing_id IN (${chunk
            .map((_, index) => `$${index + 1}`)
            .join(", ")}) ORDER BY occurred_at`,
          chunk
        ))
      );
    }
    const incidentsByOuting = new Map<string, string[]>();
    for (const incident of incidents) {
      incidentsByOuting.set(incident.outing_id, [
        ...(incidentsByOuting.get(incident.outing_id) ?? []),
        incident.id,
      ]);
    }

    return result.map((session) => ({
      sessionId: session.id,
      endDateTime: getDateOrNull(session.endDateTime),
      estimatedEndDateTime: getDateOrNull(session.estimatedEndDateTime),
      startDateTime: new Date(session.startDateTime),
      rowerIds: session.crew.map((rower) => rower.rowerId).join(","),
      crew: session.crew.map((member) => ({
        rowerId: member.rowerId,
        role: member.role as "rower" | "cox",
      })),
      outingTypeCode: session.outingTypeCode,
      distanceM: session.distanceM,
      captainRowerId: session.captainRowerId,
      hasBeenCoached: sessionRepository.handleBoolStringToBoolean(
        session.hasBeenCoached
      ),
      comment: session.comment,
      incidentId: incidentsByOuting.get(session.id)?.[0] ?? null,
      incidentIds: incidentsByOuting.get(session.id) ?? [],
      boatConfigurationId: session.boatConfigurationId,
      boatId: session.boatId,
      routeId: session.routeId,
    }));
  },

  handleBoolStringToBoolean: (value: number | null): boolean | null => {
    if (value === 1) {
      return true;
    } else if (value === 0) {
      return false;
    }
    return null;
  },

  getTotalNumberOfSessions: async (): Promise<number> => {
    const { db } = await getDatabase();

    const result = await db.select<{ count: number }[]>(/* sql */ `
      SELECT 
        COUNT(*) as count
      FROM 
        outing
      WHERE
        end_date_time IS NOT NULL
    `);

    return result[0].count;
  },

  /** False when the deletion failed (the error is already shown). */
  removeSession: async (sessionId: string): Promise<boolean> => {
    const deleted = await enqueueWrite("delete outing", (db) =>
      deleteOuting(db, sessionId)
    );
    if (deleted) {
      useIncidentStore.getState().detachFromSession(sessionId);
    }
    return deleted;
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
