# Esports Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform 2BALL from a feature-complete but visually rough game into a polished, professional esports dodgeball experience with AAA-quality UI, gameplay loops, graphics, and combat.

**Architecture:** 4 independent sub-projects executed in parallel, each modifying non-overlapping primary files. Sub-Project 1 (UI) → CSS/HTML/ui.js. Sub-Project 4 (Hitbox) → ball.js/game.js hit detection. Sub-Project 2 (Gameplay) → game.js/skills.js. Sub-Project 3 (Graphics) → renderer.js/juice.js/arena.js.

**Tech Stack:** Three.js (r160+), vanilla JS (ES modules), CSS3, Web Audio API. No new dependencies.

## Global Constraints

- No new npm dependencies — vanilla JS + Three.js only
- Must maintain 60fps performance budget
- All new UI follows existing CSS variable system (`--accent`, `--font`, `--panel`)
- All new features gated behind existing debug system (`?debug` URL param)
- Ponytail comments for deliberate simplifications
- Each task produces independently testable deliverable

---

## Sub-Project 1: UI/UX Overhaul (css/style.css, index.html, js/ui.js)

### Task 1.1: Kill Feed Redesign

**Covers:** [S3.1]

**Files:**
- Modify: `css/style.css` — kill feed styles
- Modify: `js/ui.js` — kill feed rendering logic
- Modify: `js/game.js:84` — killFeed array already exists

**Interfaces:**
- Consumes: `this.killFeed` array (already exists in game.js)
- Produces: `ui.renderKillFeed(feed)` — enhanced with animations

- [ ] **Step 1: Add kill feed CSS**

```css
/* Kill Feed — right side, animated entries */
#kill-feed {
    position: fixed;
    top: 80px;
    right: 16px;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
}
.kill-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(8px);
    border-radius: 6px;
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text);
    animation: killSlideIn 0.3s ease-out;
    border-left: 3px solid var(--accent);
    white-space: nowrap;
}
.kill-entry.fade-out {
    animation: killFadeOut 0.5s ease-in forwards;
}
.kill-entry .killer { color: #ff6666; }
.kill-entry .victim { color: #888; }
.kill-entry .weapon-icon { color: var(--accent); font-size: 1.1em; }
.kill-entry.headshot { border-left-color: #ffdd00; }
@keyframes killSlideIn {
    from { transform: translateX(100px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}
@keyframes killFadeOut {
    from { opacity: 1; }
    to { opacity: 0; transform: translateY(-10px); }
}
```

- [ ] **Step 2: Add kill-feed div to index.html**

In `index.html`, add after the HUD container:
```html
<div id="kill-feed"></div>
```

- [ ] **Step 3: Update renderKillFeed in ui.js**

In `js/ui.js`, replace the existing `renderKillFeed` method:

```javascript
renderKillFeed(feed) {
    const el = document.getElementById('kill-feed');
    if (!el) return;
    // Remove expired entries from DOM
    const now = performance.now();
    while (el.children.length > feed.length) el.removeChild(el.firstChild);
    // Update/add entries
    feed.forEach((e, i) => {
        let row = el.children[i];
        if (!row) {
            row = document.createElement('div');
            row.className = 'kill-entry' + (e.headshot ? ' headshot' : '');
            el.appendChild(row);
        }
        row.innerHTML = `<span class="killer">${e.killer || 'Bot'}</span>
            <span class="weapon-icon">${e.headshot ? '💀' : '🏐'}</span>
            <span class="victim">${e.victim || 'Bot'}</span>`;
    });
}
```

- [ ] **Step 4: Verify — open game, get a kill, check feed appears on right side with animation**

- [ ] **Step 5: Commit**

```bash
git add css/style.css index.html js/ui.js
git commit -m "feat(ui): animated kill feed with slide-in and fade-out"
```

---

### Task 1.2: Round Banner

**Covers:** [S3.2]

**Files:**
- Modify: `css/style.css` — round banner styles
- Modify: `index.html` — banner element
- Modify: `js/ui.js` — showRoundBanner method

**Interfaces:**
- Consumes: round number, team names
- Produces: `ui.showRoundBanner(round, redScore, blueScore)`

- [ ] **Step 1: Add round banner CSS**

```css
/* Round Banner — center screen, animated */
#round-banner {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) scale(0);
    z-index: 250;
    text-align: center;
    pointer-events: none;
    opacity: 0;
    transition: none;
}
#round-banner.show {
    animation: roundBannerIn 0.5s ease-out forwards, roundBannerOut 0.4s ease-in 2s forwards;
}
#round-banner .round-label {
    font-size: 1.2em;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 4px;
}
#round-banner .round-number {
    font-size: 5em;
    font-weight: 900;
    background: linear-gradient(135deg, var(--accent), #ff4444);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
}
#round-banner .round-teams {
    font-size: 1em;
    color: var(--text-dim);
    margin-top: 8px;
}
@keyframes roundBannerIn {
    from { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
    to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
@keyframes roundBannerOut {
    from { opacity: 1; }
    to { opacity: 0; transform: translate(-50%, -50%) scale(1.1); }
}
```

- [ ] **Step 2: Add banner div to index.html**

```html
<div id="round-banner" class="hidden">
    <div class="round-label">Round</div>
    <div class="round-number">1</div>
    <div class="round-teams">RED vs BLUE</div>
</div>
```

- [ ] **Step 3: Add showRoundBanner to ui.js**

```javascript
showRoundBanner(round, redScore, blueScore) {
    const el = document.getElementById('round-banner');
    if (!el) return;
    el.querySelector('.round-number').textContent = round;
    el.querySelector('.round-teams').textContent = `RED ${redScore} - ${blueScore} BLUE`;
    el.classList.remove('hidden', 'show');
    void el.offsetWidth; // force reflow
    el.classList.add('show');
    setTimeout(() => el.classList.add('hidden'), 2500);
}
```

- [ ] **Step 4: Call from game.js round start**

In `game.js`, where round starts (search for `roundNum` increment), add:
```javascript
this.ui.showRoundBanner(this.scoreboard.roundNum, this.scoreboard.redScore, this.scoreboard.blueScore);
```

- [ ] **Step 5: Verify — start a match, see round banner animate in center**

- [ ] **Step 6: Commit**

```bash
git add css/style.css index.html js/ui.js js/game.js
git commit -m "feat(ui): round banner with animated entrance"
```

---

### Task 1.3: Victory/Defeat Screen

**Covers:** [S3.3]

