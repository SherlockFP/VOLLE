# VOLLE Product Scorecard

## Measurement rule

Player-outcome scores are hypotheses until behavior data supports them. A code
change, build, or subjective review never proves FUN, RETENTION, COMMERCIAL, or
market outcomes on its own. Re-score those outcomes only after a defined cohort
has enough completed sessions and the KPI change is repeatable. The separate
readiness score can move when inspectable runtime, test, and visual gates pass.

Priority remains: core fun, one-more-match, retention, competitive depth,
feedback, visual/audio polish, social value, ethical cosmetic desire, content,
then new features. No event is used to manipulate players or introduce
pay-to-win behavior.

## Current evidence baseline (development-local, 2026-08-12)

The inspected local development profile store is not a production cohort, and
the current product analytics report contains 0 eligible events / 0 unique
profiles. Local account, reward and purchase records are test/development data,
not evidence of player behavior or revenue.

| Metric | Baseline |
| --- | --- |
| D1 / D7 / D30 retention | NOT MEASURED |
| First-session / FTUE overlay / guided practice completion | NOT MEASURED |
| Quick Play to match / match completion / rematch | NOT MEASURED |
| Sessions/player, matches/session, session length, churn screen | NOT MEASURED |
| Shop view / cosmetic purchase / equip / in-match use | NOT MEASURED |
| Arena Cache / earned-case open / card equip / card trade-up | NOT MEASURED |
| P2P connect success, join latency, reconnect, disconnect | NOT MEASURED |
| Payer conversion / ARPPU / ARPDAU | MEASUREMENT READY; 0 LIVE EVENTS |
| Paid Battle Pass conversion | NOT AVAILABLE; NO PAID PASS SKU |

Therefore no evidence-backed **player-outcome** score can increase from this
cycle. D1/D7/D30, conversion, and revenue outcomes remain **NOT MEASURED**
until the report has eligible cohorts. Engineering/product readiness is scored
separately below from tests, real runtime flows, and independent visual QA; it
must never be presented as retention or revenue lift.

## Provisional expert baseline (/10)

This is a current-state design/QA baseline, not a measured KPI lift. Runtime
Shop/post-game/auth/social/P2P QA and the 1,491-test regression suite support the readiness
ratings. Core-fun ratings remain low-confidence without external playtests;
retention/commercial ratings remain hypotheses until cohort events exist. A
real two-peer startup passed, while remote two-deflect parity remains WARN.

