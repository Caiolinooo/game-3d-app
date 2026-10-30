import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  type GameEffect,
  type GameSnapshot,
  OBSTACLES,
  PLAYER_RADIUS,
  type PlayerState,
} from "@contracts/game";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

type SmoothPosition = { x: number; y: number };

const POWERUP_LABELS = { rapid: "R", shield: "S", speed: "V" } as const;
const POWERUP_COLORS = { rapid: "#ff5ea8", shield: "#62a0ff", speed: "#8bff8a" } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private cameraX = ARENA_WIDTH / 2;
  private cameraY = ARENA_HEIGHT / 2;
  private scale = 1;
  private readonly positions = new Map<string, SmoothPosition>();
  private readonly particles: Particle[] = [];
  private readonly stars: Array<{ x: number; y: number; size: number; alpha: number }> = [];
  private lastRender = performance.now();
  private shake = 0;
  private frameCount = 0;
  private fps = 60;
  private fpsTime = performance.now();
  private vignette: CanvasGradient | null = null;
  private roomCode = "";

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D não está disponível.");
    this.ctx = context;
    for (let i = 0; i < 90; i += 1) {
      this.stars.push({ x: Math.random(), y: Math.random(), size: 0.5 + Math.random() * 1.7, alpha: 0.12 + Math.random() * 0.42 });
    }
    this.resize();
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vignette = this.ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.28,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72,
    );
    this.vignette.addColorStop(0, "rgba(0,0,0,0)");
    this.vignette.addColorStop(1, "rgba(0,0,8,0.46)");
  }

  addEffect(effect: GameEffect): void {
    const counts: Record<GameEffect["kind"], number> = {
      shot: 3,
      hit: 11,
      pickup: 14,
      dash: 18,
      ko: 38,
      powerup: 24,
      start: 42,
      win: 70,
    };
    const count = counts[effect.kind];
    for (let i = 0; i < count && this.particles.length < 280; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * (effect.kind === "ko" || effect.kind === "win" ? 280 : 150);
      const life = 0.28 + Math.random() * 0.65;
      this.particles.push({
        x: effect.x,
        y: effect.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        color: effect.color,
        size: 2 + Math.random() * 4,
      });
    }
    if (effect.kind === "hit") this.shake = Math.max(this.shake, 5);
    if (effect.kind === "ko") this.shake = Math.max(this.shake, 12);
  }

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: this.cameraX + (x - this.width / 2) / this.scale,
      y: this.cameraY + (y - this.height / 2) / this.scale,
    };
  }

  render(snapshot: GameSnapshot | null, playerId: string, pointer: { x: number; y: number; active: boolean }): void {
    this.resize();
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastRender) / 1000);
    this.lastRender = now;
    this.frameCount += 1;
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsTime));
      this.frameCount = 0;
      this.fpsTime = now;
    }

    if ((snapshot?.code ?? "") !== this.roomCode) {
      this.positions.clear();
      this.roomCode = snapshot?.code ?? "";
    }
    const own = snapshot?.players.find((player) => player.id === playerId);
    if (snapshot) {
      for (const player of snapshot.players) {
        let position = this.positions.get(player.id);
        if (!position) {
          position = { x: player.x, y: player.y };
          this.positions.set(player.id, position);
        }
        const smoothing = 1 - Math.exp(-dt * 19);
        position.x += (player.x - position.x) * smoothing;
        position.y += (player.y - position.y) * smoothing;
      }
    }

    if (snapshot) {
      this.scale = clamp(Math.min(this.width / 1120, this.height / 720), 0.56, 1.35);
      const target = own ? this.positions.get(own.id) : undefined;
      const targetX = target?.x ?? ARENA_WIDTH / 2;
      const targetY = target?.y ?? ARENA_HEIGHT / 2;
      this.cameraX += (targetX - this.cameraX) * (1 - Math.exp(-dt * 7));
      this.cameraY += (targetY - this.cameraY) * (1 - Math.exp(-dt * 7));
      const viewW = this.width / this.scale;
      const viewH = this.height / this.scale;
      this.cameraX = viewW >= ARENA_WIDTH ? ARENA_WIDTH / 2 : clamp(this.cameraX, viewW / 2, ARENA_WIDTH - viewW / 2);
      this.cameraY = viewH >= ARENA_HEIGHT ? ARENA_HEIGHT / 2 : clamp(this.cameraY, viewH / 2, ARENA_HEIGHT - viewH / 2);
    } else {
      this.scale = Math.max(this.width / ARENA_WIDTH, this.height / ARENA_HEIGHT) * 1.08;
      this.cameraX = ARENA_WIDTH / 2 + Math.sin(now / 8000) * 90;
      this.cameraY = ARENA_HEIGHT / 2 + Math.cos(now / 9000) * 45;
    }

    this.drawBackdrop(now);
    const shakeX = this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0.1 ? (Math.random() - 0.5) * this.shake : 0;
    this.shake *= Math.max(0, 1 - dt * 10);

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.width / 2 + shakeX, this.height / 2 + shakeY);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cameraX, -this.cameraY);
    this.drawArena(now, snapshot);
    if (snapshot) {
      this.drawPickups(snapshot, now);
      this.drawProjectiles(snapshot);
      for (const player of snapshot.players) this.drawPlayer(player, player.id === playerId, now);
      if (pointer.active && snapshot.phase === "playing" && own && own.hp > 0 && own.respawnIn <= 0) {
        const world = this.screenToWorld(pointer.x, pointer.y);
        this.drawCrosshair(world.x, world.y, now);
      }
    } else {
      this.drawAmbientCores(now);
    }
    this.drawParticles(dt);
    ctx.restore();

    this.drawVignette();
    if (snapshot && this.width > 800) this.drawMinimap(snapshot, playerId);
  }

  private drawBackdrop(now: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#060813";
    ctx.fillRect(0, 0, this.width, this.height);
    for (const star of this.stars) {
      const drift = (now / 180000) % 1;
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = "#9bc9ff";
      ctx.fillRect(((star.x + drift) % 1) * this.width, star.y * this.height, star.size, star.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawArena(now: number, snapshot: GameSnapshot | null): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#09111f";
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(74, 143, 190, 0.11)";
    ctx.beginPath();
    for (let x = 0; x <= ARENA_WIDTH; x += 80) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ARENA_HEIGHT);
    }
    for (let y = 0; y <= ARENA_HEIGHT; y += 80) {
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA_WIDTH, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(88, 230, 255, 0.52)";
    ctx.lineWidth = 5;
    ctx.shadowColor = "#58e6ff";
    ctx.shadowBlur = 18;
    ctx.strokeRect(4, 4, ARENA_WIDTH - 8, ARENA_HEIGHT - 8);
    ctx.shadowBlur = 0;

    for (const obstacle of OBSTACLES) {
      ctx.fillStyle = "#111e30";
      ctx.strokeStyle = "rgba(105, 161, 198, 0.5)";
      ctx.lineWidth = 3;
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.fillStyle = "rgba(88, 230, 255, 0.2)";
      ctx.fillRect(obstacle.x + 10, obstacle.y + 9, obstacle.w - 20, 3);
    }

    if (snapshot && snapshot.ringRadius < 1099) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
      ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, snapshot.ringRadius, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(86, 20, 110, 0.34)";
      ctx.fill("evenodd");
      ctx.restore();
      ctx.beginPath();
      ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, snapshot.ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(206, 105, 255, ${0.65 + Math.sin(now / 180) * 0.2})`;
      ctx.lineWidth = 7;
      ctx.shadowColor = "#c769ff";
      ctx.shadowBlur = 22;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  private drawAmbientCores(now: number): void {
    const points = [
      [290, 300],
      [1320, 720],
      [1180, 260],
      [510, 790],
      [800, 500],
    ];
    for (let i = 0; i < points.length; i += 1) {
      this.drawCore(points[i][0], points[i][1], now / 700 + i);
    }
  }

  private drawPickups(snapshot: GameSnapshot, now: number): void {
    for (const core of snapshot.cores) this.drawCore(core.x, core.y, now / 650 + core.phase);
    const ctx = this.ctx;
    for (const powerup of snapshot.powerups) {
      const bob = Math.sin(now / 350 + powerup.phase) * 5;
      const color = POWERUP_COLORS[powerup.kind];
      ctx.save();
      ctx.translate(powerup.x, powerup.y + bob);
      ctx.rotate(now / 1500 + powerup.phase);
      ctx.fillStyle = "#101827";
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * 24;
        const y = Math.sin(angle) * 24;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-now / 1500 - powerup.phase);
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.font = "800 18px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWERUP_LABELS[powerup.kind], 0, 1);
      ctx.restore();
    }
  }

  private drawCore(x: number, y: number, rotation: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = "#ffe066";
    ctx.shadowColor = "#ffe066";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 0);
    ctx.lineTo(0, 13);
    ctx.lineTo(-9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff8c7";
    ctx.fillRect(-2, -6, 4, 12);
    ctx.restore();
  }

  private drawProjectiles(snapshot: GameSnapshot): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    for (const projectile of snapshot.projectiles) {
      ctx.strokeStyle = projectile.color;
      ctx.lineWidth = 7;
      ctx.shadowColor = projectile.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(projectile.x - projectile.vx * 0.025, projectile.y - projectile.vy * 0.025);
      ctx.lineTo(projectile.x, projectile.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  private drawPlayer(player: PlayerState, isOwn: boolean, now: number): void {
    if (player.hp <= 0 || player.respawnIn > 0 || !player.connected) return;
    const ctx = this.ctx;
    const position = this.positions.get(player.id) ?? player;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 70) {
      ctx.strokeStyle = player.color;
      ctx.globalAlpha = player.dashTime > 0 ? 0.48 : 0.16;
      ctx.lineWidth = player.dashTime > 0 ? 20 : 10;
      ctx.beginPath();
      ctx.moveTo(position.x - player.vx * 0.11, position.y - player.vy * 0.11);
      ctx.lineTo(position.x, position.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(player.angle);
    ctx.shadowColor = player.color;
    ctx.shadowBlur = isOwn ? 22 : 13;
    ctx.fillStyle = "#0b1423";
    ctx.strokeStyle = player.color;
    ctx.lineWidth = isOwn ? 4 : 3;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.moveTo(31, 0);
    ctx.lineTo(8, -10);
    ctx.lineTo(12, 0);
    ctx.lineTo(8, 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(3, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (isOwn) {
      ctx.strokeStyle = "rgba(255,255,255,0.82)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(position.x, position.y, PLAYER_RADIUS + 8 + Math.sin(now / 220), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (player.shield > 0) {
      ctx.strokeStyle = "rgba(98,160,255,0.85)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(position.x, position.y, PLAYER_RADIUS + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (player.shield / 60));
      ctx.stroke();
    }
    if (player.powerup) {
      ctx.strokeStyle = POWERUP_COLORS[player.powerup];
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 7]);
      ctx.beginPath();
      ctx.arc(position.x, position.y, PLAYER_RADIUS + 13, now / 500, now / 500 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "600 13px system-ui";
    ctx.fillStyle = isOwn ? "#ffffff" : "rgba(226,238,255,0.9)";
    ctx.fillText(player.name, position.x, position.y - 40);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(position.x - 26, position.y - 34, 52, 5);
    ctx.fillStyle = player.hp > 35 ? "#70f0b1" : "#ff5e78";
    ctx.fillRect(position.x - 26, position.y - 34, 52 * (player.hp / 100), 5);
  }

  private drawCrosshair(x: number, y: number, now: number): void {
    const ctx = this.ctx;
    const radius = 10 + Math.sin(now / 180);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.moveTo(x - 17, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 17, y);
    ctx.moveTo(x, y - 17);
    ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 17);
    ctx.stroke();
  }

  private drawParticles(dt: number): void {
    const ctx = this.ctx;
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.max(0, 1 - dt * 2.4);
      particle.vy *= Math.max(0, 1 - dt * 2.4);
      ctx.globalAlpha = particle.life / particle.maxLife;
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawVignette(): void {
    if (!this.vignette) return;
    this.ctx.fillStyle = this.vignette;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawMinimap(snapshot: GameSnapshot, playerId: string): void {
    const ctx = this.ctx;
    const mapWidth = 156;
    const mapHeight = mapWidth * (ARENA_HEIGHT / ARENA_WIDTH);
    const left = this.width - mapWidth - 22;
    const top = this.height - mapHeight - 42;
    const scale = mapWidth / ARENA_WIDTH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "rgba(5, 12, 23, 0.82)";
    ctx.fillRect(left, top, mapWidth, mapHeight);
    ctx.strokeStyle = "rgba(88, 230, 255, 0.28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, mapWidth, mapHeight);
    ctx.fillStyle = "rgba(105, 161, 198, 0.24)";
    for (const obstacle of OBSTACLES) {
      ctx.fillRect(left + obstacle.x * scale, top + obstacle.y * scale, obstacle.w * scale, obstacle.h * scale);
    }
    if (snapshot.ringRadius < 1099) {
      ctx.strokeStyle = "rgba(206, 105, 255, 0.65)";
      ctx.beginPath();
      ctx.arc(left + (ARENA_WIDTH / 2) * scale, top + (ARENA_HEIGHT / 2) * scale, snapshot.ringRadius * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const player of snapshot.players) {
      if (player.hp <= 0 || player.respawnIn > 0 || !player.connected) continue;
      const x = left + player.x * scale;
      const y = top + player.y * scale;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(x, y, player.id === playerId ? 3.2 : 2.3, 0, Math.PI * 2);
      ctx.fill();
      if (player.id === playerId) {
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(151, 177, 202, 0.72)";
    ctx.font = "600 7px 'Chakra Petch', system-ui";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("MAPA DA ARENA", left + mapWidth, top - 6);
  }

  getMetrics(): { fps: number; entities: number; particles: number } {
    return { fps: this.fps, entities: this.positions.size + this.particles.length, particles: this.particles.length };
  }
}