**Files:**
- Modify: `css/style.css` — victory/defeat overlay styles
- Modify: `index.html` — overlay element
- Modify: `js/ui.js` — showVictory/showDefeat methods

**Interfaces:**
- Consumes: winning team, player stats
- Produces: `ui.showMatchResult(winner, stats)`

- [ ] **Step 1: Add victory/defeat CSS**

```css
/* Victory/Defeat Overlay */
#match-result {
    position: fixed; inset: 0;
    z-index: 300;
    display: flex; align-items: center; justify-content: center;
    flex-direction: column;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(10px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.4s ease;
}
#match-result.show { opacity: 1; pointer-events: all; }
#match-result .result-text {
    font-size: 6em; font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 8px;
    animation: resultPulse 1.5s ease-in-out infinite alternate;
}
#match-result .result-text.victory {
    background: linear-gradient(135deg, #44ff88, #22cc66);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
#match-result .result-text.defeat {
    background: linear-gradient(135deg, #ff4444, #cc2222);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
#match-result .result-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 20px; margin-top: 40px;
}
#match-result .stat-card {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px; padding: 20px 28px; text-align: center;
}
#match-result .stat-value {
    font-size: 2.5em; font-weight: 900; color: var(--accent);
}
#match-result .stat-label {
    font-size: 0.85em; color: var(--text-dim); margin-top: 4px;
}
#match-result .result-buttons { margin-top: 40px; display: flex; gap: 16px; }
@keyframes resultPulse {
    from { filter: drop-shadow(0 0 20px rgba(255,136,0,0.3)); }
    to { filter: drop-shadow(0 0 40px rgba(255,136,0,0.6)); }
}
```

- [ ] **Step 2: Add overlay HTML to index.html**

```html
<div id="match-result" class="hidden">
    <div class="result-text victory">VICTORY</div>
    <div class="result-stats">
        <div class="stat-card"><div class="stat-value" id="mr-kills">0</div><div class="stat-label">KILLS</div></div>
        <div class="stat-card"><div class="stat-value" id="mr-deaths">0</div><div class="stat-label">DEATHS</div></div>
        <div class="stat-card"><div class="stat-value" id="mr-damage">0</div><div class="stat-label">DAMAGE</div></div>
    </div>
    <div class="result-buttons">
        <button class="btn btn-primary" onclick="location.reload()">PLAY AGAIN</button>
    </div>
</div>
```

- [ ] **Step 3: Add showMatchResult to ui.js**

```javascript
showMatchResult(winner, stats) {
    const el = document.getElementById('match-result');
    if (!el) return;
    const textEl = el.querySelector('.result-text');
    textEl.textContent = winner === 'red' || winner === 'blue' ? 'VICTORY' : 'DEFEAT';
    textEl.className = 'result-text ' + (winner === 'red' || winner === 'blue' ? 'victory' : 'defeat');
    document.getElementById('mr-kills').textContent = stats.kills || 0;
    document.getElementById('mr-deaths').textContent = stats.deaths || 0;
    document.getElementById('mr-damage').textContent = Math.round(stats.damage || 0);
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('show'));
}
```

- [ ] **Step 4: Call from game.js on game over**

In `game.js` GAME_OVER state handler, add:
```javascript
this.ui.showMatchResult(this._winningTeam, {
    kills: this.scoreboard.getKills?.(this.playerName) || 0,
    deaths: this.scoreboard.getDeaths?.(this.playerName) || 0,
    damage: this.player.totalDamageDealt
});
```

- [ ] **Step 5: Verify — play a round to completion, see victory/defeat screen**

- [ ] **Step 6: Commit**

```bash
git add css/style.css index.html js/ui.js js/game.js
git commit -m "feat(ui): victory/defeat screen with match stats"
```

---

### Task 1.4: HUD Improvements

**Covers:** [S3.6]

**Files:**
- Modify: `css/style.css` — HUD element styles
- Modify: `js/ui.js` — updateVitals, updateHUD methods

**Interfaces:**
- Consumes: hp, maxHp, shield, stamina, staminaMax, ballSpeed, combo
- Produces: Enhanced `updateVitals()` and `updateHUD()`

- [ ] **Step 1: Add enhanced HUD CSS**

```css
/* Enhanced Health Bar */
#vitals { position: fixed; bottom: 20px; left: 20px; z-index: 150; }
#vitals .hp-bar {
    width: 220px; height: 14px;
    background: rgba(0,0,0,0.6);
    border-radius: 7px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.1);
}
#vitals .hp-fill {
    height: 100%;
    background: linear-gradient(90deg, #44dd66, #88ff88);
    border-radius: 7px;
    transition: width 0.3s ease, background 0.3s ease;
}
#vitals .hp-fill.low { background: linear-gradient(90deg, #ff4444, #ff6666); animation: hpPulse 0.5s ease-in-out infinite alternate; }
#vitals .hp-fill.mid { background: linear-gradient(90deg, #ffaa22, #ffcc44); }
#vitals .hp-text { font-size: 0.75em; color: var(--text-dim); margin-top: 2px; text-align: center; }
#vitals .stamina-bar {
    width: 220px; height: 8px;
    background: rgba(0,0,0,0.6);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 4px;
    border: 1px solid rgba(255,255,255,0.05);
}
#vitals .stamina-fill {
    height: 100%;
    background: linear-gradient(90deg, #44aaff, #66ccff);
    border-radius: 4px;
    transition: width 0.15s ease;
}
@keyframes hpPulse { from { opacity: 0.7; } to { opacity: 1; } }

/* Combo Counter */
#combo-display {
    position: fixed; top: 35%; left: 50%; transform: translate(-50%, -50%);
    z-index: 180; text-align: center; pointer-events: none;
    opacity: 0; transition: opacity 0.2s;
}
#combo-display.active { opacity: 1; }
#combo-display .combo-num {
    font-size: 4em; font-weight: 900;
    color: var(--accent);
    text-shadow: 0 0 30px rgba(255,136,0,0.5);
}
#combo-display .combo-label {
    font-size: 1.2em; font-weight: 700;
    color: #ffdd44;
    text-transform: uppercase;
    letter-spacing: 3px;
}

/* Ball Speed Indicator */
#ball-speed {
    position: fixed; bottom: 20px; right: 20px; z-index: 150;
    text-align: right;
}
#ball-speed .speed-value {
    font-size: 1.4em; font-weight: 900;
    color: var(--accent);
    transition: color 0.3s;
}
#ball-speed .speed-label {
    font-size: 0.7em; color: var(--text-dim); text-transform: uppercase;
}
```

