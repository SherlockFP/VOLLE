# MIMO.md — 2BALL Project Current State

> **Last updated:** 2026-08-14
> **Status:** Active Gauntlet development. Canonical cycle order and exit gates live in `docs/GAUNTLET_CYCLES.md`.
> **Tech Stack:** Three.js + PeerJS + vanilla JS (ES modules), browser-based 3D dodgeball.

---

## 2026-08-14 Sport Foundation and Gauntlet Baseline

- **Sport routing:** Quick Play now enters a keyboard-accessible Dodgeball /
  Volleyball selector. Dodgeball retains its live P2P directory; Volleyball is
  explicitly local-only and cannot host or join public rooms yet.
- **Volleyball local skeleton:** isolated deterministic rules, score, physics,
  controller, contact adapter and Practice runtime support Serve / Receive / Set /
  Spike / Block, three-contact ownership, rally scoring and fixed-step snapshots
  without importing Dodgeball combat, networking, cosmetics or economy.
- **Dodgeball feel:** aimed returns preserve more deliberate side/rear routing,
  clean bank shots own their reflected heading briefly, rear-facing deflects are
  rejected on both prediction and host admission, and incoming direction/ETA has
  a bounded responsive HUD lane.
- **Audio:** five Kenney CC0 interface/impact clips augment rather than replace
  the existing procedural competitive cues; provenance is stored in-repo.
- **Current audit baseline:** commit `8857f87`; JavaScript syntax passes 105 files
  and the full suite passes 1,731/1,731. This supersedes older 1,541-test counts.
- **Active Cycle D1:** Instagib shield handling and contradictory P2P lethal state
  are confirmed correctness defects. Kill confirmation and the mismatched light
  Match Report are being addressed before further Volleyball expansion.

---

## 2026-08-13 Gameplay Reliability, Viewmodel and Interface Cycle

- **Terminal hit reliability:** close floor-level balls that are still moving
  tangentially now converge on the target capsule instead of orbiting forever.
  Repeated capsule overlap no longer resets the pending lethal deadline, so
  Instagib eliminates once and advances the round. Pausing or backgrounding an
  offline match only settles an already incoming ball for a bounded two-second
  window; players, bots and the score clock remain frozen, and a P2P client
  never takes host simulation authority.
- **Ball cosmetics end to end:** the equipped ball skin is normalized through
  Store, retained through spawn/deflect material refreshes, and synchronized in
  binary ball state plus welcome/game-start/round-start/reconnect packets. Shop
  ball selection now drives the persistent large Live 3D showcase rather than
  only changing copy and a CSS placeholder.
- **First-person collection:** the allocation-free hand/knife pose state now
  supports draw/inspect, slash and heavy-thrust presentations. Three original
  knife silhouettes and three glove families were added to the mirrored
  client/server case catalogs; gloves cover first-person cuffs/palms/knuckles
  and both full-character hand sockets. Soldier rocket and Practice controls
  retain their existing input ownership.
- **Competitive interface:** the HUD uses a compact red/round/blue score lane,
  text-only network/FPS diagnostics, a 12-action SVG emote wheel with keyboard
  and pointer control, and Player/Chase/Free spectator camera controls with
  previous/next targeting. The social rail has party, Friends/Online/Nearby,
  profile-code, invite and responsive collapsed states; its toggle remains
  reachable and reopens at narrow widths.
- **Menu and lobby scalability:** the authenticated CS-inspired landing page,
  Shop decision layout, P2P match browser and team lobby use the shared eight
  route design language. Desktop short-height gates now fit both match browser
  and team lobby into an exact 1280x720 viewport without document overflow;
  the P2P flow intentionally has no fake region selector.
- **Session and voice:** token-based account restore survives reload until
  explicit logout without storing plaintext credentials. Automatic first-entry
  tutorial overlays were removed while manual How to Play/Practice remains.
  V push-to-talk keeps team filtering and adds distance gain plus stereo pan;
  FFA voice is proximity bounded.
- **World presentation:** Volleyball grows from 52x68 to 58x75 and Factory from
  101x112 to 111x123, with brighter map-specific exposure, floor and palette
  profiles. The single social map is now the compact Neon Clubhouse with a
  walkable lounge, stage, pool and garden using a curated CC0 Kenney Furniture
  Kit subset plus procedural fallbacks and local license metadata.
- **Verification:** `node scripts/check-js.js` passes 96 files; the full suite is
  **1,570/1,570**. The refreshed Graft wiring graph is in sync at 3,551 nodes and
  8,855 edges. Runtime browser QA passed auto-login, the eight-route main menu,
  Shop selected-item flow, responsive social reopen, global P2P match browser,
  team lobby and exact 1280x720 height gates without console warnings/errors.
  Microphone hardware, a real two-peer session and real retention/revenue KPI
  movement remain unmeasured and must not be inferred from these checks.

## 2026-08-12 Menu, Commerce, Identity, Ball and Social Cycle

- **CS-style main lobby:** the authenticated landing screen now keeps the exact
  eight-route navigation (`Play / Ranked / Arcade / Custom / Locker / Battle
  Pass / Shop / Profile`), a live full-body voxel hero, Quick Play focus, party
  leadership and a nearby-player rail in one wide composition. Exact 375x812
  QA reached every route through the left-aligned horizontal rail with no page
  overflow or console errors.
- **Server-owned party discovery:** presence exposes bounded, opt-out nearby
  discovery; invitations expire, party capacity is eight, and only the server
  party leader can invite. Logout removes ghost presence and concurrent party
  operations remain atomic. Gameplay transport remains P2P.
