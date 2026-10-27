import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Drizzle view of the v2 outing tables, used by history and stats queries.
 * The full schema is in migrations/07_v2-club-data.ts.
 */
export const DBOutings = sqliteTable("outing", {
  id: text("id").primaryKey(),
  boatId: text("boat_id").notNull(),
  boatConfigurationId: text("boat_configuration_id"),
  routeId: text("route_id"),
  outingTypeCode: text("outing_type_code"),
  startDateTime: text("start_date_time").notNull(),
  estimatedEndDateTime: text("estimated_end_date_time"),
  endDateTime: text("end_date_time"),
  distanceM: integer("distance_m"),
  comment: text("comment"),
  hasBeenCoached: integer("has_been_coached"),
  captainRowerId: text("captain_rower_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const DBOutingCrew = sqliteTable("outing_crew", {
  outingId: text("outing_id")
    .notNull()
    .references(() => DBOutings.id),
  rowerId: text("rower_id").notNull(),
  role: text("role").notNull(),
  position: integer("position").notNull(),
});

export const DBOutingsRelation = relations(DBOutings, ({ many }) => ({
  crew: many(DBOutingCrew),
}));

export const DBOutingCrewRelation = relations(DBOutingCrew, ({ one }) => ({
  outing: one(DBOutings, {
    fields: [DBOutingCrew.outingId],
    references: [DBOutings.id],
  }),
}));
