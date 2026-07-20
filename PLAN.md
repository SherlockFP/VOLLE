# DODGB-V3 Product and Engineering Plan

> Status: active
> Product: browser-based first-person dodgeball arena game
> Stack: Three.js, vanilla JavaScript modules, Node.js, PeerJS
> Working directory: `C:\Users\Sher\Desktop\dodgb-v3`
> Rule: v2 is the untouched reference. All new work happens in v3.

## 1. Product decision

Warrball will be a fast competitive arena game built around one readable skill:
redirecting an accelerating ball under pressure.

The product identity:

- Krunker-like browser accessibility and fast queue entry.
- Dodgeball-specific aim, timing, movement and team play.
- Short matches with high replay value.
- Competitive rules without paid power.
- Cosmetics obtainable with money or meaningful play.
- Community maps and creator rewards only after the core game retains players.

The initial signature mode is `Rally Duel`:

- 1v1.
- Two clean maps.
- No runes or active abilities.
- Normal, great and perfect deflect timing.
- Directional return, spike, lob and movement interaction.
- Fast rematch.

`Team Arena` follows after Rally Duel is stable:

- 3v3 casual.
- Team assists and passing.
- Bot backfill.
- Party and reconnect.

Ranked 3v3 follows only after the authoritative server prototype works.

## 2. Current implementation matrix

### Present and integrated

- Core Three.js game loop.
- Player movement, stamina, dash and wall jump.
- Ball physics, targeting, shot types, trails and skins.
- Bot AI.
- P2P multiplayer and host-authoritative simulation.
- Host migration and late join.
- Perfect deflect classification and practice metrics.
- Tutorial flow.
- Match analytics, MVP calculation and heatmap data.
- Match result UI.
- Ranked queue and seasonal ELO state.
- Replay and spectator foundations.
- Store, battle pass, daily rewards and season contracts.
- Cosmetics, cases, knives, trails and MVP effects.
- Toon shader, outline, bloom and quality presets.

### Present but requiring audit or integration polish

- Ranked integrity.
- Match reward authority.
- Tutorial pacing and completion UX.
- Perfect deflect feedback readability.
- Battle pass economy.
- Case-opening policy.
- Cosmetic preview consistency.
- Replay presentation.
- Spectator broadcast HUD.
- Map editor validation.
- Social and creator systems.
- Performance diagnostics and particle allocation.

### Missing production foundations

- Durable account authentication.
- Production database.
- Server inventory ledger.
- Payment provider integration.
- Refund, tax and regional pricing flow.
- Dedicated authoritative match service.
- Moderation operations.
- Creator publishing review pipeline.

## 3. Non-negotiable rules

- No gameplay power sold for real money.
- Ranked v1 has normalized stats.
- Ranked v1 disables runes, passives, active skills, ultimates and random power-ups.
- Cosmetics cannot change hitboxes, visibility or simulation.
- Client currency and match results are never trusted in production.
- Paid random cases are not part of v3 launch.
- Earn-only cases may remain if odds and duplicate conversion are transparent.
- Premium-currency item pages show an understandable real-money equivalent.
- New permanent queues are not added without enough concurrent players.
- Effects cannot hide the ball or team ownership.
- Creator payouts do not launch before moderation and fraud controls.

## 4. Internal success gates

These are initial product targets, not external industry claims. Replace them with
real cohort data after closed testing.

- Tutorial completion: at least 70%.
- First-match completion: at least 80%.
- D1 retention: at least 20%.
- D7 retention: at least 8%.
- Crash-free sessions: at least 99%.
- Typical queue time: under 60 seconds.
- Low-quality 720p target: stable 60 FPS on the selected baseline device.
- Ball visibility failures in moderated playtests: zero accepted failures.
- Ranked reward claims: idempotent and server-validated.

## 5. Release roadmap

### V3.0A: Reality check and rules

Deliverables:

- Replace the old feature wish-list with this implementation matrix.
- Unify the design system.
- Define ranked v1 rules in one code module.
- Normalize competitive stats.
- Disable competitive abilities, runes, passives and power-ups.
- Establish gameplay, economy, backend, asset and metric documents.

Exit gate:

- Competitive rules are deterministic and shared by player and bots.
- Casual mode keeps existing character identity.
- No new shop or map work starts before this gate.

### V3.0B: Rally Duel vertical slice

Deliverables:

- 1v1 ruleset.
- Two selected maps.
- Deflect timing and directional-return tuning.
- Catch/parry prototype.
- Ball heat indicator driven by speed.
- Threat audio and direction indicator.
- Short intro, result and rematch flow.
- Training drill using existing practice metrics.
- Bot opponent for empty queues.

Exit gate:

- Five external players can finish the tutorial and rematch without assistance.
- Match outcome is understandable from visual/audio feedback.
- No permanent ability or economy advantage exists.

### V3.0C: HUD and game-feel polish

Deliverables:

- Three-layer UI: shell, pre-match and in-match HUD.
- Stable score/timer placement.
- Accessible cooldown and danger communication.
- Reduced-motion support.
- Shared particle geometry/materials.
- Draw-call, triangle, texture and frame-time diagnostics.
- Shader warm-up for critical materials.

Exit gate:

- Ball remains visible through every supported effect.
- HUD works at 1280x720, 1920x1080 and 375px fallback width.
- Low quality meets the selected baseline performance target.

### V3.1: Team Arena and social loop

Deliverables:

- 3v3 casual.
- Party invite and ready state.
- Reconnect window.
- Bot backfill.
- Rematch.
- Private lobby and server browser.
- One weekly arcade rotation.

Exit gate:

- Low population does not split across multiple permanent queues.
- Party disconnect and rejoin paths are recoverable.