- **Shop and Locker separation:** Shop is purchase/preview-only; Locker owns
  `Loadout / Inventory / Cards`. All client-visible ball and wearable catalog
  entries have matching server prices/types. Character cards use distinct
  generated portraits, owned inventory has readable metadata, and wearable
  Inspect applies a temporary live 3D preview without mutating the loadout.
- **Case reveal lifecycle:** the CS-style reel keeps its result and
  `Inspect / Equip / Open another / Close` actions on screen after settling,
  supports skip/reduced-motion/Escape/focus trapping, and ignores stale reveal
  callbacks. `Open another` starts one direct server/fallback opening without a
  second confirmation; the in-flight guard prevents duplicate charges.
- **Canonical voxel identity:** the shared classic/slim character rig now uses
  exact 64x64 Minecraft-style proportions (16px world unit, 8x8x8 head,
  8x12x4 torso, separate arms/legs), so head and body skins update together.
  Existing wearables provide hats, capes, wings, backpacks and other silhouette
  changes without replacing the animation/socket contract. Imported Kenney GLB
  characters remain unsuitable as sellable player models until they receive a
  skin, socket, pose and P2P adapter.
- **Ball reliability and escalating rallies:** terminal steering rescues a ball
  that is close to its target but moving tangentially/away, preventing the
  reported endless horizontal orbit. The former 6x/102 gameplay cap is removed:
  every deflection adds another linear +30% base-speed step. Spike retains a
  stable 1.2x modifier without exponential compounding. P2P rejects non-finite
  or abusive ball packets above the separate 16,384 protocol safety bound while
  leaving the player-motion bound unchanged.
- **Trails and arena presentation:** seven trail families now select four shared
  silhouettes (orb, shard, crystal, pixel); trail sampling reuses persistent
  vectors instead of allocating clones in the hot path. Default, Neon and Grand
  Stadium explicitly reset exposure, sun and bloom presentation on every map
  rebuild, preventing dull cross-map leakage while retaining low-quality bloom
  disablement.
- **Case transport idempotency:** an ambiguous network/JSON/5xx failure retains
  the account-and-case-scoped request ID for the next manual retry, so a server
  commit with a lost response cannot charge twice. A confirmed success or
  definitive 4xx rotates the key; concurrent same-case calls share one flight.
- **Verification:** `node scripts/check-js.js` passes 96 files; the full suite is
  **1,541/1,541**; the refreshed Graft wiring graph is in sync at 3,480 nodes and
  8,692 edges. Runtime visual QA passed the main menu, 10/10 Shop portraits,
  wearable live preview, Locker separation and case inspector at 1440x900 with
  no console errors. Real cohort FUN/retention/revenue outcomes remain NOT
  MEASURED.

## 2026-08-11 Quality-First Product Cycles

- **Graft code context:** NanoNets Graft 0.9.1 is pinned as repo-local
  development tooling through `npm run graft:build`, `graft:check`, and
  `graft:map`; it is not a game/server runtime dependency. The structural graph
  is a regenerable ignored cache (`graft/`), while `.ignore` keeps its cards
  searchable. The first build indexed 264 JavaScript files into 3,180 nodes and
  7,950 edges without telemetry or an LLM/API key; the latest clean rebuild
  covers 280 files / 3,311 nodes / 8,237 edges and `graft:check` reports the
  graph in sync.
- **Core-fun reliability:** countdown warm-up balls now accept the first primary
  attack; bot deflect decisions begin early enough to cover reaction + wind-up
  and hold position through commitment. Regression coverage lives in
  `tests/first-shot-reliability.test.mjs` and `tests/bot-deflect-regression.test.mjs`.
  Ordinary deflects outside the perfect window no longer throw on Ball's valid
  `Infinity` sentinel. Automated pointer-lock still limits a real two-deflect
  browser check.
- **Hit-feedback semantics and cost:** Classic/local-host and P2P client paths
  no longer invoke elimination shaders, explosion audio, death particles or the
  external elimination feed for ordinary nonlethal hits. Normal damage still
  keeps its hit burst, shockwave, hit-stop, flash, impact sound and local victim
  grunt; lethal hits retain the stronger kill burst, sparks, death explosion,
  death cue and killcam. This removes 28 per-event mesh/geometry/material
  allocations from every nonlethal hit without changing damage, authority or
  `playerHit` packets. A compiled shipped-method harness passed local, host and
  P2P lethal/nonlethal traces; transient particle/audio A/B remains unverified.
- **Death-particle frame cost:** the active death-particle update no longer
  clones a `Vector3` for every particle on every frame; it integrates velocity
  with in-place `addScaledVector`. Numeric harness QA matched the prior position
  delta and preserved gravity, life, opacity, scale, spin, bounce, scene removal
  and GPU resource disposal. This is an allocation reduction, not a measured FPS
  claim.
- **Live assigned-ball threat:** the previously dormant incoming UI and urgency
  audio scheduler now receive the local assigned target at a bounded 20 Hz
  after local/host and P2P-client ball updates. Target loss, ball deactivation,
  player death and state exit clear once without changing trajectory, damage or
  packets. In a real Classic desktop match `INCOMING 1.0S` appeared before a
  100-to-62 HP hit, reached critical at impact, then hid. A measured 375px score
  collision was moved to a dedicated 84px mobile lane with 12px text; active
  mobile recapture and a real two-peer listening soak remain WARN.
