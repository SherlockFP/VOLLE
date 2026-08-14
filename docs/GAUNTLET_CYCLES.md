# Warrball Gauntlet Cycles

> Canonical execution roadmap. Updated: 2026-08-14.
> Product outcome scores move only with player/runtime evidence, never from code volume.

## Operating loop

Every active block follows one bounded loop:

0. **SOL/Root preflight only for high-risk boundaries.** The preceding SOL decision
   normally supplies the next task card. A new schema, protocol, simulation clock,
   migration, or public authority path additionally gets a short contract/no-go lock
   before TERRA writes code. Ordinary UI/content fixes skip this ceremony.
1. **TERRA High — Deliver.** Implement the single assigned bottleneck, then produce
   one compact evidence pack: before counterexample, changed behavior, focused tests,
   runtime screenshot/gameplay trace where relevant, and a performance benchmark or
   explicit reason that the metric does not apply. TERRA does not grade its own work.
2. **Risk gate — QA and LUNA only where useful.** QA cold-checks correctness,
   authority, persistence, migration, protocol, and regression risk. LUNA cold-checks
   visible gameplay, art, layout, motion, accessibility, and responsive runtime.
   Pure logic does not automatically spend a LUNA pass; pure styling does not
   automatically run a broad QA suite.
3. **SOL High/Ultra — Direct.** Review only the task card, diff, and evidence pack.
   Score the affected pillars from 0–10, find regressions/design drift/performance
   problems, and return exactly one decision: `PASS`, `FIX`, or `NEXT`.
4. **TERRA High — Correct.** A `FIX` returns as one narrow correction task. A P0
   stays active until resolved. A P1/P2 gets at most two focused correction passes;
   if it still misses the gate, record evidence and defer it without blocking an
   independent cycle forever.
5. **SOL High/Ultra — Select next.** After `PASS`, choose the single highest-impact
   independent bottleneck from current runtime evidence. Do not reopen completed work
   without a reproducible regression.
6. **Root — Integrate and close.** Preserve file ownership, run only invalidated
   final checks, update this file and `MIMO.md`, and commit only when the user asks.

Only one product bottleneck is active at a time. Parallel work is allowed only for
independent file ownership such as gameplay correctness and visual presentation.
Agents receive a narrow task card plus relevant diff/evidence, not the full conversation.
This keeps the director independent and limits token duplication.

## Global rules

- Dodgeball remains the flagship competitive mode.
- Volleyball remains local-only until its spatial-contact and network-authority
  gates pass. `canHostSport(VOLLEYBALL)` stays false before that point.
- Ranked and paid progression never grant gameplay power.
- The host is authoritative for current P2P gameplay; clients never author score,
  HP, elimination, rewards, or final results.
- Main/update hot paths target zero new allocation per simulation tick.
- UI keeps the center and lower-middle playfield clear. Text-heavy surfaces stay
  in accessible DOM; WebGL owns the arena.
- New external assets require clear provenance and a browser-budgeted shipping
  format. Generated artwork must match the established premium voxel sport style.
- Repowise and Graphify are not part of this roadmap unless the user asks for them.

## Evidence baseline

Baseline immediately before Cycle D1:

- Commit: `8857f87`
- JavaScript syntax: 105 files PASS
- Full regression: 1,731/1,731 PASS
- Focused foundation/auth/authority/Volleyball gate: 66/66 PASS
- Public Volleyball host: disabled
- Player-outcome, retention, revenue, and market-fit scores: **NOT MEASURED**

The full suite proves regression safety, not fun, clarity, or commercial outcomes.
Those require runtime playtests and real cohorts.

## Score rubric

Each visual or gameplay cycle records a before/after rubric. Scores are readiness
signals, not claims of player retention.

