# Warrball UI/UX + HUD Implementation Bible

> **Core axiom:** Every UI element must answer **What is happening / What can I do / What should I do next / What changed**; otherwise remove it.

Warrball is a kinetic, readable arena sport. The menu may be expressive and atmospheric; the competitive HUD is intentionally utilitarian. No visual flourish may obscure a throw, timing window, score, teammate, opponent, or input result.

## Product hierarchy

1. Core fun and a reliable next match
2. One-more-match motivation and retention
3. Competitive depth, skill expression and network trust
4. Gameplay feedback, visual/audio satisfaction and social value
5. Ethical cosmetic desire, content depth, then new features

The main menu has one dominant action: **Quick Play**. Shop, Battle Pass and Cases can be discoverable but never visually outrank the match CTA. No purchase may provide competitive power.

## System foundations

### Tokens and spacing

- Use `css/ui-tokens.css`; do not introduce per-screen palette constants when a semantic token exists.
- Spacing scale: `--ui-space-1` through `--ui-space-8` = 4, 8, 12, 16, 24, 32, 48, 64px.
- Use `--ui-surface-rest/hover/selected/disabled` and interaction focus/pressed roles for component states.
- Reuse `--ui-menu-max-width`, `--ui-menu-sidebar-min`, `--ui-menu-card-gap`, dialog widths, HUD edge/max-width and ultrawide-safe tokens.
- Canonical layer aliases: `--ui-z-hud`, passive overlay, active overlay, modal, toast, critical. Existing `--z-*` values remain the compatibility source of truth.

### Type, shape and state

- Display: `Russo One`; interface: `Chakra Petch`; score/timer use tabular numerals.
- HUD label floor is 12px; normal UI body floor is 16px outside dense controls.
- HUD corners are compact (4px); cards/dialogs use 8px; focused/selected borders are 2px.
- Buttons: rest, hover, pressed, focus-visible, selected, disabled and loading states must be explicit. Focus is never hover-only. Touch targets are at least 44px.
- Team red/blue communicate teams only. Rating colors, sale treatment and generic primary CTAs use their own semantic roles.

## Navigation and information architecture

The top navigation exposes exactly eight player-facing destinations:

| Nav | Route | Purpose |
|---|---|---|
| Play | Multiplayer hub | Create, join, Quick Play and solo route selection |
| Ranked | Career / Ranked | ELO, competitive queue and mastery |
| Arcade | Practice | Guided deflect and Free Lab |
| Custom | Map Editor | Local arena creation and workshop path |
| Locker | Character / loadout | Character presentation, skills, runes and cosmetics |
| Battle Pass | Battle Pass | Seasonal rewards and progress |
| Shop | Arena Shop | Inspect, practice, purchase and equip cosmetics |
| Profile | Player Profile | Identity, history and personal stats |

Challenges, achievements, leaderboard and replays are disclosed under Profile/Career rather than competing in primary navigation. Social Hub remains Play/Social. Heroes, Studio and Inventory belong to Locker. The player card, party rail and currency controls are utility views, not a ninth navigation system.

## Main menu contract

- The live menu avatar uses the shared `ShopShowcaseRenderer`; Shop, Studio and menu must never maintain divergent rig/render paths.
- The showcase backs the current character and equipped skin with the supplied arena image plate. The CSS runner remains the no-WebGL fallback.
- Bottom player card: nickname, ELO, CSS/SVG rank badge and rank name. Rank is never represented by an emoji-only primary symbol.
- Party rail is a read-only mirror of existing local party state: member, leader, ready/waiting and capacity. **Invite** and **Squad Center** open the existing Squad Center; the menu does not add a party protocol.
- On 375x667, 1280x720, 1920x1080 and 2560x1080: no horizontal overflow; routes remain keyboard reachable; ultrawide empty space becomes safe margin, not stretched controls.
- `prefers-reduced-motion` removes decorative movement; information hierarchy and keyboard focus remain unchanged.

## Competitive HUD contract

### Stable zones

| Zone | Content | Rule |
|---|---|---|
| Top center | round score, timer, phase | highest global match priority; always legible |
| Center | crosshair, ball-threat direction | keep aiming space clear; no feeds or toasts over it |
| Lower left/right | health, shield, stamina, ability | stable placement; abilities hide when rules disable them |
| Upper side | kill feed / compact events | never crosses the ball danger area |
| Bottom center | prompt, contextual interaction | only when a player can act |
| Spectator rail | camera mode and target | visibly distinct from player HUD |

