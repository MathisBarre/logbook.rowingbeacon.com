import { getDatabase } from "../../../_common/database/database";
import { loadOuting } from "../../../_common/database/repositories/club.repository";
import { SqlClient } from "../../../_common/database/sqlClient";
import { flushWrites } from "../../../_common/database/writeQueue";
import { OutingDraft } from "./outingDraft";

/** Null when the outing does not exist or is still ongoing. */
export const loadFinishedOutingDraft = async (
  outingId: string
): Promise<OutingDraft | null> => {
  // A correction saved a moment ago must show.
  await flushWrites();
  const { db } = await getDatabase();
  return readFinishedOutingDraft(db, outingId);
};

/** Null when the outing does not exist or is still ongoing. */
export const readFinishedOutingDraft = async (
  db: SqlClient,
  outingId: string
): Promise<OutingDraft | null> => {
  const outing = await loadOuting(db, outingId);
  if (!outing || outing.endDateTime === null) {
    return null;
  }

  return {
    id: outing.id,
    boatId: outing.boatId,
    boatConfigurationId: outing.boatConfigurationId,
    routeId: outing.routeId,
    outingTypeCode: outing.outingTypeCode,
    rowerIds: outing.crew
      .filter((member) => member.role === "rower")
      .map((member) => member.rowerId),
    coxId: outing.crew.find((member) => member.role === "cox")?.rowerId ?? null,
    captainRowerId: outing.captainRowerId,
    startDateTime: outing.startDateTime,
    estimatedEndDateTime: outing.estimatedEndDateTime,
    endDateTime: outing.endDateTime,
    distanceM: outing.distanceM,
    comment: outing.comment,
    hasBeenCoached: outing.hasBeenCoached,
  };
};