- [ ] **Step 2: Add elements to index.html**

```html
<div id="combo-display">
    <div class="combo-num">0</div>
    <div class="combo-label">COMBO</div>
</div>
<div id="ball-speed">
    <div class="speed-value" id="speed-val">0</div>
    <div class="speed-label">BALL SPEED</div>
</div>
```

- [ ] **Step 3: Update ui.js updateVitals**

Replace existing `updateVitals` method:

```javascript
updateVitals(hp, maxHp, shield, stamina, staminaMax, exhausted) {
    const hpPct = Math.max(0, hp / maxHp * 100);
    const stPct = Math.max(0, stamina / staminaMax * 100);
    const hpFill = document.querySelector('#vitals .hp-fill');
    const stFill = document.querySelector('#vitals .stamina-fill');
    const hpText = document.querySelector('#vitals .hp-text');
    if (hpFill) {
        hpFill.style.width = hpPct + '%';
        hpFill.className = 'hp-fill' + (hpPct < 30 ? ' low' : hpPct < 60 ? ' mid' : '');
    }
    if (stFill) stFill.style.width = stPct + '%';
    if (hpText) hpText.textContent = `${Math.ceil(hp)}${shield > 0 ? ' +' + Math.ceil(shield) : ''}`;
}
```

- [ ] **Step 4: Add combo display to ui.js**

```javascript
updateCombo(combo, label) {
    const el = document.getElementById('combo-display');
    if (!el) return;
    if (combo > 1) {
        el.classList.add('active');
        el.querySelector('.combo-num').textContent = combo;
        el.querySelector('.combo-label').textContent = label || 'COMBO';
    } else {
        el.classList.remove('active');
    }
}
```

- [ ] **Step 5: Add ball speed display to ui.js updateHUD**

```javascript
updateHUD(data) {
    // ... existing code ...
    const speedEl = document.getElementById('speed-val');
    if (speedEl && data.ballSpeed !== undefined) {
        speedEl.textContent = Math.round(data.ballSpeed);
        const ratio = data.ballSpeed / 17; // baseSpeed
        speedEl.style.color = ratio > 3 ? '#ff4444' : ratio > 2 ? '#ffaa22' : 'var(--accent)';
    }
}
```

- [ ] **Step 6: Wire combo in game.js**

In `game.js` where combo is tracked, add:
```javascript
this.ui.updateCombo(this.juice.combo, this.juice.combo > 4 ? 'GODLIKE!' : this.juice.combo > 3 ? 'UNSTOPPABLE!' : this.juice.combo > 2 ? 'DOMINATING!' : this.juice.combo > 1 ? 'DOUBLE KILL!' : '');
```

- [ ] **Step 7: Verify — play game, check HP bar pulses red at low health, combo shows on streaks**

- [ ] **Step 8: Commit**

```bash
git add css/style.css index.html js/ui.js js/game.js
git commit -m "feat(ui): enhanced HUD with animated health, combo counter, ball speed"
```

---

### Task 1.5: Settings Menu

**Covers:** [S3.7]

**Files:**
- Modify: `css/style.css` — settings styles
- Modify: `index.html` — settings panel
- Modify: `js/ui.js` — settings logic

**Interfaces:**
- Consumes: none (standalone)
- Produces: `ui.showSettings()`, `ui.hideSettings()`

- [ ] **Step 1: Add settings CSS**

```css
/* Settings Menu — tabbed panel */
#settings-panel {
    position: fixed; inset: 0;
    z-index: 300;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.8);
    backdrop-filter: blur(10px);
}
#settings-panel .settings-box {
    background: var(--panel);
    border-radius: 16px;
    padding: 0;
    min-width: 500px;
    max-width: 600px;
    border: 1px solid rgba(255,255,255,0.08);
}
.settings-tabs {
    display: flex;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}
.settings-tabs button {
    flex: 1; padding: 14px; background: none; border: none;
    color: var(--text-dim); font-family: var(--font);
    font-weight: 600; cursor: pointer; transition: all 0.2s;
    border-bottom: 2px solid transparent;
}
.settings-tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
}
.settings-content { padding: 24px; }
.settings-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
}
.settings-row label { font-weight: 600; }
.settings-row input[type="range"] { width: 180px; accent-color: var(--accent); }
.settings-row .value { color: var(--accent); font-weight: 700; min-width: 40px; text-align: right; }
```

- [ ] **Step 2: Add settings HTML to index.html**

```html
<div id="settings-panel" class="hidden">
    <div class="settings-box">
        <div class="settings-tabs">
            <button class="active" data-tab="gameplay">GAMEPLAY</button>
            <button data-tab="audio">AUDIO</button>
            <button data-tab="graphics">GRAPHICS</button>
        </div>
        <div class="settings-content" id="settings-gameplay">
            <div class="settings-row"><label>FOV</label><input type="range" min="60" max="120" value="75" id="set-fov"><span class="value">75</span></div>
            <div class="settings-row"><label>Sensitivity</label><input type="range" min="1" max="10" value="5" id="set-sens"><span class="value">5</span></div>
        </div>
        <div class="settings-content hidden" id="settings-audio">
            <div class="settings-row"><label>Music</label><input type="range" min="0" max="100" value="50" id="set-music"><span class="value">50</span></div>
            <div class="settings-row"><label>SFX</label><input type="range" min="0" max="100" value="70" id="set-sfx"><span class="value">70</span></div>
        </div>
        <div class="settings-content hidden" id="settings-graphics">
            <div class="settings-row"><label>Bloom</label><input type="range" min="0" max="100" value="15" id="set-bloom"><span class="value">15</span></div>
        </div>
        <button class="btn btn-primary" style="margin: 0 24px 24px;" onclick="document.getElementById('settings-panel').classList.add('hidden')">CLOSE</button>
    </div>
</div>
```

- [ ] **Step 3: Add settings JS to ui.js**

```javascript
initSettings() {
    const tabs = document.querySelectorAll('.settings-tabs button');
    tabs.forEach(t => t.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        document.querySelectorAll('.settings-content').forEach(c => c.classList.add('hidden'));
        document.getElementById('settings-' + t.dataset.tab)?.classList.remove('hidden');
    }));
    // Value display sync
    document.querySelectorAll('#settings-panel input[type="range"]').forEach(inp => {
        const val = inp.parentElement.querySelector('.value');
        inp.addEventListener('input', () => { if (val) val.textContent = inp.value; });
    });
    // Apply settings
    document.getElementById('set-fov')?.addEventListener('input', e => {
        if (window._game?.player?.camera) window._game.player.camera.fov = +e.target.value;
    });
    document.getElementById('set-music')?.addEventListener('input', e => {
        window._game?.setMusicVolume?.(+e.target.value / 100);
    });
    document.getElementById('set-bloom')?.addEventListener('input', e => {
        window._game?.renderer?.bloomStrength?.(+e.target.value / 100);
    });
}
```