| Player experience | Score | Evidence / constraint |
| --- | ---: | --- |
| Core Fun | 6.5 | First-shot/bot coverage plus ordinary-deflect crash fix; no external playtest. |
| Movement Feel | 7.3 | Dash reach is deterministic across 20/30/60/120/144 FPS, and the held-item gait no longer drifts while idle or snaps when speed changes. Landing now adds one 180ms downward-only, impact-scaled viewmodel pulse after retained ground/platform contact, with bhop, jump-pad, water, death/respawn and Reduced Motion handling. Independent QA measured a 0.003663u conservative combined 60Hz gait/landing step and 0.002914u in gravity-reachable falls against the 0.004u gate; physical onGround, camera, networking and player velocity remain unchanged. Reliable pointer-lock video and human feel testing remain missing. |
| Ball Interaction | 7.2 | Ball/shot suite passes; local/remote inactive timing sentinel no longer aborts a valid deflect. A real Classic match now exposes the assigned ball threat before damage without changing trajectory, damage or network state. |
| Deflect Satisfaction | 7.4 | First-shot and timing reliability pass; the first offline bot match prevents two consecutive chance-roll declines, and host authority now caps unusually short opening serves to a deterministic >=1.0s initial ETA for every target. The exact assignment frame was not captured in runtime; automated pointer-lock collision remains WARN. |
| Skill Expression | 7.2 | Earn-only ability/passive cards add collection choice; ranked resolves one neutral effect set. |
| Match Pacing | 7.3 | The duplicated default 10s + 3s start is one authoritative 3s countdown; `GO` starts gameplay while its 500ms hold remains presentation-only. A real P2P client no longer starts 13.381s before its host. Foreground solo click-return to COUNTDOWN was 0.974s and a post-polish run reached live in 4.657s. The arena/warmup is now visible throughout rather than hidden by a three-second opaque intro. Cohort score-to-serve/rematch pacing remains unavailable. |
| One-More-Match Factor | 7.6 | The previously dead GAME_OVER Rematch now starts a fresh match in runtime and clears its overlay; earned cards/cases support the loop, while rematch propensity remains unmeasured. |
| Readability | 8.5 | Exact eight-item nav plus Shop/case surfaces pass responsive QA. Normal-match HUD lanes remain separate; a real Classic desktop hit displayed `INCOMING 1.0S` before damage and cleaned up after impact. The opening now keeps score, compact identity, countdown, controls and threat in distinct lanes on desktop/mobile with the arena visible. Exact first-assignment ETA and active 375px threat recapture remain WARN. |
| UI/UX | 8.5 | Auth, Shop/Inventory/social/Rematch flows pass runtime QA. At 375x720 the host lobby now keeps one top-aligned scroll owner: the former zero-height center is 694px, Classic changes by a real 94x44 click, map/chat/teams/Start are reachable, and the 375px header has no internal overflow or overlap. Initial host-selected mode/map now survives a fresh client join. |
| Visual Polish | 7.7 | FTUE surfaces scored 7.9-8.5 and Card Collection scored 8.1 desktop/7.6 mobile. The opaque opening mask is replaced by an accepted compact arena-identity chip with clean desktop/mobile layering; its 1.5s fade leaves a short fully-readable dwell. Aurora Hub remains a 6.9 art-detail WARN. |
| Audio/Impact Feedback | 7.0 | Nonlethal hits retain normal impact/grunt feedback without death audio, and assigned-target urgency receives live ETA at a bounded 20 Hz. Accepted dash now has one dedicated 130ms low-body/rising-air signature, quieter and structurally distinct from the 160ms descending throw whoosh; gated/active frames remain silent. First-time-origin and failed-cue retry bugs are covered. Browser automation cannot expose audible output or accepted pointer-lock dash input, so headphone identification/masking and a real two-peer listening soak remain missing. |
| Onboarding | 8.4 | Account-scoped welcome launches a deterministic 40s first-run drill, emits one real start event, faces the player toward a visible serve, and hands off positively to a first bot match. The 73s mastery drill remains available; live 375px drill and first-match message QA passed with zero overlap/overflow. Completion propensity and the final result CTA frame remain unmeasured/WARN. |
| Multiplayer Experience | 8.0 | Lobby/admission, role, mode/map, chat/team and Start authority pass real two-account gates. Match start is host-authoritative. Bot defense now chooses intent before movement, holds one dodge side for 250ms, caps only combined defensive footwork at 10u/s, and synchronizes group yaw, intent, strafe and one deflect telegraph to clients. Rally speed remains a +30% base-speed step per deflection up to 3x. Source/deterministic gates pass; a live two-peer bot-animation capture and longer relay/rematch soak remain missing, so the score does not increase yet. |
| Social Experience | 7.2 | Persistent friend tags, requests, DM, party invites and flagship hub pass two-account QA; return behavior is unmeasured. |

