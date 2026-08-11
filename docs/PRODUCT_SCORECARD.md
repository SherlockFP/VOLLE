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

## Current evidence baseline (development-local, 2026-08-11)

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
| Payer conversion / ARPPU / ARPDAU / Battle Pass conversion | NOT INSTRUMENTED YET |

Therefore no evidence-backed **player-outcome** score can increase from this
cycle. D1/D7/D30, conversion, and revenue outcomes remain **NOT MEASURED**
until the report has eligible cohorts. Engineering/product readiness is scored
separately below from tests, real runtime flows, and independent visual QA; it
must never be presented as retention or revenue lift.

## Provisional expert baseline (/10)

This is a current-state design/QA baseline, not a measured KPI lift. Runtime
Shop/post-game/auth/social/P2P QA and the 1,340-test regression suite support the readiness
ratings. Core-fun ratings remain low-confidence without external playtests;
retention/commercial ratings remain hypotheses until cohort events exist. A
real two-peer startup passed, while remote two-deflect parity remains WARN.

| Player experience | Score | Evidence / constraint |
| --- | ---: | --- |
| Core Fun | 6.5 | First-shot/bot coverage plus ordinary-deflect crash fix; no external playtest. |
| Movement Feel | 6.5 | Existing movement suite passes; no new feel study. |
| Ball Interaction | 7.0 | Ball/shot suite passes; local/remote inactive timing sentinel no longer aborts a valid deflect. |
| Deflect Satisfaction | 7.0 | First-shot and timing reliability pass; automated pointer-lock collision remains WARN. |
| Skill Expression | 7.2 | Earn-only ability/passive cards add collection choice; ranked resolves one neutral effect set. |
| Match Pacing | 5.5 | No session/match-duration cohort yet. |
| One-More-Match Factor | 7.3 | First-viewport Rematch plus earned cards/cases create a free return loop; rematch rate is not measured. |
| Readability | 8.0 | Exact eight-item nav, Squad Center, Shop and case surfaces pass 375/720p/1080p QA. |
| UI/UX | 8.0 | Auth, browse/inspect/buy/equip/Practice, Inventory, social and first-focus Rematch flows pass runtime QA. |
| Visual Polish | 7.4 | Full-body identity and premium menu/case presentation pass; Aurora Hub improved 6.2 → 6.9 and remains a broader art-detail WARN. |
| Audio/Impact Feedback | 6.5 | Audio regression coverage passes; no listening panel. |
| Onboarding | 6.2 | Mandatory auth, FTUE and guided practice have working runtime paths; completion is not measured. |
| Multiplayer Experience | 7.0 | Real host/client lobby and match start pass at 20-28 ms/0% observed loss; two remote deflects remain WARN. |
| Social Experience | 7.2 | Persistent friend tags, requests, DM, party invites and flagship hub pass two-account QA; return behavior is unmeasured. |

| Commercial quality | Score | Evidence / constraint |
| --- | ---: | --- |
| Retention Potential | 6.8 | Rematch, free post-match cases/cards and social persistence form a coherent loop; D1/D7/D30 are not measured. |
| Monetization Potential | 7.1 | Cosmetic-first Shop/cases coexist with earned cases and no paid power; no payer data. |
| Cosmetic Desire | 7.8 | Full-body identity, live preview, named rarity items and readable case presentation are runtime-verified. |
| Battle Pass Value | 5.0 | Functional coverage exists; conversion is not instrumented. |
| Progression Motivation | 7.2 | Match/level Arena Cards, duplicate collection and same-rarity trade-up pass persistent server tests; behavior unknown. |
| Conversion Potential | 7.0 | Inspect/buy/equip/Practice and transparent case odds reduce friction; conversion baseline absent. |
| Social/Viral Potential | 6.8 | Friend codes, DM, party invites and shared hub are functional; referrals/shares remain absent. |
| Streamability | 6.0 | Readable arena identity; no creator/stream study. |
| Marketability | 7.4 | Distinct block roster, generated arena menu art, readable identity and flagship hub; no market test. |
| Store/Trailer Appeal | 8.0 | Premium horizontal Shop, case inspector 8.7 and live 3D character read pass visual QA. |
| Live-Service Potential | 6.8 | Persistent social graph, catalogs, earned cases/cards and telemetry foundations exist; cadence unknown. |