- **Mobile lobby access:** at 375x720 the center column no longer collapses to
  zero or paints beneath the team cards. The body is the single top-aligned
  scroll owner; map, mode, settings, chat, both teams and Start are reachable.
  Runtime QA changed Classic with a real 94x44 click, sent chat and changed map
  and teams. The responsive header is 375/375px client/scroll width, bounds the
  room UUID, and ellipsizes mode/map with an 8px gap before REGION.
- **Initial P2P lobby-state sync:** the reliable host `lobbyState` now carries
  mode/map and reaches the App presentation callback exactly once, while the
  direct Game fallback remains available for transport-only consumers. A fresh
  two-account Card Join rendered the host's preselected Speedball + Factory on
  the first captured client state without a corrective host action. A later
  Low G + Space Station change synchronized within 900 ms; room UUID,
  `lobby-client` role, disabled/hidden host controls, team/chat sync and client
  Start denial also passed with an empty browser-error log.
- **Frame-rate-independent dash:** dash displacement now consumes only the
  remaining burst duration instead of a full render-frame step. The previous
  path travelled 1.80u at 20 FPS and 1.50u at 144 FPS for a nominal 1.44u
  burst; the executable 20/30/60/120/144 FPS matrix now lands at 1.44u within
  0.01u with no terminal extra step. Direction, 25 stamina cost, 1s cooldown,
  collision clipping and reported momentum remain covered. Runtime visual QA
  found no teleport/final lurch; automated pointer-lock input remains a QA
  harness limitation rather than a claimed player defect.
- **Dash state readability:** the existing `_justDashed`/`dashTimer` signal now
  drives a mutually exclusive `DASH` movement-HUD state with priority below
  longjump and above bhop/sprint. The restrained accent has a static
  reduced-motion fallback and does not touch physics, audio or networking.
  Actual UI/source gates and the full suite pass; browser automation could not
  generate a held-key pointer-lock burst, so active-frame visual readability
  remains WARN rather than a scored improvement.
- **Dash onset audio:** an accepted dash now invokes one dedicated named cue
  after cooldown/stamina/longjump gates pass; active frames and rejected inputs
  remain silent. A 130ms triangle body (330->225Hz) plus 100ms rising sine air
  layer (980->1480Hz) is quieter and structurally distinct from the 160ms
  descending filtered-noise throw whoosh, while both retain the existing
  master/tone/limiter chain. The cue registry's first-call-at-time-zero bug was
  fixed, and failed/missing cue functions no longer poison retry cooldowns. No
  asset, physics or network path changed. Routing/envelope QA and the full suite
  pass; browser pointer-lock and audible headphone mix remain WARN.
- **Authoritative three-second match start:** the duplicated default 10s + 3s
  countdown is now one `3 → 2 → 1 → GO` phase. `GO` crosses the gameplay
  boundary immediately and remains a shared 500ms presentation on host/client.
  A connected client prepares in COUNTDOWN on `gameStart` and can enter PLAYING
  only from the host's `roundStart`; it does not spawn/target a local ball or
  create an FFA split, and applies the host ball snapshot once. Before the fix,
  a real client moved the ball 13.381s before its host; after the fix neither
  timer nor ball moved early, first-ball skew was 125ms and GO-hide skew was
  125ms. A follow-up foreground solo trace separated 2.896s of browser-tool
  delivery overhead from the product: click-return to COUNTDOWN was 0.974s and
  click-return to first live ball was 4.684s, so the product clears the `<5s`
  local time-to-action gate. A real `match_start` event reported 961.3ms loader,
  23.8ms setup and 993.6ms click-to-countdown, matching the independently polled
  DOM within 12-20ms. Cohort pacing remains NOT MEASURED.
- **Readable opening warmup:** the former z9999, 92-98% opaque intro no longer
  hides the arena or the first countdown frames. Arena/mode identity is a
  compact `WARMUP` chip below the score, the countdown owns a separate y128+
  lane, and controls/threat presentation stays hidden until GO. Host/solo
  authority caps only an unusually short opening serve so every initially
  assigned target has a deterministic >=1.0s ETA without delaying GO or
  changing client authority. Independent desktop/mobile visual QA found no
  score/intro/countdown/control intersection; a fresh solo run reached live in
  4.657s after click return. Exact first-assignment ETA was not captured in that
  runtime sample and remains source/test verified rather than visually timed.
- **First-solo response guard:** a deterministic 240-opportunity audit found
  240/240 ball launches and zero timing/range failures after a bot committed;
  solo play never traverses P2P. The reported "first two shots" feel came from
  consecutive difficulty chance-roll declines (22/40 seeded Easy pairs and
  5/40 Medium pairs). Only the first offline bot match now guarantees the
  second opportunity after an opening decline, while preserving reaction,
  wind-up, mishit, later-round and multiplayer behavior.
- **P2P startup reliability:** `gameStart` is retained and retried across brief
  signaling loss, duplicate starts are idempotent, and existing WebRTC data
  channels survive a broker disconnect where PeerJS permits it. Fresh host and
  client browsers held for 8.5+ seconds at roughly 20-28 ms / 0% observed loss;
  both entered the match within five seconds. Production TURN/signaling and a
  longer multi-peer soak remain launch requirements.