| Commercial quality | Score | Evidence / constraint |
| --- | ---: | --- |
| Retention Potential | 6.8 | Rematch, free post-match cases/cards and social persistence form a coherent loop; D1/D7/D30 are not measured. |
| Monetization Potential | 7.1 | Cosmetic-first Shop/cases coexist with earned cases and no paid power; no payer data. |
| Cosmetic Desire | 7.8 | Full-body identity, live preview, named rarity items and readable case presentation are runtime-verified. |
| Battle Pass Value | 7.2 | Account XP, claims, premium ownership, UTC Daily rewards and earned XP boosts are server-owned, replay-safe and persistent. Runtime API QA passed idempotent activation, expiry and boosted settlement; global season/catch-up UX and paid conversion remain unresolved. |
| Progression Motivation | 7.5 | Match/level Arena Cards, a responsive collection inspector, duplicate ownership and same-rarity trade-up pass persistent server/runtime tests; behavior remains unmeasured. |
| Conversion Potential | 7.0 | Inspect/buy/equip/Practice and transparent case odds reduce friction; conversion baseline absent. |
| Social/Viral Potential | 6.8 | Friend codes, DM, party invites and shared hub are functional; referrals/shares remain absent. |
| Streamability | 6.0 | Readable arena identity; no creator/stream study. |
| Marketability | 7.4 | Distinct block roster, generated arena menu art, readable identity and flagship hub; no market test. |
| Store/Trailer Appeal | 8.0 | Premium horizontal Shop, case inspector 8.7 and live 3D character read pass visual QA. |
| Live-Service Potential | 7.2 | Persistent social graph, catalogs, earned cases/cards, server-owned Daily cadence, usable earned BP boosts and truthful completion/claim/activation telemetry exist; player cadence remains unmeasured. |

**FUN SCORE: 6.2/10 (unchanged; external playtest still required)**
**RETENTION POTENTIAL SCORE: 6.8/10 (hypothesis; KPI baseline unavailable)**
**COMMERCIAL POTENTIAL SCORE: 7.1/10 (hypothesis; paid cohort unavailable)**
**NETWORK READINESS SCORE: 8.0/10 (startup + admission + lobby/match-start sync PASS; controlled remote-deflect WARN)**
**OVERALL PRODUCT READINESS SCORE: 8.6/10 (verified local Gauntlet bar)**
**OVERALL PLAYER-OUTCOME SCORE: NOT MEASURED**

## Verified 8.6 readiness gate (bounded Gauntlet, 2026-08-12)

This is the inspectable bar used for the 8.6 readiness score. A builder did not
grade its own output; independent runtime/visual critics examined the running
product after each major change.