- [ ] **Step 4: Call initSettings from ui constructor**

- [ ] **Step 5: Verify — open settings, change tabs, adjust sliders**

- [ ] **Step 6: Commit**

```bash
git add css/style.css index.html js/ui.js
git commit -m "feat(ui): settings menu with gameplay/audio/graphics tabs"
```

---

## Sub-Project 2: Gameplay Loop (js/game.js, js/skills.js)

### Task 2.1: Kill Streak Announcer

**Covers:** [S4.1]

**Files:**
- Modify: `js/game.js` — kill streak tracking + announcement
- Modify: `css/style.css` — streak announcement styles
- Modify: `index.html` — streak banner element

**Interfaces:**
- Consumes: killFeed, kill events
- Produces: `game.announceStreak(streak, killer)`

- [ ] **Step 1: Add streak banner CSS**

```css
/* Kill Streak Announcement */
#streak-banner {
    position: fixed; top: 20%; left: 50%; transform: translate(-50%, -50%);
    z-index: 260; text-align: center; pointer-events: none;
    opacity: 0;
}
#streak-banner.show {
    animation: streakIn 0.3s ease-out forwards, streakOut 0.3s ease-in 1.5s forwards;
}
#streak-banner .streak-text {
    font-size: 3em; font-weight: 900;
    text-transform: uppercase; letter-spacing: 4px;
    text-shadow: 0 0 40px rgba(255,136,0,0.6);
}
#streak-banner .streak-text.double { color: #ffaa33; }
#streak-banner .streak-text.triple { color: #ff6644; }
#streak-banner .streak-text.quadra { color: #ff3333; }
#streak-banner .streak-text.penta { color: #ff00ff; }
#streak-banner .streak-text.ace { color: #ffdd00; font-size: 4em; }
@keyframes streakIn { from { transform: translate(-50%, -50%) scale(2); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
@keyframes streakOut { from { opacity: 1; } to { opacity: 0; transform: translate(-50%, -50%) scale(0.8); } }
```

- [ ] **Step 2: Add streak HTML to index.html**

```html
<div id="streak-banner"><div class="streak-text"></div></div>
```

- [ ] **Step 3: Add streak logic to game.js**

In Game constructor, add:
```javascript
this._killStreaks = new Map(); // playerName → count
this._streakTimer = null;
```

Add method:
```javascript
announceStreak(streak, killer) {
    const labels = { 2: 'DOUBLE KILL!', 3: 'TRIPLE KILL!', 4: 'QUADRA KILL!', 5: 'PENTA KILL!' };
    const classes = { 2: 'double', 3: 'triple', 4: 'quadra', 5: 'penta' };
    if (streak >= 5 && this.isTeamAce(killer)) {
        this.ui.showStreak('ACE!', 'ace');
    } else if (labels[streak]) {
        this.ui.showStreak(labels[streak], classes[streak]);
    }
    // Bonus XP/coin
    this.scoreboard.addXP?.(streak * 50);
    this.scoreboard.addCoin?.(streak * 10);
}

isTeamAce(killer) {
    const killerTeam = killer?.team;
    if (!killerTeam) return false;
    return this.getAllTargets().filter(p => p.team !== killerTeam).every(p => !p.alive);
}
```

In `handleHit` where kill is recorded, add:
```javascript
// Kill streak tracking
const streak = (this._killStreaks.get(this.lastDeflector?.name || 'Bot') || 0) + 1;
this._killStreaks.set(this.lastDeflector?.name || 'Bot', streak);
this.announceStreak(streak, this.lastDeflector);
```

- [ ] **Step 4: Add showStreak to ui.js**

```javascript
showStreak(text, cls) {
    const el = document.getElementById('streak-banner');
    if (!el) return;
    const textEl = el.querySelector('.streak-text');
    textEl.textContent = text;
    textEl.className = 'streak-text ' + (cls || '');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
}
```

- [ ] **Step 5: Verify — get multiple kills in a row, see streak announcements**

- [ ] **Step 6: Commit**

```bash
git add js/game.js js/ui.js css/style.css index.html
git commit -m "feat(gameplay): kill streak announcer with DOUBLE/TRIPLE/QUADRA/PENTA/ACE"
```

---

### Task 2.2: Ultimate Ability System

**Covers:** [S4.2]

**Files:**
- Modify: `js/skills.js` — ultimate definitions
- Modify: `js/game.js` — ultimate activation logic
- Modify: `js/ui.js` — ultimate charge UI
- Modify: `css/style.css` — ultimate HUD styles

**Interfaces:**
- Consumes: character loadout, damage events
- Produces: `player.useUltimate()`, `ui.updateUltimateCharge(pct)`

- [ ] **Step 1: Add ultimate definitions to skills.js**

```javascript
export const ULTIMATES = {
    rally:   { name: 'BLITZ BALL',   duration: 5, desc: 'Ball targets all enemies at 2x speed' },
    tank:    { name: 'FORTRESS',     duration: 5, desc: '+100 shield, 50% damage reduction' },
    scout:   { name: 'PHANTOM RUSH', duration: 5, desc: '+50% speed, semi-transparent' },
    sniper:  { name: 'PENETRATOR',   duration: 1, desc: 'Next throw pierces walls, 3x damage' },
    guardian:{ name: 'AEGIS',        duration: 0, desc: 'Heal all allies 30% HP' },
    blazer:  { name: 'INFERNO',      duration: 5, desc: 'Fire trail burns enemies on contact' },
    frost:   { name: 'FLASH FREEZE', duration: 3, desc: 'Freeze all balls on map' },
};
```

- [ ] **Step 2: Add ultimate charge to player.js**

In Player constructor, add:
```javascript
this.ultimateCharge = 0;    // 0-100
this.ultimateActive = false;
this.ultimateTimer = 0;
```

Add method:
```javascript
addUltimateCharge(amount) {
    if (this.ultimateActive) return;
    this.ultimateCharge = Math.min(100, this.ultimateCharge + amount);
}
useUltimate() {
    if (this.ultimateCharge < 100 || this.ultimateActive) return null;
    this.ultimateCharge = 0;
    this.ultimateActive = true;
    const ult = ULTIMATES[this.charId];
    this.ultimateTimer = ult?.duration || 0;
    return ult;
}
```

