import type { GameEffect, GameSnapshot, PlayerInput, PlayerState } from "@contracts/game";
import { ArenaInput } from "./arena-input";
import { AudioSystem, type SfxId } from "./audio";
import { GameLoop } from "./engine";
import { multiplayer } from "./network";
import { CanvasRenderer } from "./renderer";

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
    __gameMetrics?: () => { fps: number; entities: number; particles: number };
  }
}

type Session = {
  input: ArenaInput;
  audio: AudioSystem;
  dispose: () => void;
};

let session: Session | null = null;
let muted = false;

function ownPlayer(snapshot: GameSnapshot | null): PlayerState | undefined {
  return snapshot?.players.find((player) => player.id === multiplayer.playerId);
}

function effectSound(effect: GameEffect): SfxId | null {
  const own = effect.playerId === multiplayer.playerId;
  if (effect.kind === "shot" && own) return "move";
  if (effect.kind === "hit" && own) return "hit";
  if (effect.kind === "pickup" && own) return "pickup";
  if (effect.kind === "dash" && own) return "ui";
  if (effect.kind === "powerup" && own) return "pickup";
  if (effect.kind === "ko") return "explosion";
  if (effect.kind === "win") return "win";
  if (effect.kind === "start") return "ui";
  return null;
}

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  const input = new ArenaInput(canvas);
  const audio = new AudioSystem();
  muted = audio.muted;
  const renderer = new CanvasRenderer(canvas);
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  let sendAccumulator = 0;
  let previousPhase = multiplayer.snapshot?.phase;

  const loop = new GameLoop({
    update: (dt) => {
      const snapshot = multiplayer.snapshot;
      for (const effect of multiplayer.drainEffects()) {
        renderer.addEffect(effect);
        const sound = effectSound(effect);
        if (sound) audio.sfx(sound);
      }

      if (snapshot?.phase !== previousPhase) {
        if (snapshot?.phase === "playing" || snapshot?.phase === "countdown") audio.startMusic();
        if (!snapshot || snapshot.phase === "results") audio.stopMusic();
        previousPhase = snapshot?.phase;
      }

      sendAccumulator += dt;
      if (sendAccumulator < 1 / 30) return;
      sendAccumulator %= 1 / 30;
      const own = ownPlayer(snapshot);
      if (!own || snapshot?.phase !== "playing") {
        input.consumeDash();
        return;
      }

      let aimX = Math.cos(own.angle);
      let aimY = Math.sin(own.angle);
      if (input.pointerActive && !coarsePointer) {
        const pointer = renderer.screenToWorld(input.pointerX, input.pointerY);
        const dx = pointer.x - own.x;
        const dy = pointer.y - own.y;
        const size = Math.hypot(dx, dy);
        if (size > 1) {
          aimX = dx / size;
          aimY = dy / size;
        }
      } else if (coarsePointer) {
        let nearest: PlayerState | undefined;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const player of snapshot.players) {
          if (player.id === own.id || player.hp <= 0 || player.respawnIn > 0 || !player.connected) continue;
          const distance = Math.hypot(player.x - own.x, player.y - own.y);
          if (distance < nearestDistance) {
            nearest = player;
            nearestDistance = distance;
          }
        }
        if (nearest) {
          const dx = nearest.x - own.x;
          const dy = nearest.y - own.y;
          const size = Math.hypot(dx, dy) || 1;
          aimX = dx / size;
          aimY = dy / size;
        }
      }

      const payload: PlayerInput = {
        moveX: input.moveX,
        moveY: input.moveY,
        aimX,
        aimY,
        fire: input.firing,
        dash: input.consumeDash(),
      };
      multiplayer.sendInput(payload);
    },
    render: () => {
      renderer.render(
        multiplayer.snapshot,
        multiplayer.playerId,
        { x: input.pointerX, y: input.pointerY, active: input.pointerActive },
      );
      window.__GAME_READY__ = true;
    },
  });
  loop.start();

  window.__gameProbe = () => {
    const own = ownPlayer(multiplayer.snapshot);
    // Top-down 2D arena: screen-up (W) is -y, exposed as z so "forward" reads as z decreasing.
    return { x: own?.x ?? 0, y: 0, z: own?.y ?? 0 };
  };
  window.__gameMetrics = () => renderer.getMetrics();

  session = {
    input,
    audio,
    dispose: () => {
      loop.stop();
      input.dispose();
      audio.dispose();
      delete window.__gameProbe;
      delete window.__gameMetrics;
      window.__GAME_READY__ = false;
    },
  };
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}

export const gameControls = {
  setMove(x: number, y: number): void {
    session?.input.setMove(x, y);
  },
  setFiring(value: boolean): void {
    session?.input.setFiring(value);
  },
  dash(): void {
    session?.input.queueDash();
  },
  toggleMute(): boolean {
    if (!session) return muted;
    muted = session.audio.toggleMute();
    return muted;
  },
  isMuted(): boolean {
    return muted;
  },
};
