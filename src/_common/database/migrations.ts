import createSessionTable from "./migrations/01_create-session-table";
import updateSessionTable from "./migrations/02_update-session-table";
import createSessionRowersTable from "./migrations/03_session_rowers-table";
import addIndexes from "./migrations/04_add-index";

export const migrations: {
  label: string;
  timestamp: number;
  sql: string;
}[] = [
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
];
