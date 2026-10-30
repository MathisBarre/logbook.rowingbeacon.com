import { useCallback, useEffect, useRef, useState } from "react";
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";
import { ChartSpec, ParamDefs } from "../chartSpec";
import { ANALYTICS_COMMANDS, InboxProposal } from "../engine/ipc";
import type { SqlClient } from "../../_common/database/sqlClient";
import {
  insertProposal,
  ProposalInput,
  writeAnalytics,
} from "../repository/analytics.repository";

/**
 * Imports the proposals that a local MCP client (Claude Desktop, Claude
 * Code, Codex, Cursor, VS Code…) wrote into the inbox folder
 * (`propose_chart`, plan 2.12):
 *
 * 1. `analytics_inbox_list` returns the parsed files;
 * 2. each valid one is inserted as `analytics_query` (status `proposed`,
 *    origin `mcp`, id = file id) through the write queue;
 * 3. only when that write succeeded is the file removed
 *    (`analytics_inbox_remove`). Inserting is idempotent by id, so a file
 *    whose removal failed is imported once, and a refused id is never
 *    imported again (its file is only removed once more).
 *
 * Unreadable files stay in the folder and are listed with their error.
 * The hook polls while the Explorer is shown and when the window regains
 * focus.
 */

export type InvokeFn = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export type WriteFn = (
  label: string,
  write: (db: SqlClient) => Promise<unknown>
) => Promise<boolean>;

/** Why a proposal file cannot be imported (translated by the page). */
export type InvalidReason =
  | "bad_file_name"
  | "sql_missing"
  | "sql_too_long"
  | "title_missing"
  | "bad_params"
  | "unreadable";

export interface InvalidProposal {
  id: string;
  title: string | null;
  client: string | null;
  createdAt: string | null;
  reason: InvalidReason;
  /** Technical detail (parser error, zod path), shown on demand. */
  detail: string | null;
}

/** A proposal that reached the database during a sync. */
export interface ImportedProposal {
  id: string;
  title: string;
  client: string | null;
}

interface InboxSyncResult {
  /** Ids written to the database during this sync. */
  imported: string[];
  /** The same proposals, with what a notification names. */
  proposals: ImportedProposal[];
  invalid: InvalidProposal[];
}

const MAX_SQL_LENGTH = 100_000;
const MAX_TITLE_LENGTH = 120;
const MAX_CLIENT_LENGTH = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A proposal ready for the database, or the reason it is not. */
export const validateProposal = (
  proposal: InboxProposal
):
  | { ok: true; input: ProposalInput }
  | { ok: false; reason: InvalidReason; detail?: string } => {
  if (proposal.error) {
    return { ok: false, reason: "unreadable", detail: proposal.error };
  }
  if (!UUID.test(proposal.id)) {
    return { ok: false, reason: "bad_file_name", detail: proposal.id };
  }
  const sql = proposal.sql?.trim() ?? "";
  if (!sql) return { ok: false, reason: "sql_missing" };
  if (sql.length > MAX_SQL_LENGTH) {
    return {
      ok: false,
      reason: "sql_too_long",
      detail: `${sql.length} > ${MAX_SQL_LENGTH}`,
    };
  }
  const title = proposal.title?.trim() ?? "";
  if (!title) return { ok: false, reason: "title_missing" };
  const params = ParamDefs.safeParse(proposal.params ?? []);
  if (!params.success) {
    const issue = params.error.issues[0];
    return {
      ok: false,
      reason: "bad_params",
      detail: `${issue.path.join(".")}: ${issue.message}`,
    };
  }
  // A chart that does not parse is not worth refusing the query: the
  // table is shown instead.
  const chart =
    proposal.chart === null || proposal.chart === undefined
      ? null
      : ChartSpec.safeParse(proposal.chart);
  return {
    ok: true,
    input: {
      id: proposal.id.toLowerCase(),
      title: title.slice(0, MAX_TITLE_LENGTH),
      description: proposal.description?.trim() || null,
      sql,
      params: params.data,
      chart: chart?.success ? chart.data : null,
      createdAt: proposal.createdAt,
      client: proposal.client?.trim().slice(0, MAX_CLIENT_LENGTH) || null,
    },
  };
};

