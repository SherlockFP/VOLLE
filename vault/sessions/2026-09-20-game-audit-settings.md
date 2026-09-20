# 2026-09-20 — Gameplay audit, reliable progression and Graphics settings

## Completed

- Rebuilt the settings dialog with explicit header / tabs / scroll / footer rows.
  Graphics groups image quality and display/frame rate; audio is together under
  Controls. Native control IDs, persistence adapters and preset values remain.
  Removed the VSync dropdown that only saved a value without changing rendering;
  the panel explains browser-managed sync. Graphics remains `data-tab="video"`.
- Added roving-tab keyboard navigation, tab/panel ARIA links, scroll reset on actual
  category changes, focus containment and return, and a persistent Done action.
  Styling lives in `css/settings-workbench.css`; obsolete arena-interface settings
  overrides were removed. Explicit grid placement fixes the legacy mobile `order:3`.
- Bots now treat an empty skill cooldown table as ready; remote skill cooldowns
  initialize, tick and reset on the existing host clock. Dead/out-of-phase skill
  requests are rejected. Remote attacks cannot resurrect committed deaths or restart
  a finished rally; legitimate pending-lethal contacts retain their bounded grace.
- Host movement reports no longer accept client-authored HP/alive. Connected host
  and guest missed swings are both feedback-only until a validated swing-intent
  protocol exists. Offline late misses use the normal authoritative damage helper,
  including the shield-independent Instagib rule. Concurrent early-miss/ball tuning
  was preserved rather than overwritten.
- Reconnect attempts have five-second deadlines, scoped Peer unavailability handling,
  once-only cleanup and stale-open guards; the existing three-retry/migration flow remains.
- Composer/render-target DPR now follows quality, render scale, resolution and resize.
  A map bloom override cannot turn bloom back on at Low quality.
- XP boost purchases use the existing authenticated purchase route with a server price,
  server-clock expiry, persisted receipt, overlap rejection and rollback on save failure.
  Client retries retain the same request ID after ambiguous failures and never debit
  optimistically. Purchased boosts affect Player XP and Battle Pass match XP; earned
  boosts remain Battle Pass only. No coin/ELO/combat multiplier was added.
- The generated ladder now identifies itself as a local Practice Ladder and labels bot
  samples. Filtered positions match the visible roster; malformed local cache is bounded.
- Diagnostics no longer report fabricated 0% packet loss; unmeasured loss is N/A.
  FPS uses actual elapsed frame time instead of the physics-capped delta.

## Validation

- `npm test`: **1,917/1,917**, no failures/skips. Log: `.qa/evaluation-final-tests.log`.
- `node scripts/check-js.js`: **110 files** pass. `git diff -w --check` passes.
  Graft was refreshed and `graft:check` reports the wiring graph in sync.
- Settings-focused compatibility: **100/100** before the final source-order repair;
  the final complete suite includes the repaired exclusive-overlay contract.
- Browser fixture uses current production HTML/CSS and the actual settings controller:
  **39 checks** for all four categories, native control reachability, tab stops, keyboard
  navigation, scroll reset, reset confirmation and Done. No page exceptions.
- Layout matrix: 1440×900, 1280×720, 375×812, 812×375, plus 1280×720 at 120% UI scale.
  Modal/header/tabs/content/footer stay in order and in bounds; sliders do not overlap
  their numeric outputs. Desktop, mobile and landscape screenshots were inspected.
  Evidence: `.qa/settings-browser-report.json`, `.qa/settings-*.png`.
- Reconnect tests use deterministic transport/timers. Renderer tests use actual vendored
  Three.js composer targets without a GPU FPS benchmark. Economy tests exercise real
  ProfileStore persistence and client retry behavior; authenticated browser registration
  attempts were tool-blocked before execution, so no live-account end-to-end purchase
  result is claimed. The UI fixture is separate from real account data.
- No dependency, deployment or commit was added. Parallel ball/other working-tree edits
  were preserved. Isolated QA artifacts remain under `.qa`.

## Product assessment and next priorities

Strengths are the accelerating-ball skill loop, physical collision/defensive telegraph
foundation, normalized competitive rules, shared character/cosmetic pipeline and broad
behavioral regression coverage. More content is not the first dependency for improving play.

Next priorities: settle/expire abandoned multiplayer result reports so a missing opponent
cannot block future rewarded matches; synchronize and validate equipped ability metadata;
filter direct mesh life-state reports by source; and complete real multi-peer reconnect/
rematch and low-end GPU playtests. These fixes do not make P2P fully cheat-proof or establish
production-ranked authority. Volleyball remains a local practice experience. First-match
clarity, difficulty progression, retention and actual fun require human playtest evidence.
