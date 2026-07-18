# P2P Multiplayer Plan

Goal: make the existing PeerJS lobby actually playable online with minimal, host-authoritative sync.

## Current State

- PeerJS connection, host, join, room code, ready, party chat already exist in `js/network.js`.
- UI has host/join/start/lobby controls.
- Ball and score sync message types exist but are incomplete.
- `Game.updateRemotePlayer()` and `Game.remoteAttack()` are empty, so joined players do not become playable entities.

## Architecture

- Host is the authority for game state, ball physics, bots, score, hits, deaths, round start, and round end.
- Clients send local player position and attack input to host.
- Host broadcasts ball, score, lobby, remote player, hit, and round state.
- Clients render host state and do not run authoritative ball/hit logic.

## Message Types

- `welcome`: host sends initial lobby/game snapshot to joining client.
- `lobbyState`: host broadcasts players, teams, bots, mode, map, and settings.
- `gameStart`: host starts match and tells clients to enter game.
- `position`: every peer sends local position, yaw, alive, and team.
- `attack`: client sends attack intent to host.
- `ballState`: host broadcasts ball position/velocity/speed/active/state.
- `scoreUpdate`: host broadcasts score/time/round/player stats.
- `playerHit`: host broadcasts hit/death result for UI sync.
- `roundStart`: host broadcasts round restart.
- `roundEnd`: host broadcasts team winner and score.

## Implementation Steps

1. Add `Game.remotePlayers` map and simple remote player entities.
2. Make `updateRemotePlayer(peerId, data)` create/update remote entities.
3. Make `remoteAttack(peerId, data)` let host deflect from remote entity.
4. Send local position at 20 Hz from `main.js`.
5. Broadcast host ball/score/player state at 15-20 Hz.
6. Make host start button broadcast `gameStart`; clients start from network message.
7. Sync lobby players when users join, switch teams, add/remove bots, change settings.
8. Keep bots host-only; clients render synced entities.
9. Validate with two local tabs, then Render URL.

## Render Notes

- Deploy as Render Web Service.
- Root Directory: `dodgb` if repo contains project in `dodgb/`.
- Build Command: `npm install` or `echo ok`.
- Start Command: `npm start` or `node server.js`.
- `server.js` uses `process.env.PORT || 8000`.
