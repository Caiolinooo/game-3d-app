import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import { z } from "zod";
import { MAX_PLAYERS, type PlayerInput, type RoomAck } from "../contracts/game";
import { GameRoom } from "./game/room";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Digite um nome.")
  .max(16, "Use no máximo 16 caracteres.")
  .regex(/^[\p{L}\p{N} _.-]+$/u, "Use apenas letras, números, espaços, ponto, hífen ou sublinhado.");
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/);
const inputSchema = z.object({
  moveX: z.number().finite().min(-1).max(1),
  moveY: z.number().finite().min(-1).max(1),
  aimX: z.number().finite().min(-1).max(1),
  aimY: z.number().finite().min(-1).max(1),
  fire: z.boolean(),
  dash: z.boolean(),
});

type RealtimeStore = {
  io?: SocketServer;
  rooms?: Map<string, GameRoom>;
  servers?: WeakSet<HttpServer>;
  emptySince?: Map<string, number>;
  loop?: ReturnType<typeof setInterval>;
};
const store = globalThis as typeof globalThis & { __circuitClashRealtime?: RealtimeStore };
const realtime = (store.__circuitClashRealtime ??= {});
const rooms = (realtime.rooms ??= new Map<string, GameRoom>());
const attachedServers = (realtime.servers ??= new WeakSet<HttpServer>());
const emptySince = (realtime.emptySince ??= new Map<string, number>());

function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("Não foi possível criar a sala. Tente novamente.");
}

function report(callback: ((response: RoomAck) => void) | undefined, response: RoomAck): void {
  callback?.(response);
}

function currentRoom(socket: Socket): GameRoom | undefined {
  const code = socket.data.roomCode as string | undefined;
  return code ? rooms.get(code) : undefined;
}

function isHost(socket: Socket, room: GameRoom): boolean {
  return room.hostId === socket.id;
}

export function attachRealtime(server: HttpServer, onMatchFinish?: (room: GameRoom) => void): SocketServer {
  if (attachedServers.has(server) && realtime.io) return realtime.io;
  attachedServers.add(server);

  const io = new SocketServer(server, {
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false,
    },
    cors: { origin: true, credentials: true },
  });
  realtime.io = io;

  io.on("connection", (socket) => {
    if (socket.recovered) {
      const room = currentRoom(socket);
      room?.markConnected(socket.id);
      if (room) socket.emit("state", room.snapshot());
    }

    socket.on("room:create", (payload: unknown, callback?: (response: RoomAck) => void) => {
      const parsed = nameSchema.safeParse((payload as { name?: unknown })?.name);
      if (!parsed.success) {
        report(callback, { ok: false, error: parsed.error.issues[0]?.message ?? "Nome inválido." });
        return;
      }
      try {
        const code = makeCode();
        const room = new GameRoom(code, socket.id, (finishedRoom) => {
          onMatchFinish?.(finishedRoom);
        });
        rooms.set(code, room);
        room.addPlayer(socket.id, parsed.data);
        socket.data.roomCode = code;
        void socket.join(code);
        report(callback, { ok: true, code, playerId: socket.id });
        io.to(code).emit("state", room.snapshot());
      } catch (error) {
        report(callback, { ok: false, error: error instanceof Error ? error.message : "Não foi possível criar a sala." });
      }
    });

    socket.on("room:join", (payload: unknown, callback?: (response: RoomAck) => void) => {
      const name = nameSchema.safeParse((payload as { name?: unknown })?.name);
      const code = codeSchema.safeParse((payload as { code?: unknown })?.code);
      if (!name.success) {
        report(callback, { ok: false, error: name.error.issues[0]?.message ?? "Nome inválido." });
        return;
      }
      if (!code.success) {
        report(callback, { ok: false, error: "O código da sala tem 4 caracteres." });
        return;
      }
      const room = rooms.get(code.data);
      if (!room) {
        report(callback, { ok: false, error: "Sala não encontrada. Confira o código." });
        return;
      }
      try {
        if (currentRoom(socket)) leaveCurrentRoom(socket, io);
        room.addPlayer(socket.id, name.data);
        socket.data.roomCode = room.code;
        void socket.join(room.code);
        report(callback, { ok: true, code: room.code, playerId: socket.id });
        io.to(room.code).emit("state", room.snapshot());
      } catch (error) {
        report(callback, { ok: false, error: error instanceof Error ? error.message : "Não foi possível entrar." });
      }
    });

    socket.on("room:addBot", (callback?: (response: RoomAck) => void) => {
      const room = currentRoom(socket);
      if (!room || !isHost(socket, room)) {
        report(callback, { ok: false, error: "Somente o anfitrião pode adicionar bots." });
        return;
      }
      if (room.phase !== "lobby") {
        report(callback, { ok: false, error: "Adicione bots antes da partida." });
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        report(callback, { ok: false, error: "A sala está cheia." });
        return;
      }
      room.addBot();
      report(callback, { ok: true, code: room.code });
      io.to(room.code).emit("state", room.snapshot());
    });

    socket.on("room:start", (callback?: (response: RoomAck) => void) => {
      const room = currentRoom(socket);
      if (!room || !isHost(socket, room)) {
        report(callback, { ok: false, error: "Somente o anfitrião pode iniciar." });
        return;
      }
      try {
        room.start();
        report(callback, { ok: true, code: room.code });
        io.to(room.code).emit("state", room.snapshot());
      } catch (error) {
        report(callback, { ok: false, error: error instanceof Error ? error.message : "Não foi possível iniciar." });
      }
    });

    socket.on("room:pause", () => {
      const room = currentRoom(socket);
      if (room && isHost(socket, room)) {
        room.togglePause();
        io.to(room.code).emit("state", room.snapshot());
      }
    });

    socket.on("player:input", (payload: unknown) => {
      const room = currentRoom(socket);
      if (!room || room.phase !== "playing") return;
      const parsed = inputSchema.safeParse(payload);
      if (parsed.success) room.setInput(socket.id, parsed.data as PlayerInput);
    });

    socket.on("room:leave", () => {
      leaveCurrentRoom(socket, io);
      socket.emit("room:left");
    });

    socket.on("disconnect", () => {
      const room = currentRoom(socket);
      if (!room) return;
      room.markDisconnected(socket.id);
      io.to(room.code).emit("state", room.snapshot());
    });
  });

  if (!realtime.loop) {
    realtime.loop = setInterval(() => {
      for (const room of rooms.values()) {
        room.update(1 / 30);
        for (const effect of room.drainEffects()) io.to(room.code).emit("effect", effect);
        if (room.tick % 2 === 0) io.to(room.code).emit("state", room.snapshot());

        const hasConnectedHumans = [...room.players.values()].some((player) => !player.isBot && player.connected);
        if (hasConnectedHumans) {
          emptySince.delete(room.code);
        } else {
          const emptyAt = emptySince.get(room.code) ?? Date.now();
          emptySince.set(room.code, emptyAt);
          if (Date.now() - emptyAt > 60_000) {
            rooms.delete(room.code);
            emptySince.delete(room.code);
          }
        }
      }
    }, 1000 / 30);
  }

  return io;
}

function leaveCurrentRoom(socket: Socket, io: SocketServer): void {
  const room = currentRoom(socket);
  if (!room) return;
  room.removePlayer(socket.id);
  void socket.leave(room.code);
  delete socket.data.roomCode;
  if (room.players.size === 0) {
    rooms.delete(room.code);
    emptySince.delete(room.code);
  } else io.to(room.code).emit("state", room.snapshot());
}