- [ ] **Step 3: Add ultimate HUD CSS**

```css
/* Ultimate Charge */
#ultimate-hud {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    z-index: 150; text-align: center;
}
#ultimate-hud .ult-ring {
    width: 64px; height: 64px; border-radius: 50%;
    border: 3px solid rgba(255,255,255,0.15);
    position: relative; margin: 0 auto;
}
#ultimate-hud .ult-fill {
    position: absolute; inset: 0; border-radius: 50%;
    background: conic-gradient(var(--accent) var(--pct), transparent var(--pct));
    opacity: 0.8;
}
#ultimate-hud .ult-text {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 1.4em; font-weight: 900; color: var(--text);
}
#ultimate-hud .ult-ready {
    font-size: 0.75em; color: var(--accent); margin-top: 4px;
    animation: ultPulse 1s ease-in-out infinite alternate;
}
@keyframes ultPulse { from { opacity: 0.5; } to { opacity: 1; } }
```

- [ ] **Step 4: Add ultimate HTML to index.html**

```html
<div id="ultimate-hud" class="hidden">
    <div class="ult-ring"><div class="ult-fill" id="ult-fill"></div><div class="ult-text" id="ult-pct">0</div></div>
    <div class="ult-ready hidden" id="ult-ready">Q — ULTIMATE</div>
</div>
```

- [ ] **Step 5: Add ultimate logic to game.js**

In `handleHit` and damage events, charge ultimate:
```javascript
// Charge ultimate on damage dealt
this.player.addUltimateCharge(damage * 0.3);
// Charge on damage taken
this.player.addUltimateCharge(damageTaken * 0.5);
```

Ultimate activation on Q hold:
```javascript
// In updatePlaying, check Q hold for ultimate
if (this.player.keys['KeyQ'] && this.player.ultimateCharge >= 100 && !this.player.ultimateActive) {
    const ult = this.player.useUltimate();
    if (ult) this.activateUltimate(ult);
}
```

Add `activateUltimate` method:
```javascript
activateUltimate(ult) {
    this.ui.showMessage?.(`⚡ ${ult.name}!`, 2000);
    this.juice.slowMo(0.5, 0.5);
    this.juice.shake(0.5);
    // Apply ultimate effect based on character
    switch (this.player.charId) {
        case 'tank':
            this.player.shield += 100;
            this.player._damageReduction = 0.5;
            setTimeout(() => { this.player._damageReduction = 0; this.player.ultimateActive = false; }, ult.duration * 1000);
            break;
        case 'scout':
            this.player.speed *= 1.5;
            this.player._transparent = true;
            setTimeout(() => { this.player.speed /= 1.5; this.player._transparent = false; this.player.ultimateActive = false; }, ult.duration * 1000);
            break;
        case 'sniper':
            this.ball._pierceWalls = true;
            this.ball.currentSpeed *= 3;
            this.player.ultimateActive = false; // one-shot
            break;
        case 'guardian':
            this.getAllTargets().filter(p => p.team === this.player.team && p.alive).forEach(p => {
                p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
            });
            this.player.ultimateActive = false;
            break;
        default:
            setTimeout(() => { this.player.ultimateActive = false; }, ult.duration * 1000);
    }
}
```

- [ ] **Step 6: Add ultimate HUD update to ui.js**

```javascript
updateUltimate(charge, isReady) {
    const hud = document.getElementById('ultimate-hud');
    const fill = document.getElementById('ult-fill');
    const pct = document.getElementById('ult-pct');
    const ready = document.getElementById('ult-ready');
    if (hud) hud.classList.remove('hidden');
    if (fill) fill.style.setProperty('--pct', charge + '%');
    if (pct) pct.textContent = Math.round(charge);
    if (ready) ready.classList.toggle('hidden', !isReady);
}
```

- [ ] **Step 7: Wire in game.js update loop**

```javascript
this.ui.updateUltimate(this.player.ultimateCharge, this.player.ultimateCharge >= 100);
```

- [ ] **Step 8: Verify — deal damage, watch charge build, activate ultimate at 100%**

- [ ] **Step 9: Commit**

```bash
git add js/skills.js js/player.js js/game.js js/ui.js css/style.css index.html
git commit -m "feat(gameplay): ultimate ability system with charge, activation, and per-character effects"
```

---

### Task 2.3: Enhanced Power-up System

**Covers:** [S4.4]

**Files:**
- Modify: `js/game.js` — power-up spawn/pickup logic (already has basic)
- Modify: `js/arena.js` — power-up visual meshes
- Modify: `css/style.css` — power-up indicator styles

**Interfaces:**
- Consumes: game timer, player position
- Produces: `game.spawnPowerUp()`, `game.pickupPowerUp(player, type)`

- [ ] **Step 1: Define power-up types in game.js**

```javascript
const POWERUP_TYPES = [
    { id: 'shield',   color: 0x44aaff, label: '+SHIELD',  duration: 10 },
    { id: 'speed',    color: 0x44ff88, label: '+SPEED',   duration: 8 },
    { id: 'damage',   color: 0xff4444, label: '+DAMAGE',  duration: 10 },
    { id: 'megaball', color: 0xffaa00, label: 'MEGA BALL', duration: 0 },
];
```

- [ ] **Step 2: Enhance spawnPowerUp in game.js**

Replace existing power-up spawn with typed system:
```javascript
spawnPowerUp() {
    if (this.powerUps.length >= this._maxPowerUps) return;
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const pos = this.arena.getSpawnPoint();
    pos.y = 1.5;
    const geo = new THREE.OctahedronGeometry(0.5);
    const mat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.renderer.scene.add(mesh);
    this.powerUps.push({ mesh, type, pos: pos.clone(), timer: 20 });
}
```

- [ ] **Step 3: Enhance pickup logic**

```javascript
pickupPowerUp(player, powerUp) {
    const type = powerUp.type;
    this.renderer.scene.remove(powerUp.mesh);
    powerUp.mesh.geometry.dispose();
    powerUp.mesh.material.dispose();
    this.ui.showMessage?.(type.label, 1500);
    switch (type.id) {
        case 'shield':
            player.shield += 50;
            break;
        case 'speed':
            player._buffSpeed = player.speed * 0.3;
            player.speed *= 1.3;
            setTimeout(() => { player.speed /= 1.3; player._buffSpeed = 0; }, type.duration * 1000);
            break;
        case 'damage':
            player._buffDamage = 1.5;
            setTimeout(() => { player._buffDamage = 1; }, type.duration * 1000);
            break;
        case 'megaball':
            this.ball.mesh.scale.setScalar(2);
            this.ball.radius *= 2;
            this.ball.currentSpeed *= 1.5;
            setTimeout(() => { this.ball.mesh.scale.setScalar(1); this.ball.radius /= 2; this.ball.currentSpeed /= 1.5; }, 5000);
            break;
    }
}
```

