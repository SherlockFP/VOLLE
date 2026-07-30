# MIMO.md — 2BALL Project Current State

> **Last updated:** 2026-07-30
> **Status:** Active development. Account system complete; Phase 1-3 done; V4 immersive/economy/combat pass complete (see below); Phase 4 backlog pending.
> **Tech Stack:** Three.js + PeerJS + vanilla JS (ES modules), browser-based 3D dodgeball.

---

## What Is This?

Warrball is a 3D first-person ball combat game with esport aspirations. Browser-based, no install needed. P2P multiplayer via PeerJS, class abilities, ranked ELO, tournament bracket, daily challenges, replay system, and more.

**Run:** `node server.js` → open `http://localhost:8000`

---

## Phase 1 — UI Foundation & Hardening ✅

- **Themes:** `dark`, `soft-spectrum`, `ember`, `violet-surge`, `verdant`, `crimson-court` — persisted through `Store`, locked by `tests/ui-theme-catalog.test.mjs`.
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

### Phase 3 — Accounts & Social (In Progress)

| # | Feature | Target File | Status |
|---|---------|-------------|--------|
| 20 | SQLite-backed Registration | `server/account-store.js` | ✅ scrypt password hashing, case-insensitive username |
| 21 | Login with Token Recovery | `server/account-store.js` | ✅ bearer token reuses existing ProfileStore integration |
| 22 | Presence Tracking | `server/presence-store.js` | ✅ in-memory online/offline, 45s TTL, heartbeat API |
| 23 | Auth Modal UI | `index.html`, `css/auth.css` | ✅ register/login tabs, error display |
| 24 | Client Account Module | `js/account.js` | ✅ localStorage persistence, async register/login |
| 25 | Presence Heartbeat | `js/main.js` | ✅ 20s interval, 0% impact on guests |
| 26 | Friends Server Status | `js/friends.js` | ✅ `getServerStatus()` for online friend polling |

**Key Design:** Accounts are identity-only. Gameplay remains 100% P2P. Only login recovery and presence display use the server. Guest sessions continue unchanged with localStorage-only profiles.

**Tests:** 12 new tests (8 account-store + 4 presence-store) all passing.
**Verified:** Register, login, duplicate rejection, wrong password rejection, and end-to-end auth flow.


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
│   ├── style.css           — All styles
│   ├── auth.css            — Auth modal (register/login)
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
│   ├── matchhistory.js     — Match history + stats
│   ├── account.js          — Client account module (register/login/localStorage)
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
├── server/
│   ├── profile-store.js     — Profile/economy (currency/purchases/cosmetics)
│   ├── account-store.js     — SQLite-backed accounts (register/login)
│   ├── presence-store.js    — Online status tracking
│   ├── creator-map-store.js — User-created map storage
│   ├── payment-ledger.js    — In-app purchase ledger
│   ├── telemetry.js         — Analytics storage
│   └── [other server modules]
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

