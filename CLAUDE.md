# 2BALL Project

## IMPORTANT: Read This First
Before working on this project, ALWAYS read `docs/wiki/2BALL_Development_Log.md` — it contains the full development history, all features, bug fixes, and current state of the game.

## Quick Reference
- **Game**: 2BALL — 3D First-Person Dodgeball (Three.js, vanilla JS)
- **Server**: `node server.js` on port 8000
- **Dev Log**: `docs/wiki/2BALL_Development_Log.md`
- **Graphify**: Run `/graphify` to analyze the codebase knowledge graph

## Key Files
- `js/ball.js` — Ball physics, homing, momentum, skins
- `js/player.js` — Movement, sprint, dash, wall jump, stamina
- `js/game.js` — Game loop, states, combat, celebration, spectate
- `js/arena.js` — 18 maps, walls, ceiling, props
- `js/console.js` — Console commands with autocomplete
- `js/ui.js` — HUD, scoreboard, settings, damage numbers
- `js/gamemodes.js` — Game modes including FFA
- `js/skills.js` — Skills + runes system
- `js/scoreboard.js` — Score tracking (no negative scores)