/** One pass over the inbox (see the module comment). */
export const syncInbox = async ({
  invoke,
  write,
}: {
  invoke: InvokeFn;
  write: WriteFn;
}): Promise<InboxSyncResult> => {
  const proposals = await invoke<InboxProposal[]>(ANALYTICS_COMMANDS.inboxList);
  const imported: string[] = [];
  const importedProposals: ImportedProposal[] = [];
  const invalid: InvalidProposal[] = [];
  for (const proposal of proposals) {
    const checked = validateProposal(proposal);
    if (!checked.ok) {
      invalid.push({
        id: proposal.id,
        title: proposal.title,
        client: proposal.client,
        createdAt: proposal.createdAt,
        reason: checked.reason,
        detail: checked.detail ?? null,
      });
      continue;
    }
    let outcome = "stored" as "stored" | "refused";
    const written = await write("import proposal", async (db) => {
      outcome = await insertProposal(db, checked.input);
    });
    if (!written) continue; // The file stays: next sync tries again.
    if (outcome === "stored") {
      imported.push(checked.input.id);
      importedProposals.push({
        id: checked.input.id,
        title: checked.input.title,
        client: checked.input.client ?? null,
      });
    }
    try {
      await invoke(ANALYTICS_COMMANDS.inboxRemove, { id: proposal.id });
    } catch (error) {
      // Imported anyway; the next sync inserts nothing (same id).
      console.warn("⚠️ Could not remove an imported proposal file", error);
    }
  }
  return { imported, proposals: importedProposals, invalid };
};

/** Removes an unreadable proposal file. */
const removeInboxFile = (invoke: InvokeFn, id: string) =>
  invoke<void>(ANALYTICS_COMMANDS.inboxRemove, { id });

/**
 * Removes the inbox file of a refused proposal, if it is still there (its
 * removal after the import may have failed): otherwise the next poll would
 * import it again. Never throws; resolves with false when it failed.
 */
export const forgetInboxFile = async (
  invoke: InvokeFn,
  id: string
): Promise<boolean> => {
  try {
    await removeInboxFile(invoke, id);
    return true;
  } catch (error) {
    console.warn("⚠️ Could not remove a refused proposal file", error);
    return false;
  }
};

/** Same unreadable files, in the same order (no re-render when so). */
export const sameInvalidList = (a: InvalidProposal[], b: InvalidProposal[]) =>
  a.length === b.length &&
  a.every(
    (item, index) =>
      item.id === b[index].id &&
      item.reason === b[index].reason &&
      item.detail === b[index].detail &&
      item.title === b[index].title &&
      item.client === b[index].client &&
      item.createdAt === b[index].createdAt
  );

const POLL_INTERVAL_MS = 10_000;

const defaultInvoke: InvokeFn = (command, args) => tauriInvoke(command, args);

/**
 * Polls the inbox while mounted and the window is visible. `onImported`
 * runs after new proposals reached the database, with their ids and what
 * a notification names (title, client).
 */
export const useProposalsInbox = ({
  onImported,
  invoke = defaultInvoke,
  write = writeAnalytics,
  enabled = true,
}: {
  onImported?: (ids: string[], proposals: ImportedProposal[]) => void;
  invoke?: InvokeFn;
  write?: WriteFn;
  enabled?: boolean;
} = {}) => {
  const [invalid, setInvalid] = useState<InvalidProposal[]>([]);
  const running = useRef(false);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;
  const active =
    enabled &&
    (invoke !== defaultInvoke || (typeof window !== "undefined" && isTauri()));

  const sync = useCallback(async () => {
    if (!active || running.current) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    running.current = true;
    try {
      const result = await syncInbox({ invoke, write });
      // Polled every 10 s: keep the same array when nothing changed.
      setInvalid((current) =>
        sameInvalidList(current, result.invalid) ? current : result.invalid
      );
      if (result.imported.length > 0) {
        onImportedRef.current?.(result.imported, result.proposals);
      }
    } catch (error) {
      console.warn("⚠️ Could not read the analytics inbox", error);
    } finally {
      running.current = false;
    }
  }, [active, invoke, write]);

  useEffect(() => {
    if (!active) return;
    void sync();
    const timer = setInterval(() => void sync(), POLL_INTERVAL_MS);
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active, sync]);

  const removeInvalid = useCallback(
    async (id: string) => {
      await removeInboxFile(invoke, id);
      setInvalid((list) => list.filter((item) => item.id !== id));
    },
    [invoke]
  );

  const forget = useCallback(
    async (id: string) => {
      if (!active) return;
      await forgetInboxFile(invoke, id);
    },
    [active, invoke]
  );

  return { invalid, sync, removeInvalid, forget };
};
