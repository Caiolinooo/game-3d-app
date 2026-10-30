import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Bot,
  Check,
  Copy,
  Crosshair,
  Gauge,
  LogOut,
  Pause,
  Play,
  Shield,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { gameControls, startGame, stopGame } from "@/game/boot";
import { multiplayer } from "@/game/network";
import { storage } from "@/game/storage";
import { trpc } from "@/providers/trpc";
import { MAX_PLAYERS, type GameSnapshot, type PlayerState, type RoomAck } from "@contracts/game";

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function powerupName(powerup: PlayerState["powerup"]): string {
  if (powerup === "rapid") return "Disparo rápido";
  if (powerup === "shield") return "Escudo";
  if (powerup === "speed") return "Velocidade";
  return "";
}

function Joystick() {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    const radius = 42;
    if (distance > radius) {
      dx = (dx / distance) * radius;
      dy = (dy / distance) * radius;
    }
    setKnob({ x: dx, y: dy });
    gameControls.setMove(dx / radius, dy / radius);
  };

  const release = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && pointerId.current !== null && event.pointerId !== pointerId.current) return;
    pointerId.current = null;
    setKnob({ x: 0, y: 0 });
    gameControls.setMove(0, 0);
  };

  return (
    <div
      ref={baseRef}
      className="joystick"
      aria-label="Joystick de movimento"
      onPointerDown={(event) => {
        pointerId.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerId === pointerId.current) update(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={() => release()}
    >
      <div className="joystick-ring" />
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

function TouchControls({ own }: { own?: PlayerState }) {
  return (
    <div className="touch-controls">
      <Joystick />
      <div className="touch-actions">
        <button
          type="button"
          className="dash-button"
          aria-label="Usar impulso"
          disabled={!own || own.dashCooldown > 0 || own.respawnIn > 0}
          onPointerDown={(event) => {
            event.preventDefault();
            gameControls.dash();
          }}
        >
          <Zap size={22} />
          <span>{own && own.dashCooldown > 0 ? Math.ceil(own.dashCooldown) : "IMPULSO"}</span>
        </button>
        <button
          type="button"
          className="fire-button"
          aria-label="Disparar pulso"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            gameControls.setFiring(true);
          }}
          onPointerUp={() => gameControls.setFiring(false)}
          onPointerCancel={() => gameControls.setFiring(false)}
          onLostPointerCapture={() => gameControls.setFiring(false)}
        >
          <Crosshair size={28} />
          <span>PULSO</span>
        </button>
      </div>
    </div>
  );
}

function Scoreboard({ snapshot, playerId }: { snapshot: GameSnapshot; playerId: string }) {
  const ranking = [...snapshot.players].sort((a, b) => b.score - a.score || b.kills - a.kills).slice(0, 5);
  return (
    <div className="scoreboard glass">
      <div className="scoreboard-title"><Trophy size={14} /> PONTOS</div>
      {ranking.map((player, index) => (
        <div className={`score-row ${player.id === playerId ? "is-own" : ""}`} key={player.id}>
          <span className="rank">{index + 1}</span>
          <span className="score-dot" style={{ background: player.color }} />
          <span className="score-name">{player.name}</span>
          <strong>{player.score}</strong>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setVersion] = useState(0);
  const [name, setName] = useState(() => storage.get("playerName", "Jogador"));
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("sala")?.toUpperCase() ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(false);

  const snapshot = multiplayer.snapshot;
  const phase = snapshot?.phase ?? "home";
  const playerId = multiplayer.playerId;
  const own = snapshot?.players.find((player) => player.id === playerId);
  const isHost = Boolean(snapshot && snapshot.hostId === playerId);

  const winnersQuery = trpc.stats.recentWinners.useQuery(undefined, {
    enabled: phase === "results",
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const unsubscribe = multiplayer.subscribe(() => setVersion((version) => version + 1));
    const canvas = canvasRef.current;
    if (canvas) startGame(canvas);
    setMuted(gameControls.isMuted());
    return () => {
      unsubscribe();
      stopGame();
    };
  }, []);

  const run = async (label: string, action: () => Promise<RoomAck>) => {
    if (busy) return;
    setBusy(label);
    setError("");
    storage.set("playerName", name.trim() || "Jogador");
    const result = await action();
    if (!result.ok) setError(result.error ?? "Não foi possível concluir a ação.");
    setBusy(null);
  };

  const quickMatch = () => run("quick", () => multiplayer.quickMatch(name.trim() || "Jogador"));
  const createRoom = () => run("create", () => multiplayer.createRoom(name.trim() || "Jogador"));
  const joinRoom = () => run("join", () => multiplayer.joinRoom(name.trim() || "Jogador", code));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing || event.repeat) return;
      if (event.code === "Space" && !multiplayer.snapshot) {
        event.preventDefault();
        void quickMatch();
      }
      if ((event.code === "Escape" || event.code === "KeyP") && multiplayer.snapshot?.hostId === multiplayer.playerId) {
        if (multiplayer.snapshot.phase === "playing" || multiplayer.snapshot.phase === "paused") multiplayer.pause();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [name, busy]);

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    void joinRoom();
  };

  const copyInvite = async () => {
    if (!snapshot) return;
    const invite = `${window.location.origin}${window.location.pathname}?sala=${snapshot.code}`;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(`Código da sala: ${snapshot.code}`);
    }
  };

  const leave = () => {
    multiplayer.leave();
    setError("");
    setBusy(null);
  };

  const ranking = snapshot ? [...snapshot.players].sort((a, b) => b.score - a.score || b.kills - a.kills) : [];

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} />
      <div id="ui-overlay">
        <header className="topbar">
          <div className="mini-brand"><span className="brand-mark" /> CIRCUIT CLASH</div>
          <div className="topbar-actions">
            <span className={`connection-dot ${multiplayer.connected ? "online" : ""}`}>
              {multiplayer.connected ? "ONLINE" : "CONECTANDO"}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={muted ? "Ativar som" : "Silenciar"}
              onClick={() => setMuted(gameControls.toggleMute())}
            >
              {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
          </div>
        </header>

        {phase === "home" && (
          <main className="home-layout">
            <section className="home-card glass-strong">
              <div className="eyebrow"><span /> MULTIPLAYER EM TEMPO REAL</div>
              <h1>CIRCUIT<br /><em>CLASH</em></h1>
              <p className="home-subtitle">Colete energia. Supere seus rivais.<br />Domine a arena antes que ela feche.</p>
              <label className="field-label" htmlFor="player-name">SEU NOME</label>
              <input
                id="player-name"
                className="text-input"
                value={name}
                maxLength={16}
                autoComplete="nickname"
                onChange={(event) => setName(event.target.value)}
                placeholder="Como quer ser chamado?"
              />
              <button type="button" className="primary-button" disabled={Boolean(busy) || !multiplayer.connected} onClick={() => void quickMatch()}>
                <Play size={19} fill="currentColor" />
                {busy === "quick" ? "PREPARANDO ARENA…" : "JOGO RÁPIDO COM BOTS"}
                <span className="keycap">ESPAÇO</span>
              </button>
              <div className="split-actions">
                <button type="button" className="secondary-button" disabled={Boolean(busy) || !multiplayer.connected} onClick={() => void createRoom()}>
                  <Users size={18} /> {busy === "create" ? "CRIANDO…" : "CRIAR SALA"}
                </button>
                <form className="join-form" onSubmit={submitJoin}>
                  <input
                    aria-label="Código da sala"
                    className="code-input"
                    value={code}
                    maxLength={4}
                    placeholder="CÓDIGO"
                    onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  />
                  <button type="submit" className="join-button" disabled={Boolean(busy) || code.length !== 4 || !multiplayer.connected}>
                    {busy === "join" ? "…" : "ENTRAR"}
                  </button>
                </form>
              </div>
              {error && <div className="error-message" role="alert">{error}</div>}
              <p className="privacy-note">Sem login. Sem instalação. Até 8 jogadores por sala.</p>
            </section>

            <aside className="how-to-play">
              <div className="section-label">COMO JOGAR</div>
              <div className="rule-card glass">
                <div className="rule-icon yellow"><Zap size={20} /></div>
                <div><strong>Colete núcleos</strong><span>Cada núcleo vale 15 pontos e recupera vida.</span></div>
              </div>
              <div className="rule-card glass">
                <div className="rule-icon pink"><Crosshair size={20} /></div>
                <div><strong>Acerte seus rivais</strong><span>Um abate vale 100 pontos. Todos reaparecem.</span></div>
              </div>
              <div className="rule-card glass">
                <div className="rule-icon violet"><Shield size={20} /></div>
                <div><strong>Use os power-ups</strong><span>Escudo, velocidade e disparo rápido por 9 segundos.</span></div>
              </div>
              <div className="controls-card glass">
                <span><b>WASD</b> mover</span><span><b>MOUSE / ESPAÇO</b> disparar</span><span><b>SHIFT</b> impulso</span>
              </div>
            </aside>
          </main>
        )}

        {phase === "lobby" && snapshot && (
          <main className="modal-wrap">
            <section className="lobby-card glass-strong">
              <div className="eyebrow"><span /> SALA PRONTA</div>
              <h2>CHAME SEU ESQUADRÃO</h2>
              <p>Compartilhe o convite. O anfitrião inicia quando todos estiverem prontos.</p>
              <button type="button" className="room-code" onClick={() => void copyInvite()} aria-label="Copiar convite da sala">
                <span>{snapshot.code}</span>
                <small>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "COPIADO" : "COPIAR CONVITE"}</small>
              </button>
              <div className="lobby-heading"><span>JOGADORES</span><b>{snapshot.players.length}/{MAX_PLAYERS}</b></div>
              <div className="player-list">
                {[...snapshot.players].sort((a, b) => Number(a.isBot) - Number(b.isBot)).map((player) => (
                  <div className="lobby-player" key={player.id}>
                    <span className="player-avatar" style={{ borderColor: player.color, color: player.color }}>{player.name.slice(0, 1).toUpperCase()}</span>
                    <strong>{player.name}{player.id === playerId ? " (você)" : ""}</strong>
                    {player.id === snapshot.hostId && <span className="host-tag">ANFITRIÃO</span>}
                    {player.isBot && <Bot size={16} />}
                    {!player.connected && <span className="offline-tag">OFFLINE</span>}
                  </div>
                ))}
              </div>
              {error && <div className="error-message" role="alert">{error}</div>}
              <div className="lobby-actions">
                {isHost && (
                  <>
                    <button type="button" className="secondary-button" disabled={snapshot.players.length >= MAX_PLAYERS || Boolean(busy)} onClick={() => void run("bot", () => multiplayer.addBot())}>
                      <Bot size={18} /> ADICIONAR BOT
                    </button>
                    <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void run("start", () => multiplayer.startMatch())}>
                      <Play size={18} fill="currentColor" /> {busy === "start" ? "INICIANDO…" : "INICIAR PARTIDA"}
                    </button>
                  </>
                )}
                {!isHost && <div className="waiting-host"><span className="pulse-dot" /> AGUARDANDO O ANFITRIÃO</div>}
              </div>
              <button type="button" className="text-button" onClick={leave}><LogOut size={15} /> SAIR DA SALA</button>
            </section>
          </main>
        )}

        {(phase === "playing" || phase === "countdown" || phase === "paused") && snapshot && (
          <>
            <div className="hud-left glass">
              <div className="hud-name"><span style={{ background: own?.color }} />{own?.name ?? "Jogador"}</div>
              <div className="health-track"><div style={{ width: `${own?.hp ?? 0}%` }} /></div>
              <div className="hud-stats"><span>VIDA <b>{Math.ceil(own?.hp ?? 0)}</b></span><span>PONTOS <b>{own?.score ?? 0}</b></span></div>
              {own?.powerup && <div className="active-powerup"><Zap size={13} /> {powerupName(own.powerup)} · {Math.ceil(own.powerupTime)}s</div>}
            </div>
            <div className="match-clock glass">
              <small>{snapshot.remaining <= 45 ? "ARENA FECHANDO" : "TEMPO"}</small>
              <strong className={snapshot.remaining <= 45 ? "danger" : ""}>{formatTime(snapshot.remaining)}</strong>
            </div>
            {isHost && (phase === "playing" || phase === "paused") && (
              <button type="button" className="pause-button glass" onClick={() => multiplayer.pause()} aria-label={phase === "paused" ? "Continuar partida" : "Pausar partida"}>
                {phase === "paused" ? <Play size={17} /> : <Pause size={17} />}
              </button>
            )}
            <Scoreboard snapshot={snapshot} playerId={playerId} />
            <div className="desktop-hint">WASD MOVER · MOUSE / ESPAÇO DISPARAR · SHIFT IMPULSO{isHost ? " · P PAUSAR" : ""}</div>
            {phase === "playing" && <TouchControls own={own} />}
            {own && own.respawnIn > 0 && phase === "playing" && (
              <div className="respawn-message"><small>CIRCUITO INTERROMPIDO</small><strong>{own.respawnIn.toFixed(1)}</strong><span>Reentrando na arena…</span></div>
            )}
          </>
        )}

        {phase === "countdown" && snapshot && (
          <div className="countdown"><small>PREPARE-SE</small><strong>{Math.max(1, Math.ceil(snapshot.countdown))}</strong></div>
        )}

        {phase === "paused" && (
          <div className="modal-wrap pause-overlay">
            <section className="pause-card glass-strong">
              <Pause size={30} />
              <h2>PARTIDA PAUSADA</h2>
              <p>{isHost ? "A arena está congelada para todos." : "O anfitrião pausou a arena."}</p>
              {isHost && <button type="button" className="primary-button" onClick={() => multiplayer.pause()}><Play size={18} /> CONTINUAR</button>}
            </section>
          </div>
        )}

        {phase === "results" && snapshot && (
          <main className="modal-wrap results-wrap">
            <section className="results-card glass-strong">
              <div className="winner-icon"><Trophy size={28} /></div>
              <div className="eyebrow">FIM DA PARTIDA</div>
              <h2>{ranking[0]?.id === playerId ? "VOCÊ DOMINOU A ARENA" : `${ranking[0]?.name ?? "Jogador"} VENCEU`}</h2>
              <div className="results-list">
                {ranking.map((player, index) => (
                  <div className={`result-row ${player.id === playerId ? "is-own" : ""}`} key={player.id}>
                    <span className="result-rank">{index + 1}</span>
                    <span className="score-dot" style={{ background: player.color }} />
                    <strong>{player.name}</strong>
                    <span>{player.kills} abates</span>
                    <b>{player.score} pts</b>
                  </div>
                ))}
              </div>
              <div className="results-actions">
                {isHost && <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void run("rematch", () => multiplayer.startMatch())}><Play size={18} /> REVANCHE</button>}
                {!isHost && <div className="waiting-host"><span className="pulse-dot" /> AGUARDANDO REVANCHE</div>}
                <button type="button" className="secondary-button" onClick={leave}><LogOut size={17} /> VOLTAR AO INÍCIO</button>
              </div>
              {winnersQuery.data && winnersQuery.data.length > 0 && (
                <div className="recent-winners">
                  <div className="section-label">VITÓRIAS RECENTES</div>
                  {winnersQuery.data.slice(0, 3).map((winner) => (
                    <div key={winner.id}><span>{winner.playerName}</span><b>{winner.score} pts · sala {winner.roomCode}</b></div>
                  ))}
                </div>
              )}
              {error && <div className="error-message" role="alert">{error}</div>}
            </section>
          </main>
        )}

        {multiplayer.connectionMessage && <div className="connection-toast">{multiplayer.connectionMessage}</div>}
      </div>
    </div>
  );
}
