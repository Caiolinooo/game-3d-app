import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  type CoreState,
  type GameEffect,
  type GamePhase,
  type GameSnapshot,
  MAX_PLAYERS,
  OBSTACLES,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  type PlayerInput,
  type PlayerState,
  type PowerupKind,
  type PowerupState,
  type ProjectileState,
  ROUND_SECONDS,
} from "../../contracts/game";

export interface ServerPlayer extends PlayerState {
  input: PlayerInput;
  disconnectedAt: number | null;
  aiOffset: number;
}

const EMPTY_INPUT: PlayerInput = {
  moveX: 0,
  moveY: 0,
  aimX: 1,
  aimY: 0,
  fire: false,
  dash: false,
};

const SPAWNS = [
  { x: 180, y: 180 },
  { x: 1420, y: 820 },
  { x: 1420, y: 180 },
  { x: 180, y: 820 },
  { x: 800, y: 500 },
  { x: 800, y: 270 },
  { x: 800, y: 730 },
  { x: 800, y: 500 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function length(x: number, y: number): number {
  return Math.hypot(x, y);
}

function normalize(x: number, y: number): { x: number; y: number } {
  const size = length(x, y);
  return size > 0.001 ? { x: x / size, y: y / size } : { x: 0, y: 0 };
}

function pointHitsObstacle(x: number, y: number, radius = 0): boolean {
  return OBSTACLES.some(
    (obstacle) =>
      x + radius > obstacle.x &&
      x - radius < obstacle.x + obstacle.w &&
      y + radius > obstacle.y &&
      y - radius < obstacle.y + obstacle.h,
  );
}

export class GameRoom {
  readonly players = new Map<string, ServerPlayer>();
  phase: GamePhase = "lobby";
  hostId: string;
  tick = 0;
  remaining = ROUND_SECONDS;
  countdown = 3;
  ringRadius = 1100;
  projectiles: ProjectileState[] = [];
  cores: CoreState[] = [];
  powerups: PowerupState[] = [];
  effects: GameEffect[] = [];
  createdAt = Date.now();
  private nextEntityId = 1;
  private coreTimer = 0;
  private powerupTimer = 5;
  private randomState: number;
  private finishReported = false;

  constructor(
    readonly code: string,
    hostId: string,
    private readonly onFinish: (room: GameRoom) => void,
  ) {
    this.hostId = hostId;
    this.randomState = [...code].reduce((seed, char) => seed * 31 + char.charCodeAt(0), 177) >>> 0;
  }

  private random(): number {
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  addPlayer(id: string, name: string, isBot = false): ServerPlayer {
    if (this.players.size >= MAX_PLAYERS) throw new Error("A sala está cheia.");
    if (this.phase === "playing" || this.phase === "countdown" || this.phase === "paused") {
      throw new Error("Aguarde a partida terminar para entrar.");
    }
    const index = this.players.size;
    const spawn = SPAWNS[index % SPAWNS.length];
    const player: ServerPlayer = {
      id,
      name,
      color: PLAYER_COLORS[index % PLAYER_COLORS.length],
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      angle: 0,
      hp: 100,
      shield: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      connected: true,
      isBot,
      respawnIn: 0,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTime: 0,
      powerup: null,
      powerupTime: 0,
      input: { ...EMPTY_INPUT },
      disconnectedAt: null,
      aiOffset: this.random() * Math.PI * 2,
    };
    this.players.set(id, player);
    if (!isBot && (!this.hostId || !this.players.has(this.hostId))) this.hostId = id;
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    if (this.hostId === id) {
      this.hostId = [...this.players.values()].find((player) => !player.isBot && player.connected)?.id ?? "";
    }
  }

  markDisconnected(id: string): void {
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.input = { ...EMPTY_INPUT };
    if (this.hostId === id) {
      this.hostId = [...this.players.values()].find((candidate) => !candidate.isBot && candidate.connected)?.id ?? id;
    }
  }

  markConnected(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = true;
    player.disconnectedAt = null;
  }

  setInput(id: string, input: PlayerInput): void {
    const player = this.players.get(id);
    if (!player || !player.connected) return;
    const move = normalize(clamp(input.moveX, -1, 1), clamp(input.moveY, -1, 1));
    const aim = normalize(clamp(input.aimX, -1, 1), clamp(input.aimY, -1, 1));
    player.input = {
      moveX: move.x,
      moveY: move.y,
      aimX: aim.x,
      aimY: aim.y,
      fire: Boolean(input.fire),
      dash: player.input.dash || Boolean(input.dash),
    };
  }

  addBot(): ServerPlayer {
    const number = [...this.players.values()].filter((player) => player.isBot).length + 1;
    return this.addPlayer(`bot-${this.code}-${number}-${Date.now()}`, `Byte ${number}`, true);
  }

  start(): void {
    if (this.players.size === 0) throw new Error("A sala precisa de pelo menos um jogador.");
    if (this.phase !== "lobby" && this.phase !== "results") return;
    this.projectiles = [];
    this.powerups = [];
    this.cores = [];
    this.remaining = ROUND_SECONDS;
    this.countdown = 3;
    this.ringRadius = 1100;
    this.phase = "countdown";
    this.finishReported = false;
    this.powerupTimer = 5;
    let index = 0;
    for (const player of this.players.values()) {
      const spawn = SPAWNS[index++ % SPAWNS.length];
      Object.assign(player, {
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        hp: 100,
        shield: 0,
        score: 0,
        kills: 0,
        deaths: 0,
        respawnIn: 0,
        fireCooldown: 0,
        dashCooldown: 0,
        dashTime: 0,
        powerup: null,
        powerupTime: 0,
        input: { ...EMPTY_INPUT },
      });
    }
    for (let i = 0; i < 12; i += 1) this.spawnCore();
    this.effects.push({ kind: "start", x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, color: "#58e6ff" });
  }

  togglePause(): void {
    if (this.phase === "playing") this.phase = "paused";
    else if (this.phase === "paused") this.phase = "playing";
  }

  update(dt: number): void {
    this.tick += 1;
    for (const player of [...this.players.values()]) {
      if (!player.isBot && !player.connected && player.disconnectedAt && Date.now() - player.disconnectedAt > 45_000) {
        this.removePlayer(player.id);
      }
    }
    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = "playing";
      }
      return;
    }
    if (this.phase !== "playing") return;

    this.remaining = Math.max(0, this.remaining - dt);
    this.ringRadius = this.remaining < 45 ? 1100 - ((45 - this.remaining) / 45) * 820 : 1100;
    if (this.remaining <= 0) {
      this.finish();
      return;
    }

    for (const player of this.players.values()) this.updatePlayer(player, dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.separatePlayers();
  }

  private updatePlayer(player: ServerPlayer, dt: number): void {
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.powerupTime = Math.max(0, player.powerupTime - dt);
    if (player.powerupTime <= 0) player.powerup = null;

    if (player.respawnIn > 0) {
      player.respawnIn -= dt;
      if (player.respawnIn <= 0) this.respawn(player);
      return;
    }
    if (player.hp <= 0 || !player.connected) return;
    if (player.isBot) this.updateBotInput(player);

    const input = player.input;
    if (input.dash && player.dashCooldown <= 0) {
      player.dashTime = 0.18;
      player.dashCooldown = 3;
      this.effects.push({ kind: "dash", x: player.x, y: player.y, color: player.color, playerId: player.id });
    }
    input.dash = false;
    player.dashTime = Math.max(0, player.dashTime - dt);

    let move = normalize(input.moveX, input.moveY);
    if (player.dashTime > 0 && length(move.x, move.y) < 0.1) move = normalize(input.aimX, input.aimY);
    const speedBoost = player.powerup === "speed" ? 1.35 : 1;
    const speed = (player.dashTime > 0 ? 690 : 255) * speedBoost;
    const responsiveness = player.dashTime > 0 ? 30 : 13;
    player.vx += (move.x * speed - player.vx) * Math.min(1, responsiveness * dt);
    player.vy += (move.y * speed - player.vy) * Math.min(1, responsiveness * dt);
    if (length(move.x, move.y) < 0.05 && player.dashTime <= 0) {
      player.vx *= Math.max(0, 1 - dt * 9);
      player.vy *= Math.max(0, 1 - dt * 9);
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    this.resolveWorldCollision(player);

    if (length(input.aimX, input.aimY) > 0.1) player.angle = Math.atan2(input.aimY, input.aimX);
    else if (length(move.x, move.y) > 0.1) player.angle = Math.atan2(move.y, move.x);

    if (input.fire && player.fireCooldown <= 0 && player.dashTime <= 0) this.fire(player);

    const distanceFromCenter = length(player.x - ARENA_WIDTH / 2, player.y - ARENA_HEIGHT / 2);
    if (distanceFromCenter > this.ringRadius) {
      this.damage(player, 13 * dt, undefined, 0, 0);
    }
  }

  private updateBotInput(bot: ServerPlayer): void {
    const opponents = [...this.players.values()].filter(
      (player) => player.id !== bot.id && player.hp > 0 && player.respawnIn <= 0 && player.connected,
    );
    let target: ServerPlayer | undefined;
    let targetDistance = Number.POSITIVE_INFINITY;
    for (const opponent of opponents) {
      const distance = length(opponent.x - bot.x, opponent.y - bot.y);
      if (distance < targetDistance) {
        target = opponent;
        targetDistance = distance;
      }
    }

    let destination: { x: number; y: number } | undefined;
    if (bot.hp < 45 || !target || targetDistance > 520) {
      destination = this.cores.reduce<{ x: number; y: number } | undefined>((nearest, core) => {
        if (!nearest) return core;
        return length(core.x - bot.x, core.y - bot.y) < length(nearest.x - bot.x, nearest.y - bot.y) ? core : nearest;
      }, undefined);
    }
    if (!destination && target) destination = target;
    if (!destination) destination = { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 };

    const direction = normalize(destination.x - bot.x, destination.y - bot.y);
    const strafe = Math.sin(this.tick / 42 + bot.aiOffset) * 0.65;
    bot.input.moveX = clamp(direction.x - direction.y * strafe, -1, 1);
    bot.input.moveY = clamp(direction.y + direction.x * strafe, -1, 1);
    if (target) {
      const aim = normalize(target.x + target.vx * 0.18 - bot.x, target.y + target.vy * 0.18 - bot.y);
      bot.input.aimX = aim.x;
      bot.input.aimY = aim.y;
      bot.input.fire = targetDistance < 720;
      if ((bot.hp < 35 || targetDistance < 110) && bot.dashCooldown <= 0 && this.random() < 0.025) {
        bot.input.dash = true;
      }
    } else {
      bot.input.fire = false;
    }
  }

  private fire(player: ServerPlayer): void {
    const direction = normalize(Math.cos(player.angle), Math.sin(player.angle));
    const speed = 650;
    this.projectiles.push({
      id: this.nextEntityId++,
      ownerId: player.id,
      x: player.x + direction.x * 34,
      y: player.y + direction.y * 34,
      vx: direction.x * speed,
      vy: direction.y * speed,
      color: player.color,
      life: 1.35,
    });
    player.fireCooldown = player.powerup === "rapid" ? 0.15 : 0.31;
    this.effects.push({ kind: "shot", x: player.x, y: player.y, color: player.color, playerId: player.id });
  }

  private updateProjectiles(dt: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.life -= dt;
      if (
        projectile.life <= 0 ||
        projectile.x < 0 ||
        projectile.x > ARENA_WIDTH ||
        projectile.y < 0 ||
        projectile.y > ARENA_HEIGHT ||
        pointHitsObstacle(projectile.x, projectile.y, 5)
      ) {
        this.projectiles.splice(index, 1);
        continue;
      }

      let hit = false;
      for (const player of this.players.values()) {
        if (
          player.id === projectile.ownerId ||
          player.hp <= 0 ||
          player.respawnIn > 0 ||
          !player.connected ||
          player.dashTime > 0
        ) {
          continue;
        }
        if (length(player.x - projectile.x, player.y - projectile.y) < PLAYER_RADIUS + 7) {
          const knockback = normalize(projectile.vx, projectile.vy);
          player.vx += knockback.x * 250;
          player.vy += knockback.y * 250;
          this.damage(player, 15, projectile.ownerId, projectile.x, projectile.y);
          hit = true;
          break;
        }
      }
      if (hit) this.projectiles.splice(index, 1);
    }
  }

  private damage(player: ServerPlayer, amount: number, attackerId: string | undefined, x: number, y: number): void {
    let remaining = amount;
    if (player.shield > 0) {
      const absorbed = Math.min(player.shield, remaining);
      player.shield -= absorbed;
      remaining -= absorbed;
    }
    player.hp = Math.max(0, player.hp - remaining);
    if (amount >= 1) {
      this.effects.push({ kind: "hit", x, y, color: player.color, playerId: player.id });
    }
    if (player.hp <= 0) this.eliminate(player, attackerId);
  }

  private eliminate(player: ServerPlayer, attackerId: string | undefined): void {
    if (player.respawnIn > 0) return;
    player.deaths += 1;
    player.respawnIn = 2.5;
    player.vx = 0;
    player.vy = 0;
    player.powerup = null;
    player.powerupTime = 0;
    const attacker = attackerId ? this.players.get(attackerId) : undefined;
    if (attacker && attacker.id !== player.id) {
      attacker.kills += 1;
      attacker.score += 100;
    }
    this.effects.push({ kind: "ko", x: player.x, y: player.y, color: player.color, playerId: player.id });
  }

  private respawn(player: ServerPlayer): void {
    const spawn = SPAWNS[Math.floor(this.random() * SPAWNS.length)];
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = 100;
    player.shield = 0;
    player.respawnIn = 0;
    player.fireCooldown = 0.4;
    player.dashCooldown = 1;
  }

  private updatePickups(dt: number): void {
    this.coreTimer -= dt;
    if (this.coreTimer <= 0 && this.cores.length < 12) {
      this.spawnCore();
      this.coreTimer = 0.8;
    }
    this.powerupTimer -= dt;
    if (this.powerupTimer <= 0 && this.powerups.length < 3) {
      this.spawnPowerup();
      this.powerupTimer = 7 + this.random() * 3;
    }

    for (const player of this.players.values()) {
      if (player.hp <= 0 || player.respawnIn > 0 || !player.connected) continue;
      for (let index = this.cores.length - 1; index >= 0; index -= 1) {
        const core = this.cores[index];
        if (length(player.x - core.x, player.y - core.y) < PLAYER_RADIUS + 18) {
          this.cores.splice(index, 1);
          player.score += 15;
          player.hp = Math.min(100, player.hp + 6);
          this.effects.push({ kind: "pickup", x: core.x, y: core.y, color: "#ffe066", playerId: player.id });
        }
      }
      for (let index = this.powerups.length - 1; index >= 0; index -= 1) {
        const powerup = this.powerups[index];
        if (length(player.x - powerup.x, player.y - powerup.y) < PLAYER_RADIUS + 22) {
          this.powerups.splice(index, 1);
          player.powerup = powerup.kind;
          player.powerupTime = 9;
          if (powerup.kind === "shield") player.shield = Math.min(60, player.shield + 45);
          this.effects.push({ kind: "powerup", x: powerup.x, y: powerup.y, color: "#b892ff", playerId: player.id });
        }
      }
    }
  }

  private spawnCore(): void {
    const point = this.randomOpenPoint(70);
    this.cores.push({ id: this.nextEntityId++, x: point.x, y: point.y, phase: this.random() * Math.PI * 2 });
  }

  private spawnPowerup(): void {
    const kinds: PowerupKind[] = ["rapid", "shield", "speed"];
    const point = this.randomOpenPoint(90);
    this.powerups.push({
      id: this.nextEntityId++,
      x: point.x,
      y: point.y,
      kind: kinds[Math.floor(this.random() * kinds.length)],
      phase: this.random() * Math.PI * 2,
    });
  }

  private randomOpenPoint(margin: number): { x: number; y: number } {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const point = {
        x: margin + this.random() * (ARENA_WIDTH - margin * 2),
        y: margin + this.random() * (ARENA_HEIGHT - margin * 2),
      };
      if (!pointHitsObstacle(point.x, point.y, 45)) return point;
    }
    return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 };
  }

  private resolveWorldCollision(player: ServerPlayer): void {
    player.x = clamp(player.x, PLAYER_RADIUS + 12, ARENA_WIDTH - PLAYER_RADIUS - 12);
    player.y = clamp(player.y, PLAYER_RADIUS + 12, ARENA_HEIGHT - PLAYER_RADIUS - 12);
    for (const obstacle of OBSTACLES) {
      const nearestX = clamp(player.x, obstacle.x, obstacle.x + obstacle.w);
      const nearestY = clamp(player.y, obstacle.y, obstacle.y + obstacle.h);
      let dx = player.x - nearestX;
      let dy = player.y - nearestY;
      let distance = length(dx, dy);
      if (distance < PLAYER_RADIUS) {
        if (distance < 0.001) {
          const sides = [
            { dx: obstacle.x - player.x - PLAYER_RADIUS, dy: 0 },
            { dx: obstacle.x + obstacle.w - player.x + PLAYER_RADIUS, dy: 0 },
            { dx: 0, dy: obstacle.y - player.y - PLAYER_RADIUS },
            { dx: 0, dy: obstacle.y + obstacle.h - player.y + PLAYER_RADIUS },
          ];
          sides.sort((a, b) => length(a.dx, a.dy) - length(b.dx, b.dy));
          player.x += sides[0].dx;
          player.y += sides[0].dy;
        } else {
          dx /= distance;
          dy /= distance;
          const overlap = PLAYER_RADIUS - distance;
          player.x += dx * overlap;
          player.y += dy * overlap;
        }
        player.vx *= 0.65;
        player.vy *= 0.65;
      }
    }
  }

  private separatePlayers(): void {
    const active = [...this.players.values()].filter((player) => player.hp > 0 && player.respawnIn <= 0 && player.connected);
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        const delta = normalize(a.x - b.x, a.y - b.y);
        const distance = length(a.x - b.x, a.y - b.y);
        const overlap = PLAYER_RADIUS * 2 - distance;
        if (overlap > 0 && distance > 0.001) {
          a.x += delta.x * overlap * 0.5;
          a.y += delta.y * overlap * 0.5;
          b.x -= delta.x * overlap * 0.5;
          b.y -= delta.y * overlap * 0.5;
        }
      }
    }
  }

  private finish(): void {
    this.phase = "results";
    this.projectiles = [];
    const winner = [...this.players.values()].sort((a, b) => b.score - a.score || b.kills - a.kills)[0];
    if (winner) this.effects.push({ kind: "win", x: winner.x, y: winner.y, color: winner.color, playerId: winner.id });
    if (!this.finishReported) {
      this.finishReported = true;
      this.onFinish(this);
    }
  }

  drainEffects(): GameEffect[] {
    return this.effects.splice(0, this.effects.length);
  }

  snapshot(): GameSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      tick: this.tick,
      remaining: this.remaining,
      countdown: this.countdown,
      ringRadius: this.ringRadius,
      players: [...this.players.values()].map(({ input: _input, disconnectedAt: _disconnectedAt, aiOffset: _aiOffset, ...player }) => player),
      projectiles: this.projectiles.map((projectile) => ({ ...projectile })),
      cores: this.cores.map((core) => ({ ...core })),
      powerups: this.powerups.map((powerup) => ({ ...powerup })),
    };
  }
}