### Threat and timing mapping

- Incoming-ball arrow size maps to proximity; pulse cadence maps to ETA; spatial audio direction maps to the ball direction; all three are redundant cues.
- The perfect-deflect window is yellow plus the existing timing label/pattern. Yellow must not simultaneously mean team ownership.
- Threat, low-health and score changes have an information budget: at most one persistent state and one transient accent may demand attention in a zone.
- Decorative particles, ambient glows and nonessential avatar effects yield before readable combat feedback. No permanent blur over the render canvas.

### HUD states

- Normal: score, timer, vitals and only active abilities.
- Critical: low health vignette stays clear through the aiming area; it does not change layout.
- Pause/chat/modal: exclusive input state has a visible label and owns focus.
- Spectator: target/camera name is persistent; player-only action prompts are removed.
- Loading/error: show current stage, recoverable action and plain-language failure. Never leave an inert spinner without status.

## Components

### Buttons and cards

- Primary match action: highest contrast, largest hit target and one per screen.
- Secondary action: visible border, lower contrast, no competing glow.
- Destructive: explicit label and destructive semantic color. Disabled items state why when useful.
- Cards use title + supporting value + one next action. Selection uses border, icon/label and `aria-pressed`/tab state, never color alone.
- Dialogs use the shared width tokens, title, close control, Escape behavior, focus trap and a stable return focus target.

### Monetization and reward surfaces

- Shop cards are browse/select surfaces; the selected detail owns **Inspect**, **Try in Practice**, purchase and equip decisions. Do not make players infer which card is selected.
- Purchasable Cases are cosmetics-only. The earn-only **Arena Cache** grants gameplay cards; paid Cases never do.
- Characters remain separate presentation choices. Gameplay cards reference existing skill/rune mechanics only; no card may reference `characterId`.
- Gameplay cards are earn-only or sidegrades, and ranked card loadouts remain disabled until server-signed entitlement and authoritative validation exist. P2P host authority alone is not sufficient for trusted ranked progression.
- Battle Pass and reward reveals are skippable, understandable, and never use scarcity/deception to hide value.

## Future map and gameplay quality pipeline

This is a quality bar, not authorization to change maps in the current UI pass. Every future map must define: readable sightlines, deflect cover, spawn fairness, traversal budget, spectator readability, collision validation, asset provenance and performance budget. Evaluate with a real match, bot soak, screenshot review and frame-time inspection before accepting it. Gameplay changes require first-shot reliability, local/remote/P2P regression evidence and competitive readability review.

## Audio, motion and noise budget

- Button feedback: 120–200ms transform/opacity/color only; screen transitions: 180–300ms; gameplay feedback under 500ms unless it represents a real timer.
- SFX explains an action, success, danger or error. Avoid sound for decorative hover noise.
- Reduced motion disables shake, glitch, marquee and decorative camera motion; it never hides a timing cue.
- One high-priority audio cue can claim attention at a time; threat audio beats reward/ambient UI cues.

## Accessibility and resilience

- WCAG AA contrast, visible focus, keyboard order matching visual order, and labels for icon-only controls.
- Images are either meaningful with descriptive alt text or decorative with `aria-hidden`; canvases have their own accessible label/fallback.
- Responsive check matrix: 375x667, 768x1024, 1280x720, 1920x1080, 2560x1080.
- Verify dark, theme-switched and high-contrast surfaces. Avoid horizontal page scrolling; intentionally scroll dense tables/cards inside a labeled container.

## Ownership and acceptance gates

| Area | Primary owner | Gate |
|---|---|---|
| Tokens, menu shell, HUD language | UI systems | token use, focus, responsive source tests |
| Shared 3D avatar | Showcase renderer | same equipped skin/character in menu, shop, studio and practice |
| Shop/Case/Locker | Commerce UI | inspect → practice → purchase/equip is unambiguous and cosmetic-only |
| Gameplay HUD | Game/UI | threat cues readable in a live match, no center obstruction |
| Party/social | Social systems | menu only mirrors existing party; no protocol fork |
| Ranked/progression | Ranked/server | cards locked out until authoritative validation exists |
| Visual QA | LUNA | screenshots at the responsive matrix and reduced-motion review |
| Runtime QA | QA | handlers, navigation, P2P-safe regression and `npm test` |

Before release, run source checks, targeted component tests, the full suite, real browser interaction and a screenshot review. A changed line is not evidence; accepted work demonstrates the player-visible route and preserves the core match.
