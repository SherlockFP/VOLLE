# Graph Report - dodgb-v3  (2026-07-28)

## Corpus Check
- 200 files · ~524,736 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2828 nodes · 5858 edges · 158 communities (116 shown, 42 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 101 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `720018b0`
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
- Community 17
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
- Community 46
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
- .escapeHTML
- ball-steering.test.mjs
- player-movement.test.mjs
- replay-spectator.test.mjs
- ._buildAARTable
- arena-config.test.mjs
- social-lobby.test.mjs
- .constructor
- ._renderTeamLists
- store-replay.test.mjs
- getAvatarPreviewLayout
- RANKED_BASE_ELO
- RANKED_RANKS
- combat.js
- release-safety.js
- 2BALL UI, Creator ve Oyun Sistemleri Yenileme Tasarimi
- ui-foundation.test.mjs
- .setupMenuHandlers
- .handleMessage
- cosmetic-customization.js
- host-migration.test.mjs
- perfect-deflect.js
- battlepass.js
- cosmetic-models.js
- crosshair.js
- target-outline.test.mjs
- .awardMatchRewards
- GuidedDeflectDrill
- payment-ledger.test.cjs
- character-rig.test.mjs
- telemetry.js
- cosmetics.js
- profile-store.js
- knife-animation.js
- .save
- goal-mode.js
- MovementTrialClass
- Friends
- weapon-models.js
- live-market.test.cjs
- Warrball V3 Design System
- V3 Backend and Online Architecture
- WARBALL.IO — Master Plan
- Interfaces
- rtc-config.js
- Engineering Rules (proje-yerel, subagent'lar dahil herkes için)
- NEXT SESSION PLAN — 5 saatlik limit yenilenince
- network.test.mjs
- cosmetic-entitlement.js
- RequestLimiter
- V3 Economy and Monetization
- V3 Gameplay Specification
- V3 UI / Görsel Yol Haritası
- ._createRemotePlayer
- startKnifeAnimation
- mesh-security.test.mjs
- getCompetitiveHUDView
- map-mechanics.test.mjs
- V3 Asset and Rendering Pipeline
- V3 Metrics and Validation
- normalizeWearableLoadout
- V3 Backlog
- .updateCarousel
- RuntimeSafety
- match-receipt.js
- checkpoint-lifecycle.test.mjs
- ui-redesign.test.mjs
- Q: Tum onerilen oyun, lobi, market ve ilerleme ozelliklerini ekle
- Q: Daha ne eklenir veya gelistirilir
- Q: V tusunu push-to-talk voice chat yap, team/FFA proximity ve canli ekonomi ekle
- Q: Dodgb-v3 detayli skin sistemi nasil genisletildi ve guvenli tutuldu?
- Q: Knife model, animation, equip, preview ve network akislari nerede ve nasil genisletilmeli?
- Q: How do arena maps, avatar skins, practice, player, and store connect for the cosmetic practice range?
- Q: [social, hub, shop, achievements, challenge, skill, quick, lobby, multiplayer, ball, spawn, bot]
- shop-showcase-ui.test.mjs
- ball-skins.test.mjs
- LICENSE.md
- getPatternColors
- normalizeCosmeticCustomization
- tradeUpDuplicates

## God Nodes (most connected - your core abstractions)
1. `Game` - 172 edges
2. `App` - 141 edges
3. `Network` - 90 edges
4. `UI` - 83 edges
5. `StoreClass` - 70 edges
6. `Arena` - 69 edges
7. `Ball` - 40 edges
8. `Player` - 38 edges
9. `SpectatorClass` - 36 edges
10. `Audio` - 34 edges

## Surprising Connections (you probably didn't know these)
- `createCharacterRig()` --indirect_call--> `applyPose()`  [INFERRED]
  js/character-rig.js → tests/character-rig.test.mjs
- `schedule()` --calls--> `scheduleThreatAudio()`  [EXTRACTED]
  tests/threat-audio.test.mjs → js/audio.js
- `setDailyState()` --references--> `Daily`  [EXTRACTED]
  tests/daily-battlepass.test.mjs → js/daily.js
- `createSlot()` --indirect_call--> `item()`  [INFERRED]
  js/cosmetic-models.js → js/cosmetic-catalog.js
- `sanitizeValue()` --indirect_call--> `item()`  [INFERRED]
  js/match-analytics.js → js/cosmetic-catalog.js

## Import Cycles
- None detected.

## Communities (158 total, 42 thin omitted)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (53): assertId(), assertInteger(), assertObject(), assertRankedState(), calculateEloChange(), clamp(), createRankedState(), expectedRankedScore() (+45 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (38): addMapProp(), checkNumber(), clampNumber(), COLOR_KEYS, containsUnsafeContent(), DEFAULTS, deleteMapProp(), FLAG_NAMES (+30 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (17): Ball, clamp(), createAimRouteOffset(), createWideWaypoint(), finitePoint(), hasCrossedTargetPlane(), networkBallStep(), predictLeadTarget() (+9 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (6): CAMERA_MODE_SET, CAMERA_MODES, clamp(), computeFreeCamMovement(), finite(), SpectatorClass

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (3): normalizeEquippedCosmetics(), defaults(), ProfileStore

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (9): Audio, classifyThreat(), createThreatAudioState(), scheduleThreatAudio(), THREAT_COOLDOWN_MS, THREAT_ENTER_SECONDS, shouldInitiateVoice(), VoiceChat (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (35): Conflict Resolution, Esports Overhaul Design Spec — 2BALL Dodgeball, File Modification Map, No New Dependencies, [S1] Problem, [S2] Solution Overview, [S3.1] Kill Feed Redesign, [S3.2] Round Banner (+27 more)

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (29): AVATAR_MODELS, AVATAR_SKINS, AvatarPainter, composeAvatarAtlas(), composeAvatarBodyAtlas(), createAvatarAtlas(), cropAtlasFace(), fill() (+21 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (15): clamp(), createReplayHighlights(), extractReplayHighlight(), finite(), interpolateReplaySnapshots(), lerp(), lerpAngle(), lerpPoint() (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (43): createCharacterAnimator(), LOOP_STATES, blendPose(), clamp(), createAnimatorState(), isPoseState(), JOINTS, locomotionState() (+35 more)

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (29): addBox(), addCylinder(), addMansionShell(), addPool(), addStatue(), CHARACTER_ASSETS, createEstateMaterials(), createNameplate() (+21 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (25): 10. Backend decision, 11. Definition of done, 12. Current execution order, 1. Product decision, 2. Current implementation matrix, 3. Non-negotiable rules, 4. Internal success gates, 5. Release roadmap (+17 more)

### Community 20 - "Community 20"
Cohesion: 0.08
Nodes (23): Esports Overhaul Implementation Plan, Global Constraints, Integration Test, Sub-Project 1: UI/UX Overhaul (css/style.css, index.html, js/ui.js), Sub-Project 2: Gameplay Loop (js/game.js, js/skills.js), Sub-Project 3: Graphics/Visual Polish (js/renderer.js, js/juice.js, js/arena.js), Sub-Project 4: Hitbox/Combat (js/ball.js, js/game.js), Task 1.1: Kill Feed Redesign (+15 more)

### Community 22 - "Community 22"
Cohesion: 0.10
Nodes (20): 2BALL Development Log, A-D-A-D Spin Dodge, Audio, Ball Physics, Characters (7), Combat, DMC Combo System, Emotes (+12 more)

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (25): Adding a New Character, Adding a New Map, Adding a New Rune, Adding a New Skill, Competitive Rules Pass, Completed Features (Commits), Cosmetics and Mega Arena Pass, File Structure (+17 more)

### Community 25 - "Community 25"
Cohesion: 0.04
Nodes (19): BoxGeometry, Color, CylinderGeometry, DirectionalLight, DisposableGeometry, DisposableMaterial, Group, HemisphereLight (+11 more)

### Community 26 - "Community 26"
Cohesion: 0.12
Nodes (21): MAPS, applyCharacter(), calcDamage(), missRampDamage(), ROSTER, applyCompetitiveRules(), clearBaseStats(), clearCompetitiveRules() (+13 more)

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (13): applyGroundFriction(), clipInwardVelocity(), clipMovementState(), moveHorizontalState(), resolveGravityScale(), resolveJump(), resolveLongJump(), resolveMovementSpeedMultiplier() (+5 more)

### Community 30 - "Community 30"
Cohesion: 0.21
Nodes (6): ADJ, generateFakes(), LeaderboardClass, NOUN, seededRng(), Store

### Community 33 - "Community 33"
Cohesion: 0.15
Nodes (12): Architecture direction, Implementation log - 2026-07-18, Product goal, Release gates, Stage 0 - Baseline and safety (Week 1), Stage 1 - Networking reliability (Weeks 1-2), Stage 2 - Performance (Week 3), Stage 3 - Match flow and replay (Week 4) (+4 more)

### Community 34 - "Community 34"
Cohesion: 0.31
Nodes (9): claimSeasonContract(), createSeasonContractState(), progressSeasonContracts(), SEASON_CONTRACTS, DEFAULT_LOADOUT, RUNES, SKILLS, ULTIMATES (+1 more)

### Community 36 - "Community 36"
Cohesion: 0.28
Nodes (4): CHALLENGE_POOL, DailyClass, pickDailies(), todayKey()

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (6): activateQueuedEntity(), isLiveJoinState(), LIVE_JOIN_STATES, normalizeTeam(), queueForNextRound(), selectQueuedTeam()

### Community 41 - "Community 41"
Cohesion: 0.20
Nodes (6): colorNumber(), ensureMapMetadata(), getArenaBounds(), getSpectatorBounds(), MAP_THEMES, registerCustomMap()

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (10): description, engines, node, name, private, scripts, check, start (+2 more)

### Community 43 - "Community 43"
Cohesion: 0.20
Nodes (9): Ball States — Yön Steering Modeli, Ceiling Guard, _clampSpeed, Collision, Deflect, Fizik, Hedef Noktası (Whole Body), Ricochet (+1 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (19): actorFrom(), addTier(), buildHeatmap(), clampLimit(), cleanText(), count(), downsampleTrajectory(), emptyStats() (+11 more)

### Community 48 - "ranked.js"
Cohesion: 0.13
Nodes (15): BALL_SKINS, COSMETIC_TYPES, COSMETICS, cosmeticsByType(), DEFAULT_WEARABLE_LOADOUT, Leaderboard, expectedScore(), getRank() (+7 more)

### Community 49 - "TutorialClass"
Cohesion: 0.28
Nodes (3): Tutorial, TUTORIAL_STEPS, TutorialClass

### Community 50 - "DODGBALL.md"
Cohesion: 0.29
Nodes (5): Skin Listesi, Özellikler, Kontroller, Oynanış, Son Güncellemeler (07/2026)

### Community 52 - ".showGameOver"
Cohesion: 0.12
Nodes (22): ACHIEVEMENTS, checkAchievements(), COMPETITIVE_LIMITS, createDraftState(), rankQueueCandidates(), shouldStartOvertime(), updateDraftPick(), normalizeNetcode() (+14 more)

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
Nodes (4): Kenney Blocky Characters, Kenney Mini Arena, Kenney Platformer Kit, Warrball CC0 Asset Manifest

### Community 62 - "2BALL Project"
Cohesion: 0.40
Nodes (4): IMPORTANT: Read This First, Key Files, Quick Reference, Warrball Project

### Community 63 - "Settings_System.md"
Cohesion: 0.40
Nodes (4): Ayarlar Listesi, Crosshair (Yeni), Resolution Fix, Özellikler

### Community 64 - ".escapeHTML"
Cohesion: 0.09
Nodes (27): COLOR_KEYS, CreatorMapStore, crypto, DIMENSION_KEYS, finiteInRange(), FLAG_KEYS, fs, hasExactKeys() (+19 more)

### Community 68 - "._buildAARTable"
Cohesion: 0.06
Nodes (30): allowRequest(), { buildRtcConfig }, { CATALOG, ProfileStore }, COSMETIC_ENTITLEMENT_SECRET, { createLiveMarket, findLiveOffer }, creatorMaps, { CreatorMapStore }, crypto (+22 more)

### Community 72 - ".constructor"
Cohesion: 0.14
Nodes (26): item(), boundedMetric(), candidateScore(), compareHostCandidates(), digestText(), electionAgreement(), eligibleIdSet(), finite() (+18 more)

### Community 73 - "._renderTeamLists"
Cohesion: 0.10
Nodes (22): BIN, constantTimeSessionValueEqual(), COSMETIC_TYPE_IDS, createSessionValue(), digestResumeToken(), FALLBACK_RTC_CONFIG, fetchRtcConfig(), isBoundedFinite() (+14 more)

### Community 78 - "combat.js"
Cohesion: 0.12
Nodes (18): CHAOS_AFFIXES, CHAOS_MODES, pointSegmentDistanceSq(), resolveKillerName(), segmentIntersectsSphere(), updateEntityCosmetics(), DEFAULT_NETCODE, predictPosition() (+10 more)

### Community 79 - "release-safety.js"
Cohesion: 0.14
Nodes (14): AFK_DEFAULTS, AfkMonitor, boundedInteger(), clamp(), createPublicDiagnostics(), finiteNumber(), MODERATION_REASONS, ModerationReportQueue (+6 more)

### Community 80 - "2BALL UI, Creator ve Oyun Sistemleri Yenileme Tasarimi"
Cohesion: 0.07
Nodes (28): 10. Hata Yonetimi ve Guvenlik, 11. Test ve Dogrulama, 12. Uygulama Fazlari, 13. Kapsam Disi, 1. Hedef, 2. Basari Kriterleri, 2BALL UI, Creator ve Oyun Sistemleri Yenileme Tasarimi, 3.1 Tema (+20 more)

### Community 81 - "ui-foundation.test.mjs"
Cohesion: 0.10
Nodes (15): initSettingsTabs(), selectSettingsTab(), applyUiPreferences(), loadUiPreferences(), normalizeTheme(), normalizeUiScale(), UI_THEMES, fakePgDom() (+7 more)

### Community 83 - ".handleMessage"
Cohesion: 0.14
Nodes (5): createResumeNonce(), isSafeResumeProof(), normalizeProtocolCapabilities(), completeIdentityAdmission(), startIdentityAdmission()

### Community 84 - "cosmetic-customization.js"
Cohesion: 0.19
Nodes (25): allowed(), canEquipCosmeticLoadout(), clampNumber(), cloneDefault(), COSMETIC_ALLOWLISTS, COSMETIC_LIMITS, DEFAULT_COSMETIC_LOADOUT, deterministicDuplicateTradeUp() (+17 more)

### Community 85 - "host-migration.test.mjs"
Cohesion: 0.07
Nodes (8): applyHostMigrationCheckpoint, compileGameMethod(), extractGameMethod(), gameSource, reconcileHostRevive, restoreHostMigrationState, STATES, validateHostMigrationCheckpointState

### Community 86 - "perfect-deflect.js"
Cohesion: 0.18
Nodes (18): chainRules(), classifyDeflectTiming(), createPracticeMetrics(), DEFLECT_CHAIN_RULES, DEFLECT_REWARDS, DEFLECT_TIMING_WINDOWS, finite(), getDeflectReward() (+10 more)

### Community 87 - "battlepass.js"
Cohesion: 0.17
Nodes (22): addXp(), applySeasonRollover(), BALL_IDS, BALL_PRICES, buildFreeTrack(), canClaim(), claimReward(), clampTier() (+14 more)

### Community 88 - "cosmetic-models.js"
Cohesion: 0.18
Nodes (25): activeImpacts, addEyes(), attachToRig(), basic(), createAura(), createBackpack(), createBanner(), createCape() (+17 more)

### Community 89 - "crosshair.js"
Cohesion: 0.15
Nodes (23): appendPart(), checksum(), clamp(), CONFIG_KEYS, CROSSHAIR_DEFAULTS, CROSSHAIR_LIMITS, CROSSHAIR_STYLES, decodeBase64Url() (+15 more)

### Community 91 - "target-outline.test.mjs"
Cohesion: 0.09
Nodes (13): body, BoxGeometry, buildParts(), createTargetOutline, endIndex, Group, Mesh, method (+5 more)

### Community 92 - ".awardMatchRewards"
Cohesion: 0.16
Nodes (10): Daily, connectedRematchParticipants(), createMatchId(), isSafeMatchId(), isTerminalRematchState(), normalizePlayerIds(), RematchVote, snapshotRematchParticipants() (+2 more)

### Community 93 - "GuidedDeflectDrill"
Cohesion: 0.18
Nodes (8): clamp(), freezeSnapshot(), freshStats(), GUIDED_DRILL_LANES, GUIDED_DRILL_STAGES, GuidedDeflectDrill, TIER_POINTS, advanceRuntime()

### Community 94 - "payment-ledger.test.cjs"
Cohesion: 0.13
Nodes (16): crypto, fs, normalizePaymentEvent(), path, PaymentLedger, paymentPayload(), PREMIUM_PACKS, signPaymentEvent() (+8 more)

### Community 95 - "character-rig.test.mjs"
Cohesion: 0.10
Nodes (9): applyPose(), EXPECTED_JOINT_OFFSETS, EXPECTED_SOCKET_OFFSETS, halfExtents(), LIMB_MESH_BY_JOINT, meshExtent(), worldPosition(), registerThreeStub() (+1 more)

### Community 96 - "telemetry.js"
Cohesion: 0.12
Nodes (14): crypto, fs, hashProfileId(), METRIC_LIMITS, normalizeTelemetryEvent(), path, TelemetryStore, TYPES (+6 more)

### Community 97 - "cosmetics.js"
Cohesion: 0.17
Nodes (11): CHARACTERS, canEquipKnife(), CASE_BALLS, CASES, getCaseDropRates(), KNIVES, resolveCaseDrop(), resolveCaseReward() (+3 more)

### Community 98 - "profile-store.js"
Cohesion: 0.12
Nodes (14): CASES, { CASES }, CATALOG, crypto, fs, { normalizeEquippedCosmetics }, path, PROFILE_FIELDS (+6 more)

### Community 99 - "knife-animation.js"
Cohesion: 0.26
Nodes (13): ACTIONS, butterflyParts(), clamp01(), KARAMBIT_REST, KNIFE_ACTION_DURATIONS, lerp(), lerpDelta(), MODEL_FRAME_OFFSET (+5 more)

### Community 101 - "goal-mode.js"
Cohesion: 0.29
Nodes (13): advanceGoalRushClock(), applyGoalScore(), checkGoalEntry(), clamp(), computeGoalZones(), createGoalRushState(), DEFAULT_GOAL_RUSH_MUTATORS, evaluateGoalRushState() (+5 more)

### Community 102 - "MovementTrialClass"
Cohesion: 0.27
Nodes (6): finite(), getGhostPoint(), lerp(), MOVEMENT_TRIALS, MovementTrialClass, point()

### Community 103 - "Friends"
Cohesion: 0.29
Nodes (6): Friends, count(), filterLobbies(), pickQuickLobby(), text(), lobbies

### Community 104 - "weapon-models.js"
Cohesion: 0.31
Nodes (13): addBlade(), addButterfly(), addCombatKnife(), addGripRibs(), addKarambit(), bladeGeometry(), createKnifeModel(), createKnucklesModel() (+5 more)

### Community 105 - "live-market.test.cjs"
Cohesion: 0.21
Nodes (10): createLiveMarket(), findLiveOffer(), utcDayKey(), assert, { CATALOG, ProfileStore }, { createLiveMarket, findLiveOffer }, fs, os (+2 more)

### Community 106 - "Warrball V3 Design System"
Cohesion: 0.17
Nodes (11): Color tokens, Components, Forbidden patterns, HUD, Motion, Navigation, Principles, Responsive checks (+3 more)

### Community 107 - "V3 Backend and Online Architecture"
Cohesion: 0.17
Nodes (11): Account/profile, Current boundary, Implemented local foundation, Inventory/economy, Match service, Matchmaking/lobby, Migration order, Production exit gate (+3 more)

### Community 108 - "WARBALL.IO — Master Plan"
Cohesion: 0.17
Nodes (11): 0. Mevcut Durum (denetlendi), 1.1 `js/character-pose.js` — TAMAMLANDI, 1.2 `js/character-rig.js` — SÖZLEŞME (Aşama A), 1.3 `js/character-anim.js` — SÖZLEŞME (Aşama A), 1. Mimari — Karakter Sistemi, 2. Aşama B — Kozmetik Genişletme, 3. Aşama C — Entegrasyon, 4. Aşama D — warball.io Yayın (sonraki tur) (+3 more)

### Community 109 - "Interfaces"
Cohesion: 0.18
Nodes (10): File Map, Global Constraints, Interfaces, Phase 1 UI Foundation Implementation Plan, Task 1: Theme and UI Scale Model, Task 2: Theme Tokens and Shared Responsive Shell, Task 3: Consolidate Settings and Add Theme/UI Scale Controls, Task 4: Secure and Stabilize Scoreboard Rendering (+2 more)

### Community 110 - "rtc-config.js"
Cohesion: 0.42
Nodes (9): boundedString(), buildPeerBrokerConfig(), buildRtcConfig(), crypto, DEFAULT_STUN_URLS, deriveTurnCredential(), finiteOr(), parseUrlList() (+1 more)

### Community 111 - "Engineering Rules (proje-yerel, subagent'lar dahil herkes için)"
Cohesion: 0.20
Nodes (9): Engineering Rules (proje-yerel, subagent'lar dahil herkes için), IMPORTANT: Read This First, Key Files, Oyun Geliştirme Modu (bu repo için doğrudan geçerli), Quick Reference, Somut Kurallar, Warrball Project, Çatışma Sırası (Final Priority System — iki kural çelişirse bu kazanır) (+1 more)

### Community 112 - "NEXT SESSION PLAN — 5 saatlik limit yenilenince"
Cohesion: 0.20
Nodes (9): 0. Devam eden / önceki turdan miras kalan işler, 1. Mekanik, 2. Harita / Mod, 3. Kozmetik / Görsel, 4.5. Site Geneli Design/Animasyon Yenileme, 4. Progression, 5. warball.io Yayın (daha önce planlanmış, hâlâ bekliyor), Delegasyon notları (+1 more)

### Community 113 - "network.test.mjs"
Cohesion: 0.22
Nodes (4): isNewerSequence(), reconnectDelay(), configureMigration(), fakeConn()

### Community 114 - "cosmetic-entitlement.js"
Cohesion: 0.24
Nodes (8): crypto, signCosmeticEntitlement(), TYPES, verifyCosmeticEntitlement(), assert, crypto, {
    normalizeEquippedCosmetics,
    signCosmeticEntitlement,
    verifyCosmeticEntitlement
}, test

### Community 115 - "RequestLimiter"
Cohesion: 0.27
Nodes (5): finitePositive(), RequestLimiter, assert, { RequestLimiter }, test

### Community 116 - "V3 Economy and Monetization"
Cohesion: 0.22
Nodes (8): Battle pass gate, Currencies, Free earning routes, Implemented foundation, Paid catalog, Required commerce work, Rules, V3 Economy and Monetization

### Community 117 - "V3 Gameplay Specification"
Cohesion: 0.22
Nodes (8): Arcade, Balance data, Ball readability, Catch/parry prototype, Core skill, Rally Duel, Team Arena, V3 Gameplay Specification

### Community 118 - "V3 UI / Görsel Yol Haritası"
Cohesion: 0.22
Nodes (8): 0. Kök neden analizi — ana sayfa neden "sıradan" hissettiriyordu, 1. Bu oturumda tamamlanan (kanıtlı), 2. Faz 1 — Menüyü "canlı ürün" hissine taşımak (en yüksek etki/efor oranı), 3. Faz 2 — Tema sisteminin geri kalan ekranlara yayılması, 4. Faz 3 — Oyuna eklenebilecek mekanikler (repo planından, önceliklendirilmiş), 5. Faz 4 — Teknik borç (görsel işten önce yapılması gerekenler), 6. Dokunulmaz alanlar, V3 UI / Görsel Yol Haritası

### Community 122 - "mesh-security.test.mjs"
Cohesion: 0.28
Nodes (4): beginResumeHandshake(), createTestNetwork(), respondToResumeChallenge(), startResumeHandshake()

### Community 125 - "map-mechanics.test.mjs"
Cohesion: 0.25
Nodes (7): arenaModuleSource, arenaPath, helperEnd, helperStart, NEW_MAP_IDS, PREEXISTING_LOW_GRAVITY_ALLOWLIST, REQUIRED_FIELDS

### Community 126 - "V3 Asset and Rendering Pipeline"
Cohesion: 0.29
Nodes (6): Export rules, Model budgets, Runtime rules, Shader rules, Texture rules, V3 Asset and Rendering Pipeline

### Community 127 - "V3 Metrics and Validation"
Cohesion: 0.29
Nodes (6): Economy, Gameplay, Initial gates, Product funnel, Technical, V3 Metrics and Validation

### Community 130 - "V3 Backlog"
Cohesion: 0.33
Nodes (5): AFTER VERTICAL SLICE, LATER, NEXT, NOW, V3 Backlog

### Community 133 - "match-receipt.js"
Cohesion: 0.60
Nodes (5): crypto, normalizeMatchReceipt(), receiptPayload(), signMatchReceipt(), verifyMatchReceipt()

### Community 134 - "checkpoint-lifecycle.test.mjs"
Cohesion: 0.40
Nodes (3): compileAppMethod(), extractAppMethod(), mainSource

### Community 135 - "ui-redesign.test.mjs"
Cohesion: 0.33
Nodes (5): cosmetics, css, html, main, ui

### Community 136 - "Q: Tum onerilen oyun, lobi, market ve ilerleme ozelliklerini ekle"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Tum onerilen oyun, lobi, market ve ilerleme ozelliklerini ekle, Source Nodes

### Community 137 - "Q: Daha ne eklenir veya gelistirilir"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Daha ne eklenir veya gelistirilir, Source Nodes

### Community 138 - "Q: V tusunu push-to-talk voice chat yap, team/FFA proximity ve canli ekonomi ekle"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: V tusunu push-to-talk voice chat yap, team/FFA proximity ve canli ekonomi ekle, Source Nodes

### Community 139 - "Q: Dodgb-v3 detayli skin sistemi nasil genisletildi ve guvenli tutuldu?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Dodgb-v3 detayli skin sistemi nasil genisletildi ve guvenli tutuldu?, Source Nodes

### Community 140 - "Q: Knife model, animation, equip, preview ve network akislari nerede ve nasil genisletilmeli?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Knife model, animation, equip, preview ve network akislari nerede ve nasil genisletilmeli?, Source Nodes

### Community 141 - "Q: How do arena maps, avatar skins, practice, player, and store connect for the cosmetic practice range?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How do arena maps, avatar skins, practice, player, and store connect for the cosmetic practice range?, Source Nodes

### Community 142 - "Q: [social, hub, shop, achievements, challenge, skill, quick, lobby, multiplayer, ball, spawn, bot]"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: [social, hub, shop, achievements, challenge, skill, quick, lobby, multiplayer, ball, spawn, bot], Source Nodes

### Community 143 - "shop-showcase-ui.test.mjs"
Cohesion: 0.40
Nodes (3): css, html, ui

### Community 144 - "ball-skins.test.mjs"
Cohesion: 0.50
Nodes (3): EXPECTED, NEW_SKIN_IDS, testableSource

## Knowledge Gaps
- **552 isolated node(s):** `MAP_THEMES`, `THREAT_ENTER_SECONDS`, `THREAT_COOLDOWN_MS`, `HEAD_FRONT`, `AVATAR_MODELS` (+547 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Preferred sources** — corroborated by past sessions; start here.
- `Store` (3× useful, score=2.997302131) _(code changed — re-verify)_
- `Player` (2× useful, score=1.999352641) _(code changed — re-verify)_
- `MAPS` (2× useful, score=1.998218926) _(code changed — re-verify)_
- `Network` (2× useful, score=1.997353116) _(code changed — re-verify)_
- `Game` (2× useful, score=1.997171044) _(code changed — re-verify)_
- `VoiceChat` (2× useful, score=1.996692775)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Game` connect `Community 6` to `Community 32`, `normalizeWearableLoadout`, `Community 5`, `Community 39`, `combat.js`, `network.test.mjs`, `.updatePowerUps`, `._createRemotePlayer`, `.showGameOver`, `Community 23`, `Community 26`, `Community 29`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `App` connect `Community 0` to `.updateCarousel`, `Community 4`, `Friends`, `.setupMenuHandlers`, `.showGameOver`, `._setupClientNetHandlers`, `.awardMatchRewards`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `Network` connect `Community 1` to `.constructor`, `._renderTeamLists`, `network.test.mjs`, `.handleMessage`, `.showGameOver`, `mesh-security.test.mjs`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `MAP_THEMES`, `THREAT_ENTER_SECONDS`, `THREAT_COOLDOWN_MS` to the rest of the system?**
  _552 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06519114688128773 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07673469387755102 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10168350168350168 - nodes in this community are weakly interconnected._