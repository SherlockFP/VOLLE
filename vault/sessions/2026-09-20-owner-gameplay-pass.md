# Owner gameplay pass: bot fairness and discoverable local play

## Scope and ownership

This pass implemented the Bot movement/status/resource changes, Arcade entry and
layout changes, and solo match-limit copy described below. It added 20 tests in
`tests/owner-bot-tactics.test.mjs` and `tests/owner-arcade-entry.test.mjs`.

The shared working tree changed concurrently. The opening-serve lifecycle work,
the HUD MATCH label, and the additional bot-navigation/serve/clock tests were
preserved and validated, not authored by this pass. Their separate receipt is
[[2026-09-20-serve-lifecycle]]. Earlier settings/shop changes also remain intact.
No commit, push, deployment, runtime dependency, economy change or ball/homing
rebalance was performed here. Browser accounts and backend files were isolated
under `.qa/owner-data`; production player data was not used for testing.

## Implemented

### Bots follow the court instead of ignoring it

`js/bot.js` now checks the arena's sphere and box colliders. Bounded movement
substeps prevent a long frame from crossing a thin wall. Sliding and a stable
perpendicular detour let ordinary movement go around nearby cover without
adding a movement-speed bonus. Already committed deflect/dodge movement does not
gain the detour. Broken and overhead props do not become invisible barriers.
Overlapping spawns separate toward an exit within the court's legal bounds.

This is local obstacle avoidance, not a navmesh or a guarantee of optimal routes
through every compound obstacle arrangement. Difficulty probabilities, reaction
times, wind-up times, ball speed and deflect mechanics are unchanged by this pass.

FFA bots are no longer clamped to the red/blue team's old half. Normal team play
retains its established half-court limits. Dead bots stop wandering. Chill applies
the same 20 percent movement slow as the player, combined with a validated hazard
multiplier without modifying base speed. Invalid frame deltas cannot corrupt
movement. Bot removal disposes its owned name/avatar/HP sprite textures and
materials exactly once, in addition to the existing rig/weapon cleanup.

### Existing local modes are reachable again

The handlers and three solo presets already existed, but their entry buttons
were absent from the page. Arcade now presents four real entries: Bot Matches,
Guided Deflect, Free Lab, and Volleyball Drill. Bot Matches opens the existing
Warm-up, Rally Duel and Under Pressure selector, preserving lobby review before
launch. Volleyball is explicitly labeled local-only and guided, not multiplayer.

The Arcade panel has fixed heading/Back controls with a bounded scrolling card
area. Back remains in view on short and portrait displays. The solo detail now
describes the clock as a match limit, not a round limit. Changed production files:
`js/bot.js`, `js/main.js`, `index.html`, `css/arena-interface.css`.

## Validation

The initial actual-Bot regression run failed 11 of 14 cases on the pre-change
code (`.qa/owner-bot-before.log`). After implementation and boundary additions,
all 17 Bot cases and all 3 Arcade contract cases pass. The tests execute shipped
Bot methods with real vendored Three.js vectors and presentation stubs rather
than duplicating the movement algorithm. Pillar/box scenarios run at 30, 60 and
144 simulated updates per second and check collision and movement budgets.

The latest full shared-tree run, `.qa/owner-final-tests.log`, reports
**1,954 tests passed, zero failed, zero skipped**. `npm run check` reports
**110 syntax-clean JavaScript files**. `git diff --check` passed. The local Graft
wiring graph was rebuilt and its check passed; no paid/deep analysis was used.
One intermediate suite overlapped the concurrent ROUND-to-MATCH label change;
the final run uses the updated exact-copy assertion with its structural checks
retained, not a relaxed test.

### Actual browser smoke

`.qa/owner-browser.cjs` drives the production app through native CDP mouse/key
input in one dedicated local tab. `.qa/owner-browser-report.json` records the
final successful run: three viewport layouts, three solo presets, a complete
three-round Warm-up ending 1-2, and Rematch starting a new match at round 1,
0-0, with one bot. No captured page errors or unhandled rejections occurred.

The preset checks observed the configured modes, maps, 180-second match limits,
one opposing bot each, and easy/medium/hard difficulties. At 1280x720, 375x812
and 812x375 the four entries have no horizontal overflow, and Back stays in the
viewport without the card scroller overlapping it. Screenshots are under
`.qa/owner-arcade-*.png`, `.qa/owner-solo-chooser.png`,
`.qa/owner-lobby-*.png`, `.qa/owner-warmup-playing.png`,
`.qa/owner-warmup-results.png`, and `.qa/owner-rematch-playing.png`.

The local Volleyball entry was also launched from Arcade. E produced a clean
serve/contact and advanced the drill; Esc restored MENU and the sport directory
with pointer lock released. `.qa/owner-volleyball-report.json` records the exit
check. A rapid Tab/Tab/Enter probe did not establish the intended focus path;
only the documented Esc exit is certified here. The first general browser
attempts also exposed test-harness issues (a missing postgame button selector
and another session reusing the same page). The final run uses the actual
`pg-play-again` button and a dedicated target URL, then repeats the full flow.

These are rendered, automated lifecycle checks. Match observation deliberately
used no player attacks; it is not human balance testing, measured render FPS,
proof of enjoyable rallies, or a multi-peer network soak.

## Assessment and next priorities

The strongest foundation is the timing/direction/movement-based combat, existing
loadout and mode variety, focused short solo choices, functioning rematch loop,
and broad regression coverage. The weak point was not simply a lack of content:
some ready content was invisible, and bots violated the court and status rules.
This pass improves those two concrete player-facing issues.

Deeper team positioning, opponent selection, recovery from compound obstacles,
and rally quality still need work. Measure accepted contacts, meaningful player
decisions and idle time across difficulties/player counts before tuning damage
or making bots artificially accurate. Game/main/UI remain large coupled modules;
extract one tested subsystem at a time rather than rewriting the project.

Volleyball still needs physical contact validation based on player position,
reach, facing and jump/timing state. The existing local session uses the ball's
position for non-serve contact origin, while its runtime receives aim rather
than a complete player pose. Keep it honestly presented as a guided local drill
until that contract is implemented and tested; this pass did not change it.

Real-player readability, sustained non-Instagib matches, live peer latency and
NAT/TURN behavior, authoritative competitive settlement, long-session memory,
and GPU frame-time comparisons remain unverified. New shop content is a lower
priority than making the current rally and team decisions consistently strong.
