# MIMO.md — 2BALL Project Current State

> **Last updated:** 2026-07-19
> **Status:** Active development. Phase 1 (7/7) complete, Phase 2-4 pending.
> **Tech Stack:** Three.js + PeerJS + vanilla JS (ES modules), browser-based 3D dodgeball.

---

## What Is This?

Warrball is a 3D first-person ball combat game with esport aspirations. Browser-based, no install needed. P2P multiplayer via PeerJS, class abilities, ranked ELO, tournament bracket, daily challenges, replay system, and more.

**Run:** `node server.js` → open `http://localhost:8000`

---

## Phase 1 — UI Foundation & Hardening ✅

- **Themes:** `dark` and `soft-spectrum`, persisted through `Store`.
- **UI scale:** 80%–120%, applied immediately through `--ui-scale` and persisted.
- **Unified settings:** one modal with Controls, Video, Game, and Accessibility tabs; compact-height content scrolls inside the modal.
- **Accessibility:** keyboard focus ring, reduced-motion mode, and high-contrast token overrides.
- **Scoreboard:** hostile player names render through `textContent`; deterministic bot levels; full-viewport centered hold-Tab overlay; release/conflicting surfaces hide it; overflowing rows scroll inside the shell.
- **Console authority:** shared-state commands are marked `hostOnly`; connected clients receive `Host only command: <command>` before mutation. Offline/host execution remains allowed. Help/autocomplete show `[HOST]`.
- **Verification:** `node --test tests/ui-foundation.test.mjs` → **21/21 passed**; `npm test` → **129/129 passed**; `npm run check` → **48 JavaScript files syntax-valid**. Responsive browser matrix passed at 1280×720, 1366×768, 1920×1080, and 2560×1080. Social Hub texture smoke load passed with non-zero transfers for all six restored texture paths. Map carousel tooltips no longer emit `[object Object]`. The document declares an inline favicon, eliminating the browser's `/favicon.ico` 404 probe.

Key files: `js/ui-theme.js`, `js/settings-controller.js`, `css/ui-tokens.css`, `css/ui-shell.css`, `tests/ui-foundation.test.mjs`.

---

## Completed Features (Commits)

### Phase 1 — Esport Core ✅

| # | Feature | Commit | Files Changed |
|---|---------|--------|---------------|
| 1 | **Enhanced Kill Cam** — 2-second lookback replay buffer, red pulsing border overlay | `e0887a9` | `js/game.js`, `js/ui.js`, `css/style.css`, `index.html` |
| 2 | **Kill Feed UI** — Right-side feed with auto-fade (5s), XSS-safe escaping | `8f759f9` | `js/ui.js`, `css/style.css`, `js/game.js` |
| 3 | **Combo Display** — Centered overlay with escalating labels (DOUBLE! → GODLIKE!) | `e76167c` | `js/ui.js`, `css/style.css`, `js/game.js` |
| 4 | **Match History System** — localStorage persistence, wins/losses/kills/deaths/damage stats | `78881fb` | `js/matchhistory.js` (NEW) |
| 5 | **Player Profile Screen** — Rank display, ELO progress bar, 6-stat grid | `dfdad66` | `index.html`, `js/ui.js`, `css/style.css` |
| 6 | **New Maps** — Dojo (🥋), Colosseum (🏛️), Volcano (🌋) with unique themes | `b13700e` | `js/arena.js` |
| 7 | **Portal Mechanic** — Two portals per map, auto-swap every 30s, +20% speed boost | `b13700e` | `js/arena.js`, `js/ball.js`, `js/game.js` |

### Phase 0 — Base Game (Before MiMo Sessions)

| Feature | Status | Notes |
|---------|--------|-------|
| 4 Maps (Beach, Factory, Space, Neon) | ✅ | `js/arena.js` MAPS object |
| Bot AI (easy/medium/hard) | ✅ | `js/bot.js` |
| P2P Multiplayer (PeerJS) | ✅ | `js/network.js` |
| HP/Shield/Stamina | ✅ | `js/player.js`, `js/bot.js` |
| Store (currency/xp/level) | ✅ | `js/store.js` |
| Minimap | ✅ | Canvas-based in `js/game.js` |
| Chat | ✅ | DOM-based in `js/ui.js` |
| Scoreboard | ✅ | `js/scoreboard.js` |
| Toon Shader + Outline | ✅ | `js/shaders/` |
| Ball Physics (spike/lob/flat) | ✅ | `js/ball.js` |
| 7 Characters | ✅ | `js/characters.js` — rally, tank, scout, sniper, guardian, blazer, frost |
| 8 Skills (Q key) | ✅ | `js/skills.js` — slow, freeze, burn, shield, smash, heal, teleport, blackhole |
| 8 Passive Runes | ✅ | `js/skills.js` — hp, dmg resist, deflect, speed, stam regen, CDR, lifesteal, thorns |
| Ranked ELO System | ✅ | `js/ranked.js` — Bronze→Grandmaster |
| Tournament Bracket | ✅ | `js/tournament.js` — single-elimination |
| Daily Challenges | ✅ | `js/daily.js` — 3 per day, deterministic seed |
| Replay System | ✅ | `js/replay.js` — record/playback events |
| Leaderboard | ✅ | `js/leaderboard.js` — fake AI opponents |
| Weather (rain/snow/storm) | ✅ | `js/weather.js` |
| Emotes (12) | ✅ | `js/emotes.js` |
| Affixes (map modifiers) | ✅ | `js/affixes.js` — fire, wobbly, straight, gravity, mega, shrink |
| Juice (hit-stop, shake, slow-mo) | ✅ | `js/juice.js` |
| Avatar Painting | ✅ | `js/avatar.js` |
| Voice Chat (WebRTC) | ✅ | `js/voice.js` |
| Spectator Mode | ✅ | `js/spectator.js` |
| Tutorial | ✅ | `js/tutorial.js` |
| Achievements | ✅ | `js/achievements.js` |
| Console Commands | ✅ | `js/console.js` |

