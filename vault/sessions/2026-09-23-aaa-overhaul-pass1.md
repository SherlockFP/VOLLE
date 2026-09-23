# 2026-09-23 — AAA overhaul, pass 1

Plan and full audit: `docs/AAA_ROADMAP.md`. Brand decision: **VOLLE** everywhere user-facing.

## Security / economy (Faz 0)
- **Critical:** static server served everything under the repo root — `/data/accounts.db`
  (password + session hashes), `/.git/config`, `/server/*` returned 200 when `DATA_DIR`
  was unset (the published Docker image). Now an allowlist (`server/static-policy.js`):
  only `index.html`, `sw.js`, `manifest.webmanifest` and `assets/ css/ js/ vendor/ music/ sfx/`.
  Dockerfile sets `DATA_DIR=/data` + volume. Tests: `tests/static-policy.test.cjs`.
- Daily login: two parallel reward systems (local 40+10n vs server 20/150) merged into the
  server-owned streak. Daily free Kickoff case is server-owned (`openCase(..., { dailyFree })`,
  `dailyFreeCaseDay`). Guests keep the local path.
- Combo damage multiplier applied to every attacker (bots/remotes inherited the local
  player's perfect-deflect streak) → local attacker only.
- CI runs `npm run check` + `npm test` before publishing the image.
- `COSMETIC_ENTITLEMENT_SECRET` env (render.yaml generates it); production warns on unset secrets.
- Loot-box invariant pinned by test: cases are coin-only, gems never substitute.
- Service worker answered failed CSS/JS with `index.html` (unstyled page after any network
  blip); shell fallback is now navigation-only; shell list matched to real stylesheets.

## First 5 minutes (Faz 1)
- Guest play: "Play Now" on the auth card, returning guests skip the gate, capture-phase
  gate turns economy/social/ranked controls into a free-account prompt. Guest progress is
  device-local and never merged (server guest sessions stay off — they trust client currency).
- First-run welcome opens once (`ftueSeen`); the drill itself is still the player's choice.
  (Reverses the earlier "never auto-show" decision on purpose.)
- New-player lock: Ranked / Battle Pass / Tournament shown locked until match one
  (`isNewPlayerProfile`, also honours server ranked/battle pass progress).
- Rotating tips on the first-load screen; post-match guest save banner.

## Skins / viewmodel (Faz 2)
- Viewmodel was **hidden by default** (only `sv_hand 1`) — players never saw owned knives.
  Now on by default; `sv_hand` persists `showViewmodel`.
- `js/viewmodel-fx.js`: rarity layer — rare rim, epic + swing trail, legendary + sparkles/pulse;
  alpha-blended rim so it reads on daylight maps; zero per-frame allocation; reduced motion keeps
  only the static rim. Deflect recoil on the hand via `Player.kick`.
- Knife test drive: case inspector lists every knife with "Try in hand" → Free Lab with that
  knife + auto inspect; leaving restores the owned knife only.

## Gameplay (Faz 3, parallel agents)
- Stereo/distance ball audio (`computeStereoPan`, `Audio.setListener`).
- Kill flash → edge-only vignette, centre stays clear (design doc rule).
- Rally speed honours the mode cap; `ball.isOverdrive` uses existing heat-tier visuals.
- Real layouts: Pillar Hall (pillars), Circuit Dome (lanes), Volcano (vents), Mecha Hangar (decks).

## Menu
- `css/menu-depth.css` + `_setupMenuDepth`: eased pointer parallax, panels lean toward the hero,
  glossy CTA sheen, tab glow underline, entrance choreography. Disabled under reduced motion
  (note: the dev machine's browser reports `prefers-reduced-motion: reduce`).

## Validation
- `npm run check`: 111 files OK. `npm test`: **2004/2004**.
- Browser: guest entry → FTUE → gate prompt → returning guest → solo match; case inspector →
  knife test drive; menu at 1280×760. Not done: real two-player network soak, human fun test.

## Known gaps / next
- Ball passes through Mecha deck slabs (needs ball↔platform collision in ball.js); bots can't
  climb decks; players can double-jump lane rails.
- No real payment checkout yet (needs a provider account — owner decision).
- i18n (TR/EN), mobile touch controls, esbuild bundle, sync-write → SQLite, real leaderboard,
  ranked collusion check, menu hero model/pose art pass.
- Tooling: `core.autocrlf=true` + mixed CRLF/LF files — editors normalise whole files. Repair:
  `git diff --ignore-cr-at-eol > p; git checkout -- <files>; git apply --ignore-whitespace p`.