- **P2P deflect/admission hardening:** a client's host echo of its predicted
  deflect no longer re-arms local attack state or replays audio/FX; remote
  deflect presentation remains intact. Host acceptance is locked by shipped-
  method tests at the speed-scaled dedup boundary, including unique, duplicate,
  queued and late-deflect cases. Lobby creation now awaits its private server
  admission token, clears stale host state, forwards a late token only to
  admitted/open clients through a host-only `lobbyAdmissionProof` packet, and
  refuses an empty proof before calling `/join`. The small proof packet is sent
  before gameplay callbacks and the full lobby snapshot, so either presentation
  path can fail without invalidating transport admission. Deterministic tests
  and the full 1,392-test suite pass. A fresh two-account browser gate then
  completed host creation, private proof, authenticated `/join` (HTTP 200),
  reciprocal roster and host start into both matches; the observed high-latency
  local run reported 306-330 ms and 0% loss. Five controlled consecutive
  deflects remain WARN because browser automation could not reacquire pointer
  lock reliably.
- **P2P progression authority:** arbitrary client match IDs can no longer mint
  currency or ranked ELO. The host receives a private lobby admission proof,
  sends it only after the existing P2P identity/password handshake, and the
  server freezes the authenticated starters before accepting coherent results.
  Real isolated two-account HTTP QA passed proof privacy, capacity, early-result
  rejection, reciprocal settlement, finalized polling and persisted 1024/976
  ELO. Solo rewards are server-capped at three per UTC day and ranked repeats at
  three matches per opponent/day. P2P collusion and pending-match recovery after
  a server restart still require authoritative simulation/persistence work.
- **Full-body player identity:** the custom 64x64 Minecraft-style atlas now maps
  head, torso, both arms, and both legs on the shared character rig. Classic and
  slim models propagate through menu, Shop, Character Studio, cosmetic practice,
  gameplay, bots, and P2P roster metadata. Character rigs also expose distinct
  silhouettes/signatures instead of sharing only a head treatment.
- **Premium Shop flow:** item cards are browse/select surfaces; inspect,
  buy/equip state, price/ownership, and the explicit Practice action live in one
  selected-item panel next to the live 3D avatar. Selecting no longer auto-loads
  Practice. Desktop and 375x812 mobile runtime QA passed; mobile still needs a
  small future polish pass because the first catalog item starts just below the
  initial viewport and the leftmost tab can graze the edge.
- **Identity + one-more-match visual gate:** non-atlas rigs now use an intentional
  face plate and two readable block eyes; a cache-busted Neon Runner A/B passed
  at the real Shop scale while saved custom atlases retain their own face. The
  populated post-game report puts Rematch in the first desktop/mobile viewport,
  moves the detailed report below it, keeps mobile XP on one line, and inserts
  reward flow under the correct nested report parent.
- **Match pacing + rematch repair:** the host-authoritative victory lap is now
  8 seconds instead of 30; the visible post-game Rematch action accepts the
  real `GAME_OVER` state, starts a fresh match, and clears the report overlay.
  Match duration now ends at gameplay end while post-game delay and
  post-game-to-rematch decision time are measured separately. Runtime solo
  flow, focused tests, syntax, and full regression pass; player rematch and
  retention outcomes remain **NOT MEASURED** until real cohort events exist.
- **Product/network measurement:** `js/product-analytics.js` and
  `server/product-analytics.js` provide authenticated, allowlisted,
  HMAC-pseudonymous, 90-day product events. Run
  `node scripts/product-kpi-report.js`; formulas and score rules are in
  `docs/PRODUCT_SCORECARD.md`. The current development-local store is not a
  cohort, so D1/D7/D30, conversion, rematch, and P2P KPI values remain
  **NOT MEASURED**. Server-confirmed payments now make payer conversion,
  currency-separated ARPPU and ARPDAU measurement-ready, while the inspected
  store still contains zero live events. Paid Battle Pass conversion is
  explicitly unavailable because no paid-pass SKU exists; soft unlock/claim
  activity is tracked only as engagement.
- **Match-start decomposition:** authenticated `match_start` events now carry
  only bounded monotonic durations (`matchLoadElapsedMs`, `matchSetupMs`,
  `clickToCountdownMs`, each 0-60000ms); no raw timestamps, name, position or
  input leaves the client. The KPI report averages observed samples only. A
  fresh solo run produced exactly one lifecycle event for its match ID and the
  sink retained only a pseudonymous profile key.
- **Analytics runtime delivery:** the authenticated browser initially queued
  events but made no network request because the stored native `fetch` was
  invoked with the analytics instance as its receiver; in-flight events could
  also remain stranded after one batch. Delivery now binds the global receiver,
  drains 20-event batches through one shared flight, preserves failed-batch
  order, and caps attempts at three. Fresh isolated browser QA wrote exactly
  `session_start`, `screen_view`, `ftue_view`, and `ftue_exit` with one 40-char
  pseudonymous key and no username/raw profile ID. This proves collection
  readiness, not D1/D7/D30 or conversion outcomes.
- **First-session path:** fresh accounts now receive an account-scoped welcome
  with a one-click Guided Drill, truthful completion/exit events, and a direct
  first bot-match handoff. The reversed team spawn yaw was corrected so the
  first serve is centered and visible instead of spawning the player toward
  the stands/sky. The account-first drill is now a deterministic 40 seconds
  with reachable 3/2/2 stage thresholds; Help/Practice and retry runs retain
  the full 73-second drill and original 5/4/3 bar. The first result is a positive
  match handoff instead of a low grade, and exactly one `practice_start` reaches
  the real analytics sink. Cache-fresh 375x812 runtime QA passed a readable
  instruction, fully visible compact side gate, zero HUD-region overlap, and no
  page overflow. Result completion/CTA behavior is source/test verified but its
  final browser frame remains unobserved because background RAF automation was
  severely throttled. Merely closing the overlay still does not count as
  completion.
