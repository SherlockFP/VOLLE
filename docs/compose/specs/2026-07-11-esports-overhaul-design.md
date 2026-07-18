# Esports Overhaul Design Spec — 2BALL Dodgeball

> **Date:** 2026-07-11
> **Scope:** Full game overhaul — UI/UX, Gameplay Loop, Graphics, Hitbox/Combat
> **Approach:** Parallel subagent execution, 4 independent sub-projects

---

## [S1] Problem

The game has solid mechanics (18 maps, 7 characters, 8 skills, P2P multiplayer) but lacks the visual polish, gameplay feedback, and professional feel of esports titles. Current issues:

- Basic HUD without contextual feedback (no kill streaks, no damage numbers)
- Missing UI screens (character select, match summary, settings)
- Simple geometry player models with no animation
- Basic distance-based hitboxes without body zones
- Minimal post-processing (only bloom)
- No kill streak rewards or ultimate abilities
- No visual hit indicators or damage feedback

---

## [S2] Solution Overview

Four parallel sub-projects, each self-contained:

| # | Sub-Project | Files Modified | Priority |
|---|-------------|----------------|----------|
| 1 | UI/UX Overhaul | `css/style.css`, `index.html`, `js/ui.js` | High |
| 2 | Gameplay Loop | `js/game.js`, `js/skills.js`, `js/player.js`, `js/arena.js` | High |
| 3 | Graphics/Visual | `js/renderer.js`, `js/juice.js`, `js/player.js`, `js/arena.js` | Medium |
| 4 | Hitbox/Combat | `js/ball.js`, `js/game.js`, `js/player.js`, `js/bot.js` | Medium |

Each sub-project modifies different primary files. Conflicts resolved by:
- Sub-project 1 (UI) only touches CSS/HTML/ui.js
- Sub-project 2 (Gameplay) touches game.js/skills.js/player.js
- Sub-project 3 (Graphics) touches renderer.js/juice.js/arena.js
- Sub-project 4 (Hitbox) touches ball.js/game.js hit detection

Player.js conflicts between 2, 3, 4 are resolved by each sub-project adding independent features (no overlapping code sections).

---

## [S3] UI/UX Overhaul

### [S3.1] Kill Feed Redesign
- Right-side vertical feed, max 5 entries
- Each entry: `[killer name] [weapon/skill icon] [victim name]`
- Headshot indicator: skull icon
- Animation: slide in from right, fade out after 5s
- Color: killer team color, victim dimmed

### [S3.2] Round Banner
- Center-screen banner at round start
- Text: "ROUND N" + team names
- Animation: scale up from 0, hold 2s, fade out
- Color: winning team color

### [S3.3] Victory/Defeat Screen
- Full-screen overlay with team gradient
- Large text: "VICTORY" (green) or "DEFEAT" (red)
- MVP display: player name + stats
- Stats grid: kills, deaths, damage, accuracy
- "Continue" button → back to lobby

### [S3.4] Character Select Screen
- Grid of character cards (7 characters)
- Each card: character icon, name, stat bars (HP/Speed/Deflect)
- Selected character highlighted with glow
- Skill description below selection
- "Select" button → saves to store

### [S3.5] Match Summary Screen
- Post-match detailed stats table
- Columns: Player, Kills, Deaths, Damage, Accuracy, MVP
- Sortable by any column
- "Play Again" and "Quit" buttons

### [S3.6] HUD Improvements
- **Health bar:** Animated fill, low HP pulse (red glow at <30%)
- **Stamina bar:** Below health, color gradient (green→yellow→red)
- **Skill cooldown:** Circular progress around skill icon
- **Ball speed indicator:** Bottom-right, color shifts with speed
- **Combo counter:** Center, large number + label (DOUBLE/TRIPLE/etc.)

### [S3.7] Settings Menu
- Tabs: Gameplay, Audio, Graphics, Controls
- Gameplay: FOV slider, sensitivity
- Audio: Music volume, SFX volume
- Graphics: Quality (Low/Med/High), bloom toggle
- Controls: Keybind display

---

## [S4] Gameplay Loop Enhancement

### [S4.1] Kill Streak Announcer
- 2 kills: "DOUBLE KILL!" (audio + UI flash)
- 3 kills: "TRIPLE KILL!"
- 4 kills: "QUADRA KILL!"
- 5+ kills: "PENTA KILL!"
- Team ace: "ACE!" (gold flash)
- Each streak: bonus XP (+50 per streak level) and coin (+10)
- Streak resets on death or 8s timeout

### [S4.2] Ultimate Ability
- Each character has unique ultimate (hold Q 2s to activate)
- Charge: 0-100%, gained by dealing/taking damage
- **Rally:** Ball speed +100%, homing to all enemies for 5s
- **Tank:** 50% damage reduction + 100 shield for 5s
- **Scout:** +50% speed + transparency for 5s
- **Sniper:** Next throw pierces walls, 3x damage
- **Guardian:** Heal all allies 30% HP
- **Blazer:** Fire trail for 5s, burns enemies on contact
- **Frost:** Freeze all balls on map for 3s

### [S4.3] Overtime Mechanic
- Triggered when score tied at round timer expiry
- Ball speed +20% every 5s in overtime
- Visual: "OVERTIME" banner, screen edges glow
- Max overtime: 30s, then sudden death (next kill wins)

