# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-10-30

### Adicionado
- Primeira versão publicada do Circuit Clash.
- Modo local (`VITE_LOCAL_MODE=1`): a simulação `GameRoom` roda no navegador para hospedagem estática (Vercel).
- `vercel.json` e script `build:vercel` (front estático, sem funções serverless).
- Testes Vitest para `GameRoom` (`api/game/room.test.ts`).

### Corrigido
- `package-lock.json` apontava para um mirror npm privado inacessível; URLs trocadas para `registry.npmjs.org`.
- `window.__gameProbe` expunha a posição vertical em `y` com `z = 0`, então o smoke test nunca detectava movimento; agora `z` recebe a coordenada vertical da arena.
- `scripts/verify-game.mjs` testava as teclas durante a contagem regressiva de 3 s; agora espera a partida começar.
- `Dockerfile` copiava `.env` para a imagem; removido (use variáveis de ambiente).