- **Responsive match HUD:** cache-fresh normal-match QA at 375x812, 720x720
  and 1440x900 now reports zero sibling-region intersections and zero page
  overflow. Vitals, ultimate, minimap, ball speed and network diagnostics occupy
  explicit mobile/desktop lanes; the exact 720px breakpoint contains the
  controls strip. Guided Practice keeps its separate compact layout with a
  190px vitals lane and no ultimate collision. First-match hints now wrap inside
  a 16px mobile safe area with vertical-only motion; a live 375px capture
  measured zero internal/viewport overflow and no score or reticle intersection.
  Reduced-motion behavior remains static and readable.
- **Account + social foundation:** playing now requires registration or sign-in.
  Embedded SQLite stores scrypt password hashes, revocable hashed sessions,
  stable `Name#CODE` friend identities, friendships, requests, direct messages,
  and lobby invitations. Two-account browser/API QA passed request, accept,
  chat, invite, logout, expiry, and unauthorized-access paths. Match transport
  remains P2P; account/social/economy authority stays on the local Node server.
- **Menu + progression loop:** the primary navigation is exactly Play, Ranked,
  Arcade, Custom, Locker, Battle Pass, Shop, Profile. Locker exposes an earn-only
  Arena Card collection and five-card same-rarity trade-up. Skills and runes can
  no longer be purchased; competitive/ranked resolves the same neutral card
  effects. Completed matches can grant cosmetic cases with a five-match drought
  guarantee, and earned cases open before credits are charged. The Card
  Collection is now a keyboard-safe fixed inspector with responsive rarity,
  ownership, equip and trade-up states; last verified visual scores are 8.1
  desktop and 7.6 mobile.
- **Account-authoritative Battle Pass:** authenticated tier/XP, claims, premium
  ownership and track boosts now persist in the server profile instead of
  trusting `localStorage`. MatchAuthority settlements grant a fixed 100 XP for
  a win and 80 XP for a loss/draw; replayed settlement grants zero. Claim and
  950-coin premium unlock routes are authenticated, rate-limited, balance-checked
  and idempotent. An isolated browser account retained tier 1 / 60 XP, its tier-1
  claim and 403 coins across reload; reduced-motion success/error messages remain
  visible until their JavaScript timeout. Authenticated Daily Challenges now use
  a server-clock UTC catalog with two play tasks plus one explicitly multiplayer
  win task; MatchAuthority advances them exactly once, claim receipts persist
  truthful capped coins plus 50/50/150 BP XP, and menu/HUD consume one server
  profile. Earned XP boosts now have server-owned, idempotent activation,
  server-clock expiry and authoritative match settlement; they affect only
  Battle Pass XP, never coins, ELO or gameplay power. The Season Value panel
  exposes exact XP-to-tier, ready claims, owned/active boost state and an
  ethical secondary CTA; successful non-replayed activation is instrumented.
  Completion/claim telemetry is emitted only after non-replayed server success.
  The account-relative 56-day season and catch-up/claim-all design remain
  follow-up.
- **Case + hub presentation:** the case inspector shows contents, verified odds,
  pity and earned inventory; normal, skip and reduced-motion reveals share one
  once-only settled callback so rewards are announced after the reel locks. The
  single Aurora Grand Plaza hub has corrected renderer restoration, improved
  lighting, pools/statues and a walk-through Grand Pavilion focal space.
- **Current verified readiness:** `docs/PRODUCT_SCORECARD.md` records an
  **OVERALL PRODUCT READINESS SCORE of 8.6/10** from independent runtime,
  visual, P2P, and 1,491-test gates. Bot defense now chooses one readable
  intent before movement, holds a declined dodge direction for 250ms, caps
  only the bot's combined defensive footwork at 10u/s, and synchronizes yaw,
  intent, strafe and a single deflect telegraph to P2P clients. Ball rally
  acceleration is unchanged: each deflection still increases speed by 30%
  of base up to the existing 3x cap. Player-outcome KPIs remain NOT MEASURED;
  the readiness score is not a retention or revenue claim.

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

### Phase 3 — Accounts & Social (Complete for local development)

| # | Feature | Target File | Status |
|---|---------|-------------|--------|
| 20 | SQLite-backed Registration | `server/account-store.js` | ✅ scrypt password hashing, case-insensitive username |
| 21 | Login with Token Recovery | `server/account-store.js` | ✅ revocable hashed session tokens; internal profile token never reaches the browser |
| 22 | Presence Tracking | `server/presence-store.js` | ✅ in-memory online/offline, 45s TTL, heartbeat API |
| 23 | Auth Modal UI | `index.html`, `css/auth.css` | ✅ register/login tabs, error display |
| 24 | Client Account Module | `js/account.js` | ✅ localStorage persistence, async register/login |
| 25 | Presence Heartbeat | `js/main.js` | ✅ 20s authenticated heartbeat |
| 26 | Persistent Social Graph | `server/social-store.js`, `js/friends.js` | ✅ friend tags, requests, friends, direct messages and lobby invites |

**Key Design:** account login is mandatory by default; `ALLOW_GUEST_SESSIONS=1`
exists only as an explicit development escape hatch. Gameplay transport remains
P2P, while identity, social relationships and economy/profile persistence use
the Node server. P2P host authority is not sufficient proof for trusted ranked
or paid-economy results; production still needs authoritative validation.

