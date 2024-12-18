import { relations } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const DBSessions = sqliteTable("session", {
  id: text("id").primaryKey().unique(),
  boatId: text("boat_id").notNull().default("NOT_FOUND"),
  startDateTime: text("start_date_time").notNull().default("NOT_FOUND"),
  estimatedEndDateTime: text("estimated_end_date_time"),
  routeId: text("route_id"),
  endDateTime: text("end_date_time"),
  incidentId: text("incident_id"),
  comment: text("comment"),
});

export const DBSessionOnRowers = sqliteTable(
  "session_rowers",
  {
    session_id: text("session_id")
      .notNull()
      .references(() => DBSessions.id),
    rower_id: text("rower_id").notNull(),
  },
  (table) => {
    return {
      idx_session_rowers_rower_id: index("idx_session_rowers_rower_id").on(
        table.rower_id
      ),
      idx_session_rowers_session_id: index("idx_session_rowers_session_id").on(
        table.session_id
      ),
    };
  }
);

export const DBSessionsRelation = relations(DBSessions, ({ many }) => ({
  sessionOnRowers: many(DBSessionOnRowers),
}));

export const DBSessionOnRowersRelation = relations(
  DBSessionOnRowers,
  ({ one }) => ({
    session: one(DBSessions, {
      fields: [DBSessionOnRowers.session_id],
      references: [DBSessions.id],
    }),
  })
);
