import createSessionTable from "./migrations/01_create-session-table";
import updateSessionTable from "./migrations/02_update-session-table";
import createSessionRowersTable from "./migrations/03_session_rowers-table";
import addIndexes from "./migrations/04_add-index";
import addHasBeenCoachedColumn from "./migrations/05_add-has-been-coached-column";
import createMigrationTable from "./migrations/00_migration-table";
import { getErrorMessage } from "../utils/error";
import fixHasBeenCoachedColumn from "./migrations/06_fix-has-been-coached";
import v2ClubData from "./migrations/07_v2-club-data";
import efaRecords from "./migrations/08_efa-records";
import boatDamages from "./migrations/09_boat-damages";
import boatReservations from "./migrations/10_boat-reservations";
import analytics from "./migrations/11_analytics";
import analyticsProposalClient from "./migrations/12_analytics-proposal-client";
import { SqlClient, sqlLiteral } from "./sqlClient";

interface Migration {
  label: string;
  timestamp: number;
  sql: string;
}

/**
 * One migration and its row in `migration`, in one transaction: a crash or
 * a power cut in between (a Raspberry Pi kiosk) leaves neither, instead of
 * a column added but not recorded, which `ALTER TABLE … ADD COLUMN` would
 * then refuse at every start (review D, L6). One script, so it runs on one
 * connection of the pool.
 */
const migrationScript = ({ sql, timestamp }: Migration) =>
  [
    "BEGIN;",
    sql,
    ";",
    `INSERT INTO migration (timestamp) VALUES (${sqlLiteral(timestamp)});`,
    "COMMIT;",
  ].join("\n");

export const applyMigrations = async (
  db: SqlClient,
  list: Migration[] = migrations
) => {
  try {
    await db.execute(createMigrationTable);

    const ordered = [...list].sort(sortByTimestamp);

    for (const migration of ordered) {
      const { timestamp, label } = migration;

      const applied = await db.select<{ timestamp: number }[]>(
        "SELECT * FROM migration WHERE timestamp = $1",
        [timestamp]
      );

      if (applied.length === 0) {
        try {
          await db.execute(migrationScript(migration));
        } catch (error) {
          await db.execute("ROLLBACK;").catch(() => undefined);
          throw error;
        }
        console.log(`✅ Migration "${label}" applied`);
      } else {
        console.log(`⏩ Migration "${label}" has been skipped`);
      }
    }

    console.log("✅ All migration applied");
  } catch (e) {
    console.error("❌" + getErrorMessage(e));
    throw e;
  }
};

const sortByTimestamp = (
  a: { timestamp: number },
  b: { timestamp: number }
) => {
  return a.timestamp - b.timestamp;
};

export const migrations: Migration[] = [
  {
    label: "Create session table",
    timestamp: 1732188036770,
    sql: createSessionTable,
  },
  {
    label: "Update session table",
    timestamp: 1732189377064,
    sql: updateSessionTable,
  },
  {
    label: "Session rowers table",
    timestamp: 1732189665154,
    sql: createSessionRowersTable,
  },
  {
    label: "Add indexes to improve performance on existing tables",
    timestamp: 1732189896438,
    sql: addIndexes,
  },
  {
    label: "Add hasBeenCoached column to session table",
    timestamp: 1753889255500,
    sql: addHasBeenCoachedColumn,
  },
  {
    label: "Fix hasBeenCoached column to session table",
    timestamp: 1753889255501,
    sql: fixHasBeenCoachedColumn,
  },
  {
    label: "v2 club data tables",
    timestamp: 1792360000000,
    sql: v2ClubData,
  },
  {
    label: "efa2 records kept by the efa2 import",
    timestamp: 1792400000000,
    sql: efaRecords,
  },
  {
    label: "Boat damages",
    timestamp: 1793170000000,
    sql: boatDamages,
  },
  {
    label: "Boat reservations",
    timestamp: 1793180000000,
    sql: boatReservations,
  },
  {
    label: "Analytics saved queries and dashboard",
    timestamp: 1793300000000,
    sql: analytics,
  },
  {
    label: "MCP client of the analytics proposals",
    timestamp: 1793400000000,
    sql: analyticsProposalClient,
  },
];