- [ ] **Step 4: Add power-up floating animation in update loop**

```javascript
// Power-up animation
this.powerUps.forEach(pu => {
    pu.mesh.rotation.y += dt * 2;
    pu.mesh.position.y = pu.pos.y + Math.sin(performance.now() / 500) * 0.3;
});
```

- [ ] **Step 5: Verify — play game, see power-ups spawn, pick them up, effects apply**

- [ ] **Step 6: Commit**

```bash
git add js/game.js js/arena.js css/style.css
git commit -m "feat(gameplay): typed power-up system with shield/speed/damage/megaball"
```

---

### Task 2.4: Overtime Mechanic

**Covers:** [S4.3]

**Files:**
- Modify: `js/game.js` — overtime logic in round timer

**Interfaces:**
- Consumes: round timer, scores
- Produces: overtime state with escalating ball speed

- [ ] **Step 1: Add overtime state to game.js**

In Game constructor:
```javascript
this._overtime = false;
this._overtimeTimer = 0;
this._overtimeMaxSpeed = 3.0; // 3x base speed at max
```

- [ ] **Step 2: Modify round end check**

Where round timer expires and scores are tied, instead of ending:
```javascript
if (timeLeft <= 0) {
    if (this.scoreboard.redScore === this.scoreboard.blueScore) {
        // Enter overtime
        this._overtime = true;
        this._overtimeTimer = 0;
        this.ui.showMessage?.('⚡ OVERTIME!', 2000);
        this.ui.showStreak('OVERTIME!', 'ace');
        // Don't end round — continue playing
    } else {
        // Normal round end
        this.endRound();
    }
}
```

- [ ] **Step 3: Add overtime speed escalation in updatePlaying**

```javascript
if (this._overtime) {
    this._overtimeTimer += dt;
    const speedMul = Math.min(this._overtimeMaxSpeed, 1 + this._overtimeTimer * 0.1); // +10% every second
    if (this.ball.active) {
        this.ball.currentSpeed = this.ball.baseSpeed * speedMul * (this.ball.skinConfig?.speedBonus || 1);
    }
    // Max overtime: 30s then sudden death
    if (this._overtimeTimer >= 30) {
        this.ui.showMessage?.('SUDDEN DEATH!', 2000);
        // Next kill wins
    }
}
```

- [ ] **Step 4: Reset overtime on round end**

In `endRound()`:
```javascript
this._overtime = false;
this._overtimeTimer = 0;
```

- [ ] **Step 5: Verify — play a round to timeout with tied score, see overtime activate**

- [ ] **Step 6: Commit**

```bash
git add js/game.js
git commit -m "feat(gameplay): overtime mechanic with escalating ball speed"
```

---

## Sub-Project 3: Graphics/Visual Polish (js/renderer.js, js/juice.js, js/arena.js)

### Task 3.1: Post-Processing Effects

**Covers:** [S5.1]

**Files:**
- Modify: `js/renderer.js` — add vignette, chromatic aberration passes
- Modify: `js/juice.js` — trigger effects on hit

**Interfaces:**
- Consumes: camera, damage events
- Produces: `renderer.setVignette(intensity)`, `renderer.chromaticAberration(strength)`

- [ ] **Step 1: Add post-processing effects to renderer.js**

Add after bloom setup:

```javascript
// Vignette — full-screen quad overlay
_initVignette(camera) {
    if (this._vignetteMesh) return;
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uIntensity: { value: 0 },
            uColor: { value: new THREE.Color(0xff0000) },
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
        fragmentShader: `
            varying vec2 vUv;
            uniform float uIntensity;
            uniform vec3 uColor;
            void main(){
                vec2 center = vUv - 0.5;
                float dist = length(center);
                float vig = smoothstep(0.3, 0.8, dist) * uIntensity;
                gl_FragColor = vec4(uColor, vig);
            }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
    });
    this._vignetteMesh = new THREE.Mesh(geo, mat);
    this._vignetteMesh.frustumCulled = false;
    this._vignetteScene = new THREE.Scene();
    this._vignetteScene.add(this._vignetteMesh);
    this._vignetteCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

setVignette(intensity) {
    this._initVignette();
    if (this._vignetteMesh) this._vignetteMesh.material.uniforms.uIntensity.value = intensity;
}
```

- [ ] **Step 2: Render vignette as overlay pass**

Modify `render(camera)`:
```javascript
render(camera) {
    this._initComposer(camera);
    this._composer.render();
    // Vignette overlay
    if (this._vignetteScene && this._vignetteMesh?.material.uniforms.uIntensity.value > 0.01) {
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this._vignetteScene, this._vignetteCam);
        this.renderer.autoClear = true;
    }
}
```

- [ ] **Step 3: Trigger vignette from juice.js on damage taken**

In Juice class:
```javascript
updateVignette(playerHp, playerMaxHp) {
    if (!this.renderer) return;
    const hpPct = playerHp / playerMaxHp;
    const intensity = hpPct < 0.3 ? (0.3 - hpPct) * 5 : 0; // 0 at 30% HP, 1.5 at 0%
    this.renderer.setVignette(intensity);
}
```

- [ ] **Step 4: Call from game.js update loop**

```javascript
this.juice.updateVignette(this.player.hp, this.player.maxHp);
```

- [ ] **Step 5: Verify — take damage, see red vignette appear at low HP**

- [ ] **Step 6: Commit**

```bash
git add js/renderer.js js/juice.js js/game.js
git commit -m "feat(graphics): vignette overlay at low HP"
```

---

### Task 3.2: Enhanced Particle Effects

**Covers:** [S5.2]

**Files:**
- Modify: `js/juice.js` — improved burst effects

**Interfaces:**
- Consumes: hit position, color, event type
- Produces: `juice.hitBurst(pos, color)`, `juice.killBurst(pos)`

- [ ] **Step 1: Enhance burst method in juice.js**

Replace existing `burst` method:

```javascript
burst(pos, color = 0xff8844, count = 12, speed = 8) {
    if (!this.scene) return;
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
        const size = 0.08 + Math.random() * 0.12;
        const geo = Math.random() > 0.5
            ? new THREE.BoxGeometry(size, size, size)
            : new THREE.SphereGeometry(size * 0.6, 4, 4);
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 1,
        });
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(pos);
        const angle = Math.random() * Math.PI * 2;
        const elevation = (Math.random() - 0.3) * Math.PI;
        const spd = speed * (0.5 + Math.random() * 0.5);
        const vel = new THREE.Vector3(
            Math.cos(angle) * Math.cos(elevation) * spd,
            Math.sin(elevation) * spd * 0.7 + 3,
            Math.sin(angle) * Math.cos(elevation) * spd
        );
        this.scene.add(p);
        this.particles.push({ mesh: p, vel, life: 0.6 + Math.random() * 0.4, maxLife: 1 });
    }
}

