# Graph Report - dodgb-v2  (2026-07-19)

## Corpus Check
- 81 files · ~117,369 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1444 nodes · 2796 edges · 79 communities (48 shown, 31 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b8c10c01`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 47
- ranked.js
- TutorialClass
- DODGBALL.md
- .updatePowerUps
- .showGameOver
- MatchHistoryClass
- P2P Multiplayer Plan
- Arena_System.md
- Wiki Index
- Player_Controller.md
- ReplayView
- CSGO_Lobby.md
- check-js.js
- VOLLE CC0 Asset Manifest
- 2BALL Project
- Settings_System.md
- ball-steering.test.mjs
- player-movement.test.mjs
- replay-spectator.test.mjs
- arena-config.test.mjs
- social-lobby.test.mjs
- store-replay.test.mjs
- getAvatarPreviewLayout
- RANKED_BASE_ELO
- RANKED_RANKS
- combat.js

## God Nodes (most connected - your core abstractions)
1. `Game` - 140 edges
2. `App` - 76 edges
3. `UI` - 66 edges
4. `Arena` - 63 edges
5. `Network` - 60 edges
6. `StoreClass` - 39 edges
7. `Ball` - 36 edges
8. `SpectatorClass` - 34 edges
9. `Player` - 33 edges
10. `Audio` - 25 edges

## Surprising Connections (you probably didn't know these)
- `_applyFromColors()` --calls--> `apply()`  [EXTRACTED]
  js/game.js → js/affixes.js
- `applyMode()` --calls--> `applyCharacter()`  [EXTRACTED]
  js/gamemodes.js → js/characters.js
- `applyMode()` --calls--> `applyRunes()`  [EXTRACTED]
  js/gamemodes.js → js/skills.js
- `canvasToWorld()` --calls--> `normalizeMapConfig()`  [EXTRACTED]
  js/map-editor.js → js/map-config.js
- `findMapPropAt()` --calls--> `normalizeMapConfig()`  [EXTRACTED]
  js/map-editor.js → js/map-config.js

## Import Cycles
- None detected.

## Communities (79 total, 31 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (5): Daily, Friends, App, Replay, Spectator

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (3): createSessionValue(), Network, reconnectDelay()

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (3): Arena, getArenaBounds(), getSpectatorBounds()

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (53): assertId(), assertInteger(), assertObject(), assertRankedState(), calculateEloChange(), clamp(), createRankedState(), expectedRankedScore() (+45 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (37): addMapProp(), checkNumber(), clampNumber(), COLOR_KEYS, containsUnsafeContent(), DEFAULTS, deleteMapProp(), FLAG_NAMES (+29 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (12): Ball, clamp(), createWideWaypoint(), finitePoint(), hasCrossedTargetPlane(), predictLeadTarget(), sampleBoundedVelocity(), splitSteeringDisplacement() (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (6): CAMERA_MODE_SET, CAMERA_MODES, clamp(), computeFreeCamMovement(), finite(), SpectatorClass

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (21): fs, http, lobbies, MIME, path, CATALOG, crypto, defaults() (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (35): Conflict Resolution, Esports Overhaul Design Spec — 2BALL Dodgeball, File Modification Map, No New Dependencies, [S1] Problem, [S2] Solution Overview, [S3.1] Kill Feed Redesign, [S3.2] Round Banner (+27 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): AVATAR_MODELS, AvatarPainter, composeAvatarAtlas(), composeAvatarBodyAtlas(), createAvatarAtlas(), cropAtlasFace(), fill(), FRONT_UV (+10 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (9): clamp(), finite(), lowerBound(), normalizeReplaySnapshot(), playerSnapshot(), point(), renderReplaySnapshot(), ReplayClass (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (9): box(), CHARACTER_ASSETS, createSocialLobbyArena(), findNearestPortal(), material(), PROP_ASSETS, setMeshShadows(), SOCIAL_LOBBY_PORTALS (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (25): 1.1 Karakter Sistemi — `js/characters.js` (YENİ), 1.2 Skill/Rune Sistemi — `js/skills.js` (YENİ), 1.3 Hasar Sistemi İyileştirme — `player.js` / `bot.js` / `game.js`, 1.4 Spam Protection — `player.js`, 1.5 Map Banlama — `index.html` lobby + `game.js`, 2.1 Yeni Mapler + Büyük Mapler — `arena.js` MAPS genişlet, 2.2 Portal Mekaniği — `arena.js` + `game.js`, 2.3 Extra Top Modelleri — `ball.js` (+17 more)

### Community 20 - "Community 20"
Cohesion: 0.08
Nodes (23): Esports Overhaul Implementation Plan, Global Constraints, Integration Test, Sub-Project 1: UI/UX Overhaul (css/style.css, index.html, js/ui.js), Sub-Project 2: Gameplay Loop (js/game.js, js/skills.js), Sub-Project 3: Graphics/Visual Polish (js/renderer.js, js/juice.js, js/arena.js), Sub-Project 4: Hitbox/Combat (js/ball.js, js/game.js), Task 1.1: Kill Feed Redesign (+15 more)

### Community 22 - "Community 22"
Cohesion: 0.10
Nodes (20): 2BALL Development Log, A-D-A-D Spin Dodge, Audio, Ball Physics, Characters (7), Combat, DMC Combo System, Emotes (+12 more)

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (18): Adding a New Character, Adding a New Map, Adding a New Rune, Adding a New Skill, Completed Features (Commits), File Structure, For Other AIs, How to Work on This (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.11
Nodes (17): Additional Forbidden Patterns, Anti-Patterns (Do NOT Use), Buttons, Cards, Color Palette, Component Specs, Design System Master File, Global Rules (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (15): apply(), CHAOS_AFFIXES, CHAOS_MODES, applyCharacter(), calcDamage(), missRampDamage(), _applyAvatarColors(), _applyFromColors() (+7 more)

### Community 27 - "Community 27"
Cohesion: 0.23
Nodes (7): applyGroundFriction(), clipInwardVelocity(), clipMovementState(), moveHorizontalState(), resolveJump(), sourceAccelerate(), tickSkillCooldowns()

### Community 33 - "Community 33"
Cohesion: 0.15
Nodes (12): 2BALL Development Program, Architecture direction, Implementation log - 2026-07-18, Product goal, Release gates, Stage 0 - Baseline and safety (Week 1), Stage 1 - Networking reliability (Weeks 1-2), Stage 2 - Performance (Week 3) (+4 more)

### Community 34 - "Community 34"
Cohesion: 0.13
Nodes (17): ACHIEVEMENTS, checkAchievements(), AVATAR_SKINS, BALL_SKINS, CHARACTERS, STATES, ADJ, generateFakes() (+9 more)

### Community 36 - "Community 36"
Cohesion: 0.31
Nodes (4): CHALLENGE_POOL, DailyClass, pickDailies(), todayKey()

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (6): activateQueuedEntity(), isLiveJoinState(), LIVE_JOIN_STATES, normalizeTeam(), queueForNextRound(), selectQueuedTeam()

### Community 41 - "Community 41"
Cohesion: 0.27
Nodes (6): colorNumber(), ensureMapMetadata(), MAP_THEMES, MAPS, registerCustomMap(), COMMANDS

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (10): description, engines, node, name, private, scripts, check, start (+2 more)

### Community 43 - "Community 43"
Cohesion: 0.20
Nodes (9): Ball States — Yön Steering Modeli, Ceiling Guard, _clampSpeed, Collision, Deflect, Fizik, Hedef Noktası (Whole Body), Ricochet (+1 more)

### Community 48 - "ranked.js"
Cohesion: 0.36
Nodes (5): expectedScore(), getRank(), getRankProgress(), RANKS, updateElo()

### Community 49 - "TutorialClass"
Cohesion: 0.28
Nodes (3): Tutorial, TUTORIAL_STEPS, TutorialClass

### Community 50 - "DODGBALL.md"
Cohesion: 0.29
Nodes (5): Skin Listesi, Özellikler, Kontroller, Oynanış, Son Güncellemeler (07/2026)

### Community 54 - "P2P Multiplayer Plan"
Cohesion: 0.29
Nodes (6): Architecture, Current State, Implementation Steps, Message Types, P2P Multiplayer Plan, Render Notes

### Community 55 - "Arena_System.md"
Cohesion: 0.29
Nodes (6): Açık Harita Ortamları (openSides), Collision Sistemi, Harita Değişiklikleri, Haritalar, Minecraft (Yeni), Portal

### Community 56 - "Wiki Index"
Cohesion: 0.29
Nodes (7): Core Systems, Customization, Game Overview, Maps, Menu & UI, Progress, Wiki Index

### Community 57 - "Player_Controller.md"
Cohesion: 0.29
Nodes (6): Combat, Hand Mesh (El), Hareket, Kamera, Skill Sistemi, Stamina

### Community 58 - "ReplayView"
Cohesion: 0.38
Nodes (3): createActor(), material(), ReplayView

### Community 59 - "CSGO_Lobby.md"
Cohesion: 0.33
Nodes (5): Chat (Lobby), Host Özellikleri, Layout, Player Cards, Yenilikler

### Community 60 - "check-js.js"
Cohesion: 0.33
Nodes (4): files, fs, path, { spawnSync }

### Community 61 - "VOLLE CC0 Asset Manifest"
Cohesion: 0.40
Nodes (4): Kenney Blocky Characters, Kenney Mini Arena, Kenney Platformer Kit, VOLLE CC0 Asset Manifest

### Community 62 - "2BALL Project"
Cohesion: 0.40
Nodes (4): 2BALL Project, IMPORTANT: Read This First, Key Files, Quick Reference

### Community 63 - "Settings_System.md"
Cohesion: 0.40
Nodes (4): Ayarlar Listesi, Crosshair (Yeni), Resolution Fix, Özellikler

### Community 78 - "combat.js"
Cohesion: 0.80
Nodes (3): pointSegmentDistanceSq(), resolveKillerName(), segmentIntersectsSphere()

## Knowledge Gaps
- **245 isolated node(s):** `MAP_THEMES`, `HEAD_FRONT`, `AVATAR_MODELS`, `TEAM_SKIN_IDS`, `PALETTE` (+240 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Game` connect `Community 6` to `Community 32`, `Community 34`, `Community 39`, `Community 46`, `Community 17`, `.updatePowerUps`, `Community 23`, `Community 26`, `Community 29`?**
  _High betweenness centrality (0.143) - this node is a cross-community bridge._
- **Why does `App` connect `Community 0` to `Community 34`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `Arena` connect `Community 2` to `Community 41`, `Community 26`, `Community 34`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **What connects `MAP_THEMES`, `HEAD_FRONT`, `AVATAR_MODELS` to the rest of the system?**
  _245 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06740506329113924 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.061955965181771634 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.088841882601798 - nodes in this community are weakly interconnected._