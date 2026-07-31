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

## Still broken after the above — fixed 2026-07-31

The 2026-07-30 pass fixed migration and snapshot completeness but never touched the
thing the user was actually hitting. Re-reported symptoms: "hosting and joining later
still broken; sometimes two tabs / two browsers can't see or join each other's lobbies."
Four independent root causes, none of them in the migration subsystem:

1. **Starting the match deleted the lobby from the registry.** `js/main.js`
   `bind('btn-start-game')` ran `clearInterval(this._lobbyKeepAlive);
   this._unregisterLobby(this._lobbyCode); this._lobbyCode = null;` the moment
   `game.startGame()` succeeded. So the instant a lobby became interesting to a late
   joiner it vanished from the lobby browser — **late join was unreachable through the
   UI**, even though the entire late-join path (`shouldQueueLateJoin` →
   `queueRemoteForNextRound` → `welcome` → `handleLateJoin` → `_enterLateJoinSpectator`)
   works. This predates every P2P_HOST_FIXES change (`git log -L` traces it back through
   `5a29b05`/`2238cc3` to the original multiplayer commit), which is why the previous
   pass never saw it. Nulling `_lobbyCode` also disarmed the host's own cleanup: after
   match start, `beforeunload`'s `sendBeacon` delete and `leaveLobby`'s
   `_unregisterLobby` both had nothing to delete, so a host quitting mid-match left a
   stale record until TTL — the exact bug #1 claimed fixed. Fixed: match start now
   re-registers the record with the live player count and leaves the keep-alive armed.
   `tests/rally-duel.test.mjs` asserted the buggy `clearInterval` line verbatim; that
   assertion was inverted.
2. **`LOBBY_TTL` sat below Chrome's throttled-timer floor.** The keep-alive is a 12s
   `setInterval`; Chrome's intensive throttling clamps timers in a hidden tab to **one
   tick per minute**. The 2026-07-30 pass raised the TTL 30s → 45s "to survive
   background-tab throttling", but 45s < 60s, so the lobby still expired — and it
   expired precisely when the host tabbed away to a second tab/browser to look for it.
   That is the "sometimes two tabs can't see lobbies" report. `server.js` `LOBBY_TTL`
   is now 90s (one full throttled minute plus margin).
3. **`lobbyWrite` rate limit is bucketed per source IP, and every local client shares
   one.** `RATE_LIMITS.lobbyWrite` was `[30, 60000]` keyed on
   `req.socket.remoteAddress` — identical for every tab and every browser on the dev
   machine (and for everyone behind one NAT). One host alone spends ~5/min on
   keep-alive plus a write per join, leave, and debounced lobby-name keystroke; two or
   three local clients exhausted the bucket. `_lobbyApi` swallows the 429 into
   `__lobbyApiError`, so registration and keep-alive failed **silently** and lobbies
   disappeared with no console signal. Raised to `[120, 60000]`; verified against a
   live server (100 consecutive POSTs → 200, `X-RateLimit-Remaining: 20`).
4. **An unreachable room code hung the Join button forever.** PeerJS reports a dead /
   expired / mistyped code as a `peer-unavailable` error **on the `Peer` object**, never
   on the `DataConnection` — and nothing in `js/network.js` listened for it. `_joinGame`'s
   promise therefore never settled: no resolve, no reject, no `alert`, no UI change.
   `_joinGame` now attaches a one-shot `peer-unavailable` listener that rejects with
   "Lobby not found — it may have closed already." Related: `joinGame` now trims the room
   code (a pasted code with a trailing newline dialled a peer id that cannot exist), and
   `btn-join-connect` starts the bg loop like `_quickJoin` already did, so a join-by-code
   client does not freeze for everyone else when its tab is hidden.

**Not verifiable from code/node alone:** actual WebRTC data-channel establishment
between two real browsers depends on the public PeerJS cloud broker and STUN reachability
(zero `TURN_*`/`PEER_*` env vars set → STUN-only, cloud broker). A broker outage or ICE
failure produces the same "can't join" symptom and is not addressed here. `initPeer()`
also has no timeout — if the broker accepts the socket but never fires `open` or `error`,
`_doHostGame` still hangs silently. Left alone: no evidence it is the reported failure,
and a timeout would need a real-network tuning pass, not a guessed constant.

**Tests (2026-07-31):** 5 added to `tests/lobby-lifecycle.test.mjs` — match start
re-registers rather than unregisters, a host throttled to one keep-alive per minute
survives `pruneLobbies`, `joinGame` rejects on `peer-unavailable`, ignores unrelated peer
errors and detaches its listener on success, and trims a pasted code. The
`rally-duel.test.mjs` and `lobby-lifecycle.test.mjs` assertions that pinned the old
behavior were updated. `node --test tests/lobby-lifecycle.test.mjs` → 23/23. Lobby/network
suites (`lobby-lifecycle`, `lobby-crosstab`, `network`, `host-migration`,
`checkpoint-lifecycle`, `lobby-browser`, `lobby-browser-mode`, `server-registry`,
`social-lobby`, `mesh-security`, `rtc-config`, `late-join`, `rally-duel`, `menu-flow`)
→ 155/155. Full suite → **1218/1218, 0 failures**.

## Test notes (2026-07-30 pass)

`tests/lobby-lifecycle.test.mjs` (18 tests) covers the TTL prune
behavior, the 1v1-close vs 2v2+-migrate decision, the migrated-host keep-alive
re-registration, snapshot field completeness, the late-join ball/affix/chaos
application (including the `data.ball` regression), and the lobby-browser pure
helpers. `node --test tests/lobby-lifecycle.test.mjs` → 18/18 passed. Re-ran all
existing network/migration-adjacent suites (`network`, `mesh-security`,
`host-migration`, `checkpoint-lifecycle`, `lobby-browser`, `lobby-browser-mode`,
`server-registry`, `rtc-config`, `social-lobby`) → 106/106 passed, unweakened.