hitBurst(pos) {
    this.burst(pos, 0xffaa44, 16, 10);
    this.shake(0.3);
}

killBurst(pos) {
    this.burst(pos, 0xff3333, 30, 14);
    this.burst(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffaa00, 15, 8);
    this.shake(0.6);
    this.slowMo(0.3, 0.4);
}
```

- [ ] **Step 2: Wire hitBurst/killBurst in game.js**

In handleHit:
```javascript
if (isKill) {
    this.juice.killBurst(target.getPosition());
} else {
    this.juice.hitBurst(target.getPosition());
}
```

- [ ] **Step 3: Verify — hit and kill enemies, see enhanced particle effects**

- [ ] **Step 4: Commit**

```bash
git add js/juice.js js/game.js
git commit -m "feat(graphics): enhanced particle bursts for hits and kills"
```

---

### Task 3.3: Map Visual Upgrades

**Covers:** [S5.4]

**Files:**
- Modify: `js/arena.js` — procedural ground texture, ambient particles

**Interfaces:**
- Consumes: map config
- Produces: `arena.addAmbientParticles()`

- [ ] **Step 1: Add procedural ground texture to arena.js**

In Arena class, replace floor material creation:

```javascript
_buildFloorTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    // Base color
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 256, 256);
    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 256; i += 32) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
    // Noise
    const imgData = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 12;
        imgData.data[i] += noise;
        imgData.data[i+1] += noise;
        imgData.data[i+2] += noise;
    }
    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    return tex;
}
```

- [ ] **Step 2: Use procedural texture for floor**

Where floor mesh is created:
```javascript
const floorTex = this._buildFloorTexture(mapConfig.floor);
const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8 });
```

- [ ] **Step 3: Add ambient particles**

```javascript
addAmbientParticles(type = 'dust') {
    const colors = { dust: 0xcccccc, spark: 0xffaa44, rain: 0x88bbff };
    for (let i = 0; i < 30; i++) {
        const geo = new THREE.SphereGeometry(0.03, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color: colors[type] || 0xcccccc, transparent: true, opacity: 0.4 });
        const p = new THREE.Mesh(geo, mat);
        p.position.set(
            (Math.random() - 0.5) * 60,
            Math.random() * 15 + 2,
            (Math.random() - 0.5) * 40
        );
        p.userData = { speed: 0.5 + Math.random(), phase: Math.random() * Math.PI * 2 };
        this.scene.add(p);
        this._ambientParticles = this._ambientParticles || [];
        this._ambientParticles.push(p);
    }
}