| Gate | Evidence | Result |
| --- | --- | --- |
| Core-loop reliability | 1,491/1,491 tests; 96-file JS syntax check; valid ordinary deflect no longer throws on the inactive perfect-window sentinel. A 240-opportunity matrix produced 240/240 launches and 0 chosen-deflect timing/range failures; solo never traversed P2P. | PASS |
| Bot defense readability | Intent is selected before movement; committed deflects produce zero dodge, declined dodges keep one side for 250ms, and hard defensive footwork is bounded to 10u/s or 0.1667u at 60Hz without limiting ball speed. Host and client consume one deflect telegraph edge per opportunity. Independent QA passed 66/66 focused and 1,491/1,491 full tests; LUNA accepted the final source/test gate. Live two-peer animation capture remains missing. | PASS with runtime-visual WARN |
| P2P startup | Fresh two-account current-source run completed host creation, private proof, `/join` HTTP 200, reciprocal roster and both-player match start; observed 306-330 ms and 0% loss in the high-latency local gate. | PASS with latency-soak WARN |
| P2P deflect/admission race | Local authoritative echo is a no-op, remote feedback remains, unique attack IDs pass the speed-scaled boundary, malformed/forged/blank/stale lobby proofs are rejected or safely replaced, and admission passed the real browser flow. | Admission PASS; controlled remote-deflect WARN |
| P2P progression authority | Real isolated two-account HTTP flow passed private host proof, capacity, ready/early gates, reciprocal 202/200 settlement, finalized polling, persisted 1024/976 ELO, three-per-day solo cap and repeated-opponent guard. | PASS with collusion/restart-recovery WARN |
| One-more-match UX | Real populated post-game keeps Rematch in the first desktop/mobile viewport; the GAME_OVER action launches a fresh match, clears the report overlay, and the 30s forced victory lap is reduced to 8s. | PASS |
| First-session path | Fresh accounts see a one-click deterministic 40s drill while manual/retry mastery stays 73s. The real sink receives exactly one guided start; incomplete runs do not claim completion. Cache-fresh 375x812 QA passed readable instructions, compact ±6 gates, zero HUD overlap/overflow, and hidden diagnostics. The first result uses a positive match handoff; source/tests pass, but its final browser frame and completion events remain runtime-unobserved due RAF throttling. | PASS with final-frame WARN |
| Responsive match HUD | Fresh 375x812, exact 720x720 and 1440x900 normal matches measured zero sibling-region intersections and zero page overflow. Guided Practice kept its isolated compact layout. Live first-match hints wrapped within x16..359 at 375px with zero internal overflow and zero score/reticle intersection; reduced-motion contracts pass. | PASS |
| Live ball threat | Shipped Game methods sample the assigned local target at 20 Hz after local/host/P2P-client ball updates, issue ETA UI/audio cues, and clean once on target loss, deactivation, death or state exit without touching trajectory, damage or packets. In a real Classic desktop match `INCOMING 1.0S` appeared at HP 100, reached critical before the 100-to-62 hit, then hid. The measured 375px score collision has a tested dedicated lane; active mobile recapture and a real two-peer listening soak remain WARN. | PASS with mobile/audio-soak WARN |
| Mobile lobby access | Exact 375x720 host runtime changed the center from 0px to 694px, selected Classic through a real click, changed maps, sent chat, changed teams and reached the fixed Start CTA through one body scroll lane. The final topbar measured 375/375px client/scroll width; ellipsized mode/map text clears REGION by 8px. 720 and 1440 sanity renders and 1,471 tests pass. | PASS |
| Dash cadence | Shipped helper and source-contract tests consume only remaining dash time. Open-terrain traces at 20/30/60/120/144 FPS all reach the nominal 1.44u within 0.01u, preserve direction/25 stamina/1s cooldown/collision behavior and take no extra terminal tick. Runtime frames show no teleport or final lurch; browser-controlled pointer-lock input was blocked by `WrongDocumentError`. | PASS with runtime-input-harness WARN |
| Dash readability | Existing player signals drive a dedicated, mutually exclusive `DASH` HUD state with restrained and reduced-motion-safe styling; behavioral UI/source tests pass without physics/network mutation. Automated pointer-lock input stayed at `0u/s MOVE`, so an active 100-180ms runtime capture and 300ms cleanup frame remain unverified. | PASS with active-frame visual WARN |
| Dash onset audio | Accepted dash calls a dedicated named cue exactly once; active-dash frames and cooldown/low-stamina/longjump-blocked paths call it zero times. Its two event-time oscillators are distinct from throw noise, peak below the throw, and stay on the existing master/tone/limiter path. A first-call-at-time-zero retrigger bug found by visual QA was fixed; missing/throwing functions do not consume cooldown. 53/53 independent focused tests pass. Browser pointer-lock and audible mix remain unverified. | PASS with listening/input WARN |
| Viewmodel gait + landing | Absolute-time bob was replaced by a phase-continuous, frame-rate-stable gait using persistent scalar state and a reused pose context. Landing uses a non-stacking 180ms sine envelope with exact 4/8/12 impact depths of 0.002/0.004/0.006u, 40% bhop scale and 25% Reduced Motion scale. Ground/platform feedback is deferred until after jump-pad resolution, preserves soft-contact audio, clears on death/respawn and reaches non-knife held items. LUNA's conservative flight/speed scan measured a 0.003663u worst combined 60Hz step; QA's full regression is 1,483/1,483. Reliable pointer-lock video remains a follow-up. | PASS with runtime-visual WARN |
| Authoritative match start | Before the fix a fresh two-account client showed speed 17/live timer 13.381s before the host. The current single 3s countdown showed both peers at `3` together; neither client ball nor timer moved early, first live ball differed by 125ms, and shared GO hiding differed by 125ms. Client round start suppresses local ball/target/split work and applies the host snapshot once. Foreground solo click-return to live was 4.684s; two-browser absolute timestamps had included browser-tool delivery overhead. | PASS with cohort pacing WARN |
| Opening presentation | The z9999 opaque intro was replaced by a compact WARMUP identity chip; arena/ball remain visible and controls/threat are suppressed through COUNTDOWN. Independent desktop/mobile QA found no score/identity/countdown/control intersections or overflow. Fresh solo click-return to live was 4.657s. Host-authoritative tests guarantee >=1.0s initial ETA for every assigned opening target; the exact assignment frame was not captured live. | PASS with first-assignment capture WARN |
| Initial P2P lobby state | A fresh two-account Card Join rendered the host's preselected Speedball + Factory on the first captured client state without any post-join host correction. The trusted `lobbyState` dispatch reaches App presentation once, a later Low G + Space Station change synchronized within 900 ms, and UUID/role/controls/team/chat/Start-authority checks passed with no browser errors. | PASS |
| Hit presentation semantics | Executable shipped-method traces prove local/host and P2P nonlethal hits retain hit burst, shockwave, hit-stop, flash, hit audio and local victim grunt while death explosion/audio/feed remain lethal-only. Damage and `playerHit` packets are unchanged. A natural Classic 100→75 HP hit was observed, but paired transient FX/audio capture remains WARN. | PASS with transient A/B WARN |
| Render-loop allocation | Death particles use in-place scaled-vector integration instead of one vector clone per active particle per frame. Numeric harness QA preserved movement, bounce and disposal semantics; no FPS A/B was claimed. | PASS |
| Post-game integration | Reward flow inserts under its actual report parent; real report has no `NotFoundError`; mobile XP remains one line inside the bar. | PASS |
| Cosmetic identity | Classic/slim full-body atlas parity and custom-atlas hiding pass functional QA; Neon Runner A/B changed from a thin bar to a distinct plate and two eyes. | PASS |
| Auth + social | Mandatory auth plus two-account friend request/accept, DM, lobby invite and revoked-session flows passed fresh isolated runtime/API QA. | PASS |
| Ethical progression | Arena Cards are earn-only, paid skill/rune purchase is rejected, ranked effects are neutral, and earned cosmetic cases open before credits. | PASS |
| Battle Pass + Daily account integrity | Server-clock profile state, deterministic Daily catalog, idempotent claims and earned XP-boost activation pass authority/HTTP/reload gates. Before expiry a real solo settlement granted floor(80 x 1.25)=100 BP XP; expiry returned 80 and replay minted nothing. Boost receipts stay private and no gameplay/ranked value changes. | PASS with global-season/catch-up WARN |
| Collection UX | Fixed accessible Card Collection dialog passes desktop/mobile layout, keyboard, ownership/equip, and trade-up gates; 8.1 desktop and 7.6 mobile visual baseline. | PASS with minor visual WARN |
| Case presentation | Inspector 8.7 and true-motion reveal 8.2; 600 ms captures show no result/toast before settle at 375/1280/1920. | PASS |
| Visual system | Exact eight-item nav, Squad Center 8.3 and responsive menu surfaces pass; Pavilion roof regression is fixed, Aurora Hub improved 6.2 → 6.9, and Daily clarity improved 6.2 → 8.0 desktop / 5.4 → 7.6 at 375px with truthful UTC labeling. | PASS with broader hub-detail WARN |
| Product observability | Privacy-respecting session, funnel, match, rematch, P2P, Shop, purchase, equip, card/cache/case and cosmetic-use events plus cohort KPI report. Match start now decomposes loader/setup/click-to-countdown into bounded durations without raw timestamps. In a fresh authenticated solo run the sink accepted exactly one match lifecycle event: 961.3ms loader, 23.8ms setup and 993.6ms click-to-countdown, consistent with DOM polling within 12-20ms, with one pseudonymous key and no raw account identity. | PASS |

