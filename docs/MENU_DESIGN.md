# VOLLE menu design brief: "Night Broadcast / Overdrive"

Scope: main menu hub, Quick Play sport select, the multiplayer directory, lobby
chrome, and the shared shell for the secondary screens you open from the menu
(shop, locker, battle pass, profile, ranked, and so on). The in-match HUD,
postgame, and the 3D arenas are out of scope.

Implementation: `css/menu-overdrive.css` (loaded last) and `js/menu-overdrive.js`
(magnetic CTA, screen-change wipe, reduced-motion flag). Markup additions in
`index.html` are decorative wrappers (`.ovd-*`, all `aria-hidden`) plus one
real `<h1>`. Every existing id and handler is untouched.

## Concept

VOLLE is a rally that keeps getting faster until it tips into OVERDRIVE. The
menu is styled like the pre-match broadcast of a night game at the resort
arena. The floodlights are on, the scoreboard type is lit, and the ball's heat
reads from cool cyan to overdrive red.

- **Broadcast furniture.** The nav is a scoreboard strip with numbered routes
  (01–08). The player card is a TV lower-third. Kickers use mono "on-air"
  type, and a LIVE tally light opens the headline.
- **Deflect geometry.** Knife-edge diagonals: clipped corners, a slanted PLAY
  slab, and a slash wipe between screens. One deflect arc crosses the hero
  stage. A ball comes in cool, snaps off the knife and leaves hot.
- **Heat gradient.** `cool → volt → hot → blaze`. Cool is theme-driven
  (`--ui-menu-accent`), so the six UI themes still re-tint the menu. Hot and
  blaze are fixed because they mean OVERDRIVE. Team red and blue stay fixed.
- **Depth.** Layers from back to front: the arena plate graded to night, two
  floodlight beams, a cursor spotlight, the giant outlined `VOLLE` wordmark,
  the live 3D hero (on its own lit plinth) with the deflect arc, then the UI. The existing eased
  pointer vars (`--px`/`--py`) drive the parallax.

## Palette tokens (`#main-menu` and shell screens)

| token | value | use |
|---|---|---|
| `--ovd-night` | `#05070d` | base ink / backdrop |
| `--ovd-night-2` | `#0b1120` | raised surfaces |
| `--ovd-glass` | `rgb(9 13 24 / .72)` | panels (near-opaque, no backdrop blur) |
| `--ovd-line` / `--ovd-line-strong` | `rgb(200 220 255 / .12 / .26)` | hairlines |
| `--ovd-ink` | `#f3f6fb` | primary text (18:1 on night) |
| `--ovd-mute` | `#a3afc4` | secondary text (≥ 8:1 on night) |
| `--ovd-cool` | `var(--ui-menu-accent)` | cool end, focus, live |
| `--ovd-volt` | `#8a6bff` | mid heat |
| `--ovd-hot` | `#ff3d5a` | OVERDRIVE |
| `--ovd-blaze` | `#ffb13b` | peak heat, currency |
| `--ovd-heat` | cool→volt→hot→blaze | meters, rules, wordmark fill |
| `--ovd-heat-warm` | hot→blaze | the one primary CTA (dark ink text, 5.4:1+) |

## Type scale

- Display: **Big Shoulders Display** 800/900, uppercase. It is a stadium
  signage face, and its tight leading (.86) suits a scoreboard. Hero
  headline: `clamp(2.6rem, min(6vw, 8.6vh), 7rem)`. PLAY:
  `clamp(2.4rem, min(3.9vw, 6.4vh), 4.4rem)`. Screen titles:
  `clamp(2.2rem, 4.2vw, 4.2rem)`. Wordmark: `clamp(8rem, 24vw, 26rem)`.
- Data: **JetBrains Mono** 500/700, uppercase, tracking .14–.2em, at
  .62–.72rem for kickers, tallies, route numbers and hints.
- Body: the existing DM Sans (unchanged).
- Both families are loaded from Google Fonts with `display=swap` and cover the
  Turkish glyphs. The fallbacks are `Impact` and `ui-monospace`, so the layout
  holds offline.

## Layout

- **≥ 1340 px:** a three-column grid (play lane, hero stage, social rail) under
  a full-width scoreboard bar, with a footer index row (replays,
  achievements, and so on) under the play lane.
- **761–1339 px:** a two-column grid. The social rail becomes the existing
  collapsible overlay. The lede and the drop card compress when height is
  short (≤ 780 px).
- **≤ 760 px:** a single column in this order: bar, swipeable numbered nav,
  hero stage (with the headline over it), PLAY, then the secondary routes.
  The social sheet stays docked at the bottom as a 58 px handle. This also
  fixes a regression where the sheet covered the whole phone menu.

## Motion principles

1. **Fast in, calm idle.** Entrances are kinetic and short, like a deflect:
   headline lines clip-reveal, PLAY slashes in, rails slide (0.5–0.9 s,
   expo-out, staggered by 60–90 ms). Ambient loops are slow (≥ 9 s) and
   small: beams sway ±4°, the LIVE tally breathes, and one ball crosses the
   arc every 7 s. It comes in cool, sparks at the knife and leaves hot.
2. **Compositor only.** Every loop animates `transform` or `opacity`.
   - The floodlights are gradients, not blurred filters.
   - The arc ball uses CSS keyframes in % of a fixed 6:7 box, not SMIL. SMIL
     restyled the page and re-ran layout every frame.
   - Nothing uses a backdrop blur over the moving layers.
   - The night grade is a static tint on the plate, not a CSS filter.
   - Pointer vars are written only on the layers that use them, not on
     `#main-menu`, so moving the pointer does not restyle the whole menu.
   - The only paint-heavy effect is the one-shot screen wipe.
3. **The pointer is light.** The spotlight and the parallax follow the
   existing eased `--px`/`--py`. PLAY is magnetic (≤ 6 px), and its sheen
   tracks the cursor. There is no magnetism on coarse pointers.
4. **Reduced motion is a first-class static layout.** With
   `prefers-reduced-motion`, `body.reduced-motion` or `.reduce-motion`, every
   animation and transition is off, parallax is pinned, the arc ball is
   hidden, and the wipe is skipped. The composition is designed to read fully
   when static.
5. **Focus is always visible.** A 2 px cool outline with a 3 px offset on
   every menu control, and never `outline: none` without a replacement.

## Screen shell (secondary screens)

The screens you open from the menu share these elements:

- the night backdrop: a floodlight glow, a knife-edge diagonal rule and a faint
  court grid
- display-type `h1`/`h2` titles
- mono heat kickers
- a heat-hairline top edge on the main panel
- a consistent ghost "Back" button

When you move between menu screens, a thin slash wipes across in 480 ms. It
is skipped when you enter gameplay and under reduced motion.
