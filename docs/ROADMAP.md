# 2BALL Development Program

Start: 2026-07-18

## Product goal

Fast browser dodgeball with reliable P2P play, strong movement, short matches,
fair cosmetic progression, and shareable highlights.

## Release gates

Every stage must pass:

1. `npm test`
2. `npm run check`
3. No new `git diff --check` errors
4. One failure-path test for the changed system

## Stage 0 - Baseline and safety (Week 1)

- Add zero-dependency Node tests.
- Cover network codecs, sequence ordering, store purchases, mastery, replay import.
- Record current gameplay constants and network packet formats.
- Keep `MIMO.md` synchronized with implemented features.

Done when tests run on a clean Node 18+ install.

## Stage 1 - Networking reliability (Weeks 1-2)

- Position packet sequence numbers and stale-packet rejection.
- Smoothed clock offset from ping/pong.
- Velocity-aware interpolation and bounded extrapolation.
- Reconnect grace period before returning to menu.
- Host migration protocol for lobby and active matches.
- Packet-loss, jitter, and 50-250 ms latency simulation tests.
- TURN/relay deployment design for restrictive NAT.

Done when two clients survive packet reordering, a short disconnect, and host
migration without resetting the match.

## Stage 2 - Performance (Week 3)

- Pool ball trail meshes, particles, damage numbers, and temporary effects.
- Add renderer quality presets and automatic quality fallback.
- Dispose map resources on rebuild.
- Add frame-time and live object counters in debug mode.

Targets:

- 60 FPS at 1080p on a mid-range laptop.
- No unbounded mesh/material growth during a 20-minute match.
- Under 16.7 ms median frame time; under 25 ms p95.

## Stage 3 - Match flow and replay (Week 4)

- Quick Play -> match -> results -> rematch flow.
- Reconnect UI and network status indicator.
- Replay library screen with play/delete/export/import.
- Automatic highlights: perfect deflect, clutch, longest rally, multi-kill.
- Shareable compact replay code.

Done when a player can finish and replay a match without returning to setup
screens.

## Stage 4 - Online progression (Weeks 5-6)

- Account/session service.
- Cloud save with schema versioning.
- Authoritative coins, inventory, ranked rating, and leaderboard.
- Match result validation and idempotent reward grants.
- Casual and ranked matchmaking queues.
- Party queue and region/ping preference.

Security rules:

- Client never decides coin balance, ownership, or ranked result.
- Gameplay skills are earned through play; shop focuses on cosmetics.
- Every reward request has a unique match/result identifier.

## Stage 5 - Content and retention (Week 7)

- Polish 4-6 competitive maps before adding more.
- Weekly rotating modes.
- Character mastery rewards.
- Cosmetic skin, trail, deflect sound, kill effect, and victory pose catalog.
- Daily/weekly challenge refresh from server time.
- Seasonal ranked rewards.

## Stage 6 - Accessibility and release polish (Week 8)

- Gamepad support and remapping.
- Color-blind team palettes.
- Reduced motion, shake, flash, and bloom options.
- UI scale, subtitles, and sound indicators.
- Mobile/touch feasibility pass.
- Tutorial telemetry and first-match bot protection.
- Production error logging and privacy-safe performance metrics.

## Architecture direction

Gradually extract from `main.js` and `game.js`:

- `MatchFlow`
- `GameSimulation`
- `CombatSystem`
- `NetworkReplication`
- `ProgressionService`
- `EffectPool`

No large rewrite. Each extraction must preserve behavior and pass tests.

## Implementation log - 2026-07-18

Completed:

- Position sequencing, stale-packet rejection, clock sync, bounded reconnect.
- Ball trail pooling and immediate low/medium/high renderer profiles.
- Replay archive, validation, 4 Hz world snapshots, ball trajectory playback.
- Persistent guest sessions, token auth, disk profiles, server catalog purchases.
- Bounded/idempotent match rewards and first-save whitelist migration.
- Deterministic portals, open-air spawn fix, boundary guides, map theme fallback.
- Reduced motion, shake, flash, contrast, color-vision settings.
- First-launch tutorial routing.

Remaining production gates:

- Abrupt host migration and restrictive-NAT TURN/relay.
- Dedicated authoritative match validation for ranked/paid economy.
- Steam authentication, App ID, payment provider, receipt verification.
- Gamepad/remapping, UI scale, subtitles, touch feasibility.
- Real-device 20-minute frame-time and memory soak tests.
