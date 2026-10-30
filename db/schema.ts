import { boolean, int, mysqlTable, serial, timestamp, varchar } from "drizzle-orm/mysql-core";

export const matchResults = mysqlTable("match_results", {
  id: serial("id").primaryKey(),
  playerName: varchar("player_name", { length: 24 }).notNull(),
  roomCode: varchar("room_code", { length: 4 }).notNull(),
  score: int("score").notNull().default(0),
  kills: int("kills").notNull().default(0),
  deaths: int("deaths").notNull().default(0),
  won: boolean("won").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MatchResult = typeof matchResults.$inferSelect;
