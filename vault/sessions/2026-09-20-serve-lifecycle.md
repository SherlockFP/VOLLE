# Gameplay review: opening serves, shared bot work and match-clock clarity

## Scope and working-tree ownership

The starting repository HEAD was `80cd197`. During this session, bot navigation,
bot status-effect/disposal fixes and Arcade entry/layout changes appeared in the
shared working tree. They were inspected and preserved rather than overwritten.
This receipt distinguishes their review from the opening-serve and HUD changes
implemented in this session. No commit, deployment, economy changes, new runtime
dependency or ball steering/homing rebalance was performed.

## Implemented here

`js/game.js` no longer starts the opening serve from an unowned 700 ms timeout.
One pending opening is attached to the actual scoreboard, round and ball. It
advances only during PLAYING on the simulation clock. Pause preserves the
remaining delay; leaving the round clears it. Replacing the round, match or ball
invalidates it. A target removed or eliminated during the opening is replaced
only by a living current participant. An already acquired target or an early
deflection cannot be overwritten. Solo and host retain authority; a network
client cannot commit a serve.

The existing 0.7 second opening delay and distance-based opening readability cap
are preserved. The ball's steering, deflect chances, velocity integration and
damage constants were not changed.

`index.html` now labels the global gameplay countdown MATCH, not ROUND. The
Scoreboard consumes this same time budget across rounds; only a match reset
restores it. The existing structural HUD test was updated to assert MATCH with
the same nested-value and hot-path requirements, not relaxed.

## Shared work reviewed

The current `js/bot.js` prevents wandering after death, applies the player's
20 percent chill slow, removes the team-half restriction in FFA, and uses the
arena's sphere/box props for bounded movement with stable detours. Committed
defence retains its movement budget. The current removal path also disposes
owned label/avatar/HP sprite resources once.

The current Arcade page exposes Bot Matches, Guided Deflect, Free Lab and the
explicitly local Volleyball Drill. The existing solo choices are discoverable;
these are not newly invented modes. Its card area scrolls separately from Back
on short/mobile viewports. Solo copy correctly calls the clock a match limit.

Additional actual-Bot tests were added here for 30/60/144 Hz obstacle movement,
movement budget, box cover, a long-frame crossing, overhead/broken props, FFA,
dead bots, planted deflects and malformed time steps. These are controlled
simulation tests, not measured render FPS or a navmesh/pathfinding claim.

## Validation receipts

- `tests/opening-serve-lifecycle.test.mjs` executes shipped methods and the real
  opening-speed helper, including the complete `startRound` wiring, stale round
  replacement, pause/resume, live-target fallback and host/client boundaries.
- `tests/bot-navigation.test.mjs` executes the shipped Bot class methods with
  presentation stubbed. Existing bot behaviour assertions remain intact.
- `tests/match-clock-copy.test.mjs` checks the visible copy against actual
  Scoreboard behaviour across rounds and match reset.
- `.qa/serve-final-tests.log`: **1,954/1,954 passed, zero failed, zero skipped**
  in the final full run. `npm run check`: **110 JavaScript files syntax-clean**.
  `git diff --check` passed. The local Graft graph was rebuilt successfully;
  the separate post-build check invocation was blocked by the tool gateway.
- `.qa/serve-playtest-report.json` records an actual production-module browser
  run on an isolated local origin using UI input through CDP. A controlled pause
  held the opening at 0.6231 seconds for 1.2 wall-clock seconds; resuming acquired
  a target. A no-input warm-up completed all three rounds, 1-2, reached results,
  and the Rematch button started round 1 at 0-0 with a live target. No captured
  page errors occurred. This is an end-to-end smoke test, not a human fun score.
- Screenshots inspected: `.qa/serve-arcade.png`, `.qa/serve-live.png`,
  `.qa/serve-results.png`, `.qa/serve-rematch.png`. The original smoke screenshots
  preceded the final MATCH-label change; the final copy is covered separately.

The first browser harness attempt failed because it tried to serialize a cyclic
game object through CDP. The boolean wait condition was corrected, then the full
browser run passed. The full-suite run after changing the label exposed one
legacy exact-copy assertion; it was updated from ROUND to MATCH without changing
its structural assertions, then the suite was rerun.

## Assessment and remaining priorities

The project has a substantial playable foundation: readable timing/deflection
systems, distinct skill and loadout choices, three focused solo presets, quick
rematch, a wide local activity catalog and broad automated regression coverage.
The menu/result screens now provide more structure than the original entry flow.

The next high-value work is about rally quality rather than more shop content:
measure meaningful contacts and idle time by difficulty/player count, validate
team tactics and target readability in prop-heavy courts, and play sustained
non-Instagib matches with real inputs. Local obstacle avoidance is not full
route planning. A scripted no-input win/loss does not establish balance.

Overtime currently assigns speed from its base-speed ramp each frame, potentially
overwriting speed gained during a rally; this was observed in source but was not
changed without a dedicated physics/status-effect regression matrix. Several
large game/main/UI modules make lifecycle coupling expensive to inspect. Extract
one well-tested subsystem at a time rather than rewriting the game.

Real multi-peer latency/NAT/TURN soak, authoritative competitive settlement,
long-session memory and GPU frame-time measurements remain outside this receipt.
Volleyball remains local-only. No claim of production-ranked readiness is made.