**Verified:** full regression `1365/1365`; syntax `96` files; focused
authority/network acceptance `97/97`. Fresh isolated-data HTTP/browser QA passed mandatory auth,
two-account friendship/chat/invite, idempotent reward, earned-case opening,
card equip, purchase rejection and logout revocation.


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
- Historical note: this pass made Classic the default at the time. The current
  2026-08-14 runtime and lobby contract intentionally default to Instagib.
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

---

## V4 Wave 3 — Battle Pass Fix, Case Reveal Tiers, Vendor Lock, Combo Charge, Trophy (2026-07-30)

1081/1081 tests (was 1031), 91 files clean. Self-found complaints + roadmap backlog.

- **Battle Pass screen looked broken** (self-found via screenshot audit). Root causes: (1) the
  "black void circle" was `.progression-ring`'s radial-gradient painting a near-black #082832 hole —
  pure CSS, not a missing asset; replaced with a bright orb + next-reward icon + real conic
  progress ring; (2) hero text inherited dark `--shell-ink` onto a dark teal panel — scoped
  `--ui-text` fix without touching the shared `.panel` rule; (3) "Premium lock everywhere"
  perception was real: the lock state ignored whether the tier was even reached — new pure
  `rewardRowState()`/`tierCardState()` in `js/battlepass.js` are the single source of truth
  (claimed > locked-tier > locked-premium > claimable). Track is now a horizontal scroll-snap
  strip auto-centered on the current tier (rAF-deferred — scrollIntoView while display:none was
  a real no-op bug). Daily↔BP XP bridge already existed (50/task + 100 all-complete); ratio
  verified sane and locked by `tests/battlepass-bridge.test.mjs` instead of duplicating.
- **Case reveal rarity tiers** (`js/cosmetics.js` revealPresentationForRarity, `js/ui.js` reveal
  region): rare and epic genuinely felt identical (same 'medium' tier, zero visual diff). Now:
  rare blue glow → epic purple glow + pulse + tf2_crit → legendary gold + confetti + pre-stop
  hitch + fanfare. CSS-driven, NOT `juice.slowMo()` — UI has no Juice instance and timeScale only
  affects the 3D loop (documented decision). Reel core untouched. Pity refresh audited: not broken.
- **Vendor lock** (`vendor/`, `index.html` head only): Three.js 0.170.0 + 7 addons + 9 transitive
  deps + PeerJS 1.5.4 = 17 files, 1.6MB, committed. Gotcha for future edits: importmap addresses
  MUST start with `./` (bare `vendor/...` silently resolves to null in Chromium). Verified live:
  0 CDN requests, 0 page errors.
- **Perfect-deflect combo → ability charge** (`js/skills.js` perfectDeflectCooldownCut, game.js):
  chain 1 = −1.0s, chained = −1.5s, 6s/round cap. Key architecture note: skill cooldowns are
  host-gated via mirror copies (`useSkill(p,...)` at ~4515), so the cut is applied BOTH on the
  local path and in the host's remoteAttack handler with separate per-player round budgets —
  local-only would desync host gating.
- **Trophy celebration** (`js/game.js` celebration region): `window.arenaDecor.trophy` clone
  spawns on MATCH end only (never round end), rises/rotates in the existing celebration update
  (raw dt, 0 alloc), removed on teardown WITHOUT disposing shared geometry/material
  (`trophyTeardownPlan()` contract in arena-decor.js). FFA uses a neutral center spot.

---

## V4 Waves 4-5 — Theme Spread, Retention, PWA, Bot Fix, Lobby Fix, Case Reel, Avatars (2026-07-30)

1186/1186 tests (was 1081), 93 files clean. Wave 4 = backlog burn-down; Wave 5 = user-reported bugs.

### Wave 4
- **Theme spread** (roadmap 2.1): shop/lobby/career/social fixed turquoise hexes → `--screen-*`
  tokens (79 lines). Dark theme pixel-identical; ember theme now actually recolors these screens.
  `tests/theme-spread.test.mjs` locks those screens at 0 fixed-hex budget; 368 remain globally
  (inventoried in the test). Console `:root` vars in polish.css head are orphaned (only console.js
  reads them) — flagged, not touched.
- **Retention**: first-match-of-day (+80, was documented-but-never-built) on BOTH guest and
  server-authoritative paths; login streak (+20/day, +150 on day 7, cycling, UTC) with menu badge
  `#menu-streak-badge` + `POST /api/profile/streak-claim` (idempotent). Coexists with the older
  Daily-Login card (different formula) — intentionally separate state.
- **PWA**: `manifest.webmanifest` + `sw.js` (network-first, small shell precache, `/api` +
  peerjs + cross-origin bypass). BUMP `CACHE_V1` on production deploys. Installable on phones.
- **Achievements**: +10 (29 total) with progress bars; triggers restricted to data that actually
  reaches `checkAchievements` ctx — see agent report for rejected candidates.
- **Target outline (roadmap 4.3): ALREADY DONE** — restored in f6a8c60 after being collaterally
  deleted in the 5a29b05 rig migration; roadmap doc was stale. No changes made.

