# Execution Checklist: UI + Mechanics Sprint

## Status
- [x] Audio system analyzed (kill-confirm already plays, need visual)
- [ ] Core game flow mapped (post-match, XP feed)
- [ ] XP curve identified
- [ ] UI inventory + gaps documented
- [ ] Competitive HUD best-practices comparison

## Week 1 Tasks (5 hours max)

### Task Group A: Post-Match Screen + XP Progression (90 min)
**Parallel: Developer A**

- [ ] A1: Read `js/ui.js` showScreen('post-game'), current DOM structure
- [ ] A2: Export XP earned from `js/game.js` match end
- [ ] A3: Create post-game-screen component with:
  - [ ] Stats section (kills, deaths, objectives) — existing, clean
  - [ ] XP earned display (animated counter, "+1000 XP")
  - [ ] Tier progress bar (animated fill from current → +earned)
  - [ ] Next reward card (cosmetic preview, tier number, ETA)
  - [ ] "Next Match" button (prominent, team-color glow)
- [ ] A4: Add animation CSS (count-up, bar slide, card flip)
- [ ] A5: Test on all game modes (ranked, duel, goal-rush)

### Task Group B: HUD Modernization (90 min)
**Parallel: Developer B**

- [ ] B1: Audit current HUD layout (top, corners, edges, center)
- [ ] B2: Implement Overwatch-style positioning:
  - [ ] Top-center: round timer (large, readable)
  - [ ] Top-left: team score (glowing, team-color)
  - [ ] Top-right: objective progress (Goal Rush indicator or tier)
  - [ ] Left edge: player health + ability cooldowns
  - [ ] Right edge: opponent score (smaller, opposite team-color)
  - [ ] Bottom-center: combo meter (0-100%) + kill streak text
- [ ] B3: Add glow effects (CSS filter: drop-shadow, bright color)
- [ ] B4: Add animations (on change: slide, pulse, color-shift)
- [ ] B5: Test readability at distance (font sizes, contrast)

### Task Group C: Kill-Confirm System (60 min)
**Parallel: Developer C**

- [ ] C1: Read `js/game.js` kill detection (lethal hit trigger)
- [ ] C2: Add client-side kill feedback:
  - [ ] Hit-flash: 20ms white/team-color overlay (corners fade)
  - [ ] Sound: audio.playSfx('tf2_explosion') already plays (no change needed)
  - [ ] Combo counter: text "2x Kill Streak!" bottom-center, fade 3sec
- [ ] C3: Rate-limiter: only show visual combo every 1 sec (prevent spam multi-kill)
- [ ] C4: Test: multi-kill (ensure no spam), single kill (immediate feedback)

### Task Group D: Menu Alive (60 min)
**Parallel: Developer D**

- [ ] D1: Hero animation: breathing (idle), slow rotate on mouse parallax
- [ ] D2: Menu buttons: hover expand + glow + sound, active state highlight
- [ ] D3: Title glow + subtle pulse
- [ ] D4: Background motion (particle drift or gradient shift)
- [ ] D5: Ensure all 37 screens use consistent tokens (--ui-primary, --ui-space-*)

---

## Phase 2 (if time permits: 90 min)

### Light Theme + Motion Tokens
- [ ] Light theme: define `:root[data-theme="light"]` palette
- [ ] Test all 37 screens for readability
- [ ] Motion tokens: replace 50 ad-hoc transitions with `--ui-motion-*`
- [ ] Profile animation performance (60fps target)

---

## Dependencies & Blockers

| Task | Depends On | Blocker? |
|---|---|---|
| A (post-match) | Game XP export | No (can stub if needed) |
| B (HUD) | Current HUD layout | No (visual only) |
| C (kill-confirm) | Game.js kill detection | No (can hook into existing sound) |
| D (menu) | Existing hero/menu | No (additive) |

**No blockers** — all groups can run in parallel.

---

## Code Review Checklist

Before merge:
- [ ] No regressions (all 515 tests pass)
- [ ] No new dependencies
- [ ] Accessibility: text contrast, readability, animation seizure safety
- [ ] Performance: animations run 60fps, no layout thrashing
- [ ] Responsive: HUD readable on 1920x1080 down to 1280x720
- [ ] Audio: kill-confirm doesn't spam on multi-kill
- [ ] XP math: tested at tier boundaries (tier 0→1, 49→50)

---

## Success Metrics (Post-Deployment)

Measure in analytics:
- **Session length**: avg matches per session (target: +15% vs baseline)
- **D1 return**: players returning next day (target: +10%)
- **Post-match dwell time**: time spent on post-game screen (target: >5 sec)
- **Engagement**: in-round activity (kills/deflects per match, target: baseline stable)
- **Cosmetics**: loot claim rate (target: >80% of players click "next match" without closing)

