import { desc, eq } from "drizzle-orm";
import { matchResults } from "@db/schema";
import type { GameRoom } from "../game/room";
import { getDb } from "./connection";

export async function saveMatchResults(room: GameRoom): Promise<void> {
  const ranking = [...room.players.values()].sort((a, b) => b.score - a.score || b.kills - a.kills);
  const winner = ranking[0];
  const rows = ranking
    .filter((player) => !player.isBot)
    .map((player) => ({
      playerName: player.name,
      roomCode: room.code,
      score: Math.round(player.score),
      kills: player.kills,
      deaths: player.deaths,
      won: player.id === winner?.id,
    }));
  if (rows.length > 0) await getDb().insert(matchResults).values(rows);
}

export async function recentWinners() {
  return getDb().select().from(matchResults).where(eq(matchResults.won, true)).orderBy(desc(matchResults.createdAt)).limit(6);
}
