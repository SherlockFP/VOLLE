# 2BALL Development Log

## Game Overview
- **Name**: 2BALL (formerly DODGBALL)
- **Type**: 3D First-Person Dodgeball
- **Engine**: Three.js, vanilla JS, zero dependencies
- **Server**: Node.js static file server (port 8000)

## Ball Physics
- **baseSpeed**: 14, **speedMultiplier**: 1.06 per deflect, **maxSpeed**: no cap (infinite ramp)
- **radius**: 0.5
- **Homing system**: Curved homing with progressive pull
  - `aimW = min(dist/10, 1) * momentum` (momentum: 0.40 aimed, 0.30 bot)
  - Close range (<3): `(dist/3) * momentum * 0.15` (strong pull)
  - Close range (<2): gravity skipped (prevents orbiting)
  - `deflPull = max(0.15, 1 - deflections * 0.065)` (progressive, more deflections = stronger pull)
  - `steer`: 5.7 normal, 14.0 close range
- **Momentum physics**: Player velocity (dash/sprint/jump) adds to ball velocity on deflect
  - `momScale = min(1, momLen/12)`, multipliers 0.9 horizontal, 0.6 vertical
- **Spin**: Only on real flicks (power > 0.3), capped at 1.5
- **Floor bounce**: `Math.max(3.0, ...)` minimum upward velocity
- **Ceiling**: Uses `bounds.maxY` fallback for open-air maps
- **Stuck detection**: Random up/down (not always up)
- **Glow**: radius * 1.15, depthTest true, scale capped at 1.5
- **Trail**: dot radius capped at 0.15, sr capped at 4

## Player Movement
- **Sprint**: Hold Shift, 1.5x speed, drains 50 stamina/s, regen blocked while sprinting+moving
- **Dash**: Ctrl tap, 20 m/s burst, 25 stamina, 1s cooldown
- **Double jump**: 2 jumps, reset on ground
- **Wall jump**: 15 stamina, 0.6s cooldown, push away from wall
- **Stamina**: 7 per deflect, 20/s regen, 0.4s attack cooldown

## Game Modes
- Classic, Speedball, Low Gravity, Instagib, Tank, Multi Ball, Tiny, Giant, Freeze Tag, Hot Potato
- **FFA**: Free For All, no teams, no net, last man standing

## Maps (18 total)
- beach, beach_open, industrial, space, neon, dojo, colosseum, volcano, ice, cloud, jungle, cyber, canyon, pillar, lava, crystal, mecha, minecraft
- All maps enlarged ~44% (two rounds of +20%)
- Walls and ceiling: visual removed, collision kept via bounds
- buildSun: disabled (caused white circle artifact)

## Combat
- **Attack range**: 2.5 (fixed, no speed scaling)
- **Skill check**: Must look at ball (~100° cone, dot > -0.2)
- **Damage**: Base 25, miss ramp, combo multiplier, character passives
- **Score**: Only increases on kill (recordPoint), never decreases (recordHit bug fixed)
- **Death**: takeDamage returns lethal, handleHit processes KO

## DMC Combo System
- First Blood → Double Kill → Triple Kill → Quadra Kill → Penta Kill → ACE
- Preloaded sounds: music/1kill.m4a through music/ace.m4a
- Display: 4 seconds, colored text, combo-pop animation
- killStreak resets each round

## End-Game Celebration (30s)
- Winners get weapons: 1=Fists, 2=Pistol, 3=Rocket
- Losers flee, winners chase and attack
- Blood spray effects, "boo" sounds
- Hit-stop does NOT freeze celebration (fixed)
- After 30s: XP screen with Play Again / Lobby / Main Menu

## Spectate System
- Dead players auto-spectate alive teammates
- Left click = next, right click = prev (context menu disabled)
- Bracket keys also work
- Camera follows teammate from behind

## UI Features
- **HUD**: Score panel top, ball speed top-right (frameless), vitals bottom-left
- **Damage meter**: Only visible when scoreboard (Tab) open
- **Damage numbers**: Floating red text on hit, max 8 concurrent, 800ms
- **Combo display**: Center screen, DMC-style
- **Settings**: 3 tabs (Controls, Video, Game), horizontal
- **Console**: `~` key, autocomplete dropdown, commands include:
  - sv_bot_kick, sv_bot_kickall, sv_playergravity, sv_damagemul
  - mp_restartgame, endgame_1, endgame_2, sv_ffa
  - cl_showfps, cl_showdamage, r_fullbright
  - sv_timescale, sv_ballspeed, sv_gravity, sv_bot_add

## Audio
- **Lobby music**: 4 tracks (music/1-4.mp3), rotate, volume 0.02
- **Volume slider**: Controls SFX + music (music at 3% of SFX)
- **Combo sounds**: Preloaded m4a files, zero latency
- **Thunder**: Reduced to 0.06 gain

## Characters (7)
- Rally (balanced), Bulwark (tank), Scout (fast), Sniper (spike), Guardian (shield), Blazer (burn), Frost (slow)

## Skills (8) + Runes (8)
- Skills: slow, freeze, burn, shield, smash, heal, teleport, blackhole
- All cooldowns 3x increased
- Runes: hp_bonus, dmg_resist, deflect_power, speed_bonus, stam_regen, cooldown_red, lifesteal, thorns

## Shop
- Ball skins: Equip from shop (🎯 Equip button), 7 skins
- Skills: Select from owned, purchase with coins
- Characters: Purchase and select

## Emotes
- G or Z key: emote wheel (toggle open/close)
- ESC closes wheel
- Chat :D etc. triggers emote above character (no 3rd person)
- 12 emotes available

## Key Bindings
- WASD: movement, Space: jump/double/wall jump
- Shift: sprint, Ctrl: dash
- Mouse: aim, LMB: attack/deflect
- Q: skill, B: ball skin cycle
- Y/T/Enter: chat, V: voice PTT
- G/Z: emote wheel, Tab: scoreboard
- M: team popup, ESC: pause menu
- `~: console

## Power-ups
- Speed (⚡), Shield (🛡️), Damage (💥)
- Spawn on map every 12s, max 3 at a time
- 6 second duration buffs

## A-D-A-D Spin Dodge
- Rapid A-D-A-D presses orbit ball around player
- 2.5s duration, speeds up over time (6→24 rad/s)
- Auto-release on timer or left click to throw
- Speed bonus based on orbit duration

## Known Issues Fixed
- hitPos used before declaration (crashed handleHit)
- Sprint crash (moveDir referenced before init)
- Score going negative (recordHit decremented score)
- Ball orbiting forever (gravity skipped at close range)
- White circle artifact (spawnGlow + ball glow depthTest)
- Celebration freeze (hit-stop blocking update)
- Trail/glow infinite growth (capped)
- Damage flash too bright (reduced to 10% opacity)
- Stamina not regenerating (sprint check fixed)
- Volume slider 0 = music full (falsy || bug, fixed with ??)
