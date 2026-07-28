# Revised Priority Sprint (Updated with Scout Findings)

## CRITICAL GAPS DISCOVERED

### Readability Crisis
- **HUD text: 9-12px** (unreadable at typical gaming distance)
- **Fix:** Increase to 14-18px (clamp-based responsive)
- **Impact:** HIGH (competitive players need instant info)
- **Effort:** 30 min (CSS variable update + regression test)

### Kill Feed Missing
- **Current state:** No kill feed element in CSS
- **Fix:** Create `#kill-feed` UI element (right side, stacking, fade-out)
- **Impact:** CRITICAL (competitive UX 101 — players NEED to see kills)
- **Effort:** 45 min (component + animation)

### Animation Polish
- **Current:** Cubic-bezier overshoots (bouncy, unprofessional)
- **Fix:** Smooth easing (ease-in-out, no overshoot)
- **Impact:** MEDIUM (psychological "this is polished")
- **Effort:** 20 min (CSS easing variable tweak)

### HUD Spacing
- **Current:** 8-12px padding (cramped, hard to read)
- **Fix:** Increase to 12-16px (breathing room)
- **Impact:** MEDIUM (readability + visual hierarchy)
- **Effort:** 20 min

---

## REVISED WEEK 1 SPRINT (3-4 hours)

### Tier 0: Readability (30 min) — DO FIRST
1. **HUD text scale:** 9-12px → 14-18px (clamp-based, responsive)
2. **Measure:** Readable at 1920x1080 from 6-10 feet away

### Tier 1: Kill Feed (45 min) — CRITICAL PATH
1. **Create kill-feed component** (right side, vertical stack)
2. **Format:** "[Killer] [kill-symbol] [Victim]" (team-color aware)
3. **Animation:** Slide-in from right, fade-out after 4 sec
4. **Wire to:** `game.js` kill detection, already calls audio
5. **Integration:** Read kill event, push to kill-feed DOM

### Tier 2: Post-Match + XP (90 min) — RETENTION
1. **Post-game screen:** XP earned → tier progress → next reward
2. **Tier animation:** Slide fill from current to current+earned
3. **Next reward card:** Cosmetic preview, ETA to tier
4. **CTA:** "Next Match" button (team-color glow)

### Tier 3: Animation Polish (20 min) — PROFESSIONAL FEEL
1. **Easing curve:** Replace cubic-bezier overshoots
2. **Standard:** `--ui-ease: cubic-bezier(0.4, 0, 0.2, 1)` (Material Design)
3. **Apply:** All transitions in polish.css (~50 rules)

### Tier 4: Combat Feedback (60 min) — JUICE
1. **Hit-flash:** 20ms white/team-color overlay (corners)
2. **Combo counter:** Text "2x Kill Streak!" (fade 3 sec)
3. **Rate-limit:** Throttle visual every 1 sec (prevent multi-kill spam)

### Tier 5: Menu Alive (45 min) — POLISH
1. **Hero:** Breathing (idle), rotate on parallax
2. **Buttons:** Hover expand + glow + sound
3. **Consistency:** Apply tokens to all 37 screens

---

## XP Curve Tuning (Separate, 15 min)

Current formula: 50 + deflections×3 + (win?+100:+30)

**Opus insight:** Tune so 70% matches end 60-90% through tier (near-miss psychology)

Implementation:
```javascript
// Current tier XP cost (linear)
const tierCost = 100 + (tier-1)*20;  // 100 @ tier1, 1080 @ tier50

// Target: typical match XP = 150-250
// If match = 180 XP, tier cost = 200 XP → 90% = near-miss
// Solution: Add small random bonus (+0 to +50 XP) OR deflection boost

// Option A: Deflection boost (skill reward)
const matchXp = 50 + deflections*4 + (win?100:30);  // up deflection multiplier

// Option B: Win bonus boost (close matches)
const matchXp = 50 + deflections*3 + (win?150:30);  // increase win bonus
```

**Recommendation:** Option A (deflection boost) — rewards skilled play, natural psychology.

---

## Implementation Order (Critical Path)

1. **Readability** (30 min) — HUD text scale up
2. **Kill feed** (45 min) — missing competitive feature
3. **Post-match** (90 min) — retention mechanic
4. **Animation** (20 min) — professional feel
5. **Combat feedback** (60 min) — in-match juice
6. **Menu** (45 min) — first impression
7. **XP tune** (15 min) — psychology tuning

**Total:** 305 min (~5 hours) = exactly one focused dev session.

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Kill feed spam | Rate-limit DOM updates (max 1 kill/sec in feed) |
| HUD text readability regression | Test on 1280x720 down to 1080p |
| Post-match XP animation lag | Use CSS transforms, GPU acceleration |
| Animation overshoots remain | Use standard Material Design easing |
| Menu hero animation CPU cost | Profile; throttle rotation update to 30fps if needed |

---

## Parallel Execution (4 developers)

- **Dev A:** Readability (HUD text) + XP tune
- **Dev B:** Kill feed (UI + wiring)
- **Dev C:** Post-match screen (XP bar + card)
- **Dev D:** Animation polish + menu alive

All independent → merge after verification.