### V3.2: Production account and economy

Deliverables:

- Account authentication.
- Production database.
- Inventory and currency ledger.
- Idempotent purchase/reward transactions.
- Direct cosmetic store.
- Mastery currency and free earning routes.
- Regional pricing, refund and tax integration.
- Founder/supporter pack.

Exit gate:

- No client can choose its own reward amount.
- Every paid item has an exact preview and price.
- Free players can earn a representative set of cosmetics.

### V3.3: Authoritative online competition

Deliverables:

- Authoritative 1v1 match prototype.
- Input sequence and server tick.
- Snapshot interpolation and reconciliation.
- Signed match result.
- Server-owned ELO and rewards.
- Leaver, reconnect and abandon rules.
- Authoritative 3v3 after the 1v1 prototype passes.

Exit gate:

- Ranked result cannot be submitted by a standalone client request.
- Replay and authoritative result agree on winner and score.

### V3.4: Ranked and esports presentation

Deliverables:

- Placement matches.
- Separate hidden MMR and visible rank presentation.
- Map veto.
- Spectator broadcast HUD.
- Replay timeline and highlight markers.
- Tournament lobby.
- Season rewards.

### V3.5: Creator beta

Deliverables:

- Map schema and limits.
- Private test publishing.
- Thumbnail and tags.
- Moderation queue.
- Report and takedown path.
- Featured rotation.
- Creator analytics.
- Fraud-resistant creator reward model after sufficient player scale.

### Active creator content stream

This is pre-beta work. It does not unlock creator payouts, paid map placement or
unreviewed public publishing.

- Workshop discovery: approved-map browsing, search, newest/name/trending sort
  and per-account upvote/downvote state.
- Voting integrity: map creators cannot vote for their own map; only aggregate
  totals are exposed; a new revision resets votes and returns to review.
- Official content: `Circuit Dome` is a symmetric indoor competitive map using
  existing procedural neon/cyber render paths, so it adds no model download or
  texture streaming cost.
- Cosmetic content: `Circuit Vanguard` is a direct 650-coin purchase and a
  disclosed 7% Chroma Case drop. Coins and cases remain earnable through play.
- Next beta work: report/takedown flow, approved-map thumbnails and tags,
  featured rotation rules, creator analytics and moderation tooling.

Acceptance checks for the active stream:

- Public workshop cards never reveal another player's individual vote.
- A player cannot vote for their own map.
- Workshop ranking remains deterministic for equal scores.
- Official maps preserve map metadata, spectator bounds and low-quality paths.
- Cosmetic unlocks affect appearance only, never hitboxes or gameplay stats.

## 6. Queue strategy

Launch queues:

- Quick Play.
- Rally Duel.
- Team Arena when ready.
- One rotating Arcade card.
- Custom/Private.

Do not launch separate permanent queues for every mutator. Speedball, Multiball,
Hot Potato, Pinball, Low Gravity and Instagib use the rotating Arcade slot.

## 7. Economy decision

Currencies:

- Coins: earned through play.
- Mastery Shards: earned from character/ball mastery.
- Premium currency: optional, introduced with payment infrastructure.
- Event Token: temporary and clearly expiring.

Store:

- Direct purchase is the primary paid model.
- Cases use earn-only tickets.
- No paid stat boosts.
- No paid ranked access advantage.
- No paid visibility advantage in gameplay.
- Duplicate conversion is disclosed before opening a case.

Battle pass:

- Starts only after retention gates are credible.
- Eight-week initial season.
- Free reward on every tier.
- Premium track contains cosmetic additions.
- Catch-up XP near season end.
- No artificial energy system.

See `docs/V3_ECONOMY.md`.

## 8. Design decision

Style name: `Kinetic Arena Sport`.

- Deep navy background.
- Red and blue retain semantic team ownership.
- Acid yellow marks actions, perfect timing and rewards.
- Cyan is a technical accent, not the only brand color.
- Russo One for display headings.
- Chakra Petch for interface text.
- Four to eight pixel corner radius.
- Thick readable borders.
- Minimal glow outside gameplay-critical objects.
- SVG icon system; emoji is not the primary UI icon language.

The authoritative visual specification is:
`design-system/warrball/MASTER.md`.

## 9. Asset and rendering decision

- Repeated arena props use shared geometry/materials or instancing.
- Transient effects avoid per-particle geometry/material allocation.
- Every model has triangle, material and texture budgets.
- Every shader has a low-quality fallback.
- Critical textures and shaders are preloaded.
- Runtime diagnostics use renderer information and frame-time samples.
- Visual work is measured before and after changes.

See `docs/V3_ASSET_PIPELINE.md`.

## 10. Backend decision

PeerJS remains acceptable for casual/private testing. It is not the final ranked
authority.

Production services are separated into:

- Account/profile service.
- Inventory/economy ledger.
- Matchmaking/lobby service.
- Authoritative match service.
- Analytics ingestion.
- Moderation/admin tools.

See `docs/V3_BACKEND.md`.

## 11. Definition of done

Every implementation item records:

- User value.
- Exact files touched.
- Dependencies.
- Happy path.
- Failure path.
- Security boundary.
- Performance impact.
- Accessibility behavior.
- Measurable acceptance check.
- Deferred work.

## 12. Current execution order

1. V3 documents and design source of truth.
2. Competitive rules module.
3. Ranked stat/ability normalization.
4. Rally Duel specification and integration.
5. HUD and ball-readability pass.
6. Particle/rendering allocation pass.
7. Team Arena/social integration.
8. Production account/economy foundation.
9. Authoritative match prototype.
10. Ranked/esports presentation.
11. Creator beta.

Detailed task state lives in `docs/V3_BACKLOG.md`.
