# VOLLE

**3D First-Person Dodgeball — fast, cartoonish, free, and playable right in your browser.**

VOLLE is a competitive browser-based dodgeball game built with Three.js and vanilla JavaScript. It pairs TF2-inspired cartoonish visuals with deep skill mechanics: charged shots, deflected returns, homing balls, and character abilities. No downloads, no installs — just open the browser and play.

> ## ▶ [Play the live demo](https://volle.onrender.com/)

---

## Highlights

- **First-person dodgeball combat** — throw, catch, charge, and deflect with a physics-driven ball model and momentum-based movement (sprint, dash, wall jump, stamina).
- **Real multiplayer** — peer-to-peer matches over WebRTC (PeerJS) with host migration, late join, spectator mode, replays, and push-to-talk voice.
- **18 hand-crafted arenas** — varied maps, skyboxes, weather, portal mechanics, and open-sided environments, plus an in-game map editor and community-created maps.
- **Game modes** — Free-for-all, team modes, goal mode, rally duel, hot potato, competitive/ranked, and tournaments.
- **Deep progression** — XP, coins, battle pass, achievements, prestige, daily contracts, ranked leaderboards, and match history.
- **Cosmetics** — unlockable characters, ball skins, CS-style loot cases, an avatar painter, and full loadout customization.
- **Playable with bots** — practice against AI opponents across multiple difficulty levels, or jump into solo drills (guided deflect, perfect deflect, movement trials).
- **Polish** — juice effects, hit feedback, shader finishers, procedural textures, crosshair customization, and an in-game console.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Rendering | [Three.js](https://threejs.org/) (vendored, no build step), GLTF models, GLSL shaders |
| Game code | Vanilla JavaScript ES modules |
| Multiplayer | PeerJS / WebRTC peer-to-peer, Node.js signaling |
| Server | [Node.js](https://nodejs.org/) `>= 18` — accounts, profiles, economy, telemetry |
| Frontend | Plain HTML/CSS/JS — progressive web app (PWA) with service worker |
| Tests | Node's built-in test runner (`node --test`) |

## Getting Started

Runtime dependencies are vendored in `vendor/` — no `npm install` required.

```bash
git clone https://github.com/SherlockFP/VOLLE.git
cd VOLLE
npm start
```

Open [http://localhost:8000](http://localhost:8000).

### Scripts

| Command | Description |
| --- | --- |
| `npm start` | Run the game server (`server.js`, port 8000) |
| `npm test` | Run the test suite (`node --test`) |
| `npm run check` | Static sanity-check of JS files (`scripts/check-js.js`) |

## Project Structure

```
├── index.html            # Game entry point
├── server.js             # Node.js game server (accounts, economy, signaling)
├── server/               # Server modules: profiles, payments, telemetry, live market
├── js/                   # Client game code: ball, player, arena, combat, UI, netcode
├── css/                  # UI styling and design tokens
├── assets/               # 3D models, textures, generated art (licenses below)
├── vendor/               # Vendored runtime libraries (three.js, peerjs)
├── tests/                # 128 test files across gameplay, netcode, and economy
├── docs/                 # Wiki, plans, and design docs
└── design-system/        # Design system reference
```

## Testing

The project ships a broad test suite runnable with `node --test`, covering ball physics, combat feel, netcode, lobby lifecycle, economy/balance, and UI systems.

```bash
npm test
```

## Assets & Licensing

- [Kenney](https://kenney.nl/) assets — CC0 (public domain).
- Sketchfab models — CC-BY, with full attribution in [`assets/cc-by/sketchfab/ATTRIBUTION.md`](assets/cc-by/sketchfab/ATTRIBUTION.md).
- AI-generated art (characters, cases, skyboxes) — see `assets/cc0/ASSET_MANIFEST.md` and `assets/generated/`.

## Documentation

- [Wiki index](docs/wiki/Index.md) — gameplay systems, ball physics, arenas, and progression
- [Master plan](docs/V4_MASTER_PLAN.md) — architecture and roadmap
- [Dev log](docs/wiki/2BALL_Development_Log.md) — development history