### Wave 5 (user-reported)
- **Bots not deflecting** — root cause was PRE-EXISTING (ea037d5 added windUp delay but never
  updated the fixed 8-unit alert range in `bot.js tryDeflect`; reaction+windup budget exceeded the
  engagement window). Fix: dynamic `alertRange = speed*(reaction+windUp)+attackRange`. Measured:
  medium isolated 0/40 → 32/40; live matches score again. Known follow-up: hard bots dodge so
  aggressively they leave deflect range (separate issue, documented).
- **Cross-tab lobby failures** — root cause: browser "Duplicate Tab" CLONES sessionStorage, so two
  tabs shared playerId+resumeToken and the host's identity-dedup silently rejected the second
  join. Fix: `dodgb.identityClaims` localStorage liveness registry (5s heartbeat, 15s TTL,
  pagehide release) regenerates identity when the stored id is claimed by another live tab.
  Also: `_lobbyApi` no longer swallows errors silently (warn + 'Lobby service unreachable').
- **Case reel**: CS:GO pacing 6.3-7.0s (was 1.2-3.4s), single transform keyframe (fast launch →
  long deceleration → crawl → 16px overshoot settle), analytic tick scheduling (bezier inversion,
  setTimeout batch — cheaper than rAF polling), near-miss filler arrangement (odds untouched),
  bigger rarity-gradient tiles. Reduced-motion skips spin entirely.
- **Shop UX2**: 15 AI-generated character portraits (`assets/generated/characters/portrait-*.jpg`,
  Pollinations, emoji fallback on 404), name-fit tiers (no more clipping), inventory tab rebuilt
  (rarity stripes, EQUIPPED/OWNED badges, RED/BLUE ONLY pills, grouped sections), footer -40%.
  Duplicate inline 'Owned' labels removed (badge is the single owned indicator).
- **Menu flow**: single `btn-play-online` replaces main-menu Host/Join buttons (multiplayer screen
  handles both). Victory-screen dark frame root-caused: `#celebration-banner` was a short strip
  whose gradient hard-cut at its own edge — now `inset:0` vignette with 30vh fade.
- **Minecraft avatars**: 16 skin presets (`js/skin-presets.js` — 6 expressions + 10 ORIGINAL
  themed archetypes; IP-safe: palettes/motifs only, trademark blacklist test), avatar editor
  2D↔3D toggle (reuses ShopShowcaseRenderer via options.camera bust framing — still one renderer
  path), preset strip, customAvatar atlas wired to shop showcase + menu hero + editor 3D.
- **Test-harness gotcha (recurring)**: several tests load `js/ui.js` via data-URL after stripping
  imports with a SINGLE-LINE regex — keep every ui.js import on one line or the loader breaks
  with ERR_UNSUPPORTED_RESOLVE_REQUEST.

### Session assets/tools note
- Pollinations.ai (keyless) is the working free image-gen route; used for the 15 portraits.
- `last30days` skill v3.18.4 installed at `C:/Users/Sher/.claude/skills/last30days` (user request).

---

## V4 Wave 6 — Skybox Panoramas + ACES Grading (2026-07-30)

1215/1215 tests (was 1186), 94 files clean.

- **12 AI-generated 360° equirect panoramas** (`assets/generated/skybox/*.jpg`, Pollinations,
  2048x1024) wired to 13 map ids (beach + beach_open share beach.jpg) via new `js/skybox-loader.js`
  + `MAPS.skybox` field. `scene.background` (dome hidden once loaded, no double-draw), gradient
  dome remains as loading state, fallback, and low-quality path. Load-time seam crossfade (last 4%
  over first 4%). Fog auto-tints toward the panorama's sampled horizon color ONLY when it clashes
  (volcano/beach tinted; space/neon no-op — threshold works both ways).
- **`scene.environment` deliberately OFF**: floors are team-colored MeshStandardMaterial —
  an env map could shift perceived team colors (AGENTS rule). Toon materials wouldn't care, the
  floor would. Revisit only with a proven-safe setup.
- **Texture lifecycle proven**: `renderer.info.memory.textures` stable at 22 across
  beach_open→space→neon→volcano switches in one session; `_skyboxToken` cancels stale async loads.
- **Renderer** (`js/renderer.js`): ACESFilmicToneMapping, exposure 1.1 (matches shop-showcase
  precedent). Team red/blue separation proven against the actual vendored ACES curve across all 4
  toon bands. Bloom: threshold 0.3→0.78, radius 0.3→0.22 (only true emissives bloom; bright skies
  no longer bleach); `setBloomProfile({strength,radius,threshold})` exposed for future per-map
  tuning; UnrealBloomPass fully disabled at strength 0 (perf win in low-quality/hub mode).
  FPS unchanged (beach 300.2→299.8, neon 299.8→299.6 @1600x900).
---

## V4 Wave 7 — Skybox Revert, Quick Play Hub, Ball Stall Fix, Lobby Lifecycle (2026-07-31)

**User verdict after playtest:** AI panorama skyboxes looked worse in-game than the procedural
gradient dome — reverted (all 13 `skybox:` fields removed from `MAPS` in `js/arena.js`; loader
kept, `tests/skybox-loader.test.mjs` now pins "no map declares skybox"). QUICK PLAY is the single
online entry point: routes to the multiplayer hub (`showScreen('multiplayerMenu')` + lobby list
refresh), `btn-play-online` removed (`tests/menu-flow.test.mjs` updated).