**FUN SCORE: 6.2/10 (unchanged; external playtest still required)**
**RETENTION POTENTIAL SCORE: 6.8/10 (hypothesis; KPI baseline unavailable)**
**COMMERCIAL POTENTIAL SCORE: 7.1/10 (hypothesis; paid metrics unavailable)**
**NETWORK READINESS SCORE: 7.0/10 (real two-peer start PASS; remote-deflect WARN)**
**OVERALL PRODUCT READINESS SCORE: 7.4/10 (verified local Gauntlet bar)**
**OVERALL PLAYER-OUTCOME SCORE: NOT MEASURED**

## Verified 7.4 readiness gate (bounded Gauntlet, 2026-08-11)

This is the inspectable bar used for the 7.0 readiness score. A builder did not
grade its own output; independent runtime/visual critics examined the running
product after each major change.

| Gate | Evidence | Result |
| --- | --- | --- |
| Core-loop reliability | 1,340/1,340 tests; 96-file JS syntax check; valid ordinary deflect no longer throws on the inactive perfect-window sentinel. | PASS |
| P2P startup | Fresh host/client browsers formed a roster, held the connection for 8.5+ seconds at about 20-28 ms and 0% observed loss, and both entered the match within five seconds. | PASS with remote-deflect WARN |
| One-more-match UX | Real populated post-game: Rematch at y=287 desktop and y=197 mobile, fully visible without scroll; first keyboard focus lands on Rematch. | PASS |
| Post-game integration | Reward flow inserts under its actual report parent; real report has no `NotFoundError`; mobile XP remains one line inside the bar. | PASS |
| Cosmetic identity | Classic/slim full-body atlas parity and custom-atlas hiding pass functional QA; Neon Runner A/B changed from a thin bar to a distinct plate and two eyes. | PASS |
| Auth + social | Mandatory auth plus two-account friend request/accept, DM, lobby invite and revoked-session flows passed fresh isolated runtime/API QA. | PASS |
| Ethical progression | Arena Cards are earn-only, paid skill/rune purchase is rejected, ranked effects are neutral, and earned cosmetic cases open before credits. | PASS |
| Case presentation | Inspector 8.7 and true-motion reveal 8.2; 600 ms captures show no result/toast before settle at 375/1280/1920. | PASS |
| Visual system | Exact eight-item nav, Squad Center 8.3 and responsive menu surfaces pass; Pavilion roof regression is fixed and Aurora Hub improved 6.2 → 6.9. | PASS with broader hub-detail WARN |
| Product observability | Privacy-respecting session, funnel, match, rematch, P2P, Shop, purchase, equip, card/cache/case and cosmetic-use events plus cohort KPI report. | PASS |

The 7.4 score means the current local product clears this engineering and UX
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

Client delivery is bounded (50 queued, batches of 20, at most two retries),
uses the revocable account session token, a tab-scoped sessionStorage session
id, and fetch keepalive. Events queued before profile authentication flush
after Store.connectRemote() succeeds.

## Instrumented behavior

- Session start/end/heartbeat; FTUE overlay view/complete; guided/free practice start/complete.
- Screen views for shop, Battle Pass, multiplayer, lobby, and core menus.
- Quick Play click, join/host success or failure, bounded join latency bucket.
- Lobby host/join and P2P role; safe reconnect/disconnect state transitions.
- Match start/complete, rematch click/start, and equipped avatar skin use.
- Shop avatar/character inspection, soft-currency purchase success/failure,
  and cosmetic equip.
- Arena Cache earn/open, card earn/equip/trade-up, and earned cosmetic-case
  grant/open events.

Real-money payer conversion, ARPPU, ARPDAU, and Battle Pass conversion are
explicitly **not instrumented yet**: the current code does not have a truthful
client-side purchase/paid-pass completion event. Do not infer revenue from
soft-currency shop events.

## KPI report

Run:

    node scripts/product-kpi-report.js

The report reads data/product-analytics.json (or --file path) and emits
numerator, denominator, and null when a denominator/cohort is insufficient.
It includes D1/D7/D30, first-session completion, FTUE overlay completion,
guided practice completion, Quick Play, match completion, rematch, sessions,
shop/cosmetic, Arena Cache/card engagement, earned-case open rate,
churn-last-screen, and P2P dimensions. It never invents a percentage.

## Score decision rules

| Score | Evidence required |
| --- | --- |
| FUN | Playtest evidence plus match completion/rematch trend; no code-only increase. |
| RETENTION | Eligible D1/D7/D30 cohort report; compare the same acquisition source. |
| COMMERCIAL | Shop view-to-soft-currency purchase plus cosmetic equip/use; paid metrics remain null until truthfully instrumented. |
| NETWORK | P2P Quick Play success, join latency, reconnect/disconnect trend, plus runtime QA. |
| OVERALL PRODUCT | The weakest material pillar constrains the score; do not average away a regression. |