### [S4.4] Enhanced Power-up System
- Spawn every 15s, max 3 active
- **Shield Orb:** +50 shield (10s)
- **Speed Boost:** +30% speed (8s)
- **Damage Boost:** +50% damage (10s)
- **Mega Ball:** Ball 2x size, +damage (one throw)
- Visual: floating orb with glow, pickup radius indicator

### [S4.5] Spawn System
- Death → 3s respawn timer
- Respawn with 2s invulnerability (breaks on attack)
- Kill cam: 2s killer POV replay after death
- Spawn point selection: furthest from enemies

---

## [S5] Graphics/Visual Polish

### [S5.1] Post-Processing Effects
- **Vignette:** Red vignette at low HP (<30%), intensity scales with damage
- **Chromatic Aberration:** 100ms on hit impact, strength based on damage
- **Motion Blur:** Subtle blur when speed > 15 m/s
- **Color Grading:** Warm tone for fire maps, cool for ice maps

### [S5.2] Particle System Improvements
- **Deflect:** Large burst (20 particles) + spark trail
- **Kill:** Body burst (30 box particles) + ragdoll effect
- **Trail:** Denser, color-matched to ball skin, 40 dots max
- **Spawn:** Light pillar + 50 particle rain from above
- **Portal:** Spiraling inward particles + glow ring

### [S5.3] Player Model Improvements
- Capsule body with distinct head/torso/limbs
- Team-colored uniform (red/blue tint)
- Idle: subtle breathing animation (scale oscillation)
- Run: arm/leg swing animation (sinusoidal)
- Hit: recoil animation (step back + flash)
- Death: fade out + particle burst

### [S5.4] Map Visual Upgrades
- Procedural ground texture (noise-based, no external files)
- Wall grid pattern with team-colored accents
- Ambient particles per map type (dust/spark/rain)
- Dynamic point lights from ball trail

### [S5.5] UI Visual Polish
- Button hover: glow + scale(1.05) + shadow expansion
- Screen transitions: slide + fade (300ms)
- Loading screen: game logo + rotating tips
- Toast notifications: slide from top, auto-dismiss 3s

---

## [S6] Hitbox/Combat System

### [S6.1] Capsule Hitbox
- Player represented as capsule (radius 0.4, height 1.7)
- Ball → capsule intersection test (closest point on segment)
- More accurate than distance-to-center
- Visual: debug mode shows capsule wireframe

### [S6.2] Body Zone Multipliers
- Head (top 20%): 2.0x damage
- Chest (20-50%): 1.5x damage
- Body (50-80%): 1.0x damage
- Legs (bottom 20%): 0.8x damage
- Each hit shows zone label (HEAD/CHEST/BODY/LEGS)

### [S6.3] Damage Falloff
- < 5m: 100% damage
- 5-15m: 80% damage
- 15-30m: 60% damage
- > 30m: 50% damage
- Speed bonus: each 100% speed above base reduces falloff by 10%

### [S6.4] Visual Hit Indicators
- Crosshair hit marker: X flash (100ms) on successful hit
- Damage numbers: floating text at hit point, color by zone
- Hit sound: distinct per zone (headshot: sharp, body: thud)
- Directional damage: red arc on screen edge showing hit direction

### [S6.5] Combat Feel Enhancements
- Hit-stop: 40ms (normal), 80ms (critical/headshot)
- Camera kick: 2-degree recoil on deflect, 5-degree on headshot
- Slow-mo: 0.3s at 0.3x speed on perfect catch
- Screen shake: 0.3 amplitude on hit, 0.6 on kill

---

## [S7] Architecture Notes

### File Modification Map
```
css/style.css      ← Sub-Project 1 (UI)
index.html         ← Sub-Project 1 (UI)
js/ui.js           ← Sub-Project 1 (UI)
js/game.js         ← Sub-Projects 2, 4 (Gameplay + Hitbox)
js/skills.js       ← Sub-Project 2 (Gameplay)
js/player.js       ← Sub-Projects 2, 3 (Gameplay + Graphics)
js/ball.js         ← Sub-Project 4 (Hitbox)
js/renderer.js     ← Sub-Project 3 (Graphics)
js/juice.js        ← Sub-Project 3 (Graphics)
js/arena.js        ← Sub-Projects 2, 3 (Gameplay + Graphics)
js/bot.js          ← Sub-Project 4 (Hitbox)
```

### Conflict Resolution
- `game.js`: Sub-Project 2 adds ultimate/powerup systems, Sub-Project 4 modifies hit detection. Non-overlapping sections.
- `player.js`: Sub-Project 2 adds ultimate charge, Sub-Project 3 adds animation. Independent features.
- `arena.js`: Sub-Project 2 adds powerup spawns, Sub-Project 3 adds visual particles. Independent features.

### No New Dependencies
All features implemented in vanilla JS + existing Three.js stack. No npm packages added.

### Testing
- Each sub-project tested independently
- Integration test: full game loop with all features active
- Performance test: ensure 60fps with all effects

---

## [S8] Implementation Order

1. **Sub-Project 1 (UI/UX):** CSS + HTML + ui.js changes
2. **Sub-Project 4 (Hitbox):** ball.js + game.js hit detection
3. **Sub-Project 2 (Gameplay):** game.js + skills.js + player.js
4. **Sub-Project 3 (Graphics):** renderer.js + juice.js + arena.js

Order rationale: UI first (most visible), Hitbox second (foundational for combat), Gameplay third (builds on combat), Graphics last (polish layer).

---

*Spec generated by MiMoCode Compose Agent. Ready for implementation planning.*
