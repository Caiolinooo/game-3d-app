# Circuit Clash

Arena 2D multiplayer em tempo real para 1–8 jogadores, com salas privadas de quatro caracteres e entrada sem login. Partidas duram 3 minutos; núcleos valem 15 pontos e abates valem 100. Nos últimos 45 segundos, a arena fecha e causa dano fora do círculo seguro.

## Testar online

Acesse **[game-3d-app.vercel.app](https://game-3d-app.vercel.app)** para jogar direto no navegador, sem instalar nada. Nessa versão funciona o **Jogo rápido** contra bots. O multiplayer entre dispositivos e o histórico de vitórias precisam do servidor Node com MySQL (veja abaixo).

## Como jogar

- **Desktop:** WASD ou setas para mover, mouse ou Espaço para disparar, Shift para impulso e P/Esc para o anfitrião pausar.
- **Celular:** joystick esquerdo para mover, botão Pulso para disparar com mira automática e botão Impulso para dash.
- **Power-ups:** disparo rápido, escudo e velocidade duram 9 segundos.
- **Jogo rápido:** cria uma sala com três bots. Para jogar com outras pessoas, crie uma sala e compartilhe o convite antes de iniciar.

## Executar

```bash
npm install
npm run db:push
npm run dev
```

Para produção:

```bash
npm run check
npm run build
npm start
```

O servidor usa porta 3000. A partida é simulada no servidor a 30 Hz e transmitida aos clientes a 15 Hz com Socket.IO, reconexão automática e fallback de transporte. Resultados são persistidos em MySQL via Drizzle; o estado ativo das salas fica em memória e expira quando todos saem.

## Deploy na Vercel (plano Hobby, custo zero)

A Vercel não mantém um servidor Node persistente nem WebSockets do Socket.IO, então o deploy na Vercel é **somente o front estático em modo local** (`VITE_LOCAL_MODE=1`, script `npm run build:vercel`, configurado em `vercel.json`).

No modo local, a mesma simulação do servidor (`api/game/room.ts`) roda no navegador:

- Funciona: Jogo rápido com 3 bots, criar sala e adicionar bots, pausa, power-ups, arena que fecha, resultados.
- Não funciona na Vercel: entrar em sala de outro jogador / multijogador entre aparelhos (precisa do Socket.IO), ranking "vencedores recentes" e gravação de partidas (precisam da API tRPC + MySQL).

Para o jogo completo (multijogador + MySQL), rode `npm run build && npm start` em um host com processo Node persistente (Docker: `Dockerfile`), com `DATABASE_URL`, `APP_ID` e `APP_SECRET` definidos como variáveis de ambiente (veja `.env.example`). Nunca commite `.env`.

## Testes

```bash
npm run check   # TypeScript
npm test        # Vitest (api/**/*.test.ts)
VITE_LOCAL_MODE=1 npm run build && npm run verify   # smoke test Playwright
```
