# FINAL SPRINT PLAN (Week 1 Game Dev: 5 hours)

## Discovery Summary

### What's Working ✓
- Post-game screen DOM exists (#post-game-screen, pg-xp-fill, pg-bp-progress)
- XP flow wired: game.js → Store.grant() → battlepass.addXp() → ui.showPostGame()
- Audio system ready: kill sounds already playing (tf2_explosion + death voice)
- Token system modern: Overwatch-style palette, 6 themes, elevation scale
- 37 screens exist (menu, match, progress, social, practice, etc)

### Critical Gaps ✗
1. **HUD Text Unreadable** (9-12px, needs 14-18px)
2. **Kill Feed Missing** (not in DOM, not in CSS)
3. **Animation Bouncy** (cubic-bezier overshoots, needs smooth easing)
4. **Post-Match Card** (tier progress bar exists, but next-reward card missing or plain)
5. **Combat Feedback** (kill audio plays but no combo counter visual)
6. **Menu Polish** (hero static, buttons lack glow/feedback)

---

## SPRINT EXECUTION (5-Hour Commitment)

### PHASE 1: Readability Crisis (30 min)
**Priority: 🔴 CRITICAL** — HUD text invisible at gaming distance

#### Task 1.1: HUD Font Scale
- **File:** `css/ui-tokens.css` (add token) + `css/polish.css` (apply)
- **Change:** `--ui-hud-text: clamp(14px, 1.2vw, 18px)` (was 0.55-0.76rem ≈ 9-12px)
- **Apply to:** `.hud-speed-text`, `.hud-health`, `.incoming-indicator`, `.combo-counter` (all HUD text)
- **Test:** Readable at 1920×1080 from 6-10 feet
- **Regression:** Ensure 1280×720 still readable (minimum 12px)

**Files to edit:**
- `css/ui-tokens.css:220-230` (add token)
- `css/polish.css:~1200-1300` (HUD text selectors, update font-size)

---

### PHASE 2: Kill Feed (45 min)
**Priority: 🔴 CRITICAL** — Missing competitive UX 101 feature

#### Task 2.1: Kill Feed DOM
- **File:** `index.html`
- **Add after `#hud`:**
  ```html
  <div id="kill-feed">
    <div class="kill-entry" data-killer="PlayerName" data-victim="EnemyName" data-icon="⚔">
      <span class="killer">PlayerName</span>
      <span class="icon">⚔</span>
      <span class="victim">EnemyName</span>
    </div>
  </div>
  ```
- **Location:** Right side of screen, vertical stack, 4-entry max
- **Style:** Tight spacing (4px), 12px text, team-color aware

#### Task 2.2: Kill Feed CSS
- **File:** `css/polish.css` (add new section)
- **Properties:**
  - Position: fixed, right 20px, top 150px
  - Background: transparent (text + icon only, no box)
  - Animation: slide-in from right (200ms), fade-out after 4 sec (1s ease-out)
  - Color: killer=team-color (red/blue), victim=gray
  - Font: monospace, 12px, letter-spacing 0.5px

#### Task 2.3: Kill Feed JS Wiring
- **File:** `js/game.js` (find kill detection around line 2647-2710)
- **Hook:** After `audio.playSfx('tf2_explosion')`, call `addKillFeed(killer, victim, icon)`
- **Function:**
  ```javascript
  window.addKillFeed = (killer, victim, icon = '⚔') => {
    const feed = document.getElementById('kill-feed');
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = `<span class="killer">${killer}</span>
                       <span class="icon">${icon}</span>
                       <span class="victim">${victim}</span>`;
    feed.insertBefore(entry, feed.firstChild);
    if (feed.children.length > 4) feed.removeChild(feed.lastChild);
    
    setTimeout(() => entry.remove(), 4000);
  };
  ```
- **Rate limit:** Throttle DOM updates max 1/sec (prevent spam on multi-kill)

**Files to edit:**
- `index.html` (add kill-feed div)
- `css/polish.css` (add kill-feed styles)
- `js/game.js` (add addKillFeed call after kill audio)

---

### PHASE 3: Post-Match Tier Card (90 min)
**Priority: 🟡 HIGH** — Retention mechanic, "one more game" hook

#### Task 3.1: Enhance Post-Game Screen
- **File:** `index.html` (#post-game-screen)
- **Current:** XP bar + stats table
- **Add:** Next-reward card (cosmetic preview, tier number, ETA)

**HTML to add after pg-bp-progress:**
```html
<div class="pg-next-reward">
  <div class="reward-card">
    <div class="reward-tier">TIER 5</div>
    <div class="reward-preview">
      <img id="pg-reward-image" src="" alt="Cosmetic">
    </div>
    <div class="reward-name" id="pg-reward-name">Legendary Trail</div>
    <div class="reward-eta" id="pg-reward-eta">3 matches to unlock</div>
  </div>
</div>
```

#### Task 3.2: Post-Match CSS
- **File:** `css/polish.css`
- **Styles:**
  - Card: centered, 200×250px, shadow + glow on legendary
  - Preview: image fill, rounded corners (8px)
  - Tier label: bold, team-color for current tier
  - ETA text: muted color, small font
  - Animation: reveal on screen appear (scale 0→1, 300ms cubic-bezier ease-out)

**Rarity-based styling:**
- Legendary: gold glow, particle effect (CSS animation)
- Epic: purple shadow
- Rare: blue border
- Uncommon: green text

#### Task 3.3: Post-Match JS Logic
- **File:** `js/ui.js` (find showPostGame function around line 500-560)
- **Enhancement:**
  ```javascript
  // After XP bar animation, populate next-reward card
  const nextTier = currentTier + 1;
  if (nextTier <= 50) {
    const nextCost = battlepass.xpForTier(nextTier);
    const currentXp = battlepass.getTierProgress(currentTier).xp;
    const xpNeeded = nextCost - currentXp;
    const matchesEstimate = Math.ceil(xpNeeded / 150); // avg match = 150 XP
    
    document.getElementById('pg-reward-tier').textContent = `TIER ${nextTier}`;
    document.getElementById('pg-reward-image').src = getCosmeticPreview(nextTier);
    document.getElementById('pg-reward-name').textContent = getCosmeticName(nextTier);
    document.getElementById('pg-reward-eta').textContent = `${matchesEstimate} matches to unlock`;
  }
  ```

**Files to edit:**
- `index.html` (add reward-card HTML)
- `css/polish.css` (add reward-card styles)
- `js/ui.js` (populate next-reward in showPostGame)

---

### PHASE 4: Animation Polish (20 min)
**Priority: 🟡 MEDIUM** — Professional feel

#### Task 4.1: Replace Easing Curve
- **File:** `css/ui-tokens.css`
- **Current:** `cubic-bezier(0.22, 1, 0.36, 1)` (overshoots, bouncy)
- **New:** `--ui-ease-smooth: cubic-bezier(0.4, 0, 0.2, 1)` (Material Design, no overshoot)
- **Apply:** Replace ~50 instances in `css/polish.css`

**Command:**
```bash
sed -i 's/cubic-bezier(0\.22, 1, 0\.36, 1)/var(--ui-ease-smooth)/g' css/polish.css
```

**Files to edit:**
- `css/ui-tokens.css` (define new easing)
- `css/polish.css` (apply to transitions)

---

### PHASE 5: Combat Feedback (60 min)
**Priority: 🟡 MEDIUM** — In-match juice

#### Task 5.1: Hit-Flash (20ms)
- **File:** `css/polish.css` (add animation) + `js/game.js` (trigger)
- **Animation:**
  ```css
  @keyframes hit-flash {
    0% { background: rgba(255, 255, 255, 0.4); }
    100% { background: transparent; }
  }
  ```
- **Trigger:** On lethal hit, add class to `<body>` for 20ms
  ```javascript
  document.body.classList.add('hit-flash');
  setTimeout(() => document.body.classList.remove('hit-flash'), 20);
  ```

#### Task 5.2: Combo Counter
- **File:** `index.html` (add counter div) + `css/polish.css` + `js/game.js`
- **DOM:**
  ```html
  <div id="combo-counter" class="hidden">
    <span class="combo-text">2x KILL STREAK</span>
    <span class="combo-medal">🔥</span>
  </div>
  ```
- **Logic:**
  ```javascript
  let comboCounter = 0;
  let comboTimer = null;
  
  window.onKill = () => {
    comboCounter++;
    document.getElementById('combo-counter').textContent = `${comboCounter}x KILL STREAK`;
    document.getElementById('combo-counter').classList.remove('hidden');
    
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => {
      document.getElementById('combo-counter').classList.add('hidden');
      comboCounter = 0;
    }, 3000);
  };
  ```
- **Rate limit:** Only update DOM if combo changed (prevent 1-frame spam)

**Files to edit:**
- `index.html` (add combo-counter div)
- `css/polish.css` (combo styles + animation)
- `js/game.js` (call onKill after kill audio)

---

### PHASE 6: Menu Alive (45 min)
**Priority: 🟢 LOW** — First impression polish

#### Task 6.1: Hero Breathing Animation
- **File:** `js/main.js` (hero render loop) + `css/polish.css`
- **CSS animation:**
  ```css
  @keyframes breathing {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.02); }
  }
  .hero-character { animation: breathing 4s ease-in-out infinite; }
  ```

#### Task 6.2: Menu Button Glow
- **File:** `css/polish.css`
- **Hover state:**
  ```css
  .menu-button:hover {
    background: var(--ui-primary);
    filter: drop-shadow(0 0 12px var(--ui-primary));
    transform: translateY(-2px);
    transition: all 150ms ease-out;
  }
  ```

**Files to edit:**
- `js/main.js` (hero animation loop)
- `css/polish.css` (button + hero styles)

---

## PARALLELIZATION (4 Developers)

| Dev | Tasks | Duration | Dependencies |
|---|---|---|---|
| A | 1.1 (readability) + 4.1 (easing) | 50 min | None |
| B | 2.1, 2.2, 2.3 (kill feed) | 45 min | None |
| C | 3.1, 3.2, 3.3 (post-match card) | 90 min | Battlepass API (verify exports) |
| D | 5.1, 5.2 (hit-flash + combo) + 6.1, 6.2 (menu) | 105 min | Game.js kill detection API |

**Sequential dependencies:**
1. Dev A completes easing (needed for all animations)
2. Devs B, C, D start immediately (no cross-blocking)
3. All merge after 2-3 hours, test together

---

## Testing Checklist

- [ ] HUD text readable at 1920×1080 (6-10 feet away)
- [ ] Kill feed stacks up to 4, fades after 4 sec
- [ ] Post-match card shows correct tier + cosmetic preview
- [ ] XP bar animates on screen appear
- [ ] Hit-flash triggers on lethal hit (20ms white overlay)
- [ ] Combo counter increments, resets after 3 sec (max combo visible)
- [ ] Menu hero breathes smoothly, buttons glow on hover
- [ ] All 515 tests still pass
- [ ] No regressions on 1280×720 (minimum res)

---

## Post-Sprint Analytics

**Measure success (24h after deploy):**
1. Session length (avg matches/session) → target +15%
2. D1 return rate → target +10%
3. Post-match dwell time (time on screen) → target >5 sec
4. Combo counter interaction (how many players trigger it) → baseline
5. Kill feed usage (visual heatmap) → should be high on right side

---

## XP Curve Tuning (Optional, 15 min)

If time permits after core features:
- Increase deflection multiplier: `50 + deflections*4 + (win?100:30)` (was ×3)
- Effect: Typical match = 180-220 XP → 80-90% through tier (near-miss psychology)
- Measurement: Track % of matches ending in "near-miss" zone

---

## File Summary

**Total edits:**
- `index.html`: +2 sections (kill-feed, combo-counter, reward-card)
- `css/ui-tokens.css`: +3 tokens (hud-text, ease-smooth, motion-normal)
- `css/polish.css`: +200 lines (kill-feed, reward-card, animations, button glow)
- `js/ui.js`: +30 lines (reward-card logic)
- `js/game.js`: +10 lines (kill-feed wiring, hit-flash trigger)
- `js/main.js`: +5 lines (hero animation)

**Total lines added:** ~250 (minimal, surgical)
**Risk:** LOW (mostly CSS + DOM, no core logic change)
**Regression window:** +0.5 hours (full test suite + visual QA)