The 8.6 score means the current local product clears this engineering and UX
readiness bar. It does **not** claim D1/D7/D30 retention, payer conversion,
ARPPU/ARPDAU, or market fit. Those remain null until real cohorts exist.

## Privacy-respecting telemetry contract

POST /api/product-events accepts one event or a JSON events array from an
authenticated profile. The server stores an HMAC-pseudonymous profile key,
server timestamp, allowlisted event name, bounded dimensions, and bounded
numeric metric only. It retains at most 100,000 events and at most 90 days,
deduplicated by event id.

It never accepts or records player names, chat, free text, raw input,
positions, avatar pixels/images, IP addresses, or payment secrets. Production
must set PRODUCT_ANALYTICS_SECRET; the deterministic local fallback exists
only to keep development pseudonyms stable and is not a production secret.

Client delivery is bounded (50 queued, batches of 20, at most three attempts),
uses the revocable account session token, a tab-scoped sessionStorage session
id, and fetch keepalive. Events queued before profile authentication flush
after Store.connectRemote() succeeds.

## Instrumented behavior

- Session start/end/heartbeat; FTUE overlay view/exit/complete; guided/free practice start/complete.
- Screen views for shop, Battle Pass, multiplayer, lobby, and core menus.
- Quick Play click, join/host success or failure, bounded join latency bucket.
- Lobby host/join and P2P role; safe reconnect/disconnect state transitions.
- Match start/complete, gameplay-bounded match duration, post-game delay,
  post-game-to-rematch decision time, rematch click/start, and equipped avatar
  skin use.