| Pillar | Evidence needed to raise it |
| --- | --- |
| Core fun | Controlled playtest plus rally/completion/rematch evidence |
| Kill/impact satisfaction | Exactly-once semantic trace, three-frame runtime capture, audible/visual hierarchy |
| UI/UX | Task completion, responsive geometry, keyboard/pointer flow, no console errors |
| Art direction | Consistent silhouette/material/palette review in the running game |
| Performance | Measured p95 frame time, renderer memory/draw-call lifecycle, allocation audit |
| Network readiness | Real two-peer connect/convergence/reconnect evidence plus protocol abuse tests |
| Social value | Party journey completion and real funnel/return evidence |
| Retention/commercial | Eligible cohort and currency-separated telemetry; otherwise stays unmeasured |

## Active cycle — D1: Elimination Clarity and Match Closure

### Verified baseline

- Instagib currently sends `maxHp` through normal shield/resistance handling, so a
  shielded Player or Bot can survive a supposed one-hit elimination.
- A host can broadcast a lethal hit before `alive` is flipped, creating the
  contradictory packet `lethal:true`, `hp:0`, `alive:true`; a client can then run
  its revive reconciliation.
- Final rounds show `Next round` during the round-end delay.
- Local/host and P2P lethal presentation are duplicated and visually unequal.
- The current Match Report is a narrow light receipt inside a dark neon sports
  game. Runtime visual baseline: 5.3/10 overall, 3.5/10 art cohesion.

### D1A — Lethal truth and confirmation

Scope: `js/game.js`, a small pure presentation helper if needed, and direct tests.

Exit gates:

- Instagib eliminates Player and Bot with shields 0/1/25 and damage reduction;
  ordinary modes retain shield absorption.
- Every authoritative lethal packet satisfies `hp === 0 && alive === false`.
- A defensive client never revives from contradictory legacy lethal input.
- Repeated overlap produces one KO, one score mutation, one round transition,
  and one canonical confirmation.
- Local/host and P2P show one named KO cue for at least 500 ms; nonlethal hits show none.
- Final round never says `Next round`; overtime and ordinary rounds remain correct.
- No hitbox, deflect, ball-speed, damage progression, scoring-formula, or reward
  changes beyond restoring the one authoritative lethal transition that was missing.

### D1B — Arena Broadcast Aftershow

Scope: one optimized generated Victory key art, canonical postgame DOM/UI/CSS, and
responsive tests. Reward/economy semantics remain unchanged.

Exit gates:

- In a deterministic settled fixture that actually grants a drop, 1280x720 and
  1440x900 show result, final score, Rematch, and that first real drop above the fold
  in a dark 960–1040 px arena-broadcast composition. A no-drop receipt stays truthful.
- 375x812 has no horizontal scrolling, table squeeze, or sub-12px core copy;
  touch actions are at least 44 px.
- Normal text contrast is at least 4.5:1 and large text at least 3:1.
- Structural emoji are replaced by the existing SVG language.
- Reduced motion keeps all outcome information without essential animation.
- The bitmap is decorative; winner/result/score/actions remain selectable,
  accessible DOM and work if the image fails to load.

### D1 integrated gate

Solo 1v1 Instagib with a shield and a real two-peer lethal trace must agree on
victim state, score, round transition, and exactly-once presentation. LUNA then
captures impact/KO/aftershow at desktop and mobile. D1 closes only after both sides pass.

## Dependency-ordered queue

### S1 — One Dodgeball simulation clock

Unify solo and host gameplay under a fixed 60 Hz simulation step, with render
interpolation and explicit input sampling. Export a renderer-free/headless simulation
boundary consumed later by R1. Preserve all physics constants. Exit: after 300 warmup
ticks, the same 10,000-tick input trace at 30/60/120/144 render FPS produces identical
winner/HP/score/rally count and a final player/ball position delta <= 0.01 world units;
two repeated headless runs have the same checksum; retained-heap growth over the final
5,000 ticks is <= 1% after forced GC in the test harness, with no new object creation in
the instrumented steady tick.

### D2 — Dodgeball skill-loop evidence and tuning

