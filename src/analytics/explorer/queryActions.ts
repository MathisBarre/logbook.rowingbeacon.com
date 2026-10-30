import { v4 as uuidv4 } from "uuid";
import type { SqlClient } from "../../_common/database/sqlClient";
import type { SavedQuery } from "../types";
import {
  acceptProposal,
  archiveQuery,
  getQuery,
  listDashboardItems,
  MAIN_DASHBOARD,
  readAnalytics,
  refuseProposal,
  saveQuery,
  SaveQueryInput,
  unarchiveQuery,
  writeAnalytics,
} from "../repository/analytics.repository";
import { ExplorerDoc, hasUnsavedChanges } from "./explorer.store";

/**
 * Saved-query actions of the Explorer, through the write queue (ADR 0003).
 * `db` access is injectable so tests run them on node:sqlite.
 */

export interface QueryDb {
  read: <T>(read: (db: SqlClient) => Promise<T>) => Promise<T>;
  write: (
    label: string,
    write: (db: SqlClient) => Promise<unknown>
  ) => Promise<boolean>;
}

export const appQueryDb: QueryDb = {
  read: readAnalytics,
  write: writeAnalytics,
};

const saveThrough = async (
  db: QueryDb,
  label: string,
  input: SaveQueryInput
): Promise<SavedQuery | null> => {
  let saved = null as SavedQuery | null;
  const ok = await db.write(label, async (client) => {
    saved = await saveQuery(client, input);
  });
  return ok ? saved : null;
};

/**
 * Saves the doc: in place when it is a saved query and `asNew` is false,
 * else as a new query (first save, "Enregistrer sous…"). A query archived
 * meanwhile (on another workstation) is saved as a new query, so the
 * saved work shows in the list instead of staying hidden. Resolves with
 * the stored query, or null when the write failed (toast shown).
 */
export const saveDoc = async (
  doc: ExplorerDoc,
  meta: { title: string; description: string | null; asNew: boolean },
  db: QueryDb = appQueryDb
): Promise<SavedQuery | null> => {
  let saved = null as SavedQuery | null;
  const inPlaceId = meta.asNew ? null : doc.queryId;
  const ok = await db.write("save query", async (client) => {
    const existing = inPlaceId ? await getQuery(client, inPlaceId) : null;
    saved = await saveQuery(client, {
      id: existing && !existing.archivedAt ? existing.id : uuidv4(),
      title: meta.title,
      description: meta.description,
      sql: doc.sql,
      params: doc.params,
      chart: doc.chart,
      origin: doc.origin,
      status: "saved",
      basedOnReportId: doc.basedOnReportId,
    });
  });
  return ok ? saved : null;
};

export const renameQuery = (
  query: SavedQuery,
  meta: { title: string; description: string | null },
  db: QueryDb = appQueryDb
) =>
  saveThrough(db, "rename query", {
    ...query,
    title: meta.title,
    description: meta.description,
  });

export const duplicateQuery = (
  query: SavedQuery,
  copySuffix: string,
  db: QueryDb = appQueryDb
) =>
  saveThrough(db, "duplicate query", {
    ...query,
    id: uuidv4(),
    title: `${query.title} ${copySuffix}`.slice(0, 120),
    status: "saved",
  });

/** How many dashboard items show this query (archive confirmation). */
export const countPins = (queryId: string, db: QueryDb = appQueryDb) =>
  db.read(
    async (client) =>
      (await listDashboardItems(client, MAIN_DASHBOARD)).filter(
        (item) =>
          item.source.kind === "query" && item.source.queryId === queryId
      ).length
  );

export const archiveSavedQuery = (id: string, db: QueryDb = appQueryDb) =>
  db.write("archive query", (client) => archiveQuery(client, id));

export const restoreArchivedQuery = (id: string, db: QueryDb = appQueryDb) =>
  db.write("restore query", (client) => unarchiveQuery(client, id));

export const acceptQueryProposal = (id: string, db: QueryDb = appQueryDb) =>
  db.write("accept proposal", (client) => acceptProposal(client, id));

export const refuseQueryProposal = (id: string, db: QueryDb = appQueryDb) =>
  db.write("refuse proposal", (client) => refuseProposal(client, id));

/**
 * "Accepter" on a proposal. When it is the doc open in the editor and was
 * edited, the edited query is what gets accepted (saved in place, status
 * saved); otherwise the stored proposal becomes a saved query. Resolves
 * with the stored query when the doc was saved, true when the proposal was
 * accepted as stored, false when the write failed.
 */
export const acceptProposalFrom = async (
  query: SavedQuery,
  open: { doc: ExplorerDoc; baseline: ExplorerDoc | null },
  db: QueryDb = appQueryDb
): Promise<SavedQuery | boolean> => {
  if (
    open.doc.queryId === query.id &&
    hasUnsavedChanges(open.doc, open.baseline)
  ) {
    const saved = await saveDoc(
      open.doc,
      {
        title: open.doc.title.trim() || query.title,
        description: open.doc.description,
        asNew: false,
      },
      db
    );
    return saved ?? false;
  }
  return acceptQueryProposal(query.id, db);
};