**Ball stall root cause (critical):** solo/bot match had zero simulation drivers when
`network.isHost && !network.connected` — RAF loop skips hosts (`js/main.js` ~5896), bg loop skips
disconnected. One failed Create Lobby poisoned `isHost=true` forever; every later Solo vs Bots
match started frozen (ball hovering, no target). Fixes: RAF guard now
`!isHost || !connected` (exactly one loop runs per state), and `hostGame()` resets
`isHost=false` when `initPeer()` rejects. `tests/solo-sim-loop.test.mjs` (4 tests) pins both.
Ball/bot logic itself was never broken — regression blamed to `5a29b05`, not the V4 commits.

**Host/late-join — 4 real root causes (all outside the migration subsystem):**
1. `btn-start-game` unregistered the lobby the moment the match began → late join unreachable
   from UI (the whole `welcome`/`handleLateJoin` path was fine). Now re-registers with live
   player count, keep-alive stays armed.
2. `LOBBY_TTL` 45s < Chrome's 60s hidden-tab timer clamp → lobby expired whenever host tabbed
   away; cause of "two tabs can't see each other". Now 90s.
3. `lobbyWrite` rate limit 30/min bucketed per IP — shared by every local tab, silently 429'd
   registration. Now 120/min (verified live).
4. `peer-unavailable` had zero listeners → dead/mistyped room code hung Join forever. Now
   rejects with a message; join code trimmed.
`tests/lobby-lifecycle.test.mjs` 23/23 (+5, two assertions that pinned buggy behavior inverted).

**Verification:** full suite `node --test` → **1222/1222 pass**. Live browser smoke: Quick Play
opens hub; solo bot match cycles ROUND_END→PLAYING→ROUND_END with ball moving and hitting.
Known cosmetic: during the 10s pre-game countdown the warmup ball floats untargeted and bots
stand still — by design, predates V4, looks similar to the stall bug's first seconds.

---

## V4 Wave 8 — Retention Loop, FTUE, 4 Arenas, Aurora Hub, Cosmetics, Viewmodel, UI Overhaul (2026-07-31)

Orchestrated as Fable 5 plan/control + Opus/Sonnet execution agents + Haiku commits (user mandate).
Commits: `17218aa` (waves A-D), see also `1741825` (Wave 7 fixes). Full suite grew 1222 → 1272, all green.

- **Post-match reward flow** (`js/ui.js` `_renderRewardFlow`, `js/match-analytics.js` `buildRewardSummary`):
  XP count-up with per-source rows (`xpSources` from `game.js` — same totals, decomposed), coin
  breakdown + first-of-day row, battlepass tick + next-reward kind icon, daily challenge deltas
  (`Daily.takeLastMatchProgress()` one-shot handoff), dominant PLAY AGAIN. MP client path untouched
  (no `xpSources` in client payload → flow hides itself). `tests/post-match-rewards.test.mjs`.
- **Main-menu retention strip** (`#menu-retention-strip`): daily progress, battlepass tier + next
  reward, existing streak badge folded in as third card. Hover-lift/press-scale on primary surfaces
  only (Menu Identity Pass decision respected).
- **FTUE**: `#ftue-welcome` overlay (real bindings verified from player.js: WASD/Space/Ctrl,
  hold-LMB flick throw/deflect, RMB stab), `#btn-how-to-play` reopener, first-solo-match timed
  hints via `ui.showMessage`. Flags `ftueSeen`/`ftueMatchHintsSeen` in store DEFAULTS.
- **4 new arenas** (`js/arena.js` +880): `aquarium` (glass vault, fish schools/mantas/whale shark
  outside), `museum` (colonnades, twin dino skeletons, oculus), `casino` (marquee arches, spinning
  roulettes, slot-cabinet cover), `subway` (two trains, mezzanine platforms + stairs). One
  allocation-free `_mapAnimators` loop; picker auto-registers (25→29). `tests/new-arenas.test.mjs`.
- **Aurora Grand Plaza** (`js/social-lobby.js` rewrite): estate/skyline/harbor DELETED, single
  flagship hub ±250×±230 — Aurora Spire in swimmable fountain, amphitheatre with walkable rim,
  parkour terraces (jump-budget-verified), Lantern Bazaar, Observatory. One block table drives
  collision+platforms+meshes. `SOCIAL_HUB_MAP_ID` export; server.js allowlist `{plaza}`.
- **Cosmetics**: ball SHAPE skins `shuriken/baseball/blockball/dark_eater` (visual mesh swap via
  `_applyShape`, physics radius single constant, geometry cached at module level), knives
  `tanto/cleaver/dagger` in `js/weapon-models.js` + case drops (`dark_eater/cleaver/stiletto`),
  Dark Eater 5-piece set reusing `void` style. `server/case-catalog.js` mirrored.
- **Viewmodel**: Roblox-style mitt hand (`buildHandMesh`), unified `MODEL_FRAME_OFFSET` table in
  `knife-animation.js` (incl. rocket, was hardcoded branch) — clipping measured via AABB before/after.
- **UI overhaul**: 7 distinct CSS knife silhouettes (was 1 for all), ball-shape 2D badges + real-
  geometry 3D inspect (cloned from `ballShapeParts`), CS-style inventory grid (rarity edge/glow,
  reused `#shop-filters`), HUD sheen/score-pop/low-health vignette (`#hud.hud-critical` — `:has()`
  doesn't match in Chromium here), settings row/toggle/tab polish, patch notes v0.11 entry.
  Fixed pre-existing clipped Buy/Equip buttons on avatar/ball/inventory cards.
- **Session memory**: `vault/` (STATUS.md + sessions/) is now the cross-session source of truth,
  wired into CLAUDE.md; graphify graph updated same day.
