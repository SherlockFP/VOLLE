# VOLLE menu design brief: "Arena Lobby"

Scope: the main menu, Quick Play sport select, the multiplayer directory, lobby
chrome, and the shared backdrop of the secondary screens opened from the menu.
The in-match HUD, postgame, and the 3D arenas are out of scope.

Implementation: `css/menu-arena.css`, loaded last. There is no menu JS module.
Markup changes in `index.html` are one decorative backdrop (`.menu-backdrop`,
`aria-hidden`) and a simpler PLAY button. Every id and handler is unchanged.

## Direction

The menu should feel like a game lobby, not a landing page. It follows the
original VOLLE menu (bright arena, rounded panels, teal accent, red and blue
teams) and keeps the parts of the 2026 redesign that worked.

- **The arena is the backdrop.** The daylight arena art stays bright. Light
  scrims sit only behind the UI: the left panel, the top bar and the floor.
- **Game fonts only.** DM Sans for body text and Nunito for display text.
  Labels are sentence case. There are no mono kickers, letter-spaced eyebrows
  or taglines.
- **Rounded, physical controls.** Corner radii are 10, 14 and 18 px. Buttons
  have a hard bottom lip and press down when clicked.
- **One go-key.** PLAY is a big amber key: `PLAY`, with "Quick Play · Create or
  join a lobby" under it. Find Match, Host a Game and Start Game use the same
  key, so "go" looks the same on every screen.
- **Layout.** A top bar holds the player card, plain tabs (the active one gets
  a tinted pill and an accent dash) and the wallet. The left "Choose your
  match" card holds PLAY, Social Hub, Tournament and Avatar, the daily
  challenges, battle pass and streak cards, and a small "In the shop" shelf.
  The hero stands in the middle with the player card at its feet. The social
  rail is on the right, and the footer links sit in the bottom row.

## Tokens (`--mm-*`)

| token | value | use |
|---|---|---|
| `--mm-accent` | `var(--ui-menu-accent)` | focus, active tab, social tabs; follows the six UI themes |
| `--mm-go` / `--mm-go-top` / `--mm-go-lip` / `--mm-go-ink` | amber face, darker lip, dark ink | the go-key |
| `--mm-gold` | `var(--ui-menu-gold)` | currency, battle pass, shop shelf |
| `--mm-panel` | `rgb(7 22 32 / .86)` | panels (near-opaque, no backdrop blur) |
| `--mm-raise` / `--mm-line` | white 5.5% / teal-white 14% | cards and hairlines |
| `--mm-display` / `--mm-body` | Nunito / DM Sans | type |

## Layout breakpoints

- **≥ 1340 px:** three columns (play card, hero, social rail) under the top bar,
  with the footer links in the bottom row.
- **761–1339 px:** two columns. The social rail is the collapsible overlay.
  Short heights tighten the cards and turn the shelf into pills.
- **≤ 760 px:** one column: top bar with swipeable tabs, then the hero, then
  PLAY. The social sheet stays docked at the bottom as a 58 px handle.

## Motion

- Feedback only. Hover lifts a control by 1–2 px and a click presses it down.
  The go-key's lip shrinks as it presses.
- Screens open with a short fade (about 0.2 s). Flow panels also scale in from
  0.985.
- There are no ambient loops, magnetic cursors, wipes, floodlights or
  decorative ball arcs. The hero's own 3D idle is the only idle motion. The
  backdrop follows the pointer by up to 8 px through the existing eased
  `--px`/`--py`.
- Reduced motion (`prefers-reduced-motion`, `body.reduced-motion` or
  `.reduce-motion`) turns off every animation and transition and pins the
  parallax.
- Focus is always visible: a 2 px accent outline on every menu and flow control.

## Locker

Implementation: `css/locker.css` (after `menu-arena.css`), `js/locker.js` (pure
filter, sort, count and inspect helpers), with rendering in `js/ui.js` and wiring
in `js/main.js`.

- **Stage.** The main-menu hero canvas moves into `#locker-stage-mount`, so
  there is no second renderer. The stage shows the equipped look: skin,
  knife, gloves and wearables, plus the ball in the free hand. Drag turns the
  model. Inspect plays the viewmodel's keyframed knife inspect and twirl on
  the rig; with no knife equipped, the model does one slow turn. The
  renderer pauses on the Cards tab and on any other screen.
- **Slots.** Hero, Skin, Knife, Gloves, Ball, Wearables, Ability and Rune. Each
  slot shows the equipped item with its tier. A cosmetic slot opens the
  inventory filtered to that slot. Hero, Ability and Rune scroll to their
  pickers.
- **Inventory.** Slot chips show counts like "owned / total". The grid has
  search, sorting (Rarity, Newest or Name; favourites first, owned before
  locked), a "Show locked" toggle, NEW badges for unseen drops and a
  favourite star. Clicking a tile previews the item on the stage. Locked
  tiles are dimmed and link to the right Shop tab, or to cases for knives.
  The Locker never sells anything.
- **Equip.** Equip uses the existing Store paths: `knife-equip` (with
  `data-team="both"`) and `shop-equip`. Each equip plays the `equip-change`
  cue and a one-shot pop on the tile and its slot.
- **Layout.** At 1440 and 1280 px the stage sits beside the panel and only the
  panel scrolls. On phones the stage is on top, the content is below, and the
  whole sheet scrolls in one column.
- **Accessibility.** Arrow keys move between tiles. Focus rings are always
  visible. Reduced motion turns off the pops and transitions, and Inspect
  holds a single presented frame instead of animating.
