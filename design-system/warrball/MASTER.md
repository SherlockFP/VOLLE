# Warrball V3 Design System

> Style: Kinetic Arena Sport
> Scope: menu shell, lobby, shop, match HUD and spectator surfaces

## Principles

- Gameplay readability outranks decoration.
- Team ownership is never communicated by color alone.
- One component language is used across every screen.
- Motion explains state and respects reduced-motion settings.
- UI remains usable at 375px fallback width and common desktop resolutions.

## Color tokens

| Role | Value |
|---|---|
| Background | `#0B1120` |
| Surface | `#111B30` |
| Elevated | `#192134` |
| Foreground | `#F8FAFC` |
| Muted foreground | `#A7B4C8` |
| Border | `rgba(255,255,255,0.12)` |
| Brand cyan | `#36D8CA` |
| Action yellow | `#DFE104` |
| Team red | `#DC2626` |
| Team blue | `#2563EB` |
| Success | `#22C55E` |
| Destructive | `#EF4444` |
| Focus ring | `#F8FAFC` |

Rules:

- Red and blue are reserved for team semantics during matches.
- Yellow is used for primary action and perfect timing.
- Cyan is used for technical information and neutral progress.
- Body text must meet WCAG AA contrast.
- Alerts include an icon, label or pattern in addition to color.

## Typography

- Display/headings: `Russo One`.
- Interface/body: `Chakra Petch`.
- Minimum body size: 16px outside dense HUD labels.
- HUD labels: 12px minimum with strong contrast.
- Score and timer use tabular numerals.
- Uppercase is limited to short labels and headings.

## Shape and depth

- Radius: 4px for HUD, 8px for cards and dialogs.
- Border: 1px normal, 2px focused/selected.
- Avoid soft claymorphism.
- Avoid white modals over the dark game shell.
- Avoid permanent blur layers over the render canvas.
- Use chamfered or angular accents sparingly.

## Motion

- Button state: 120-200ms.
- Screen transition: 180-300ms.
- Reward reveal: skippable.
- Gameplay feedback: under 500ms unless it represents a real timer.
- Animate transform and opacity; avoid layout-shifting width/height animation.
- `prefers-reduced-motion` changes must be observed at runtime.
- Reduced motion disables shake, glitch, marquee and decorative camera motion.

## Navigation

Primary:

- Play.
- Ranked.
- Arcade.
- Custom.
- Locker.
- Battle Pass.
- Shop.
- Profile.

Use progressive disclosure. The home screen emphasizes Quick Play and the current
recommended activity. Secondary systems do not compete with the main CTA.

## HUD

- Score and round timer remain top-center.
- Team states include color plus name/icon.
- Crosshair remains visually isolated.
- Ball threat uses direction, distance and sound.
- Ability panels are hidden when competitive rules disable abilities.
- HP, shield and stamina use stable positions.
- Kill feed never overlaps the ball danger area.
- Spectator mode clearly labels camera mode and target.

## Components

Buttons:

- Primary: action yellow, dark text, 2px dark border.
- Secondary: dark surface, light text, visible border.
- Destructive: red, white text.
- Disabled: no glow, reduced contrast, `aria-disabled`.

Cards:

- Dark elevated surface.
- 1px border.
- No layout movement on hover.
- Selection uses border, icon and label.

Dialogs:

- Dark elevated surface.
- Visible title and close button.
- Focus trap and Escape behavior.
- No placeholder-only labels.

Icons:

- Use one SVG icon set.
- Do not use emoji as the primary navigation icon.
- Every icon-only control has an accessible label.

## Responsive checks

- 375x667 fallback.
- 768x1024.
- 1280x720.
- 1366x768.
- 1920x1080.
- 2560x1080.

## Forbidden patterns

- Purple-on-white generic game dashboards.
- Glow on every card.
- Thin low-contrast HUD lines.
- Multiple unrelated font families.
- Team color used for unrelated actions.
- Hover-only information.
- Unskippable reward animation.
- Hidden keyboard focus.
- Gameplay text smaller than readable minimums.