updateAmbientParticles(dt) {
    if (!this._ambientParticles) return;
    this._ambientParticles.forEach(p => {
        p.position.y -= p.userData.speed * dt;
        p.position.x += Math.sin(performance.now() / 1000 + p.userData.phase) * dt * 0.5;
        if (p.position.y < 0) p.position.y = 15 + Math.random() * 5;
    });
}
```

- [ ] **Step 4: Call addAmbientParticles when map loads, updateAmbientParticles in game loop**

- [ ] **Step 5: Verify — play on different maps, see procedural floor textures and ambient particles**

- [ ] **Step 6: Commit**

```bash
git add js/arena.js
git commit -m "feat(graphics): procedural ground textures and ambient particles"
```

---

## Sub-Project 4: Hitbox/Combat (js/ball.js, js/game.js)

### Task 4.1: Capsule Hitbox

**Covers:** [S6.1]

**Files:**
- Modify: `js/game.js` — replace distance check with capsule test

**Interfaces:**
- Consumes: ball position, player positions
- Produces: `game.checkCapsuleHit(ballPos, playerPos, playerHeight)`

- [ ] **Step 1: Add capsule hit test to game.js**

```javascript
// Capsule hit test — closest point on vertical segment to ball center
capsuleHitTest(ballPos, playerPos, playerHeight = 1.7, capsuleRadius = 0.4) {
    // Player capsule: segment from (px, 0, pz) to (px, height, pz)
    const px = playerPos.x, pz = playerPos.z;
    const py = Math.max(0, Math.min(playerHeight, ballPos.y));
    const dx = ballPos.x - px;
    const dz = ballPos.z - pz;
    const dy = ballPos.y - py;
    const distSq = dx * dx + dy * dy + dz * dz;
    const totalRadius = this.ball.radius + capsuleRadius;
    return distSq < totalRadius * totalRadius;
}
```

- [ ] **Step 2: Replace hit detection in game.js**

Replace existing bodyDist check with:
```javascript
if (this.capsuleHitTest(ballPos, headPos, 1.7, 0.4)) {
    this.handleHit(target);
    return;
}
```

- [ ] **Step 3: Verify — test hits at different angles, confirm capsule is more accurate than distance-to-center**

- [ ] **Step 4: Commit**

```bash
git add js/game.js
git commit -m "feat(combat): capsule-based hitbox for more accurate player collision"
```

---

### Task 4.2: Body Zone Multipliers

**Covers:** [S6.2]

**Files:**
- Modify: `js/game.js` — body zone detection + multiplier
- Modify: `js/ui.js` — damage number display

**Interfaces:**
- Consumes: ball position relative to player
- Produces: zone label + damage multiplier

- [ ] **Step 1: Add body zone detection to game.js**

```javascript
getBodyZone(ballPos, playerPos, playerHeight = 1.7) {
    const relativeY = (ballPos.y - (playerPos.y - playerHeight)) / playerHeight;
    if (relativeY > 0.8) return { zone: 'head', multiplier: 2.0, label: 'HEAD' };
    if (relativeY > 0.5) return { zone: 'chest', multiplier: 1.5, label: 'CHEST' };
    if (relativeY > 0.2) return { zone: 'body', multiplier: 1.0, label: 'BODY' };
    return { zone: 'legs', multiplier: 0.8, label: 'LEGS' };
}
```

- [ ] **Step 2: Apply multiplier in handleHit**

```javascript
handleHit(target) {
    const zone = this.getBodyZone(this.ball.position, target.getPosition());
    let damage = BASE_HIT_DAMAGE * zone.multiplier;
    // Apply other modifiers...
    this.ui.showDamageNumber(target.getPosition(), damage, zone.label);
    // ... rest of handleHit
}
```

- [ ] **Step 3: Add damage number display to ui.js**

```javascript
showDamageNumber(pos, damage, label) {
    // Project 3D position to screen
    const screenPos = pos.clone().project(this._camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'damage-number';
    el.innerHTML = `<span class="dmg-value">${Math.round(damage)}</span><span class="dmg-zone">${label}</span>`;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
}
```

- [ ] **Step 4: Add damage number CSS**

```css
.damage-number {
    position: fixed; z-index: 300; pointer-events: none;
    animation: dmgFloat 0.8s ease-out forwards;
    text-align: center;
}
.damage-number .dmg-value {
    font-size: 1.8em; font-weight: 900; color: #ffdd44;
    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}
.damage-number .dmg-zone {
    display: block; font-size: 0.7em; font-weight: 700;
    color: var(--accent); text-transform: uppercase;
}
@keyframes dmgFloat {
    from { opacity: 1; transform: translateY(0) scale(1); }
    to { opacity: 0; transform: translateY(-40px) scale(0.7); }
}
```

- [ ] **Step 5: Verify — hit enemies at different heights, see HEAD/CHEST/BODY/LEGS labels and different damage numbers**

- [ ] **Step 6: Commit**

```bash
git add js/game.js js/ui.js css/style.css
git commit -m "feat(combat): body zone multipliers (HEAD 2x, CHEST 1.5x, BODY 1x, LEGS 0.8x) with damage numbers"
```

---

### Task 4.3: Damage Falloff

**Covers:** [S6.3]

**Files:**
- Modify: `js/game.js` — falloff calculation in handleHit

**Interfaces:**
- Consumes: distance between ball and thrower
- Produces: damage multiplier

- [ ] **Step 1: Add falloff function to game.js**

```javascript
getDamageFalloff(distance) {
    if (distance < 5) return 1.0;
    if (distance < 15) return 0.8;
    if (distance < 30) return 0.6;
    return 0.5;
}
```

- [ ] **Step 2: Apply in handleHit**

```javascript
const throwerPos = this.lastDeflector?.getPosition?.() || this.ball.position;
const dist = throwerPos.distanceTo(target.getPosition());
const falloff = this.getDamageFalloff(dist);
damage *= falloff;
```

- [ ] **Step 3: Verify — hit at different distances, confirm damage decreases**

- [ ] **Step 4: Commit**

```bash
git add js/game.js
git commit -m "feat(combat): damage falloff based on distance from thrower"
```

---

### Task 4.4: Visual Hit Indicators

**Covers:** [S6.4]

**Files:**
- Modify: `css/style.css` — hit marker + directional indicator styles
- Modify: `js/ui.js` — hit marker + directional indicator logic
- Modify: `js/game.js` — trigger indicators on hit

**Interfaces:**
- Consumes: hit event, direction
- Produces: `ui.showHitMarker()`, `ui.showDamageDirection(angle)`

- [ ] **Step 1: Add hit marker CSS**

```css
/* Hit Marker — crosshair flash */
#hit-marker {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 200; pointer-events: none; opacity: 0;
    font-size: 1.5em; color: white; font-weight: 900;
}
#hit-marker.show { animation: hitMarkerFlash 0.15s ease-out; }
@keyframes hitMarkerFlash {
    from { opacity: 1; transform: translate(-50%, -50%) scale(1.5); }
    to { opacity: 0; transform: translate(-50%, -50%) scale(1); }
}

/* Directional Damage Indicator */
#dmg-direction {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 200px; height: 200px; z-index: 190; pointer-events: none; opacity: 0;
}
#dmg-direction .dmg-arc {
    position: absolute; top: 0; left: 50%; width: 4px; height: 50px;
    background: rgba(255, 0, 0, 0.6);
    transform-origin: bottom center;
    border-radius: 2px;
}
#dmg-direction.show { animation: dmgDirFlash 0.5s ease-out; }
@keyframes dmgDirFlash { from { opacity: 1; } to { opacity: 0; } }
```

- [ ] **Step 2: Add elements to index.html**

```html
<div id="hit-marker">✕</div>
<div id="dmg-direction"></div>
```

- [ ] **Step 3: Add UI methods**

```javascript
showHitMarker(headshot = false) {
    const el = document.getElementById('hit-marker');
    if (!el) return;
    el.style.color = headshot ? '#ffdd00' : 'white';
    el.style.fontSize = headshot ? '2em' : '1.5em';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
}

showDamageDirection(angle) {
    const el = document.getElementById('dmg-direction');
    if (!el) return;
    el.innerHTML = '';
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}deg)`;
    el.appendChild(arc);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
}
```

- [ ] **Step 4: Wire in game.js**

On hit: `this.ui.showHitMarker(zone.zone === 'head');`
On damage taken: `this.ui.showDamageDirection(damageAngle);`

- [ ] **Step 5: Verify — hit enemies, see hit marker flash; take damage, see direction indicator**

- [ ] **Step 6: Commit**

```bash
git add css/style.css index.html js/ui.js js/game.js
git commit -m "feat(combat): visual hit markers and directional damage indicators"
```

---

## Integration Test

After all 4 sub-projects complete:

- [ ] **Step 1: Start server and play full game**

```bash
cd C:\Users\Sher\Desktop\dodgb-v2 && node server.js
```

- [ ] **Step 2: Verify all features work together**
  - Kill feed shows animated entries
  - Round banner appears at round start
  - Kill streaks announce correctly
  - Ultimate charges and activates
  - Power-ups spawn and work
  - Vignette appears at low HP
  - Particle effects are enhanced
  - Capsule hitbox feels accurate
  - Body zones show correct labels
  - Damage numbers float at hit point
  - Hit markers flash on successful hit
  - Settings menu opens and works
  - Victory/defeat screen shows at game end

- [ ] **Step 3: Performance check — maintain 60fps with all effects active**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: esports overhaul — UI/UX, gameplay loop, graphics, hitbox/combat"
```

---

*Plan generated by MiMoCode Compose Agent. 4 sub-projects, 17 tasks, parallel execution ready.*