---

## Pending Features (Phase 2-4)

### Phase 2 — Content (Not Started)

| # | Feature | Target File | Complexity |
|---|---------|-------------|------------|
| 8 | Ball Skins System (7 skins) | `js/ball.js` | Low |
| 9 | Extended Ball Skins (5 more) | `js/ball.js` | Low |
| 10 | Ice Map (slippery floor) | `js/arena.js`, `js/player.js` | Medium |
| 11 | Cloud Map (low gravity) | `js/arena.js`, `js/player.js` | Medium |
| 12 | Jungle Map (water hazard) | `js/arena.js`, `js/game.js` | Medium |

### Phase 3 — UI/Meta (Not Started)

| # | Feature | Target File | Complexity |
|---|---------|-------------|------------|
| 13 | Battlepass System (50 tiers) | `js/store.js`, `js/ui.js` | High |
| 14 | Enhanced Shop UI (tabs) | `js/ui.js` | Medium |
| 15 | Practice Range Mode | `js/game.js`, `js/gamemodes.js` | Medium |
| 16 | Map Ban UI Enhancement | `js/ui.js` | Low |

### Phase 4 — Optional (Not Started)

| # | Feature | Target File | Complexity |
|---|---------|-------------|------------|
| 17 | Achievement System Enhancement (10 new) | `js/achievements.js` | Low |
| 18 | Voice Chat Enhancement (PTT indicator) | `js/voice.js` | Low |
| 19 | Performance Optimization (object pooling) | `js/game.js` | Medium |

---

## File Structure

```
dodgb/
├── index.html              — UI screens (menu, lobby, profile, etc.)
├── MIMO.md                 — This file (current state for other AIs)
├── CLAUDE.md               — Quick reference
├── PLAN.md                 — Full feature plan (19 tasks, 4 phases)
├── package.json            — Node.js config
├── server.js               — Static file server (port 8000)
├── css/
│   └── style.css           — All styles
├── js/
│   ├── main.js             — Bootstrap
│   ├── game.js             — Game loop, states, combat (~3200 lines)
│   ├── player.js           — FPS controller + stats (~586 lines)
│   ├── bot.js              — AI
│   ├── ball.js             — Ball physics, skins, portal collision
│   ├── arena.js            — Maps, walls, props, portal rendering
│   ├── renderer.js         — Three.js setup
│   ├── ui.js               — HUD, menus, profile, shop, combo, kill feed
│   ├── network.js          — P2P via PeerJS
│   ├── scoreboard.js       — Score tracking
│   ├── audio.js            — SFX
│   ├── store.js            — Meta progression (currency/xp/level)
│   ├── characters.js       — 7 character definitions + stats
│   ├── skills.js           — 8 skills + 8 runes
│   ├── matchhistory.js     — Match history + stats (NEW)
│   ├── ranked.js           — ELO system
│   ├── tournament.js       — Bracket system
│   ├── daily.js            — Daily challenges
│   ├── replay.js           — Record/playback
│   ├── leaderboard.js      — Fake AI leaderboard
│   ├── weather.js          — Rain/snow/storm
│   ├── emotes.js           — 12 emotes
│   ├── affixes.js          — Map modifiers
│   ├── juice.js            — Game feel (hit-stop, shake, combo)
│   ├── avatar.js           — Avatar painting
│   ├── voice.js            — WebRTC voice chat
│   ├── spectator.js        — Spectator mode
│   ├── tutorial.js         — Tutorial
│   ├── achievements.js     — Achievement system
│   ├── console.js          — Console commands
│   └── shaders/            — Toon shader (vert + frag)
├── models/                 — 3D models
├── music/                  — Background music
├── sfx/                    — Sound effects
├── docs/
│   ├── P2P_PLAN.md
│   └── wiki/               — Development log, system docs
└── graphify-out/           — Code analysis (run /graphify to update)
```

