# P2P Host Fixes (User report 2026-07-30)

## Confirmed bugs

1. **Host exits → lobby stays open.** When the host leaves a 1v1 match, the
   lobby should close immediately. Currently it stays listed in the browser
   and other peers don't get disconnected.

2. **No host migration in 2v2+.** When the host leaves and there are more than
   2 players, the lobby should migrate to the next eligible peer instead of
   dying. Currently: lobby closes, everyone dropped.

3. **Partial data sharing.** Host doesn't sync all game state to peers. Some
   data (likely settings, mutators, map state) stays host-only and peers see
   stale or missing information.

## Affected files (to audit)
- `js/network.js` — PeerJS connection lifecycle, disconnect handlers
- `js/main.js` — `_doHostGame`, `_lobbyCode`, `_unregisterLobby`, host migration
- `server.js` — `/api/lobbies` CRUD
- `js/game.js` — sync, `broadcast`, host migration checkpoint

## Priority order
1. Host leaves → lobby removed from registry
2. Host migration to next eligible peer (build on existing checkpoint infra)
3. Full state sync on join (complete snapshot, not partial)

## Status
**Fixed 2026-07-30.** Host migration infrastructure (vote/epoch/checkpoint) already
existed in `js/network.js` and `js/game.js` — the three bugs were gaps in how it was
wired up, not a missing subsystem. Root causes and fixes:

1. **Host exits → lobby stays open — root cause: `_beginHostMigration()` always
   self-promoted.** In 1v1, after the host disconnects, the sole remaining player
   was the only migration candidate and always "won" the election against zero
   rivals — the client silently became host of an empty lobby instead of closing.
   Fix (`js/network.js` `_beginHostMigration`): bail out to `onHostLeft()` when
   fewer than 2 eligible candidates remain, closing the lobby instead of
   self-promoting. Also: `beforeunload` (`js/main.js`) now calls
   `network.closeLobby()` for the host instead of a bare `disconnect()`, so an
   explicit tab close messages survivors immediately instead of relying on the
   ~3.5s reconnect-timeout fallback. Server: lobby records now carry `lastSeen`
   (alongside `updatedAt`) and `LOBBY_TTL` moved from 30s to 45s to survive
   background-tab `setInterval` throttling on the 12s host keep-alive.
2. **No host migration in 2v2+ — root cause: real gap only in re-registration.**
   The vote/epoch election and checkpoint restore (mode/map/score/round/time) were
   already correct end-to-end. The actual bug: a migrated host never re-registered
   its lobby with the server after taking over — `_installMigratedHostHandlers`
   (`js/main.js`) registered once and never re-armed the 12s keep-alive, so the
   lobby silently expired off the browser at the next `LOBBY_TTL` window even
   though the match kept running. Fixed by arming the same keep-alive interval
   used by `_doHostGame`. The departing host's own record is already deleted
   before the explicit-leave path triggers migration; a hard crash relies on
   the (now 45s) TTL, same as bug #1.
3. **Partial data sharing — root cause: snapshot omitted settings/mutator/map
   state, and late-join ball sync read the wrong field.** `js/game.js`
   `snapshotState()` (used for both the join `welcome` packet and migration
   checkpoints) was missing `settings` (matchTime/maxRounds/botDifficulty),
   `ballAffix` (the active ball mutator), and `chaos` (tornado/gravity-flip map
   hazards) — added all three, backward-compatible (`undefined`/`null` when
   absent, read via optional chaining). Separately, `handleLateJoin` checked
   `data.ball`, a field the `welcome` message never sets (ball state only ever
   arrives nested under `data.snapshot.ball`) — that branch was dead code; late
   joiners relied entirely on the next periodic `ballState` broadcast instead of
   syncing immediately. Fixed to read `data.snapshot?.ball || data.ball`, and to
   apply the new `ballAffix`/`chaos` fields via the existing `applyChaosState`/
   `updateBallAffix` plumbing. `applyHostMigrationCheckpoint` also best-effort
   restores `ballAffix` post-migration (score/round/mode/map were already
   correctly restored there).
4. **Lobby browser UX.** `_refreshLobbyList` (`js/main.js`) cards now show
   player count as `X/Y` (was just `X`), a relative lobby age ("12s ago"), and
   the map (already present). Empty states (no lobbies at all, or none matching
   filters) show a clear message plus a "Host a game" button that triggers the
   existing create-lobby flow. The 5s auto-refresh interval was audited against
   `GET /api/lobbies`, which is not rate-limited server-side — left unchanged.

**Tests:** `tests/lobby-lifecycle.test.mjs` (18 tests) covers the TTL prune
behavior, the 1v1-close vs 2v2+-migrate decision, the migrated-host keep-alive
re-registration, snapshot field completeness, the late-join ball/affix/chaos
application (including the `data.ball` regression), and the lobby-browser pure
helpers. `node --test tests/lobby-lifecycle.test.mjs` → 18/18 passed. Re-ran all
existing network/migration-adjacent suites (`network`, `mesh-security`,
`host-migration`, `checkpoint-lifecycle`, `lobby-browser`, `lobby-browser-mode`,
`server-registry`, `rtc-config`, `social-lobby`) → 106/106 passed, unweakened.