- `graphify-out/` refreshed 2026-07-28 (2828 nodes, 5858 edges, 158 communities). Re-run
  `graphify update .` after code changes — code extraction is AST-only, no API key needed.
  `colliders.json` yields zero nodes and is absent from the graph (upstream graphify #1666).
- `PLAN.md` contains both completed and pending items — check this file (MIMO.md) for current status.
- Automated Node tests are available via `npm test`; Phase 1 UI coverage lives in `tests/ui-foundation.test.mjs`.
- PeerJS P2P requires both peers to be on same network or use a signaling server.

## July 2026 Polish Pass

- Unified menu, lobby, Social Hub, shop, progression, career, and patch notes around a turquoise/light-blue visual system.
- Social Hub activity portals removed; map view, presence, chat, practice area, and solid prop collision retained.
- Added Source-style bunnyhop feedback, Ctrl+Space+W longjump, speed HUD, landing distance notifications, and crosshair share codes.
- Added lobby map previews, expanded progression/career presentation, generated shop roster artwork, and `By Sherlock` patch notes.
- Reduced authoritative background simulation from 128Hz to 60Hz; ball sync is 30Hz and bot sync is 10Hz.
- Social Hub now auto-loads into the single original Grand Estate map; the retired island runtime/assets are removed.
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

## Showcase Shop and Cosmetic Studio

- Rebuilt Shop as a wide premium showcase: live Three.js character on the left, scrollable catalog and commerce controls on the right.
- Avatar preview selection auto-loads `cosmetic_studio`, a hidden no-combat/no-bot practice map with instant skin comparison, purchase, equip, and return-to-Shop controls.
- Added reusable `js/shop-showcase.js` renderer/rig and pure `js/cosmetic-practice.js` session state.
- Replaced the retired island Social Hub with one procedural Grand Estate containing walk-through mansions, pools, plaza, statues, local props, collisions, and procedural textures.

## Menu Identity Pass (2026-07-28)

- Main-menu palette now derives from theme tokens (`--ui-menu-*` in `css/ui-tokens.css`)
  instead of the fixed hex block that used to sit in `css/polish.css`. `dark` fallbacks
  equal the previous values, so the default look is unchanged.
- Four new themes: Ember, Violet Surge, Verdant, Crimson Court. Team red/blue stay
  theme-independent (PLAN.md: effects may never obscure team ownership).
- The main menu hero is a live 3D character: `ShopShowcaseRenderer` is reused through a
  new `options.camera` framing override, so no second renderer path exists. The old CSS
  character remains the automatic fallback when WebGL is unavailable
  (`#menu-character-showcase[data-live]`).
- `UI.showScreen` now dispatches `warrball:screen`, so per-screen features start/stop
  without patching all ~25 `showScreen('mainMenu')` call sites. The menu hero uses it.
- `ShopShowcaseRenderer.setReducedMotion()` ORs the in-app accessibility setting with the
  OS `prefers-reduced-motion` query; `applyAccessibility()` propagates it.
- Menu hover/focus colors follow the active theme via `color-mix()` instead of fixed cyan.
- Roadmap for the remaining UI work: `docs/V3_UX_ROADMAP.md`.
- Verification: `npm run check` → 79 files clean. `node --test` → **509/509 passed**.
  Browser matrix at 1600×900: all six themes, menu→shop→menu hero lifecycle, and the
  reduced-motion chain confirmed.

---

## Skin Finisher Pass (2026-07-29)

Valorant-style elimination and round-end effects driven by the ball skin that landed the
kill. This was the actual gap — the shop, case reel and item previews were already strong
and needed no rework.

- `js/shader-finishers.js` — one parameterised `ShaderMaterial` with four `uVariant`
  branches, keyed on each skin's existing `effect` family from `BALL_SKINS` rather than on
  ids, so 22 shipped skins are covered without a per-skin table:
  `void` -> void implosion, `flame` -> ember burst, `glitch` -> digital dissolve,
  `frost` -> ghost fade. `uColor` comes from that skin's own `glow`.
- `js/shaders/finisher.vert.js` / `finisher.frag.js` — inline hash/value-noise fbm, no
  external GLSL dependency, matching the existing `js/shaders/` export style.
- Four hooks in `js/game.js`, all optional-chained through `window.shaderFinishers` so the
  layer is a drop-in and its absence is a no-op, never a crash:
  `spawnDeathExplosion()` (one hook covers all six call sites, reads the live `ball.skinId`),
  `setState(ROUND_END)`, the update loop (raw `dt`, deliberately before juice's hit-stop
  early-return so a kill's own hit-stop cannot freeze the effect it just spawned), and
  `startRound()` teardown.
- Skins outside those four families (`spark`, `prism`, `pixel`, `smile`, `candy`, `toxic`)
  silently no-op, as does an unknown id, a missing scene, or `prefers-reduced-motion`.
- Audio deliberately untouched this pass — effects only, per the request.
- Verification: all four variants compile and render distinctly in a real WebGL context;
  every effect retires to `scene.children.length === 0` and disposes its geometry/material;
  `update(dt)` is host-driven with a self-cancelling RAF fallback; `node --test` -> 558/558.

**Deliberately reverted during this pass:** a parallel case-opener modal, a second
marketplace grid and a `skin-effects` glow module were built and then deleted. Each
duplicated something better that already shipped — `UI.showCaseReel()` (31-item CS:GO track,
pixel-perfect stop, winner pop, 3D reward preview, skip), `UI.renderShop()` (live 3D
showcase, ARIA, preview events) and the procedural `.ball-preview` CSS that already covers
all 44 ball skins via `data-effect` + `--ball-color`. Check those three before adding UI here.

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

---

## V4 Pass — Combat Feel, Economy, Lobby Fixes, Shop/Settings Clarity, Immersion (2026-07-30)

Full plan: `docs/V4_MASTER_PLAN.md`. 6 parallel slices, 978/978 tests passing (was 893), 89 files
syntax-clean (was 86; +arena-decor.js, +hit-feedback.js, +combat.js, +shop-clarity.js).

- **Hitreg + feel** (`js/combat.js` new, `js/game.js` combat region, `js/hit-feedback.js` new):
  ball→player hit path now uses distance-driven swept steps (was discrete/speed-gated, had a
  tunneling gap at high rally speed and a per-frame Vector3 allocation). remoteAttack dedup window
  and pending-lethal-hit grace now scale with ball speed / reported ping instead of fixed
  90ms/80ms. Fixed a real race: a wrong player's late attack could cancel another player's pending
  lethal hit. Added hitmarker/damage-direction feedback module, kill-confirm "hot ball" 3-4s bonus
  window, kill-confirm audio cue.
- **Economy** (`server/profile-store.js`, `js/store.js`, `js/ui.js`): match reward was previously
  broken end-to-end for account-linked users (client never sent a signed receipt). Now: win 120 /
  lose 40 coins + kill/deflect bonus (cap 60), both guest and account paths grant. New
  `POST /api/profile/ad-reward` house-promo (no real ad SDK — 20s in-app showcase), daily cap 5,
  50 coins, 90s cooldown, idempotent. Post-match coin-breakdown + battlepass progress panel.
- **Shop/Settings clarity** (`js/shop-clarity.js` new, `js/ui.js`, `js/settings-controller.js`):
  every shop card now shows OWNED/EQUIPPED badges, dim+"N coin short" when unaffordable, 6 filter
  chips. Settings modal: theme swatch previews, grouped sections with descriptions, saved-pulse
  indicator, per-tab two-tap reset-to-defaults. Cross-slice contract (`#shop-earn-slot` +
  `window.UI.renderEarnSlot()`) verified live in browser.
- **Lobby/P2P** (`js/network.js`, `js/main.js`, `server.js`, `js/game.js` sync region): fixed the
  3 bugs in `docs/P2P_HOST_FIXES.md`. Root causes: (1) 1v1 host-exit self-promoted to a dead lobby
  because migration never checked candidate count; (2) migrated hosts never re-armed their
  keep-alive interval, so mid-match lobbies silently TTL'd out of the browser; (3) snapshot/late-join
  never carried match settings, ball affix, or chaos-mode state. Host migration vote/epoch/checkpoint
  infra was already correct and untouched. Lobby browser now shows player count, age, and an empty-
  state CTA.
- **Immersion** (`js/arena-decor.js` new, `js/arena.js`, `js/renderer.js`): GLTF decor loader
  (same pattern as `js/social-lobby.js`) wired to 5 maps (grand_stadium, esport_arena, colosseum,
  dojo, neon) using 6 CC-BY models from Sketchfab (`assets/cc-by/sketchfab/`, see ATTRIBUTION.md —
  credit required). Bounding-box-normalized scale, disposed on map change, silent no-op if a model
  fails to load. Trophy template exposed at `window.arenaDecor.trophy` (unused — next session can
  wire it into round-win celebration in `game.js`).
- **Assets**: Sketchfab API key works (basic account, CC0/CC-BY search+download). Tripo AI key is
  valid but has **0 credit balance** (403 code 2010) — text-to-3D generation is blocked until
  credit is purchased; see `docs/V4_MASTER_PLAN.md` for the planned generation list once unblocked.
- **Fixed one pre-existing regression during review**: `tests/endgame-controls.test.mjs` asserted
  the literal old reward formula (`won ? 5 : 1`) as source text — updated to assert the new
  `matchRewardBreakdown` contract instead of reverting the intentional economy change.

---

## V4 Wave 2 — Case Presentation, UI Overlap, Combat FX, Homepage, New Skins (2026-07-30)

1031/1031 tests (was 978), 91 files clean (+combat-fx.js, +menu-featured.js). All verified live
in browser before commit.

- **Shop case cards were rendering with NO artwork** — root cause chain: `.shop-grid` is height-
  constrained → grid rows compress because `#shop-screen .case-card { min-height: 0 }` removed the
  floor (cards are `overflow:hidden`, so auto min-size is 0) → the flex-column card squeezed
  `.case-art` (default `flex-shrink:1`) down to its 2px borders. Fix in `css/polish.css` ~3793:
  `min-height: 340px` floor + `flex-shrink: 0; height: auto` on the art (aspect-ratio takes over).
  The 6 premium 512px case renders in `assets/generated/cases/` now actually show.
- **UI overlap fixes** (`js/ui.js` exclusive-overlay registry `UI._openExclusive`, `css/ui-tokens.css`
  `--z-hud/--z-overlay/--z-modal/--z-toast/--z-critical` scale, `js/main.js` unified Escape chain):
  4 real bugs fixed — chat opened *behind* the team overlay, emote wheel + team popup could stack,
  earn overlay + case inspector stacked with no Escape path, and case-inspector had an orphan
  document-level Escape listener outside the priority chain. Pause↔settings nested-modal return
  behavior is INTENTIONAL and was left alone; pause is deliberately outside the registry.
- **Combat FX** (`js/combat-fx.js` new pure helpers, `js/ui.js` damage/combo region, `js/juice.js`,
  `js/audio.js`): damage numbers now tiered (small/medium/large/kill), 14-element DOM pool (0 alloc
  after warm-up), deterministic jitter; combo display has tier colors, amber-only edge glow
  (never red/blue — team ownership rule), shatter-on-break, audio pitch ramp (`playSfx` gained an
  optional `rate` param, backward compatible). Deflect now fires `juice.burst()` radial particles
  (existing pool infra reused; gold variant on perfect). Fixed a real double-writer bug: game.js's
  per-frame `updateCombo()` was overwriting `showCombo()` banners — `_comboPinnedUntil` window.
- **Homepage** (`js/menu-featured.js` new, `index.html` #main-menu, `css/polish.css`): logo
  gradient (theme-aware via `--menu-*` tokens) replaced the cheap red/blue offset outline; FEATURED
  strip (day-of-year deterministic rotation, live-market takes precedence when populated) deep-links
  into shop cases/balls tabs. New skins enter rotation automatically.
- **6 new sellable ball skins** (`js/ball.js` BALL_SKINS + `js/battlepass.js` BALL_PRICES):
  emberfall/glacies (rare), binary_ghost/event_null (epic), wildfire_phantom/oblivion_shard
  (legendary) — all reuse the existing 4 effect families. **Real bug found**: 12 skins added by an
  earlier session existed in BALL_SKINS but were missing from BALL_PRICES (the separate price map
  `store.buyBall()` actually checks), so they showed in shop but silently failed to purchase.
  All 49 ids now verified in sync; `tests/ball-skins-catalog.test.mjs` locks the parity.
- **Image gen note**: Pollinations.ai works keyless for non-text art; AI wordmark generation
  produced garbled text ("WARBBALT") — existing `assets/generated/` logo marks remain the source
  of truth for branding.