---

## How to Work on This

### Rules (Ponytail)
- **YAGNI**: Don't add features not in the plan
- **Reuse**: Check existing code before writing new
- **Minimal diff**: Smallest change that works
- **Self-check**: Each module has `if (debug)` assertions
- **No new deps**: Three.js + vanilla JS only
- **ponytail: comments**: Mark deliberate simplifications

### Adding a New Map
1. Add entry to `MAPS` object in `js/arena.js`
2. Set: `name`, `emoji`, `floor/wall/ceiling` colors, `skyTop/Bottom`, `fog`, `ambient`, `size`, `props`, `weather`
3. Optionally add `slippery`, `lowGravity`, or `waterZones` for special mechanics

### Adding a New Character
1. Add entry to `CHARACTERS` object in `js/characters.js`
2. Set: `id`, `name`, `emoji`, `maxHp`, `speed`, `deflectPower`, `staminaMax`, `passive`, `desc`, `color`, `price`
3. Passive must be handled in `calcDamage()` or player update

### Adding a New Skill
1. Add entry to `SKILLS` object in `js/skills.js`
2. Add case in `useSkill()` switch statement
3. Add cooldown handling (already automatic via `tickSkillCooldowns`)

### Adding a New Rune
1. Add entry to `RUNES` object in `js/skills.js`
2. Add case in `applyRunes()` switch statement
3. Rune bonus name must match `runeBonuses` property

---

## Known Issues

- `graphify-out/` is stale (last run before recent commits). Run `/graphify` to update.
- `PLAN.md` contains both completed and pending items — check this file (MIMO.md) for current status.
- Automated Node tests are available via `npm test`; Phase 1 UI coverage lives in `tests/ui-foundation.test.mjs`.
- PeerJS P2P requires both peers to be on same network or use a signaling server.

## July 2026 Polish Pass

- Unified menu, lobby, Social Hub, shop, progression, career, and patch notes around a turquoise/light-blue visual system.
- Social Hub activity portals removed; map view, presence, chat, practice area, and solid prop collision retained.
- Added Source-style bunnyhop feedback, Ctrl+Space+W longjump, speed HUD, landing distance notifications, and crosshair share codes.
- Added lobby map previews, expanded progression/career presentation, generated shop roster artwork, and `By Sherlock` patch notes.
- Reduced authoritative background simulation from 128Hz to 60Hz; ball sync is 30Hz and bot sync is 10Hz.
- Replacement Social Hub map remains pending the user-provided source link.
- Public launch still needs production signaling/TURN configuration and multi-peer soak testing.

## Competitive Rules Pass

- Team score is integer round score only; damage and kills remain personal stats.
- Classic HP/elimination is now the default instead of Instagib.
- A round ends only when a complete team is eliminated.
- Celebration weapons and HUD are winner-only.
- Dead players receive smoothed first-person POV restricted to living teammates.
- Emote wheel is centered, translucent, keyboard-accessible, and reduced-motion safe.
- Every arena gets dedicated spectator stands.
- Space arena includes planets, starfield, and map-specific low gravity.

## Cosmetics and Mega Arena Pass

- Added deterministic first-touch opening-ball ownership announcements.
- Added `Mega Pinball Complex`, roughly 10x standard arena dimensions, with 12 resettable breakable glass targets.
- Added Pinball mode and target-chain chat feedback.
- Added an original animated knife viewmodel that remains cosmetic.
- Added bounded knife catalog, Kickoff Case, weighted secure drop roll, duplicate conversion, and team-restricted equipment.
- Added Shop Cases and Inventory tabs with red/blue loadouts.
- Upgraded free Red Current and Blue Current Minecraft-style team atlases.
- Generated original Kickoff Case artwork at `assets/generated/volle-kickoff-case.webp`.

## Momentum Season

- Added persistent Launch Season contracts for matches, wins, deflects, longjump distance, and rocket jumps.
- Added Surf Line, Bhop Sprint, and Rocket Circuit time trials with first-clear rewards.
- Added 10 Hz personal-best ghost paths and an in-game trial HUD.
- Added automatic replay highlight clips for rallies, eliminations, and rocket jumps.
- Added a transparent case pity counter with an Epic+ guarantee on the tenth opening.

---

## For Other AIs

When working on this project:
1. **Read this file first** — it tells you what's done and what's not
2. **Read PLAN.md** — it has the full feature specs
3. **Read CLAUDE.md** — quick reference for key files
4. **Check git log** — `git log --oneline -10` for recent changes
5. **Follow Ponytail** — shortest working diff, reuse existing patterns
6. **Self-check** — add `console.assert` in debug mode for new features

---

*Generated by MiMoCode (mimo-auto). Run `/graphify` to update code analysis.*
