import { SqlClient } from "../database/sqlClient";
import { normalizeModuleIds } from "../business/modules.rules";
import { SETTING_MODULES_ENABLED } from "../store/modules.store";
import { Efa2Project } from "./efa2Project";
import {
  Efa2ImportLabels,
  Efa2ImportPlan,
  planEfa2Import,
} from "./planEfa2Import";

export interface Efa2ImportDependencies {
  /** Saves the current data before it is replaced (ADR 0005). */
  backup: () => Promise<unknown>;
  labels: Efa2ImportLabels;
  now?: Date;
}

class Efa2ImportStepError extends Error {
  constructor(
    message: string,
    /** The error that stopped the step. */
    readonly reason: unknown
  ) {
    super(message);
  }
}

/** The backup failed: nothing was imported, the club data is untouched. */
export class Efa2BackupFailedError extends Efa2ImportStepError {}

/**
 * The import script failed and was rolled back. The connection that ran it
 * may still hold the transaction if the ROLLBACK went to another one of the
 * pool, so the caller reopens the database.
 */
export class Efa2ImportFailedError extends Efa2ImportStepError {}

/**
 * Replace the club data with an efa2 project (ADR 0004). The statements
 * run as one script, so on one connection inside one transaction, which
 * checks its row counts and turns on the modules before committing; a
 * backup is taken first in case the result is not what the club expected.
 */
export const runEfa2Import = async (
  db: SqlClient,
  project: Efa2Project,
  deps: Efa2ImportDependencies
): Promise<Efa2ImportPlan["report"]> => {
  const current = await db.select<{ value: string }[]>(
    "SELECT value FROM setting WHERE key = $1",
    [SETTING_MODULES_ENABLED]
  );
  const plan = planEfa2Import({
    project,
    labels: deps.labels,
    now: deps.now,
    enabledModules: normalizeModuleIds(
      current[0] ? (JSON.parse(current[0].value) as unknown) : []
    ),
  });

  try {
    await deps.backup();
  } catch (error) {
    throw new Efa2BackupFailedError(
      "Backup before the efa2 import failed",
      error
    );
  }

  try {
    await db.execute(plan.statements.join("\n"));
  } catch (error) {
    await db.execute("ROLLBACK;").catch(() => undefined);
    throw new Efa2ImportFailedError("efa2 import failed", error);
  }

  return plan.report;
};
