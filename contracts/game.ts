export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 1000;
export const MAX_PLAYERS = 8;
export const ROUND_SECONDS = 180;
export const PLAYER_RADIUS = 23;

export type GamePhase = "lobby" | "countdown" | "playing" | "paused" | "results";
export type PowerupKind = "rapid" | "shield" | "speed";

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const OBSTACLES: Obstacle[] = [
  { x: 350, y: 240, w: 190, h: 54 },
  { x: 1060, y: 706, w: 190, h: 54 },
  { x: 1060, y: 240, w: 190, h: 54 },
  { x: 350, y: 706, w: 190, h: 54 },
  { x: 735, y: 120, w: 130, h: 54 },
  { x: 735, y: 826, w: 130, h: 54 },
];

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  shield: number;
  score: number;
  kills: number;
  deaths: number;
  connected: boolean;
  isBot: boolean;
  respawnIn: number;
  fireCooldown: number;
  dashCooldown: number;
  dashTime: number;
  powerup: PowerupKind | null;
  powerupTime: number;
}

export interface ProjectileState {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
}

export interface CoreState {
  id: number;
  x: number;
  y: number;
  phase: number;
}

export interface PowerupState {
  id: number;
  x: number;
  y: number;
  kind: PowerupKind;
  phase: number;
}

export interface GameSnapshot {
  code: string;
  phase: GamePhase;
  hostId: string;
  tick: number;
  remaining: number;
  countdown: number;
  ringRadius: number;
  players: PlayerState[];
  projectiles: ProjectileState[];
  cores: CoreState[];
  powerups: PowerupState[];
}

export interface PlayerInput {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  dash: boolean;
}

export type EffectKind = "shot" | "hit" | "pickup" | "dash" | "ko" | "powerup" | "start" | "win";

export interface GameEffect {
  kind: EffectKind;
  x: number;
  y: number;
  color: string;
  playerId?: string;
}

export interface RoomAck {
  ok: boolean;
  code?: string;
  playerId?: string;
  error?: string;
}

export const PLAYER_COLORS = [
  "#58e6ff",
  "#ff5ea8",
  "#ffe066",
  "#8bff8a",
  "#b892ff",
  "#ff925c",
  "#62a0ff",
  "#f5f7ff",
];