Measure rally length, deflect reject reason, facing angle, route angle,
time-to-impact, and rematch intent. Tune only a proven problem. Preserve rear-click
rejection, uncapped linear rally speed, host authority, and frame-equivalent steering.
Exit: a fixed 240-attempt matrix at 30/60/120/144 FPS yields identical accept/reject
reasons, zero rear-facing accepts, and route position drift <= 0.04 world units; a
headed 10-player moderated test requires at least 8 players to complete one three-return
rally within three attempts before any feel score may rise.

### V3 — Spatial Volleyball contact authority

Connect player position, jump height, reach, facing, and bounded input timing to
the existing local Volleyball controller. Remove ball-position contact teleport.
Exit: an idle/out-of-range player cannot complete the scripted chain; a player can
move through Receive → Set → Spike at 30/60/120/144 FPS with equal results.

### V4 — Local Volleyball team rhythm

Add deterministic receiver/setter/spiker roles, teammate positioning, three-contact
ownership, block exception, service rotation, and readable callouts. No P2P, ranked,
coach system, economy, or new arena in this block. Exit: 100 seeded rallies never
exceed three team contacts; blocks consume zero team contacts; every side-out produces
exactly one rotation; repeated seeds produce identical role/target decisions; runtime
completes Pass → teammate Set → player Spike without console errors.

### P1 — Durable transactional player ledger

Migrate profile/currency/inventory/reward receipts from whole-file JSON mutation to
the existing built-in SQLite boundary with an idempotent export/rollback path.
No formula, price, odds, or catalog changes. Crash/restart and concurrent mutation
tests must prove no duplicate items or negative currency. A configured Render
`DATA_DIR`/persistent disk gate must survive a deploy-style process restart with the
same account session, profile, currency, and inventory. Missing persistence makes
`/healthz` readiness fail explicitly rather than silently accepting durable login.

### N1 — Private Volleyball P2P convergence

Add a ruleset/config fingerprint, host-authoritative Volleyball inputs/snapshots,
sport-safe lobby validation, and reconnect recovery behind a private flag. Public
hosting remains disabled until two real browsers converge for 20 rallies and reject
malformed, stale, and duplicate inputs atomically. Host/client score, phase, contact
count, and ball snapshot remain equal after every rally; position error after smoothing
is <= 0.10 world units. A forced disconnect must recover to the same rally or a safe
next-serve state within 8 seconds, otherwise the private gate stays closed.

### R1 — Authoritative Dodgeball 1v1 prototype

Use the extracted pure simulation boundary for a server-ticked experimental 1v1.
ELO/rewards may only consume its terminal receipt. No 3v3, Volleyball ranked, or
public ranked reward during the prototype. Exit: 100 deterministic client/server traces
produce identical terminal digests; forged winner/score, duplicate/out-of-order input,
and client-authored rewards mutate nothing; reconnect/abandon resolves deterministically;
only the server terminal receipt can unlock ELO or a reward.

### L1 — Party-to-rematch continuity

Prove a 2–4 player party across menu → lobby → match → rematch, including leader
exit and failed follow recovery. Do not add a new hub, clan, referral, or dark pattern.

### A1 — Renderer budget and showcase art

First add runtime renderer diagnostics and complete the shared particle geometry/material
pass; only then polish the two flagship arena identities (Volleyball and Factory),
character/live-preview parity, collection-card imagery, and core HUD contrast. Measure
the same device/browser at 1280x720, Medium quality, one fixed map/camera/input trace,
10-second warmup and 60-second samples repeated three times. Exit: median p95 frame time
is no worse than 5% versus baseline; renderer geometry/material/program counts return
within 2% of baseline after 10 rounds; ball/team/threat readability passes LUNA at
720p/1080p; low quality keeps bloom disabled.

## Deferred until evidence exists

- Public/ranked Volleyball
- Ranked 3v3 and tournament broadcast
- Coach AI and public creator maps
- Creator payouts and paid random cases
- Retention, conversion, revenue, or market-fit score increases without cohorts