- Shop avatar/character inspection, soft-currency purchase success/failure,
  and cosmetic equip.
- Arena Cache earn/open, card earn/equip/trade-up, and earned cosmetic-case
  grant/open events.
- Server-only verified payment completion with opaque receipt identity and
  currency/amount metrics; Battle Pass unlock and reward-claim engagement.

Real-money payer conversion, ARPPU, and ARPDAU are measurement-ready from the
server-confirmed payment path and are reported separately by currency. They
remain **NOT MEASURED** because the inspected store has zero live events. Paid
Battle Pass conversion is **NOT AVAILABLE** because no paid-pass SKU exists;
soft Battle Pass unlock/claim activity is engagement, not revenue. Never infer
revenue from soft-currency events.

## KPI report

Run:

    node scripts/product-kpi-report.js

The report reads data/product-analytics.json (or --file path) and emits
numerator, denominator, and null when a denominator/cohort is insufficient.
It includes D1/D7/D30, first-session completion, FTUE overlay completion,
guided practice completion, Quick Play, match completion, rematch, sessions,
shop/cosmetic, Arena Cache/card engagement, earned-case open rate,
churn-last-screen, P2P dimensions, currency-separated payer conversion,
ARPPU/ARPDAU, and soft Battle Pass engagement. It never invents a percentage.

First-session and funnel metrics can populate as soon as live events arrive.
D1 requires at least two calendar days of cohort observation, D7 eight days,
and D30 thirty-one days; early cohorts must not be presented as mature results.

## Score decision rules

| Score | Evidence required |
| --- | --- |
| FUN | Playtest evidence plus match completion/rematch trend; no code-only increase. |
| RETENTION | Eligible D1/D7/D30 cohort report; compare the same acquisition source. |
| COMMERCIAL | Shop view-to-soft-currency purchase plus cosmetic equip/use; paid metrics remain null until truthfully instrumented. |
| NETWORK | P2P Quick Play success, join latency, reconnect/disconnect trend, plus runtime QA. |
| OVERALL PRODUCT | The weakest material pillar constrains the score; do not average away a regression. |
