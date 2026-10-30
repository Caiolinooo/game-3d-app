import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../../contracts/game";
import { GameRoom } from "./room";

describe("GameRoom", () => {
  it("starts in lobby with the host as first player", () => {
    const room = new GameRoom("ABCD", "host", () => {});
    room.addPlayer("host", "Caio");
    const snap = room.snapshot();
    expect(snap.phase).toBe("lobby");
    expect(snap.hostId).toBe("host");
    expect(snap.players).toHaveLength(1);
  });

  it("adds bots up to MAX_PLAYERS and starts a match", () => {
    const room = new GameRoom("WXYZ", "host", () => {});
    room.addPlayer("host", "Caio");
    for (let i = 1; i < MAX_PLAYERS; i += 1) room.addBot();
    expect(room.players.size).toBe(MAX_PLAYERS);
    room.start();
    expect(room.phase).not.toBe("lobby");
    for (let i = 0; i < 300; i += 1) room.update(1 / 30);
    expect(room.tick).toBeGreaterThan(0);
  });
});
