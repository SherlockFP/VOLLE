# UI Modernization Plan (v3.2+)
> Strategic overhaul targeting Overwatch/Valorant/modern competitive standards
> Goal: Professional-tier appearance → retention boost

## Phase 1: HUD + Post-Match Alive (90 min)

### 1.1 Battle HUD Modernization
**File:** `css/polish.css`, `js/hud.js` (or similar)

Current state: Minimal, functional
Target: Overwatch-style (edges populated, center clean)

Changes:
- **Top-center**: Round timer (large, readable), round-count (won/lost streak)
- **Top-left**: Team score (big, glowing, team-color)
- **Top-right**: Objective progress (Goal Rush: goal indicator; Ranked: tier/points)
- **Left edge**: Player health (bar + number), ability cooldowns
- **Right edge**: Opponent score (smaller, team-color opposite)
- **Bottom-center**: Combo meter (0-100%), kill streak counter
- **Animation**: Glow on changes, slide-in on kill, pulse on low health

Estimated effort: 45 min (CSS + minimal JS for state bindings)

### 1.2 Post-Match Screen (Progression Visible)
**File:** `index.html` (#post-game-screen), `js/ui.js`, `js/battlepass.js`

Current: Stats only (kills, deaths, objectives)
Target: Stats + Progression (XP earned → tier bar → next reward)

Changes:
- **Top half**: Match stats (current, keep clean)
- **Bottom half**: Battle pass progress
  - XP earned: "1000 XP" (big, glowing green)
  - Tier bar: animated fill from current to current+earned
  - Next reward card: tier 5, cosmetic preview image, timer until available
- **Animation**: XP numbers count-up, tier bar slides, card flips on legendary
- **Call-to-action**: "Next Match" button (prominent, team-color glow)

Estimated effort: 45 min (component + animation)

### 1.3 Kill Feedback Loop
**Files:** `js/game.js` (kill detection), `js/hud.js`, `js/audio.js`

Current: Kill detected server-side, no immediate player feedback
Target: Client-side hit-flash + sound + combo counter

Changes:
- **Hit-flash**: 20ms white/team-color overlay on kill (screen corners)
- **Sound**: Play existing kill-confirm audio (or synthesize 40ms beep)
- **Combo counter**: Show "2x Kill Streak!" text (bottom-center, fade after 3sec)
- **Rate limit**: Only visual every 1 sec (prevent spam on multi-kill)

Estimated effort: 20 min (mostly DOM + audio integration)

---

## Phase 2: Menu Alive (60 min)

### 2.1 Main Menu Polish
**Files:** `index.html` (#main-menu), `css/polish.css`, `js/main.js`

Current: 3D hero, menu buttons (text)
Target: Hero animation + button feedback + visual hierarchy

Changes:
- **Hero**: Breathing animation (idle loop), rotate slowly on mouse move (parallax)
- **Title**: Glow, subtle pulse
- **Buttons**: 
  - Hover: expand slightly, glow, sound effect
  - Active: press animation, feedback
  - State: selected button highlighted (team-color outline)
- **Background**: Subtle motion (particle drift or gradient shift)

Estimated effort: 30 min

### 2.2 Menu Flow Consistency
**Files:** `css/polish.css`, `index.html` (all screens)

Current: Varied button styles, spacing inconsistent
Target: Design system applied (token-based spacing, typography)

Changes:
- Buttons: all use `--ui-primary`, hover uses `--ui-primary-hover`
- Modals: consistent shadow, padding, close button placement
- Typography: heading sizes, line-height, letter-spacing consistent
- Spacing: use `--ui-space-*` tokens (4px, 8px, 12px, 16px)

Estimated effort: 30 min (regex replace + manual polish)

---

## Phase 3: Light Theme + Motion (90 min)

### 3.1 Light Theme
**Files:** `css/ui-tokens.css`, `css/style.css`

Current: Dark theme only
Target: Light theme (high-contrast, readable)

Changes:
- Add `:root[data-theme="light"]` with inverted palette
  - `--ui-bg: #f5f5f5`
  - `--ui-text: #1a1a1a`
  - `--ui-primary: #0066cc`
- Test on all 37 screens (regression testing)

Estimated effort: 60 min (token definition + testing)

### 3.2 Motion Tokens (50 transition rules)
**Files:** `css/polish.css`, `css/style.css`

Current: Ad-hoc `transition: 200ms ease`
Target: Standardized motion (--ui-motion-fast, --ui-motion-normal, --ui-motion-slow)

Changes:
- Define: `--ui-motion-fast: 150ms`, `--ui-motion-normal: 250ms`, `--ui-motion-slow: 400ms`
- Replace ~50 inline transitions with token references
- Add easing variants: ease-in, ease-out, ease-in-out

Estimated effort: 30 min

---

## Technical Debt (Faz 4)

### Optional (only if blocking):
- `.gitattributes` CRLF normalization (needed for parallel work)
- Duplicate `#main-menu` CSS rules (cosmetic, low-impact)
- Three.js CDN versioning (stability, not retention)

---

## Success Metrics

| Phase | Metric | Target |
|---|---|---|
| 1.1 | HUD glows, readable from distance | Pass visual inspection |
| 1.2 | Post-match XP visible, animated | Players see progress |
| 1.3 | Kill confirm immediate (client-side) | <100ms feedback |
| 2.1 | Menu feels alive | Smooth parallax, glow |
| 2.2 | No visual regressions | All screens consistent |
| 3.1 | Light theme usable | No readability issues |
| 3.2 | Smooth animations | 60fps on reference device |

---

## Parallelization Strategy

**Week 1:**
- Developer 1: HUD + post-match (Phases 1.1, 1.2)
- Developer 2: Menu + consistency (Phase 2)
- Developer 3: Kill feedback + audio integration (Phase 1.3)

All can run in parallel; no cross-file dependencies if coordinated.

**Week 2:**
- Light theme (Phase 3.1)
- Motion tokens (Phase 3.2)
- Regression testing

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Animation CPU cost | Profile on reference device; use CSS transforms only (GPU) |
| Theme regression | Keep token definitions locked; test all 37 screens |
| Audio timing | Client-side only; mute if needed (no network lag) |
| XP bar math | Use existing `xpForTier` export; test with edge values (tier boundaries) |

