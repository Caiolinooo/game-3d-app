import { io, type Socket } from "socket.io-client";
import { MAX_PLAYERS, type GameEffect, type GameSnapshot, type PlayerInput, type RoomAck } from "@contracts/game";
import { GameRoom } from "../../api/game/room";

type Listener = () => void;

class MultiplayerClient {
  private readonly socket: Socket;
  private readonly listeners = new Set<Listener>();
  private readonly effects: GameEffect[] = [];
  snapshot: GameSnapshot | null = null;
  playerId = "";
  connected = false;
  connectionMessage = "";

  constructor() {
    this.socket = io({
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 6000,
    });
    this.socket.on("connect", () => {
      this.connected = true;
      this.connectionMessage = this.socket.recovered ? "Conexão recuperada" : "";
      this.playerId = this.socket.id ?? this.playerId;
      if (!this.socket.recovered && this.snapshot) this.snapshot = null;
      this.notify();
    });
    this.socket.on("disconnect", () => {
      this.connected = false;
      this.connectionMessage = "Reconectando…";
      this.notify();
    });
    this.socket.on("connect_error", () => {
      this.connected = false;
      this.connectionMessage = "Servidor indisponível. Tentando novamente…";
      this.notify();
    });
    this.socket.on("state", (snapshot: GameSnapshot) => {
      this.snapshot = snapshot;
      this.playerId = this.socket.id ?? this.playerId;
      this.connectionMessage = "";
      this.notify();
    });
    this.socket.on("effect", (effect: GameEffect) => {
      if (this.effects.length > 160) this.effects.shift();
      this.effects.push(effect);
    });
    this.socket.on("room:left", () => {
      this.snapshot = null;
      this.notify();
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private request(event: string, payload?: unknown): Promise<RoomAck> {
    if (!this.socket.connected) return Promise.resolve({ ok: false, error: "Aguarde a conexão com o servidor." });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (response: RoomAck) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "O servidor demorou a responder. Tente novamente." }), 6500);
      if (payload === undefined) this.socket.emit(event, finish);
      else this.socket.emit(event, payload, finish);
    });
  }

  createRoom(name: string): Promise<RoomAck> {
    return this.request("room:create", { name });
  }

  joinRoom(name: string, code: string): Promise<RoomAck> {
    return this.request("room:join", { name, code: code.toUpperCase() });
  }

  addBot(): Promise<RoomAck> {
    return this.request("room:addBot");
  }

  startMatch(): Promise<RoomAck> {
    return this.request("room:start");
  }

  async quickMatch(name: string): Promise<RoomAck> {
    const created = await this.createRoom(name);
    if (!created.ok) return created;
    for (let i = 0; i < 3; i += 1) {
      const bot = await this.addBot();
      if (!bot.ok) return bot;
    }
    return this.startMatch();
  }

  pause(): void {
    this.socket.emit("room:pause");
  }

  leave(): void {
    this.socket.emit("room:leave");
    this.snapshot = null;
    this.notify();
  }

  sendInput(input: PlayerInput): void {
    if (this.socket.connected && this.snapshot?.phase === "playing") this.socket.volatile.emit("player:input", input);
  }

  drainEffects(): GameEffect[] {
    return this.effects.splice(0, this.effects.length);
  }
}

/**
 * Local (single-device) mode, used on static hosting such as Vercel where no
 * persistent Socket.IO server exists. The same GameRoom simulation runs in the
 * browser: quick match and private rooms with bots work; joining other devices
 * does not. Enabled at build time with VITE_LOCAL_MODE=1.
 */
class LocalClient {
  private readonly listeners = new Set<Listener>();
  private readonly effects: GameEffect[] = [];
  private room: GameRoom | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  snapshot: GameSnapshot | null = null;
  playerId = "local-player";
  connected = true;
  connectionMessage = "";

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private publish(): void {
    if (this.room) this.snapshot = this.room.snapshot();
    this.notify();
  }

  private ensureLoop(): void {
    if (this.loop) return;
    this.loop = setInterval(() => {
      const room = this.room;
      if (!room) return;
      room.update(1 / 30);
      for (const effect of room.drainEffects()) {
        if (this.effects.length > 160) this.effects.shift();
        this.effects.push(effect);
      }
      if (room.tick % 2 === 0) this.publish();
    }, 1000 / 30);
  }

  async createRoom(name: string): Promise<RoomAck> {
    const clean = name.trim().slice(0, 16) || "Jogador";
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    this.room = new GameRoom(code, this.playerId, () => {});
    this.room.addPlayer(this.playerId, clean);
    this.ensureLoop();
    this.publish();
    return { ok: true, code, playerId: this.playerId };
  }

  async joinRoom(_name: string, _code: string): Promise<RoomAck> {
    return { ok: false, error: "Multijogador online indisponível nesta versão. Use Jogo rápido ou crie uma sala com bots." };
  }

  async addBot(): Promise<RoomAck> {
    const room = this.room;
    if (!room) return { ok: false, error: "Crie uma sala primeiro." };
    if (room.phase !== "lobby") return { ok: false, error: "Adicione bots antes da partida." };
    if (room.players.size >= MAX_PLAYERS) return { ok: false, error: "A sala está cheia." };
    room.addBot();
    this.publish();
    return { ok: true, code: room.code };
  }

  async startMatch(): Promise<RoomAck> {
    const room = this.room;
    if (!room) return { ok: false, error: "Crie uma sala primeiro." };
    try {
      room.start();
      this.publish();
      return { ok: true, code: room.code };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Não foi possível iniciar." };
    }
  }

  async quickMatch(name: string): Promise<RoomAck> {
    const created = await this.createRoom(name);
    if (!created.ok) return created;
    for (let i = 0; i < 3; i += 1) {
      const bot = await this.addBot();
      if (!bot.ok) return bot;
    }
    return this.startMatch();
  }

  pause(): void {
    this.room?.togglePause();
    this.publish();
  }

  leave(): void {
    this.room = null;
    this.snapshot = null;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.notify();
  }

  sendInput(input: PlayerInput): void {
    if (this.room?.phase === "playing") this.room.setInput(this.playerId, input);
  }

  drainEffects(): GameEffect[] {
    return this.effects.splice(0, this.effects.length);
  }
}

export const isLocalMode = import.meta.env.VITE_LOCAL_MODE === "1";
export const multiplayer: MultiplayerClient | LocalClient = isLocalMode ? new LocalClient() : new MultiplayerClient();
