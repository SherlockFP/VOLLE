# Warrball Development Roadmap (living document)

**Owner:** Main agent, acting as project lead/decision authority per explicit user mandate.
**Operating rule:** decide and execute without asking permission per-step; verify every claim
against real code/browser evidence before marking done; delegate independent slices to capable
agents, never route judgment-requiring work to low-reasoning/mechanical agents.

This file is updated as phases complete or scope changes. It is not a status report — it is the
plan being executed against.

---

## Phase 0: Regression Recovery (blocking everything else)

Three claims from the user, each verified before being treated as real:

1. **Main menu has no 3D render.** CONFIRMED root cause: `_initMenuHero()` (main.js) looks for
   `#menu-hero-canvas`, which existed in commit `f2802c8` and was silently deleted in `0567fc8`
   (a dev pass whose assigned scope was CSS tokens, not index.html) via an out-of-scope edit.
   The function fails its `if (!canvas) return` guard silently — no error, just the flat CSS
   `.ow-character` fallback forever. Fix: restore the canvas, verify live WebGL render.

2. **Ball doesn't go to bots when a match starts.** Not yet reproduced against a live match.
   Must reproduce with a real bot match before touching ball-targeting code — no fix without a
   confirmed repro.

3. **Character model style mismatch.** In-match characters are the round-headed procedural rig
   (`character-rig.js`, animated, cosmetic-socket-compatible). Avatar painter and shop preview
   screens instead show Kenney "blocky-characters" GLB assets (Minecraft-style), per
   `assets/cc0/ASSET_MANIFEST.md`'s own documented intent ("character previews"). This is a
   genuine visual-promise break: what you customize is not what you see in-game.

---

## Phase 1: Foundational Decisions (must precede all new content)

- **Canonical character style = the procedural round-head rig.** It is what actually renders in
  matches, is animated, and is the thing the entire cosmetic-attachment system (sockets, rig
  offsets, `applyEntityCosmetics`) was built around. The Kenney blocky previews in avatar/shop are
  the bug to fix, not a second style to keep alive. All new skins (zombie, anime-inspired) target
  this rig.
- **Default game mode = one-shot/instagib.** Locate the mode definition, verify it exists, wire
  as default on load.

## Phase 2: Main Menu Overhaul

- Restore and verify the live 3D hero canvas actually renders (not just DOM-present).
- Make it feel alive, not "sıkıcı": idle motion, camera/parallax response to pointer, ambient
  particles/lighting consistent with the theme system already shipped.
- Keep the flat CSS card as the genuine no-WebGL fallback (`_initMenuHero`'s own stated intent) —
  don't delete it, just make sure the live path actually engages.

## Phase 3: Shop UX Fixes

- Item preview tiles are too small to read at a glance — enlarge/redesign the grid cells.
- "Back to menu" button is oversized, eating layout space — shrink to match other secondary
  actions.
- Top nav/category bar is oversized — shrink slightly, matching the rest of the shop's density.
- Verify every added ball skin is actually selectable/visible in the shop grid (not just present
  in `BALL_SKINS` data with no UI path to it).
- Price pass: audit current prices for consistency across rarity tiers.

## Phase 4: Viewmodel Overhaul

- Locate first-person weapon/hand rig (viewmodel) code.
- Fix reported rocket-launcher-clips-into-hand.
- Audit every other weapon's viewmodel offset for the same class of bug.

## Phase 5: Map Atmosphere

- Audit existing arenas for the "ruhsuz/zombimsi" (lifeless) complaint: lighting, skybox variety,
  environmental detail, prop density.
- Add atmosphere without touching collision/gameplay geometry.

## Phase 6: New Content — Skins

- Zombie-themed character skins on the canonical procedural rig.
- Original anime-inspired character skins — **no trademarked/copyrighted characters (e.g. actual
  Naruto) are implemented; only original designs in that visual register.** This boundary is
  fixed and non-negotiable regardless of future phrasing of the request.
- Extra ball skins/effects as capacity allows.

## Phase 7: Mechanical Polish

- Whatever concrete gameplay bugs Phase 0's reproduction work surfaces (ball targeting, etc.)
  get fixed here with the same reproduce-before-fix discipline as Phase 0.

## Phase 8: Verification & Ship

- Full automated suite + real browser smoke test (not synthetic module calls alone) for every
  changed system before any commit.
- Commit and push after each coherent phase, not one giant deferred commit — smaller, verified,
  reviewable increments, consistent with how this session has operated so far.

---

## Execution Log

- Session start: consolidated 5 stacked user messages into this roadmap.
- Phase 0 item 1 (menu render): root cause confirmed, fix in progress.
