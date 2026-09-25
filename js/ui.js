// ui.js — Full UI: menus, HUD, chat, minimap, scoreboard, skill cooldown, kill feed,
// damage meter, character select, shop, battlepass.
import { CHARACTERS } from './characters.js';
import { appendCosmeticIcon } from './cosmetic-icons.js';
import { SKILLS, RUNES } from './skills.js';
import { BALL_SKINS } from './ball.js';
import { AVATAR_SKINS } from './avatar.js';
import { CASES, KNIVES, COLLECTIONS, getCaseDropRates, revealPresentationForRarity, formatDuplicateConversion, computeCaseReelTickSchedule, arrangeNearMissFillers } from './cosmetics.js';
import { ACHIEVEMENTS } from './achievements.js';
import { MatchHistory } from './matchhistory.js';
import { getRank, getRankProgress } from './ranked.js';
import { Leaderboard } from './leaderboard.js';
import { Arena } from './arena.js';
import { COSMETICS, COSMETIC_TYPES, cosmeticsByType } from './cosmetic-catalog.js';
import { accountRankLabel, accountRankShort, levelProgress, prestigeTitle } from './prestige.js';
import { Store } from './store.js';
import { filterChatText } from './chat-filter.js';
import { playTags } from './play-of-game.js';
import { matchesShopFilter, matchesShopQuery, compareShopItems, deriveShopCardState, SHOP_COLLECTIONS, shopCollectionForItem } from './shop-clarity.js';
import { characterPortraitPath, shopNameFitTier, knifeTeamRestriction, isKnifeEquippedAny } from './shop-ux2.js';
import { classifyDamageTier, nextPoolCursor, damageJitterFor, comboTier, OVERDRIVE_MAX_RATIO } from './combat-fx.js';
import { rewardRowState, tierCardState, SHOP_XP_BOOST } from './battlepass.js';
import { buildRewardSummary, rewardStepDelays } from './match-analytics.js';
import { Daily } from './daily.js';
import { tierForRarity, tierBadgeHTML, tierRank, TIER_ORDER } from './tiers.js';
import { LOCKER_FAVORITES_KEY, LOCKER_FILTERS, LOCKER_SEEN_KEY, LOCKER_SORTS, LOCKER_SOURCE_TAB, buildLockerEntries, filterLockerEntries, lockerCounts, readKeySet, seedSeenKeys, sortLockerEntries, writeKeySet } from './locker.js';
import * as ItemThumbnails from './item-thumbnails.js';
import { createCaseReveal3D } from './case-reveal-3d.js';
import { selectMvp } from './mvp-select.js';
import { createMvpShowcaseStage } from './mvp-showcase.js';
import { localizedName, setText, t } from './i18n.js';
import { autoAssignTeam, effectiveTeam, isTeam as isTeamId, teamCounts } from './team-switch.js';
import { awaitGemCredit, buildGemShop, gemShopView, readPurchaseReturn, rememberGemsBeforeCheckout, stripPurchaseParams, takeGemsBeforeCheckout } from './gem-shop.js';
import { LEVEL_STAMP_VISIBLE_MS, TOAST_QUEUE_MAX, TOAST_QUEUE_MIN_MS } from './run-it-back.js';

// Queued post-match toasts outrank generic in-match copy (priority 0-2) so a
// level-up is never erased by the next ordinary message.
const TOAST_QUEUE_PRIORITY = 3;
// js/daily.js challenge type -> postgame.units.* plural key for the nudge line.
const DAILY_NUDGE_UNITS = Object.freeze({
    wins: 'wins',
    deflects: 'deflects',
    games: 'games',
    bestRally: 'rally',
    spikes: 'spikes',
    damage: 'damage',
    winStreak: 'wins',
    cleanWins: 'cleanWins'
});

const BALL_BASE_SPEED = 17;
// Countdown "COVER ON / OPEN COURT" chip lifetime (>= 2.5 s readable).
export const COVER_CHIP_VISIBLE_MS = 3000;

export function getBallHeat(ballSpeed, baseSpeed = BALL_BASE_SPEED) {
    const speed = Number.isFinite(ballSpeed) ? Math.max(0, ballSpeed) : 0;
    const base = Number.isFinite(baseSpeed) && baseSpeed > 0 ? baseSpeed : BALL_BASE_SPEED;
    const ratio = speed / base;
    const level = ratio >= 3.5 ? 'critical' : ratio >= 2.25 ? 'danger' : ratio >= 1.35 ? 'warm' : 'track';
    return {
        speed,
        ratio,
        percent: Math.round(ratio * 100),
        level,
        label: level === 'critical' ? 'CRITICAL' : level === 'danger' ? 'DANGER' : level === 'warm' ? 'WARM' : 'BALL'
    };
}

// G4 ETA readout: whole milliseconds under one second ("140 MS"), else seconds
// with one decimal ("1.2S"), rounded to the shown unit first (999.6 ms → 1.0S).
// Capped at 99.9S. '' when there is no finite ETA.
export const THREAT_ETA_MAX_TENTHS = 999;
export function threatEtaKey(seconds) {
    if (!Number.isFinite(seconds)) return -1;
    const ms = Math.round((seconds > 0 ? seconds : 0) * 1000);
    if (ms < 1000) return ms;
    const tenths = Math.round(ms / 100);
    return 1000 + (tenths > THREAT_ETA_MAX_TENTHS ? THREAT_ETA_MAX_TENTHS : tenths);
}
export function formatThreatEta(seconds) {
    const key = threatEtaKey(seconds);
    if (key < 0) return '';
    if (key < 1000) return `${key} MS`;
    const tenths = key - 1000;
    return `${Math.floor(tenths / 10)}.${tenths % 10}S`;
}
// The G4 closing ring around the reticle was removed at the owner's request
// (it cluttered the crosshair); the ETA label, edge glow, arrow and threat
// audio remain the incoming-ball cues.
const THREAT_DIRECTIONS = ['front', 'left', 'right', 'rear'];
const THREAT_DIRECTION_LABELS = ['FRONT', 'LEFT', 'RIGHT', 'BEHIND'];
// OVERDRIVE banner lifetime. The ratio that switches it (and the chip) to MAX
// is OVERDRIVE_MAX_RATIO, imported from combat-fx.js (the one definition
// shared with game.js's own OVERDRIVE presentation).
export const OVERDRIVE_BANNER_MS = 1200;

export function getBallThreat(isTarget, ballSpeed, distance, direction = 'front', perfectWindow = false, contactEta = null) {
    if (!isTarget) return {
        active: false,
        level: 'track',
        eta: Infinity,
        label: '',
        direction: 'front',
        perfectWindow: false
    };
    const heat = getBallHeat(ballSpeed);
    const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
    const eta = heat.speed > 0 ? safeDistance / heat.speed : Infinity;
    const level = eta <= 0.45 || heat.level === 'critical'
        ? 'critical'
        : eta <= 0.85 || heat.level === 'danger'
            ? 'danger'
            : 'alert';
    const safeDirection = direction === 'left' || direction === 'right' || direction === 'rear'
        ? direction
        : 'front';
    const directionLabel = safeDirection === 'rear' ? 'BEHIND' : safeDirection.toUpperCase();
    // G4: the label reads the predicted G1 contact when the game supplies it;
    // the level keeps the centre-distance ETA.
    const labelEta = Number.isFinite(contactEta) ? contactEta : eta;
    return {
        active: true,
        level,
        eta,
        direction: safeDirection,
        perfectWindow: perfectWindow === true,
        label: Number.isFinite(labelEta)
            ? `INCOMING ${formatThreatEta(labelEta)} · ${directionLabel}`
            : `INCOMING · ${directionLabel}`
    };
}

// 'red'/'RED' -> localised team word; FFA player names pass through untouched.
function teamLabel(team) {
    const id = String(team || '').toLowerCase();
    if (id === 'red') return t('hud.redCaps');
    if (id === 'blue') return t('hud.blueCaps');
    return String(team || '');
}

// Character blurbs live in the locale tables; characters.js keeps the English fallback.
export function characterDesc(character) {
    return localizedName('characters', character?.id, character?.desc || '');
}

export class UI {
    constructor() {
        this.screens = {
            mainMenu: document.getElementById('main-menu'),
            lobby: document.getElementById('lobby-screen'),
            hud: document.getElementById('hud'),
            scoreboardOverlay: document.getElementById('scoreboard-overlay'),
            gameOver: document.getElementById('game-over-screen'),
            postGame: document.getElementById('post-game-screen'),
            joinMenu: document.getElementById('join-menu'),
            multiplayerMenu: document.getElementById('multiplayer-menu'),
            practiceMenu: document.getElementById('practice-menu-screen'),
            character: document.getElementById('character-screen'),
            shop: document.getElementById('shop-screen'),
            battlepass: document.getElementById('battlepass-screen'),
            avatar: document.getElementById('avatar-screen'),
            mapEditor: document.getElementById('map-editor-screen'),
            achievements: document.getElementById('achievements-screen'),
            daily: document.getElementById('daily-screen'),
            ranked: document.getElementById('ranked-screen'),
            socialCenter: document.getElementById('social-center-screen'),
            leaderboard: document.getElementById('leaderboard-screen'),
            replays: document.getElementById('replays-screen'),
            social: document.getElementById('social-screen'),
            patchnotes: document.getElementById('patchnotes-screen'),
            tournament: document.getElementById('tournament-screen'),
            profile: document.getElementById('screen-profile')
        };
        this.competitiveHUD = {
            root: document.getElementById('hud-competitive-status'),
            mode: document.getElementById('hud-competitive-mode'),
            round: document.getElementById('hud-competitive-round'),
            phase: document.getElementById('hud-competitive-phase'),
            rules: document.getElementById('hud-competitive-rules')
        };
        this._competitiveHUDKey = '';
        this._shopPreviewAvatar = null;
        // Exclusive overlay registry (UIOverlapFix pass): tracks the single
        // "exclusive" floating overlay currently open (pause/settings/emote
        // wheel/chat/team popup/case inspector/earn overlay) so opening one
        // closes any other, instead of stacking on top of it. Passive panels
        // (scoreboard, kill feed) are not tracked here.
        this._exclusiveOverlay = null;
        this.initSettings();
        this._setupHoverAudio();
        if (typeof window !== 'undefined') window.UI = this;
    }

    initSettings() {
        const tabs = document.querySelectorAll('#settings-panel .settings-tabs button');
        tabs.forEach(t => t.addEventListener('click', () => {
            tabs.forEach(b => b.classList.remove('active'));
            t.classList.add('active');
            document.querySelectorAll('#settings-panel .settings-content').forEach(c => c.classList.add('hidden'));
            document.getElementById('settings-' + t.dataset.tab)?.classList.remove('hidden');
        }));
        document.querySelectorAll('#settings-panel input[type="range"]').forEach(inp => {
            const val = inp.parentElement.querySelector('.value');
            inp.addEventListener('input', () => { if (val) val.textContent = inp.value; });
        });
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

    showSettings() {
        this.hideScoreboard();
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.remove('hidden');
    }

    hideSettings() {
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.add('hidden');
    }

    showScreen(name) {
        this.hideScoreboard();
        this._exclusiveOverlay = null;
        Object.values(this.screens).forEach(s => { if (s) s.classList.add('hidden'); });
        const target = this.screens[name];
        if (target) {
            target.classList.remove('hidden');
            void target.offsetHeight; // force reflow for entrance animation
        }
        document.body.dataset.screen = name;
        document.body.classList.remove('match-ui-active');
        this._comboPinnedUntil = 0;
        this.hideMessage?.();
        document.querySelectorAll('.dmg-num.active, #combo-display.active, #streak-banner.active').forEach(el => el.classList.remove('active'));
        // Single screen-change signal so features can start/stop per screen without
        // patching every showScreen() call site.
        if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('warrball:screen', { detail: { screen: name } }));
        }
        // Close floating menus that aren't in screens
        const extras = ['pause-menu', 'settings-screen', 'post-game-screen', 'team-popup', 'celeb-weapon-hud'];
        extras.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        // post-game-screen is always hidden above, so its MVP turntable (WebGL
        // context + rAF loop) must stop here too — `.hidden` alone doesn't
        // disconnect the canvas, and the render loop only checks isConnected.
        this._mvpShowcase?.dispose();
        this._mvpShowcase = null;
    }

    // _openExclusive('pause'|'settings'|'emoteWheel'|'chat'|'teamPopup'|
    // 'caseInspector'|'earnOverlay', closeFn) — if a different exclusive
    // overlay is already open, closes it first via its own closeFn, then
    // tracks the new one. Callers still own their own DOM show/hide; this
    // only prevents two exclusive overlays being visible at once.
    _openExclusive(name, closeFn) {
        if (this._exclusiveOverlay && this._exclusiveOverlay.name !== name) {
            this._exclusiveOverlay.closeFn();
        }
        this._exclusiveOverlay = { name, closeFn };
        // main.js renders the inspector body, then registers it here — the one ui.js
        // touchpoint where the 3D drop strip can be added without owning that path.
        if (name === 'caseInspector') this._decorateCaseInspector();
    }

    _closeExclusive(name) {
        if (this._exclusiveOverlay?.name === name) this._exclusiveOverlay = null;
    }

    exclusiveOverlayOpen() {
        return this._exclusiveOverlay?.name || null;
    }

    hideAll() {
        Object.values(this.screens).forEach(s => { if (s) s.classList.add('hidden'); });
        if (document.body?.dataset) document.body.dataset.screen = 'gameplay';
        if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('warrball:screen', { detail: { screen: 'gameplay' } }));
        }
    }

    // HUD score labels keep their pinned markup (<span>RED</span>…), so they are
    // translated here instead of with data-i18n. Called on boot and on switch.
    onLanguageChanged() {
        const setSpan = (selector, key) => {
            const span = document.querySelector(selector);
            if (span) span.textContent = t(key);
        };
        setSpan('#hud-score-red > span', 'hud.redCaps');
        setSpan('#hud-score-blue > span', 'hud.blueCaps');
        setSpan('#hud-round-timer > span', 'hud.matchCaps');
        if (this._scoreExtras) {
            const round = this._scoreExtras.round;
            this._scoreExtras.round = null;
            this._updateScoreboardExtras(round, null);
        }
    }

    showHUD() {
        document.body.classList.add('match-ui-active');
        this.updateCompetitiveHUD();
        if (this.screens.hud) this.screens.hud.classList.remove('hidden');
    }
    // Round label + CS-style alive pips. Called every frame; writes the DOM only when
    // a value changes (pips are rebuilt only when a team's size changes).
    _updateScoreboardExtras(round, alive) {
        const state = this._scoreExtras || (this._scoreExtras = { round: null, red: '', blue: '' });
        if (Number.isFinite(round) && state.round !== round) {
            state.round = round;
            const label = document.querySelector('#hud-round-timer [data-round-label]');
            if (label) label.textContent = t('hud.roundN', { round });
        }
        if (!alive) return;
        for (const side of ['red', 'blue']) {
            const counts = alive[side];
            const key = `${counts.alive}/${counts.total}`;
            if (state[side] === key) continue;
            state[side] = key;
            const node = document.getElementById(`hud-alive-${side}`);
            if (!node) continue;
            const total = Math.min(8, counts.total);
            if (node.childElementCount !== total) {
                node.replaceChildren(...Array.from({ length: total }, () => document.createElement('u')));
            }
            for (let i = 0; i < node.children.length; i++) node.children[i].classList.toggle('down', i >= counts.alive);
            node.setAttribute('aria-label', t('hud.aliveAria', { team: t(side === 'red' ? 'hud.redName' : 'hud.blueName'), alive: counts.alive, total: counts.total }));
        }
    }

    hideHUD() { document.body.classList.remove('match-ui-active'); if (this.screens.hud) this.screens.hud.classList.add('hidden'); }

    updateHUD(data) {
        const { time, timeRemaining, redScore, blueScore, ballSpeed, hotPotato, competitive,
            heatTier, heatColor, heatProgress, charging, chargeRatio, round, alive } = data;
        const el = id => document.getElementById(id);

        const timerEl = el('hud-round-timer');
        if (timerEl) {
            const timerValue = timerEl.querySelector('[data-timer-value]') || timerEl;
            if (timerValue.textContent !== time) timerValue.textContent = time;
            // updateHUD runs every frame, so only touch the DOM when the tier
            // actually changes rather than rewriting the attribute 60x a second.
            const urgency = !Number.isFinite(timeRemaining) ? ''
                : timeRemaining <= 10 ? 'critical'
                : timeRemaining <= 30 ? 'warning'
                : '';
            if (this._timerUrgency !== urgency) {
                this._timerUrgency = urgency;
                timerEl.dataset.urgency = urgency;
            }
        }
        // updateHUD runs every frame, so the score digits are written only when the
        // value actually changes. That skips ~99% of the DOM writes and gives the
        // CSS pop (.score-pop, css/polish.css) a natural once-per-goal trigger.
        this._hudScores ??= { red: null, blue: null };
        for (const side of ['red', 'blue']) {
            const value = side === 'red' ? redScore : blueScore;
            if (this._hudScores[side] === value) continue;
            this._hudScores[side] = value;
            const node = el(`hud-score-${side}`);
            if (!node) continue;
            const scoreValue = node.querySelector('[data-score-value]') || node;
            scoreValue.textContent = value;
            node.classList.remove('score-pop');
            void node.offsetWidth; // restart the animation on repeat scores
            node.classList.add('score-pop');
        }
        this._updateScoreboardExtras(round, alive);
        if (el('hud-speed')) {
            const heat = getBallHeat(ballSpeed);
            el('hud-speed').textContent = `${heat.label} ${heat.percent}%`;
            el('hud-speed').dataset.heat = heat.level;
        }
        // Ball speed indicator (bottom-right)
        const speedEl = document.getElementById('speed-val');
        if (speedEl && ballSpeed !== undefined) {
            const heat = getBallHeat(ballSpeed);
            speedEl.textContent = Math.round(heat.speed);
            speedEl.parentElement.dataset.heat = heat.level;
        }
        // Rally heat pip — fills/tints as rallyCount climbs ball.js's heat tiers
        // (Game._applyRallyHeat, called once per deflect, not per frame).
        const heatPip = el('hud-heat-pip');
        const heatFill = el('hud-heat-fill');
        if (heatPip && heatFill) {
            const tier = heatTier || 'cool';
            if (heatPip.dataset.tier !== tier) heatPip.dataset.tier = tier;
            heatFill.style.width = `${Math.round((heatProgress || 0) * 100)}%`;
            if (Number.isFinite(heatColor)) heatFill.style.backgroundColor = `#${heatColor.toString(16).padStart(6, '0')}`;
        }
        // Charge bar — only visible while holding the deflect button (Game._updateCharge).
        const chargeBar = el('hud-charge-bar');
        const chargeFill = el('hud-charge-fill');
        if (chargeBar && chargeFill) {
            chargeBar.classList.toggle('hidden', !charging);
            if (charging) chargeFill.style.width = `${Math.round((chargeRatio || 0) * 100)}%`;
        }
        this.updateHotPotato(hotPotato);
        this.updateCompetitiveHUD(competitive);
    }

    updateCompetitiveHUD(state) {
        const hud = this.competitiveHUD;
        if (!hud?.root) return;
        const view = getCompetitiveHUDView(state);
        hud.root.classList.toggle('hidden', !view.active);
        hud.root.setAttribute('aria-hidden', String(!view.active));
        if (!view.active) {
            this._competitiveHUDKey = '';
            return;
        }
        if (view.key === this._competitiveHUDKey) return;
        this._competitiveHUDKey = view.key;
        if (hud.mode) hud.mode.textContent = view.mode;
        if (hud.round) hud.round.textContent = view.roundLabel;
        if (hud.phase) hud.phase.textContent = view.phase;
        if (hud.rules) hud.rules.textContent = view.rulesLabel;
        hud.root.dataset.phase = view.phase.toLowerCase().replaceAll(' ', '-');
        hud.root.setAttribute('aria-label', view.ariaLabel);
    }

    updateMovementHUD(speed = 0, state = 'MOVE', social = false) {
        const root = document.getElementById(social ? 'social-movement-hud' : 'movement-hud');
        const value = document.getElementById(social ? 'social-speed-value' : 'movement-speed-value');
        const label = document.getElementById(social ? 'social-movement-state' : 'movement-state');
        if (!root || !value || !label) return;
        const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
        value.textContent = Math.round(safeSpeed);
        label.textContent = state;
        root.classList.toggle('hidden', safeSpeed < 4 && state === 'MOVE');
        root.classList.toggle('boost', safeSpeed >= 11 || state === 'BHOP' || state === 'DASH');
        root.classList.toggle('bhop', state === 'BHOP');
        root.classList.toggle('longjump', state === 'LONGJUMP');
        root.classList.toggle('dash', state === 'DASH');
    }

    updateMovementTrialHUD(state) {
        const root = document.getElementById('movement-trial-hud');
        if (!root) return;
        root.classList.toggle('hidden', !state?.active);
        if (!state?.active) return;
        const name = document.getElementById('movement-trial-name');
        const time = document.getElementById('movement-trial-time');
        const progress = document.getElementById('movement-trial-progress');
        const detail = document.getElementById('movement-trial-detail');
        if (name) name.textContent = state.trial.name;
        if (time) time.textContent = `${(state.elapsed / 1000).toFixed(2)}s`;
        if (progress) progress.style.width = `${Math.min(100, state.distance / state.trial.targetDistance * 100)}%`;
        if (detail) {
            const best = state.trial.requiredRocketJumps
                ? `${state.rocketJumps}/${state.trial.requiredRocketJumps} rocket jumps`
                : `${Math.round(state.distance)}/${state.trial.targetDistance}m`;
            detail.textContent = best;
        }
    }

    updateScoreboard(stats, ffa = false, { cover } = {}) {
        this.updateScoreboardTable('scoreboard-body', stats, ffa);
        const heading = document.querySelector('#scoreboard-overlay th:nth-child(2)');
        if (heading) heading.textContent = ffa ? t('mp.mode') : t('common.team');
        this._updateScoreboardCover(cover);
    }

    // One-line cover state under the Tab table (repeats the countdown chip,
    // so a late joiner who never saw the countdown can still read it).
    _updateScoreboardCover(cover) {
        const shell = document.querySelector('#scoreboard-overlay .scoreboard-shell');
        if (!shell) return;
        let line = document.getElementById('scoreboard-cover');
        if (typeof cover !== 'boolean') {
            line?.classList.add('hidden');
            return;
        }
        if (!line) {
            line = document.createElement('p');
            line.id = 'scoreboard-cover';
            line.className = 'scoreboard-cover';
            shell.insertBefore(line, shell.querySelector('.scoreboard-hint'));
        }
        setText(line, cover ? 'match.coverStateOn' : 'match.coverStateOff');
        if (line.dataset) line.dataset.cover = cover ? 'on' : 'off';
        line.classList.remove('hidden');
    }

    updateScoreboardTable(tbodyId, stats, ffa = false) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = '';
        const store = window.__store;
        stats.forEach((p, i) => {
            const row = document.createElement('tr');
            row.className = p.team;
            const rank = p.rank || (p.isBot ? ['🥉','🥈','🥇'][Math.min(2, i)] : '🔰');
            const level = p.level || (p.isBot ? Math.min(20, i + 1) : (store?.get?.('level') || 1));
            // Your own row carries the prestige marker ("P2·12"); bots keep a plain
            // number. The column header is only "Lv", so this stays compact.
            const levelText = !p.isBot && typeof store?.getAccount === 'function'
                ? accountRankShort(store.getAccount())
                : String(level);
            const values = [
                `${p.name}${p.isYou ? ' (YOU)' : ''}`,
                ffa ? 'SOLO' : String(p.team || '').toUpperCase(),
                String(rank),
                levelText,
                String(p.score ?? 0),
                String(p.deflections ?? 0),
                String(p.hits ?? 0)
            ];
            values.forEach((value, cellIndex) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                if (cellIndex === 0) cell.className = `team-${p.team}`;
                row.appendChild(cell);
            });
            const action = document.createElement('td');
            if (!p.isYou && !p.isBot) {
                const inspect = document.createElement('button');
                inspect.type = 'button';
                inspect.className = 'scoreboard-safety inspect';
                inspect.textContent = 'Inspect';
                inspect.addEventListener?.('click', () => this.onPlayerInspect?.(p));
                const safety = document.createElement('button');
                safety.type = 'button';
                safety.className = 'scoreboard-safety';
                safety.textContent = 'Report';
                safety.setAttribute?.('aria-label', `Mute or report ${p.name}`);
                safety.addEventListener?.('click', () => this.onPlayerSafety?.(p));
                action.appendChild(inspect);
                action.appendChild(safety);
            } else action.textContent = '-';
            row.appendChild(action);
            tbody.appendChild(row);
        });
    }

    showScoreboard() {
        const s = this.screens.scoreboardOverlay;
        if (s) s.classList.remove('hidden');
        const tracker = document.getElementById('contract-tracker');
        if (tracker?.dataset.ready === 'true') tracker.classList.remove('hidden');
        const dm = document.getElementById('damage-meter');
        if (dm) dm.style.display = '';
    }

    hideScoreboard() {
        const s = this.screens.scoreboardOverlay;
        if (s) s.classList.add('hidden');
        document.getElementById('contract-tracker')?.classList.add('hidden');
        const dm = document.getElementById('damage-meter');
        if (dm) dm.style.display = 'none';
    }

    // Incoming indicator with speed and time-to-impact readability.
    setPlayerTarget(
        isTarget,
        ballSpeed = 0,
        distance = Infinity,
        side = 0,
        direction = 'front',
        behind = false,
        offscreen = false,
        perfectWindow = false,
        contactEta = null
    ) {
        const el = document.getElementById('incoming-indicator');
        if (!el) return;
        const threat = getBallThreat(isTarget, ballSpeed, distance, direction, perfectWindow, contactEta);
        // G4: setThreatEta refreshes this label every frame with the same text.
        this._threatLabelDirection = threat.active ? THREAT_DIRECTIONS.indexOf(threat.direction) : -1;
        this._threatLabelKey = threat.active ? threatEtaKey(Number.isFinite(contactEta) ? contactEta : threat.eta) : -2;
        const previousLevel = el.dataset.threat;
        const previousDirection = el.dataset.direction;
        el.classList.toggle('active', threat.active);
        el.classList.toggle('hidden', !threat.active);
        el.dataset.threat = threat.level;
        el.dataset.label = threat.label;
        el.dataset.direction = threat.direction;
        el.dataset.behind = String(threat.active && behind === true);
        el.dataset.offscreen = String(threat.active && offscreen === true);
        el.dataset.perfect = String(threat.active && threat.perfectWindow);
        const safeSide = Number.isFinite(side) ? Math.max(-1, Math.min(1, side)) : 0;
        const eta = Number.isFinite(threat.eta) ? threat.eta : 1.5;
        const scale = Math.max(0.88, Math.min(1.18, 1.18 - eta * 0.2));
        const pulse = Math.max(0.34, Math.min(0.82, 0.34 + eta * 0.3));
        el.style.setProperty('--threat-side', safeSide.toFixed(3));
        el.style.setProperty('--threat-scale', scale.toFixed(3));
        el.style.setProperty('--threat-pulse', `${pulse.toFixed(3)}s`);
        el.setAttribute('aria-hidden', String(!threat.active));
        if (!threat.active) {
            el.setAttribute('aria-label', 'No incoming ball');
        } else if (previousLevel !== threat.level || previousDirection !== threat.direction) {
            el.setAttribute('role', 'status');
            const ariaDirection = threat.direction === 'rear' ? 'behind' : threat.direction;
            el.setAttribute('aria-label', `Incoming ball from ${ariaDirection}`);
        }
    }

    // G4: every rendered frame while the local player is targeted
    // (Game.updatePlayerThreat): ETA label from the predicted G1 contact.
    // Strings are built once per distinct value and cached; the DOM is written
    // only when the shown value changes. (No reticle ring any more.)
    setThreatEta(contactMs) {
        if (typeof document === 'undefined') return;
        const direction = this._threatLabelDirection;
        if (!(direction >= 0)) return; // indicator not shown yet (first 20 Hz sample)
        const etaKey = threatEtaKey(contactMs / 1000);
        if (etaKey < 0 || etaKey === this._threatLabelKey) return;
        this._threatLabelKey = etaKey;
        const labels = this._threatEtaLabels ??= [];
        const index = direction * 2000 + etaKey;
        const label = labels[index] ??= `INCOMING ${formatThreatEta(contactMs / 1000)} · ${THREAT_DIRECTION_LABELS[direction]}`;
        const el = this._threatIndicator ??= document.getElementById('incoming-indicator');
        if (el) el.dataset.label = label;
    }

    // G4 OVERDRIVE: 1.2 s banner in the top-centre lane (once per rally —
    // Game._updateOverdrivePresentation decides), then the chip.
    showOverdriveBanner(max = false) {
        if (typeof document === 'undefined') return;
        const el = document.getElementById('overdrive-banner');
        if (!el) return;
        setText(el, max ? 'hud.overdriveMax' : 'hud.overdrive');
        el.dataset.max = String(max === true);
        el.classList.remove('hidden', 'show');
        void el.offsetWidth; // restart the entry animation
        el.classList.add('show');
        this._overdriveBannerShowing = true;
        this._syncOverdriveChip();
        clearTimeout(this._overdriveBannerTimer);
        this._overdriveBannerTimer = setTimeout(() => this._hideOverdriveBanner(), OVERDRIVE_BANNER_MS);
    }

    _hideOverdriveBanner() {
        clearTimeout(this._overdriveBannerTimer);
        this._overdriveBannerTimer = null;
        this._overdriveBannerShowing = false;
        const el = typeof document !== 'undefined' ? document.getElementById('overdrive-banner') : null;
        el?.classList.add('hidden');
        el?.classList.remove('show');
        this._syncOverdriveChip();
    }

    // Persistent "OVERDRIVE ×N.N" chip; ratio <= 0 removes chip and banner
    // (rally end / round change). Text is rebuilt only when N.N changes.
    setOverdrive(ratio) {
        const tenths = ratio > 0 ? Math.round(ratio * 10) : 0;
        if (!tenths && this._overdriveBannerShowing) this._hideOverdriveBanner();
        const max = tenths > 0 && ratio >= OVERDRIVE_MAX_RATIO;
        const key = tenths * 2 + (max ? 1 : 0);
        if (key === this._overdriveChipKey) return;
        this._overdriveChipKey = key;
        this._overdriveChipTenths = tenths;
        const chip = typeof document !== 'undefined' ? document.getElementById('overdrive-chip') : null;
        if (chip && tenths) {
            setText(chip, 'hud.overdriveChip', { x: `${Math.floor(tenths / 10)}.${tenths % 10}` });
            chip.dataset.max = String(max);
        }
        this._syncOverdriveChip();
    }

    _syncOverdriveChip() {
        const visible = this._overdriveChipTenths > 0 && !this._overdriveBannerShowing;
        // body.overdrive-on retires the match-start controls hint, whose
        // (usually faded) box shares the banner/chip slot under the score.
        const on = visible || this._overdriveBannerShowing === true;
        if (on !== this._overdriveOn && typeof document !== 'undefined') {
            this._overdriveOn = on;
            document.body?.classList.toggle('overdrive-on', on);
        }
        if (visible === this._overdriveChipVisible) return;
        this._overdriveChipVisible = visible;
        const chip = typeof document !== 'undefined' ? document.getElementById('overdrive-chip') : null;
        chip?.classList.toggle('hidden', !visible);
    }

    updateHotPotato(state) {
        const root = document.getElementById('hot-potato-hud');
        if (!root) return;
        const enabled = state?.enabled === true;
        root.classList.toggle('hidden', !enabled);
        if (!enabled) return;
        const time = document.getElementById('hot-potato-time');
        const holder = document.getElementById('hot-potato-holder');
        const remaining = Math.max(0, Number(state.remaining) || 0);
        const ratio = remaining / Math.max(1, Number(state.duration) || 5);
        root.dataset.urgency = ratio <= 0.25 ? 'critical' : ratio <= 0.55 ? 'danger' : 'armed';
        if (time) time.textContent = state.active ? remaining.toFixed(1) : '--';
        if (holder) {
            holder.textContent = state.active
                ? `${state.holderName || 'PLAYER'} - ${String(state.holderTeam || '').toUpperCase()}`
                : state.holderName
                    ? `${state.holderName} EXPLODED`
                    : 'WAITING FOR TARGET';
        }
    }

    // Team switch popup (M)
    showTeamPopup(game) {
        const overlay = document.getElementById('team-overlay');
        if (!overlay) return;
        this._openExclusive('teamPopup', () => this.hideTeamPopup());
        overlay.classList.remove('hidden');
        const classSwitcher = document.getElementById('class-switcher-template');
        const popup = overlay.querySelector('.team-popup');
        if (classSwitcher && popup) popup.insertBefore(classSwitcher, popup.querySelector('.team-popup-actions'));
        // Open on the side you are headed for: a late-join pick or a queued
        // next-round switch. Otherwise opening the menu means "switch", so the
        // other side is preselected and one Enter / click on Join confirms it.
        const current = game.player.team === 'blue' ? 'blue' : 'red';
        this.selectedTeam = game.player.pendingTeam || game.player.nextRoundTeam
            || (game.player.queuedForNextRound ? current : (current === 'red' ? 'blue' : 'red'));
        classSwitcher?.classList.remove('hidden');
        this._renderTeamLists(game);
        this._renderClassSwitch(game);
        // Keyboard users land on the selected side (Tab cycles inside).
        this._focusTeamDoor(this.selectedTeam);
    }

    hideTeamPopup() {
        const overlay = document.getElementById('team-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
            const active = typeof document !== 'undefined' ? document.activeElement : null;
            if (active && overlay.contains?.(active)) active.blur?.();
        }
        this._closeExclusive('teamPopup');
    }

    isTeamPopupOpen() {
        const overlay = document.getElementById('team-overlay');
        return !!overlay && !overlay.classList.contains('hidden');
    }

    _focusTeamDoor(team) {
        const door = document.getElementById?.(team === 'blue' ? 'team-header-blue' : 'team-header-red');
        try { door?.focus?.({ preventScroll: true }); } catch (_) {}
    }

    _renderTeamLists(game) {
        const redList = document.getElementById('team-list-red');
        const blueList = document.getElementById('team-list-blue');
        if (!redList || !blueList) return;
        const players = game.getPlayerList();
        const isHost = !game.network || !game.network.connected || game.network.isHost;
        const current = game.player.team === 'blue' ? 'blue' : 'red';
        const queued = !!game.player.queuedForNextRound;
        const pendingNext = queued ? null : (isTeamId(game.player.nextRoundTeam) ? game.player.nextRoundTeam : null);
        const mode = typeof game._teamSwitchModeNow === 'function' ? game._teamSwitchModeNow() : 'instant';
        redList.replaceChildren();
        blueList.replaceChildren();

        // Players are listed (and counted) on the side they will play for;
        // a queued switch carries a NEXT ROUND badge.
        const counts = teamCounts(players);
        players.forEach(p => {
            const side = effectiveTeam(p);
            const moving = !!p.queuedForNextRound || (isTeamId(p.nextRoundTeam) && p.nextRoundTeam !== p.team);
            const isYou = p.name === game.playerName;
            const li = document.createElement('li');
            li.className = 'team-chip';
            if (isYou) li.classList.add('you');
            if (moving) li.classList.add('next-round');
            const avatar = document.createElement('i');
            avatar.textContent = String(p.name || '?').slice(0, 1).toUpperCase();
            const name = document.createElement('span');
            name.textContent = p.name;
            li.append(avatar, name);
            const tags = [];
            if (isYou) tags.push(t('team.you'));
            else if (p.isBot) tags.push(t('team.bot'));
            if (moving) tags.push(t('team.nextRound'));
            if (tags.length) {
                const badge = document.createElement('small');
                badge.textContent = tags.join(' · ');
                li.append(badge);
            }
            li.title = isHost || isYou ? t('team.confirmedBelow') : '';
            (side === 'red' ? redList : blueList).appendChild(li);
        });

        const selectTeam = (team) => {
            this.selectedTeam = team;
            this._renderTeamLists(game);
        };
        const target = this.selectedTeam === 'blue' || this.selectedTeam === 'red' ? this.selectedTeam : (pendingNext || current);
        const other = target === 'red' ? 'blue' : 'red';
        for (const side of ['red', 'blue']) {
            const header = document.getElementById(`team-header-${side}`);
            const col = document.getElementById(`team-col-${side}`);
            header?.classList.toggle('selected', target === side);
            header?.setAttribute?.('aria-pressed', String(target === side));
            // First click picks a side; clicking the picked side again joins it.
            if (header) header.onclick = () => {
                const confirm = document.getElementById('btn-team-popup-confirm');
                if (target === side && confirm && !confirm.disabled) confirm.click();
                else selectTeam(side);
            };
            if (col) {
                col.classList.toggle('current', current === side && !queued);
                col.classList.toggle('next', (pendingNext || (queued ? game.player.pendingTeam : null)) === side);
                if (col.dataset) {
                    col.dataset.currentLabel = t('team.current');
                    col.dataset.nextLabel = t('team.nextRound');
                }
            }
            const node = document.getElementById(`team-count-${side}`);
            if (node) node.textContent = t('team.players', { count: counts[side] });
        }

        // Balance: counts once this pick applies. Solo/host bots fill in, so
        // say that instead of nagging about Auto-assign.
        const mine = pendingNext || (queued ? game.player.pendingTeam : null) || current;
        const after = { red: counts.red, blue: counts.blue };
        if (target !== mine) { after[target]++; after[mine] = Math.max(0, after[mine] - 1); }
        const stacked = after[target] - after[other] >= 2;
        const botCanMove = isHost && players.some(p => p.isBot && effectiveTeam(p) === target);
        const note = document.getElementById('team-balance-note');
        if (note) {
            note.hidden = !stacked;
            note.textContent = !stacked ? ''
                : botCanMove ? t('team.botBalance', { team: teamLabel(other) })
                    : t('team.stackedNote', { team: teamLabel(target), count: after[target] - after[other] });
        }
        const rule = document.getElementById('team-switch-rule');
        if (rule) {
            const text = pendingNext ? t('team.pendingNote', { team: teamLabel(pendingNext) })
                : mode === 'nextRound' && !queued ? t('team.nextRoundRule') : '';
            rule.hidden = !text;
            rule.textContent = text;
            rule.classList.toggle('pending', !!pendingNext);
        }
        const auto = document.getElementById('btn-team-popup-auto');
        if (auto) {
            auto.disabled = mode === 'blocked';
            auto.onclick = () => selectTeam(autoAssignTeam(players, game.playerName, current));
        }
        this._bindTeamPopupKeys(game);

        const confirm = document.getElementById('btn-team-popup-confirm');
        if (confirm) {
            let key = 'team.joinTeam';
            let disabled = false;
            if (mode === 'blocked' && !queued) {
                key = 'team.unavailable';
                disabled = true;
            } else if (queued) {
                key = 'team.joinNextRound';
                disabled = game.player.pendingTeam === target;
            } else if (mode === 'nextRound') {
                if (target === current) {
                    key = pendingNext ? 'team.stayOn' : 'team.alreadyOn';
                    disabled = !pendingNext;
                } else {
                    key = pendingNext === target ? 'team.queuedFor' : 'team.joinNextRound';
                    disabled = pendingNext === target;
                }
            } else if (target === current) {
                key = 'team.alreadyOn';
                disabled = true;
            }
            confirm.textContent = t(key, { team: teamLabel(target) });
            confirm.disabled = disabled;
            confirm.dataset.mode = mode;
            confirm.onclick = () => { if (!confirm.disabled) this.onTeamConfirm?.(target); };
        }

        const specBtn = document.getElementById('btn-team-popup-spectate');
        if (specBtn && this.onToggleSpectate) {
            setText(specBtn, queued
                ? 'team.waitingNextRound'
                : (this.spectating ? 'team.leaveSpectator' : 'common.spectate'));
            specBtn.disabled = queued;
            specBtn.onclick = () => { this.onToggleSpectate(); };
        }
    }

    // While the team popup is open it owns: 1 / 2 join red / blue in one press
    // (CS-style M → 1/2), ← / → only move the pick, Enter confirms, Space
    // presses the focused button, Tab cycles focus inside the dialog. main.js
    // leaves these keys alone while it is open.
    _bindTeamPopupKeys(game) {
        this._teamKeyGame = game;
        if (this._teamKeysBound || typeof document === 'undefined') return;
        this._teamKeysBound = true;
        document.addEventListener('keydown', event => {
            if (!this.isTeamPopupOpen()) return;
            if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            const pick = (team, join = false) => {
                if (event.repeat) return;
                this.selectedTeam = team;
                this._renderTeamLists(this._teamKeyGame);
                this._focusTeamDoor(team);
                const confirm = document.getElementById('btn-team-popup-confirm');
                if (join && confirm && !confirm.disabled) confirm.click();
            };
            if (event.code === 'Digit1' || event.code === 'Numpad1') pick('red', true);
            else if (event.code === 'Digit2' || event.code === 'Numpad2') pick('blue', true);
            else if (event.code === 'ArrowLeft') pick('red');
            else if (event.code === 'ArrowRight') pick('blue');
            else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
                const confirm = document.getElementById('btn-team-popup-confirm');
                if (!event.repeat && confirm && !confirm.disabled) confirm.click();
            } else if (event.code === 'Space') {
                const active = document.activeElement;
                if (!event.repeat && active?.closest?.('#team-overlay') && active.tagName === 'BUTTON' && !active.disabled) active.click();
            } else if (event.code === 'Tab') {
                const popup = document.querySelector('#team-overlay .team-popup');
                const focusable = [...(popup?.querySelectorAll('button:not([disabled])') || [])]
                    .filter(el => el.offsetParent !== null);
                if (focusable.length) {
                    const index = focusable.indexOf(document.activeElement);
                    const next = event.shiftKey
                        ? (index <= 0 ? focusable.length - 1 : index - 1)
                        : (index + 1) % focusable.length;
                    focusable[next].focus();
                }
            } else return;
            event.preventDefault();
            event.stopPropagation();
        }, true);
    }

    showGameOver(winner, stats, ffa = false) {
        this.showScreen('gameOver');
        const el = document.getElementById('winner-text');
        if (el) {
            el.textContent = winner === 'DRAW' ? t('gameOver.draw') : ffa ? t('gameOver.playerWins', { name: winner }) : t('gameOver.teamWins', { team: teamLabel(winner) });
            el.className = `winner-${winner.toLowerCase()}`;
        }
        this.updateScoreboard(stats, ffa);
        this.updateScoreboardTable('scoreboard-body-final', stats, ffa);
        const heading = document.querySelector('#game-over .scoreboard-table th:nth-child(2)');
        if (heading) heading.textContent = ffa ? t('mp.mode') : t('common.team');
    }

    showCountdown(num, callback, token = ++this._countdownToken) {
        const el = document.getElementById('countdown');
        if (!el) return;
        el.classList.remove('hidden');
        el.textContent = num;
        el.classList.add('countdown-anim');
        setTimeout(() => {
            if (token !== this._countdownToken) return;
            el.classList.remove('countdown-anim');
            if (num > 1) {
                this.showCountdown(num - 1, callback, token);
            } else {
                // Gameplay starts on GO; the short visual hold remains presentation-only.
                if (callback) callback();
                this.showCountdownGo(token);
            }
        }, 1000);
    }

    showCountdownGo(token = ++this._countdownToken) {
        const el = document.getElementById('countdown');
        if (!el || token !== this._countdownToken) return;
        el.classList.remove('hidden', 'countdown-anim');
        el.textContent = 'GO!';
        setTimeout(() => {
            if (token === this._countdownToken) el.classList.add('hidden');
        }, 500);
    }

    cancelCountdown() {
        this._countdownToken = (this._countdownToken || 0) + 1;
        document.getElementById('countdown')?.classList.add('hidden');
    }

    showRoundBanner(round, redScore, blueScore) {
        const el = document.getElementById('round-banner');
        if (!el) return;
        el.querySelector('.round-number').textContent = round;
        el.querySelector('.round-teams').textContent = t('hud.roundTeams', { red: redScore, blue: blueScore });
        el.classList.remove('hidden', 'show');
        void el.offsetWidth; // force reflow
        el.classList.add('show');
        setTimeout(() => el.classList.add('hidden'), 2500);
    }

    // `cover` (boolean): this match's rolled in-court props — host/solo pass
    // arena.propsEnabled, clients the value adopted from the snapshot's `props`.
    showMatchIntro(mapName, modeName, { cover } = {}) {
        this.showCoverChip(cover);
        const el = document.getElementById('match-intro');
        if (!el) return;
        const mapEl = document.getElementById('mi-map-name');
        const modeEl = document.getElementById('mi-mode-name');
        if (mapEl) mapEl.textContent = mapName;
        // This card is only shown while the non-lethal countdown ball is active.
        // Name that state explicitly so a targeted warmup ball is never read as a
        // live round threat.
        if (modeEl) modeEl.textContent = `WARMUP · ${modeName || 'Classic'}`;
        el.classList.remove('hidden');
        el.style.animation = 'none';
        void el.offsetHeight;
        el.style.animation = '';
    }
    // "COVER ON" / "OPEN COURT" chip for the countdown. Its own element and
    // timer: the intro pill hides after 1.5 s, the chip stays COVER_CHIP_VISIBLE_MS.
    showCoverChip(cover) {
        if (typeof cover !== 'boolean' || typeof document === 'undefined') return;
        let chip = document.getElementById('match-cover-chip');
        if (!chip && document.body && typeof document.createElement === 'function') {
            chip = document.createElement('div');
            chip.id = 'match-cover-chip';
            chip.setAttribute?.('role', 'status');
            chip.setAttribute?.('aria-live', 'polite');
            document.body.appendChild(chip);
        }
        if (!chip) return;
        setText(chip, cover ? 'match.coverOn' : 'match.coverOff');
        if (chip.dataset) chip.dataset.cover = cover ? 'on' : 'off';
        chip.classList.remove('hidden');
        clearTimeout(this._coverChipTimer);
        this._coverChipTimer = setTimeout(() => chip.classList.add('hidden'), COVER_CHIP_VISIBLE_MS);
    }
    scheduleMatchIntroHide(durationMs) {
        clearTimeout(this._matchIntroHideTimer);
        this._matchIntroHideTimer = setTimeout(() => this.hideMatchIntro(), durationMs);
    }
    hideMatchIntro() {
        clearTimeout(this._matchIntroHideTimer);
        this._matchIntroHideTimer = null;
        const el = document.getElementById('match-intro');
        if (el) el.classList.add('hidden');
    }

    showMessage(text, duration = 2000, { priority = 0, tone = '' } = {}) {
        const el = document.getElementById('game-message');
        if (!el) return false;
        const safeDuration = Math.max(0, Number(duration) || 0);
        const safePriority = Math.max(0, Number(priority) || 0);
        const now = performance.now();
        // A lower-priority generic event must never erase an active perfect
        // confirmation. The token also prevents an older timeout hiding a newer
        // toast during a fast rally.
        if (this._messageUntil > now && safePriority < (this._messagePriority || 0)) return false;
        clearTimeout(this._messageTimer);
        const token = (this._messageToken || 0) + 1;
        this._messageToken = token;
        this._messagePriority = safePriority;
        this._messageUntil = now + safeDuration;
        el.textContent = text;
        el.classList.remove('deflect-normal', 'deflect-great', 'deflect-perfect', 'kill-confirm');
        if (tone === 'deflect-normal' || tone === 'deflect-great' || tone === 'deflect-perfect' || tone === 'kill-confirm') {
            el.classList.add(tone);
        }
        // Fixed position — no random placement
        el.classList.remove('hidden');
        el.classList.add('message-anim');
        void el.offsetWidth;
        this._messageTimer = setTimeout(() => {
            if (token !== this._messageToken) return;
            el.classList.add('hidden');
            el.classList.remove('message-anim');
            el.classList.remove('deflect-normal', 'deflect-great', 'deflect-perfect', 'kill-confirm');
            this._messagePriority = 0;
            this._messageUntil = 0;
            this._messageTimer = null;
        }, safeDuration);
        return true;
    }

    hideMessage() {
        clearTimeout(this._messageTimer);
        this._messageTimer = null;
        this._messageToken = (this._messageToken || 0) + 1;
        this._messagePriority = 0;
        this._messageUntil = 0;
        const el = document.getElementById('game-message');
        if (!el) return false;
        el.classList.add('hidden');
        el.classList.remove('message-anim', 'deflect-normal', 'deflect-great', 'deflect-perfect');
        return true;
    }

    showPostGame(won, xpGained, level, kills, deflects, audio, result = {}, store = Store) {
        const el = document.getElementById('post-game-screen');
        if (!el) return;
        this.setPostGameTab?.('summary');
        this.hideHUD?.();
        this.hideMessage?.();
        el.classList.remove('hidden');
        el.dataset.outcome = won ? 'win' : 'loss';
        audio?.playCue?.('score');
        const resultEl = document.getElementById('pg-result');
        setText(resultEl, won ? 'pg.victory' : 'pg.defeat');
        // Win/loss is carried on the banner itself so the result reads at a glance
        // instead of every match ending in the same gold title.
        resultEl.classList.toggle('pg-result-win', !!won);
        resultEl.classList.toggle('pg-result-loss', !won);
        const winnerEl = document.getElementById('pg-winner');
        if (winnerEl) winnerEl.textContent = result.winnerText || '';
        // Prestige-aware rank so the progression a player is chasing is the thing
        // the match report leads with. Falls back to the passed-in level for any
        // store shape predating getAccount().
        const liveAccount = typeof store?.getAccount === 'function'
            ? store.getAccount()
            : { level, xp: 0, prestige: 0 };
        // js/main.js snapshots the account BEFORE store.grant() and passes it as
        // result.prevAccount; without it the report would open on the post-grant
        // level and a crossed level could never read as a level-up.
        const prev = result.prevAccount && Number.isFinite(Number(result.prevAccount.level))
            ? result.prevAccount
            : null;
        const account = prev
            ? { level: Number(prev.level), xp: Number(prev.xp) || 0, prestige: Number(prev.prestige) || 0 }
            : liveAccount;
        document.getElementById('pg-level').textContent = accountRankLabel(account);
        this._paintPrestigeBadge('pg-prestige', account.prestige);
        // Snapshot so setPostGameRewardReceipt() can tell a real level-up (this
        // match's grant crossing a level) from just re-rendering the same rank.
        this._postGameStartLevel = account.level;
        this._postGameStartPrestige = account.prestige || 0;
        document.getElementById('pg-xp-fill')?.classList.remove('pg-xp-levelup');
        this._hideLevelStamp();
        this._renderPersonalStrip(result.personal);
        this.setPostGameDailyNudge(result.matchId, null);
        // Detailed AAR stats table
        const playerStats = result.playerStats || [];
        const statsHTML = this._buildAARTable(playerStats, kills, deflects);
        document.getElementById('postgame-stats').innerHTML = statsHTML;
        // MVP card + 3D showcase. The showcase's knife/gloves/ball ids arrive
        // from a live game-entity lookup (js/main.js#onMatchComplete hook,
        // js/mvp-select.js#resolveMvpLoadout) that always runs before this
        // paint, keyed by matchId so a stale stash from a different match can
        // never attach to this report.
        const mvpShowcase = this._pendingMvpShowcase?.matchId === result.matchId
            ? this._pendingMvpShowcase.loadout
            : null;
        this._pendingMvpShowcase = null;
        this._renderMvpCard(playerStats, mvpShowcase);
        const pgLog = document.getElementById('pg-chat-log');
        if (pgLog) pgLog.innerHTML = '';
        const detailDisclosure = document.getElementById('pg-detail-disclosure');
        if (detailDisclosure) detailDisclosure.open = false;
        // The bar tracks progress toward the next level, not an arbitrary
        // xpGained/1000 slice, so "how close am I" is answerable at a glance.
        // That proximity is the actual one-more-match hook.
        this._postGameRewardMatchId = typeof result.matchId === 'string' ? result.matchId : null;
        this._postGameRewardSettledMatchId = null;
        const pending = result.rewardsPending === true;
        const progress = levelProgress(account);
        const perc = Math.round(progress.ratio * 100);
        const gainPerc = Math.min(100, (xpGained / 1000) * 100);
        const xpFill = document.getElementById('pg-xp-fill');
        const xpText = document.getElementById('pg-xp-text');
        if (xpFill) { xpFill.style.width = '0%'; requestAnimationFrame(() => { xpFill.style.width = perc + '%'; }); }
        if (xpText && pending) {
            xpText.textContent = t('pg.rewardsSettling');
        } else if (xpText) {
            const tail = progress.need > 0
                ? ` · ${t('pg.toLevel', { xp: progress.xp, need: progress.need, level: progress.level + 1 })}`
                : ` · ${t('pg.maxRank')}`;
            this._animateCount(xpText, xpGained, value => `+${value} XP${tail}`);
        }
        if (pending) {
            const battlepass = document.getElementById('pg-bp-progress');
            const nextReward = document.getElementById('pg-reward-card');
            if (battlepass) battlepass.style.display = 'none';
            if (nextReward) nextReward.style.display = 'none';
            this._lastMatchReward = null;
            this._renderMatchRewardBreakdown();
            this._renderRewardFlow(0, [], { pending: true });
        } else {
            this._renderPostGameBattlepass(store);
            this._renderPostGameRewardCard(store);
            this._renderMatchRewardBreakdown();
            this._renderRewardFlow(xpGained, result.xpSources);
        }
        this.renderMatchAnalysis(result.analytics);
        this._renderRoundStrip(result.roundHistory);
        // Ding count stays tied to the XP earned, so a big match still sounds big.
        const dings = Math.min(10, Math.ceil(gainPerc / 10));
        let delay = 0;
        for (let i = 0; i < dings; i++) {
            setTimeout(() => {
                if (audio?.playDing) audio.playDing(660 + i * 40, 0.16);
            }, delay);
            delay += 150;
        }
        const playAgain = document.getElementById('pg-play-again');
        const lobby = document.getElementById('pg-lobby');
        const mainMenu = document.getElementById('pg-main-menu');
        if (playAgain) playAgain.onclick = () => window._postGameAction?.('play_again');
        const nextMap = document.getElementById('pg-next-map');
        if (nextMap) nextMap.onclick = () => window._postGameAction?.('next_map');
        if (lobby) lobby.onclick = () => {
            el.classList.add('hidden');
            window._postGameAction?.('lobby');
        };
        if (mainMenu) mainMenu.onclick = () => {
            el.classList.add('hidden');
            window._postGameAction?.('main_menu');
        };
        // Guest save banner: same conversion nudge as the (unused) legacy
        // #game-over-screen, css/auth.css already shows/hides it via
        // body.is-guest so this is only the click wire-up.
        const guestSave = document.getElementById('pg-btn-guest-save');
        if (guestSave) guestSave.onclick = () => window._postGameAction?.('create_account');
        playAgain?.focus?.({ preventScroll: true });
    }

    // Post-match "next reward" hook (NEXT_SESSION_PLAN.md #4.5): honest battlepass
    // progress after the match XP already granted by Store.grant() lands, so this
    // always reflects the real post-match state — never a fabricated or optimistic
    // number. Free-track reward only (premium is a purchase, not something to dangle
    // here). No-ops quietly if the battlepass API or DOM nodes aren't present.
    _renderPostGameBattlepass(store) {
        const wrap = document.getElementById('pg-bp-progress');
        if (!wrap || typeof store?.getBattlepassProgress !== 'function') return;
        const tierEl = document.getElementById('pg-bp-tier');
        const nextEl = document.getElementById('pg-bp-next');
        const fillEl = document.getElementById('pg-bp-bar-fill');
        const xpTextEl = document.getElementById('pg-bp-xp-text');
        const bp = store.getBattlepassProgress();
        const tier = Number(bp?.tier) || 0;
        if (tierEl) tierEl.textContent = String(tier);
        const xpNeeded = Number(store.getBattlepassXpForNextTier?.()) || 0;
        const maxed = tier >= 50 || xpNeeded <= 0;
        wrap.classList.toggle('maxed', maxed);
        if (maxed) {
            if (nextEl) nextEl.textContent = 'Max tier reached';
            if (fillEl) fillEl.style.width = '100%';
            if (xpTextEl) xpTextEl.textContent = '';
            return;
        }
        const xp = Math.max(0, Number(bp?.xp) || 0);
        const { free } = store.getBattlepassRewards?.() || {};
        const nextReward = Array.isArray(free) ? free.find(r => r.tier > tier) : null;
        if (nextEl) nextEl.textContent = nextReward ? `Next: ${nextReward.name}` : `Tier ${tier + 1}`;
        const pct = Math.max(0, Math.min(100, Math.round((xp / xpNeeded) * 100)));
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (xpTextEl) xpTextEl.textContent = `${xp} / ${xpNeeded} XP to Tier ${tier + 1}`;
    }

    // Post-match next reward preview. Shows tier, cosmetic name, and ETA (matches to unlock).
    // Uses existing battlepass reward data from store to find the next tier's reward.
    _renderPostGameRewardCard(store) {
        const wrap = document.getElementById('pg-reward-card');
        if (!wrap || typeof store?.getBattlepassProgress !== 'function') return;
        const bp = store.getBattlepassProgress();
        const tier = Number(bp?.tier) || 0;
        // Don't show reward card at max tier
        if (tier >= 50) {
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = '';
        const { free } = store.getBattlepassRewards?.() || {};
        const nextReward = Array.isArray(free) ? free.find(r => r.tier > tier) : null;
        if (!nextReward) {
            wrap.style.display = 'none';
            return;
        }
        const tierEl = document.getElementById('pg-reward-tier');
        const nameEl = document.getElementById('pg-reward-name');
        const etaEl = document.getElementById('pg-reward-eta');
        this._paintRewardKindIcon(wrap, nextReward.kind);
        if (tierEl) tierEl.textContent = `TIER ${nextReward.tier}`;
        if (nameEl) nameEl.textContent = nextReward.name || 'Mystery Reward';
        // Calculate matches to unlock: estimate 150 XP per match
        const xpNeeded = Number(store.getBattlepassXpForNextTier?.()) || 0;
        const matchesEta = Math.ceil(xpNeeded / 150);
        if (etaEl) etaEl.textContent = matchesEta === 1 ? '1 match to unlock' : `${matchesEta} matches to unlock`;
        // Apply rarity styling if available
        const rarity = nextReward.rarity || 'common';
        wrap.className = `pg-reward-card rarity-${rarity}`;
    }

    // Icon for the "next battlepass reward" teaser, keyed off the reward's own
    // kind (js/battlepass.js FREE_TRACK). Reuses ids from the sprite already in
    // index.html — no new asset, no emoji stand-in.
    _paintRewardKindIcon(wrap, kind) {
        if (!wrap || typeof document.createElementNS !== 'function') return;
        const ICONS = { currency: '#i-coins', ball: '#i-ball', xpboost: '#i-trophy', cosmetic: '#i-ticket' };
        const href = ICONS[kind] || '#i-trophy';
        let icon = wrap.querySelector('.pg-reward-icon');
        if (!icon) {
            icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('class', 'ui-icon pg-reward-icon');
            icon.setAttribute('aria-hidden', 'true');
            icon.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'use'));
            wrap.insertBefore(icon, wrap.firstChild);
        }
        icon.firstChild?.setAttribute('href', href);
    }

    // Coin breakdown for the match just played — base result payout + capped
    // performance bonus. Reads what awardMatchRewards() actually granted
    // (js/main.js#awardMatchRewards sets ui._lastMatchReward before the local
    // grant fires), so it never shows a fabricated number. No-ops quietly
    // outside a real match (practice mode never sets it).
    _renderMatchRewardBreakdown() {
        const wrap = document.getElementById('pg-coin-breakdown');
        if (!wrap) return;
        const reward = this._lastMatchReward;
        if (!reward) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        // buildRewardSummary() drops zero rows, so "First match of day" — a real
        // field of matchRewardBreakdown() that index.html never had a row for —
        // shows up exactly on the days it was actually paid.
        const { coinRows, coinTotal } = buildRewardSummary({ coins: reward });
        const rowValue = label => coinRows.find(row => row.label === label)?.value || 0;
        const baseEl = document.getElementById('pgcb-base');
        const bonusRow = document.getElementById('pgcb-bonus-row');
        const bonusEl = document.getElementById('pgcb-bonus');
        const totalEl = document.getElementById('pgcb-total');
        if (baseEl) baseEl.textContent = `+${reward.base}`;
        if (bonusRow) bonusRow.style.display = reward.bonus > 0 ? '' : 'none';
        if (bonusEl) bonusEl.textContent = `+${reward.bonus}`;
        const firstOfDay = rowValue('First match of day');
        let firstRow = document.getElementById('pgcb-firstday-row');
        if (!firstRow && firstOfDay > 0 && bonusRow?.parentNode) {
            firstRow = document.createElement('div');
            firstRow.id = 'pgcb-firstday-row';
            firstRow.className = 'pgcb-row';
            const label = document.createElement('span');
            label.textContent = 'First match of day';
            const value = document.createElement('span');
            value.id = 'pgcb-firstday';
            firstRow.append(label, value);
            bonusRow.parentNode.insertBefore(firstRow, bonusRow.nextSibling);
        }
        if (firstRow) {
            firstRow.style.display = firstOfDay > 0 ? '' : 'none';
            const valueEl = document.getElementById('pgcb-firstday');
            if (valueEl) valueEl.textContent = `+${firstOfDay}`;
        }
        this._animateCount(totalEl, coinTotal, value => `+${value}`);
        this._lastMatchReward = null;
    }

    // Report tabs: Summary (result, MVP, Play of the Game), Rewards (XP, battle
    // pass, coins, drops) and Details (stats, rounds, chat). The header and the
    // Rematch hero stay on every tab; CSS hides the other panes (data-pg-pane).
    setPostGameTab(tab = 'summary') {
        const screen = document.getElementById('post-game-screen');
        if (!screen) return false;
        const name = ['summary', 'rewards', 'details'].includes(tab) ? tab : 'summary';
        if (!this._postGameTabsBound) {
            this._postGameTabsBound = true;
            screen.addEventListener('click', event => {
                const button = event.target.closest?.('[data-pg-tab-btn]');
                if (button) this.setPostGameTab(button.dataset.pgTabBtn);
            });
        }
        screen.dataset.pgTab = name;
        screen.querySelectorAll('[data-pg-tab-btn]').forEach(button => {
            const selected = button.dataset.pgTabBtn === name;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        if (name === 'rewards') this._markPostGameRewards?.(false);
        if (name === 'details') {
            const details = document.getElementById('pg-detail-disclosure');
            if (details) details.open = true;
        }
        return true;
    }

    // A dot on the Rewards tab while something new landed there unseen.
    _markPostGameRewards(fresh = true) {
        const screen = document.getElementById('post-game-screen');
        const dot = screen?.querySelector('[data-pg-tab-btn="rewards"] .pg-tab-dot');
        if (!dot) return;
        dot.hidden = !(fresh && screen.dataset.pgTab !== 'rewards');
    }

    // Play of the Game card on the report: who, what (tags), and a Watch button
    // when the replay can be played here (solo). null hides it.
    setPlayOfTheGame(play, { canWatch = false, canShare = false } = {}) {
        const card = document.getElementById('pg-potg');
        if (!card) return false;
        if (!play) {
            card.hidden = true;
            return false;
        }
        const name = document.getElementById('pg-potg-name');
        const tags = document.getElementById('pg-potg-tags');
        const watch = document.getElementById('btn-pg-potg-watch');
        if (name) name.textContent = play.player || t('potg.rallyOnly');
        if (tags) {
            tags.replaceChildren();
            for (const label of playTags(play, t)) {
                const chip = document.createElement('span');
                chip.className = 'pg-potg-tag';
                chip.textContent = label;
                tags.append(chip);
            }
        }
        if (watch) watch.hidden = !canWatch;
        const share = document.getElementById('btn-pg-potg-share');
        if (share) share.hidden = !canShare;
        card.hidden = false;
        return true;
    }

    clearPostGameMatchDrops() {
        this._markPostGameRewards?.(false);
        this._postGameDropMatchId = null;
        this._postGameRewardMatchId = null;
        this._postGameRewardSettledMatchId = null;
        const wrap = document.getElementById('pg-match-drop');
        const list = document.getElementById('pg-match-drop-list');
        if (list) list.replaceChildren();
        if (wrap) wrap.hidden = true;
    }

    // Only match-owned, already-granted rewards can enter this component. The
    // match id makes a late completion receipt harmless after a rematch starts.
    setPostGameMatchDrops(matchId, drops = []) {
        if (typeof matchId !== 'string' || !matchId) return false;
        if (this._postGameDropMatchId && this._postGameDropMatchId !== matchId) return false;
        const wrap = document.getElementById('pg-match-drop');
        const list = document.getElementById('pg-match-drop-list');
        if (!wrap || !list) return false;
        const safeDrops = Array.isArray(drops) ? drops.filter(drop => (
            drop && (drop.type === 'case' || drop.type === 'card')
                && typeof drop.id === 'string' && typeof drop.name === 'string'
        )).slice(0, 2) : [];
        this._postGameDropMatchId = matchId;
        list.replaceChildren();
        wrap.hidden = safeDrops.length === 0;
        for (const drop of safeDrops) {
            const item = document.createElement('article');
            item.className = `pg-match-drop-item rarity-${drop.rarity || 'common'}`;
            const copy = document.createElement('div');
            copy.className = 'pg-match-drop-copy';
            const caseArt = drop.type === 'case' ? CASES[drop.id]?.art : null;
            let visual;
            if (caseArt) {
                visual = document.createElement('img');
                visual.src = caseArt;
                visual.alt = '';
                visual.width = 80;
                visual.height = 80;
                visual.decoding = 'async';
                visual.className = 'pg-match-drop-visual pg-match-drop-art';
            } else {
                visual = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                visual.setAttribute('class', 'ui-icon pg-match-drop-visual');
                visual.setAttribute('aria-hidden', 'true');
                const visualUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                visualUse.setAttribute('href', drop.type === 'case' ? '#i-ticket' : '#i-ball');
                visual.appendChild(visualUse);
            }
            const meta = document.createElement('div');
            meta.className = 'pg-match-drop-meta';
            const rarity = document.createElement('span');
            rarity.className = `skin-rarity rarity-${drop.rarity || 'common'}`;
            rarity.textContent = String(drop.rarity || 'earned').toUpperCase();
            const name = document.createElement('strong');
            name.textContent = drop.name;
            const type = document.createElement('small');
            type.textContent = drop.type === 'case' ? 'Cosmetic case' : 'Arena card';
            meta.append(rarity, name, type);
            copy.append(visual, meta);
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'btn btn-secondary';
            action.textContent = drop.type === 'case' ? 'View Cases' : 'View Cards';
            action.addEventListener('click', () => window._postGameDropAction?.({ type: drop.type, id: drop.id }));
            item.append(copy, action);
            list.append(item);
        }
        if (safeDrops.length) {
            this._markPostGameRewards?.(true);
            // The drop lands below Rematch; bring it into view with a short pop.
            wrap.classList.remove('is-fresh');
            void wrap.offsetWidth;
            wrap.classList.add('is-fresh');
            const reduce = document.body.classList.contains('reduced-motion')
                || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
            wrap.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
        }
        return safeDrops.length > 0;
    }

    // A terminal report is visible immediately, while the values underneath it
    // wait for this player's settled receipt. The match id blocks a late receipt
    // from repainting a rematch or applying the same settlement twice.
    setPostGameRewardReceipt(matchId, receipt = {}, store = Store) {
        const screen = document.getElementById('post-game-screen');
        if (!screen || screen.classList.contains('hidden') || this._postGameRewardMatchId !== matchId || this._postGameRewardSettledMatchId === matchId) return false;
        this._postGameRewardSettledMatchId = matchId;
        const xp = Math.max(0, Math.floor(Number(receipt.xp) || 0));
        const account = typeof store?.getAccount === 'function' ? store.getAccount() : { level: 1, xp: 0, prestige: 0 };
        const progress = levelProgress(account);
        const xpText = document.getElementById('pg-xp-text');
        if (xpText) {
            const tail = progress.need > 0 ? ` · ${progress.xp}/${progress.need} to Lv ${progress.level + 1}` : ' · MAX RANK';
            this._animateCount(xpText, xp, value => `+${value} XP${tail}`);
        }
        // The initial showPostGame() paint only knew the pre-grant account (rewards
        // were still pending), so the level label and prestige badge are refreshed
        // here against the account this match's XP actually landed on. Comparing to
        // the snapshot taken at that first paint is what "a real level-up happened"
        // means — the receipt itself carries no such flag for the server-authoritative
        // path (js/store.js#_matchRemoteCompletion never returns one).
        const leveledUp = account.level > (this._postGameStartLevel ?? account.level)
            || (account.prestige || 0) > (this._postGameStartPrestige ?? (account.prestige || 0));
        document.getElementById('pg-level').textContent = accountRankLabel(account);
        this._paintPrestigeBadge('pg-prestige', account.prestige);
        // Level-up moment: the bar rolls over first, then the LEVEL N stamp lands.
        this._paintXpBarFill(progress, { leveledUp, onRolled: () => this._showLevelStamp(account) });
        this._lastMatchReward = receipt.coins && typeof receipt.coins === 'object' ? receipt.coins : null;
        this._renderMatchRewardBreakdown();
        const battlepass = document.getElementById('pg-bp-progress');
        if (battlepass) battlepass.style.display = '';
        this._renderPostGameBattlepass(store);
        this._renderPostGameRewardCard(store);
        this._renderRewardFlow(xp, receipt.xpSources, { dailies: receipt.dailies, battlepassXp: receipt.battlepassXp });
        return true;
    }

    setPostGameRewardRetry(matchId, onRetry, { exhausted = false } = {}) {
        if (this._postGameRewardMatchId !== matchId || this._postGameRewardSettledMatchId === matchId) return false;
        const status = document.querySelector('#pg-reward-flow .pg-reward-pending');
        if (!status) return false;
        status.replaceChildren();
        const copy = document.createElement('span');
        copy.textContent = exhausted ? 'Rewards are still settling.' : 'Rewards settling…';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-secondary pg-reward-retry';
        retry.textContent = 'Retry rewards';
        retry.setAttribute('aria-label', 'Retry loading your match rewards');
        retry.addEventListener('click', async () => {
            retry.disabled = true;
            await onRetry?.();
            if (this._postGameRewardSettledMatchId !== matchId) retry.disabled = false;
        });
        status.append(copy, retry);
        return true;
    }

    // Count-up used by every earned-number on the post-match screen. Plain rAF,
    // no library, one handle per element so a re-render cancels its predecessor
    // instead of leaving two loops fighting over the same node. Reduced motion
    // (and any non-positive delta) sets the final value immediately.
    _animateCount(el, to, format = value => String(value), from = 0) {
        if (!el) return;
        const target = Math.max(0, Math.round(Number(to) || 0));
        if (el._countRaf) { cancelAnimationFrame(el._countRaf); el._countRaf = 0; }
        if (target <= from || this._isReducedMotion()) { el.textContent = format(target); return; }
        const duration = Math.min(900, 260 + target * 1.2);
        const startedAt = performance.now();
        const step = now => {
            const t = Math.min(1, (now - startedAt) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = format(from + Math.round((target - from) * eased));
            el._countRaf = t < 1 ? requestAnimationFrame(step) : 0;
        };
        el.textContent = format(from);
        el._countRaf = requestAnimationFrame(step);
    }

    // XP bar fill for the settled receipt (js/ui.js#setPostGameRewardReceipt). A plain
    // level-up just eases to the new percentage. A real level-up instead fills to 100%,
    // flashes (css/postgame.css .pg-xp-levelup), then snaps back to 0 and eases up to
    // the new level's progress — one continuous "rolled over" motion instead of the
    // number quietly going backwards. Reduced motion always sets the final value with
    // no transition (css/postgame.css disables the CSS transition/animation too).
    _paintXpBarFill(progress, { leveledUp = false, onRolled = null } = {}) {
        const fill = document.getElementById('pg-xp-fill');
        if (!fill) {
            if (leveledUp) onRolled?.();
            return;
        }
        const perc = Math.max(0, Math.min(100, Math.round((progress?.ratio || 0) * 100)));
        fill.classList.remove('pg-xp-levelup');
        if (!leveledUp || this._isReducedMotion()) {
            fill.style.width = perc + '%';
            if (leveledUp) onRolled?.();
            return;
        }
        fill.style.width = '100%';
        fill.classList.add('pg-xp-levelup');
        let rolled = false;
        const rollover = () => {
            if (rolled) return;
            rolled = true;
            fill.removeEventListener('transitionend', onFull);
            clearTimeout(safety);
            fill.style.transition = 'none';
            fill.style.width = '0%';
            void fill.offsetWidth; // force reflow so the next width change transitions again
            fill.style.transition = '';
            // Synchronous, not rAF: a backgrounded tab can throttle animation
            // frames indefinitely, which would otherwise strand the bar at 0%.
            fill.style.width = perc + '%';
            onRolled?.();
        };
        const onFull = event => { if (event.target === fill && event.propertyName === 'width') rollover(); };
        fill.addEventListener('transitionend', onFull);
        // Safety net: a hidden tab, a zero-duration user stylesheet, or the panel
        // closing mid-flash can all suppress transitionend. Without this the bar
        // would stay pinned at 100% forever instead of settling on the real value.
        const safety = setTimeout(rollover, 1700);
    }

    // "LEVEL N" stamp over the report's rank line, shown once the XP bar has
    // rolled over. Visible for LEVEL_STAMP_VISIBLE_MS (>= 1.5 s); reduced motion
    // keeps the same dwell with no scale animation (css/postgame.css).
    _showLevelStamp(account) {
        const stamp = document.getElementById('pg-levelup-stamp');
        if (!stamp) return false;
        const level = Math.max(1, Math.floor(Number(account?.level) || 1));
        stamp.textContent = t('postgame.levelStamp', { level });
        clearTimeout(this._levelStampTimer);
        stamp.classList.remove('is-stamping');
        stamp.hidden = false;
        void stamp.offsetWidth; // restart the stamp animation on a repeat level-up
        stamp.classList.add('is-stamping');
        stamp.closest?.('.pg-level')?.classList.add('pg-level-up');
        this._levelStampShownAt = performance.now();
        this._levelStampTimer = setTimeout(() => this._hideLevelStamp(), LEVEL_STAMP_VISIBLE_MS);
        return true;
    }

    _hideLevelStamp() {
        clearTimeout(this._levelStampTimer);
        this._levelStampTimer = null;
        const stamp = document.getElementById('pg-levelup-stamp');
        if (!stamp) return;
        stamp.hidden = true;
        stamp.classList.remove('is-stamping');
        stamp.closest?.('.pg-level')?.classList.remove('pg-level-up');
    }

    // Personal strip above the fold: this player's match numbers against their
    // stored records (js/store.js#recordPersonalBests). A beaten record reads
    // NEW BEST; otherwise the standing record is shown for context.
    _renderPersonalStrip(personal) {
        const wrap = document.getElementById('pg-personal');
        if (!wrap) return;
        const stats = personal?.stats;
        wrap.hidden = !stats;
        if (!stats) return;
        const previous = personal.previous || {};
        const beaten = personal.beaten || {};
        const format = (key, value) => key === 'topSpeed'
            ? `${(Number(value) || 0).toFixed(1)}×`
            : String(Math.max(0, Math.floor(Number(value) || 0)));
        wrap.querySelectorAll('[data-stat]').forEach(cell => {
            const key = cell.dataset.stat;
            const value = cell.querySelector('.pg-personal-value');
            const best = cell.querySelector('.pg-personal-best');
            if (value) value.textContent = format(key, stats[key]);
            const isNew = beaten[key] === true;
            cell.classList.toggle('is-new-best', isNew);
            if (best) {
                best.textContent = isNew
                    ? t('postgame.newBest')
                    : (Number(previous[key]) || 0) > 0 ? t('postgame.best', { value: format(key, previous[key]) }) : '';
            }
        });
    }

    // One report line for the nearest incomplete daily at >= 50% (js/daily.js
    // nearestDailyNudge). A null nudge hides it; a stale match id is ignored.
    setPostGameDailyNudge(matchId, nudge) {
        const line = document.getElementById('pg-daily-nudge');
        if (!line) return false;
        if (!nudge) {
            line.hidden = true;
            line.textContent = '';
            return false;
        }
        if (typeof matchId !== 'string' || matchId !== this._postGameRewardMatchId) return false;
        const count = Math.max(1, Math.floor(Number(nudge.remaining) || 1));
        const unitKey = DAILY_NUDGE_UNITS[nudge.type] || 'steps';
        line.textContent = t('postgame.dailyNudge', {
            count,
            unit: t(`postgame.units.${unitKey}`, { count }),
            name: nudge.name
        });
        line.hidden = false;
        return true;
    }

    // Post-match toasts: sequential, each on screen >= TOAST_QUEUE_MIN_MS, at
    // most TOAST_QUEUE_MAX in flight (overflow is dropped, never interleaved).
    // Uses the shared #game-message surface at a priority generic messages
    // cannot overwrite, so a level-up no longer disappears under the next toast.
    queueToast(text, duration = 2000) {
        const message = String(text ?? '').trim();
        if (!message) return false;
        this._toastQueue ||= [];
        if (this._toastQueue.length + (this._toastActive ? 1 : 0) >= TOAST_QUEUE_MAX) return false;
        this._toastQueue.push({ text: message, duration: Math.max(TOAST_QUEUE_MIN_MS, Number(duration) || 0) });
        if (!this._toastActive) this._pumpToastQueue();
        return true;
    }

    _pumpToastQueue() {
        const next = this._toastQueue?.shift();
        if (!next) {
            this._toastActive = false;
            this._toastTimer = null;
            return;
        }
        this._toastActive = true;
        this.showMessage(next.text, next.duration, { priority: TOAST_QUEUE_PRIORITY });
        this._toastTimer = setTimeout(() => this._pumpToastQueue(), next.duration);
    }

    clearToastQueue() {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
        this._toastQueue = [];
        if (this._toastActive) this.hideMessage();
        this._toastActive = false;
    }

    // Animated XP-source + daily-challenge breakdown. index.html is owned
    // elsewhere, so the container is built here on first use and reused after
    // that. Text goes in through textContent only (challenge names and source
    // labels are data, never markup).
    _renderRewardFlow(xpGained = 0, xpSources = [], { dailies = null, battlepassXp = 0, pending = false } = {}) {
        const panel = document.querySelector('#post-game-screen .pg-panel');
        const stats = document.getElementById('postgame-stats');
        const report = stats?.parentNode;
        if (!panel || !stats || !report) return;
        let host = document.getElementById('pg-reward-flow');
        if (!host) {
            host = document.createElement('div');
            host.id = 'pg-reward-flow';
            host.className = 'pg-reward-flow';
        }
        // Post-game details now live in .pg-detail-report, so the reference node
        // must be inserted by its direct parent instead of the outer panel.
        // Rehoming also repairs a host created by the former panel-level layout.
        if (host.parentNode !== report || host.nextSibling !== stats) report.insertBefore(host, stats);
        const summary = buildRewardSummary({
            xp: xpGained,
            xpSources,
            dailies: Array.isArray(dailies) ? dailies : (pending ? [] : Daily?.takeLastMatchProgress?.() || [])
        });
        host.replaceChildren();
        if (pending) {
            host.style.display = '';
            const status = document.createElement('div');
            status.className = 'pg-reward-pending';
            status.textContent = 'Settling your match rewards…';
            host.appendChild(status);
            return;
        }
        if (!summary.xpRows.length && !summary.dailyRows.length) {
            host.style.display = 'none';
            return;
        }
        host.style.display = '';
        const reducedMotion = this._isReducedMotion();
        const delays = rewardStepDelays(summary.rowCount, { reducedMotion });
        let index = 0;
        const addRow = (parent, className) => {
            const row = document.createElement('div');
            row.className = className;
            row.style.animationDelay = `${delays[index++] || 0}ms`;
            parent.appendChild(row);
            return row;
        };
        const addGroup = title => {
            const group = document.createElement('div');
            group.className = 'pg-flow-group';
            const head = document.createElement('div');
            head.className = 'pg-flow-head';
            head.textContent = title;
            group.appendChild(head);
            host.appendChild(group);
            return group;
        };

        if (summary.xpRows.length) {
            const group = addGroup(`XP earned · +${summary.xpTotal}`);
            summary.xpRows.forEach(source => {
                const row = addRow(group, 'pg-flow-row');
                const label = document.createElement('span');
                label.textContent = source.label;
                const value = document.createElement('b');
                row.append(label, value);
                this._animateCount(value, source.value, amount => `+${amount} XP`);
            });
        }

        const safeBattlepassXp = Math.max(0, Math.floor(Number(battlepassXp) || 0));
        if (safeBattlepassXp > 0) {
            const group = addGroup('Battle Pass');
            const row = addRow(group, 'pg-flow-row');
            const label = document.createElement('span');
            label.textContent = 'Match progression';
            const value = document.createElement('b');
            row.append(label, value);
            this._animateCount(value, safeBattlepassXp, amount => `+${amount} BP XP`);
        }

        if (summary.dailyRows.length) {
            const group = addGroup('Daily challenges');
            summary.dailyRows.forEach(daily => {
                const row = addRow(group, `pg-flow-row pg-flow-daily${daily.completed ? ' complete' : ''}`);
                const label = document.createElement('span');
                label.textContent = daily.completed ? `${daily.name} — COMPLETE` : daily.name;
                const value = document.createElement('b');
                const bar = document.createElement('i');
                const fill = document.createElement('em');
                // Start at the pre-match value and let the CSS width transition
                // carry it to the new one — the "tick" is the whole point.
                fill.style.width = `${Math.round(daily.from / daily.target * 100)}%`;
                bar.appendChild(fill);
                row.append(label, value, bar);
                const paint = () => { fill.style.width = `${Math.round(daily.to / daily.target * 100)}%`; };
                if (reducedMotion) paint();
                else requestAnimationFrame(() => requestAnimationFrame(paint));
                this._animateCount(value, daily.to, amount => `${amount}/${daily.target}`, daily.from);
            });
        }
    }

    // ===== Watch & Earn (house-promo ad-reward, no real ad SDK/dependency) =====
    // Shop calls window.UI?.renderEarnSlot?.() into #shop-earn-slot (optional
    // chained — silent no-op if that div or window.UI isn't wired up yet).
    renderEarnSlot(store = Store) {
        const el = document.getElementById('shop-earn-slot');
        if (!el) return;
        const status = store.getAdRewardStatus?.() || { remaining: 0, cap: 5 };
        el.replaceChildren();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary';
        btn.textContent = `📺 Watch & Earn +50 (${status.remaining}/${status.cap})`;
        btn.disabled = status.remaining <= 0;
        btn.onclick = () => this.showEarnOverlay(store);
        el.appendChild(btn);
    }

    // 20s unskippable house promo (rotating ball-skin showcase, no video file)
    // then a "Claim +50" button that hits the real server-enforced ad-reward
    // endpoint. Works for guests too — /api/profile/session already hands out
    // a bearer token before this is ever reachable.
    showEarnOverlay(store = Store) {
        const el = document.getElementById('earn-overlay');
        if (!el) return;
        this._openExclusive('earnOverlay', () => this.hideEarnOverlay());
        el.classList.remove('hidden');
        const showcase = document.getElementById('earn-showcase');
        const countdownEl = document.getElementById('earn-countdown');
        const claimBtn = document.getElementById('earn-claim-btn');
        const closeBtn = document.getElementById('earn-close-btn');
        const statusEl = document.getElementById('earn-status');
        if (statusEl) statusEl.textContent = '';
        if (claimBtn) { claimBtn.disabled = true; claimBtn.textContent = 'Claim +50'; }
        if (closeBtn) closeBtn.disabled = true;
        const skinIds = Object.keys(BALL_SKINS).filter(id => id !== 'classic');
        let skinIndex = 0;
        const paintSkin = () => {
            if (!showcase || !skinIds.length) return;
            const skin = BALL_SKINS[skinIds[skinIndex % skinIds.length]];
            const hex = Number.isFinite(skin?.glow) ? skin.glow : 0x333344;
            showcase.style.backgroundColor = `#${hex.toString(16).padStart(6, '0')}`;
            showcase.textContent = skin?.name || '';
            skinIndex++;
        };
        paintSkin();
        clearInterval(this._earnShowcaseTimer);
        this._earnShowcaseTimer = setInterval(paintSkin, 2500);
        let seconds = 20;
        if (countdownEl) countdownEl.textContent = String(seconds);
        clearInterval(this._earnCountdownTimer);
        this._earnCountdownTimer = setInterval(() => {
            seconds--;
            if (countdownEl) countdownEl.textContent = String(Math.max(0, seconds));
            if (seconds <= 0) {
                clearInterval(this._earnCountdownTimer);
                if (claimBtn) claimBtn.disabled = false;
                if (closeBtn) closeBtn.disabled = false;
            }
        }, 1000);
        const requestId = `adreward:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        if (claimBtn) {
            claimBtn.onclick = async () => {
                claimBtn.disabled = true;
                claimBtn.textContent = 'Claiming...';
                const result = await store.claimAdReward(requestId);
                if (result.ok) {
                    if (statusEl) statusEl.textContent = `+${result.coins} coins!`;
                    this.showMessage?.(`📺 Watch & Earn: +${result.coins} coins`, 2500);
                    this.renderEarnSlot(store);
                    setTimeout(() => this.hideEarnOverlay(), 900);
                } else {
                    if (statusEl) statusEl.textContent = result.error || 'Reward unavailable';
                    claimBtn.disabled = false;
                    claimBtn.textContent = 'Claim +50';
                }
            };
        }
        if (closeBtn) closeBtn.onclick = () => this.hideEarnOverlay();
    }

    hideEarnOverlay() {
        const el = document.getElementById('earn-overlay');
        if (el) el.classList.add('hidden');
        this._closeExclusive('earnOverlay');
        clearInterval(this._earnShowcaseTimer);
        clearInterval(this._earnCountdownTimer);
    }

    renderMatchAnalysis(report, initialTab = 'overview') {
        const wrap = document.getElementById('pg-analysis');
        const content = document.getElementById('pg-analysis-content');
        const tabs = document.querySelectorAll('[data-analysis-tab]');
        if (!content) return;
        const safe = report && typeof report === 'object' ? report : {};
        const hasAnalysis = Boolean(
            safe.mvp
            || (Array.isArray(safe.players) && safe.players.length)
            || (Array.isArray(safe.timeline) && safe.timeline.length)
            || (Array.isArray(safe.heatmap?.cells) && safe.heatmap.cells.flat().length)
        );
        if (wrap) wrap.hidden = !hasAnalysis;
        if (!hasAnalysis) {
            content.replaceChildren();
            return;
        }
        const render = tab => {
            tabs.forEach(button => {
                const selected = button.dataset.analysisTab === tab;
                button.classList.toggle('selected', selected);
                button.setAttribute('aria-selected', String(selected));
            });
            if (tab === 'timeline') {
                const events = Array.isArray(safe.timeline) ? safe.timeline.slice(-80).reverse() : [];
                content.innerHTML = events.length ? `<div class="pg-timeline">${events.map(event => {
                    const seconds = Math.max(0, Number(event.t) || 0) / 1000;
                    const who = event.data?.name || event.data?.playerId || event.data?.attackerId || '';
                    return `<div><time>${seconds.toFixed(1)}s</time><b>${this._esc(event.type || 'event')}</b><span>${this._esc(who)}</span></div>`;
                }).join('')}</div>` : '<p>No timeline events recorded.</p>';
                return;
            }
            if (tab === 'heatmap') {
                const heatmap = safe.heatmap;
                const cells = Array.isArray(heatmap?.cells) ? heatmap.cells.flat() : [];
                const max = Math.max(1, Number(heatmap?.max) || 1);
                content.innerHTML = cells.length
                    ? `<div class="pg-heatmap" style="--heat-cols:${heatmap.columns || 12}">${cells.map(value =>
                        `<i style="--heat:${Math.max(0, Number(value) || 0) / max}" title="${Number(value) || 0} samples"></i>`
                    ).join('')}</div><small>${heatmap.total || 0} ball trajectory samples</small>`
                    : '<p>No trajectory data recorded.</p>';
                return;
            }
            const players = Array.isArray(safe.players) ? safe.players : [];
            const totals = players.reduce((sum, player) => {
                sum.deflects += player.deflects || 0;
                sum.perfects += player.deflectTiers?.perfect || 0;
                sum.kos += player.kos || 0;
                return sum;
            }, { deflects: 0, perfects: 0, kos: 0 });
            content.innerHTML = `<div class="pg-analysis-grid">
                <article><span>MVP</span><b>${this._esc(safe.mvp?.name || '--')}</b></article>
                <article><span>Deflects</span><b>${totals.deflects}</b></article>
                <article><span>Perfects</span><b>${totals.perfects}</b></article>
                <article><span>KOs</span><b>${totals.kos}</b></article>
            </div>`;
        };
        tabs.forEach(button => {
            button.onclick = () => render(button.dataset.analysisTab || 'overview');
        });
        render(initialTab);
    }

    _buildAARTable(playerStats, totalKills, totalDeflects) {
        if (!playerStats.length) return `<span>${totalKills} kills</span><span>${totalDeflects} deflects</span>`;
        // Team totals
        let redTot = { score:0, deaths:0, assists:0, deflections:0, rally:0, damageDealt:0, damageTaken:0 };
        let blueTot = { score:0, deaths:0, assists:0, deflections:0, rally:0, damageDealt:0, damageTaken:0 };
        playerStats.forEach(p => {
            const t = p.team === 'blue' ? blueTot : redTot;
            t.score += p.score || 0;
            t.deaths += p.deaths || 0;
            t.assists += p.assists || 0;
            t.deflections += p.deflections || 0;
            t.rally += p.hits || 0;
            t.damageDealt += p.damageDealt || 0;
            t.damageTaken += p.damageTaken || 0;
        });
        // Find MVP — same tie-break as the MVP card (js/mvp-select.js#selectMvp):
        // most kills, deflections break a kill tie, damage breaks a deflection tie.
        const mvp = selectMvp(playerStats);
        // Build table
        let rows = '';
        playerStats.forEach(p => {
            const kd = (p.deaths || 1) > 0 ? ((p.score || 0) / (p.deaths || 1)).toFixed(1) : '∞';
            const isMvp = mvp && p.name === mvp.name;
            rows += `<tr class="${isMvp ? 'pg-mvp' : ''} ${p.team}">
                <td class="pg-name" data-label="Player">${this._esc(p.name)}${isMvp ? ' <span class="pg-mvp-tag">MVP</span>' : ''}</td>
                <td data-label="Kills">${p.score || 0}</td>
                <td data-label="Deaths">${p.deaths || 0}</td>
                <td data-label="Deflects">${p.deflections || 0}</td>
                <td data-label="Rally">${p.hits || 0}</td>
                <td data-label="Assists">${p.assists || 0}</td>
                <td data-label="Damage">${p.damageDealt || 0}</td>
                <td data-label="K/D">${kd}</td>
            </tr>`;
        });
        return `
            <table class="pg-aar-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Kills</th>
                        <th>Deaths</th>
                        <th>Defl</th>
                        <th>Rally</th>
                        <th>Assists</th>
                        <th>Dmg</th>
                        <th>K/D</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="pg-team-red"><td colspan="8">RED — K:${redTot.score} D:${redTot.deaths} Defl:${redTot.deflections} Rally:${redTot.rally} Dmg:${redTot.damageDealt}</td></tr>
                    <tr class="pg-team-blue"><td colspan="8">BLUE — K:${blueTot.score} D:${blueTot.deaths} Defl:${blueTot.deflections} Rally:${blueTot.rally} Dmg:${blueTot.damageDealt}</td></tr>
                </tfoot>
            </table>`;
    }

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    _playDing() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 800 + Math.random() * 400;
            const g = ctx.createGain(); g.gain.value = 0.06;
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.15);
        } catch (_) {}
    }

    showCombo(combo, maxCombo) {
        const el = document.getElementById('combo-display');
        if (!el || combo < 2) { el?.classList.remove('active'); this._setComboGlow(0); return; }
        const labels = ['', '', 'DOUBLE!', 'TRIPLE!', 'QUAD!', 'PENTA!', 'HEXA!', 'ULTRA!', 'MEGA!'];
        const label = labels[Math.min(combo, labels.length - 1)] || 'GODLIKE!';
        const numEl = el.querySelector('.combo-num') || el.querySelector('.combo-count');
        const lblEl = el.querySelector('.combo-label');
        if (numEl) numEl.textContent = combo + 'x';
        if (lblEl) lblEl.textContent = label;
        el.classList.remove('shatter');
        el.classList.add('active');
        el.classList.remove('hidden');
        this._applyComboTier(el, combo);
        clearTimeout(this._comboHideTimer);
        // Pin the display so game.js's per-frame updateCombo() (continuous juice.combo
        // sync, same #combo-display element) can't stomp this one-shot pop-in mid-hold.
        const HOLD_MS = 1500;
        this._comboPinnedUntil = performance.now() + HOLD_MS;
        this._comboHideTimer = setTimeout(() => {
            el.classList.remove('active');
            this._setComboGlow(0);
        }, HOLD_MS);
    }

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

    // DOM element pool: after warm-up (first DMG_NUM_POOL_SIZE hits) every call
    // reuses a pooled div by round-robin cursor instead of createElement — 0
    // alloc in the hot combat path. Tier (color/scale) and a per-slot jitter
    // (so stacked hits don't overlap pixel-for-pixel) come from combat-fx.js.
    spawnDamageNumber(screenX, screenY, dmg, lethal = false, zoneLabel = null, charged = false) {
        const DMG_NUM_POOL_SIZE = 14;
        let pool = this._dmgNumPool;
        if (!pool) {
            pool = this._dmgNumPool = [];
            for (let i = 0; i < DMG_NUM_POOL_SIZE; i++) {
                const div = document.createElement('div');
                div.className = 'dmg-num';
                document.body.appendChild(div);
                pool.push(div);
            }
            this._dmgNumCursor = -1;
        }
        this._dmgNumCursor = nextPoolCursor(this._dmgNumCursor, DMG_NUM_POOL_SIZE);
        const el = pool[this._dmgNumCursor];
        const tier = classifyDamageTier(dmg, lethal);
        const jitter = damageJitterFor(this._dmgNumCursor);
        if (zoneLabel) {
            el.innerHTML = `<span class="dmg-value">-${dmg}</span><span class="dmg-zone">${zoneLabel}</span>`;
        } else {
            el.textContent = '-' + dmg;
        }
        el.style.left = (screenX + jitter.x) + 'px';
        el.style.top = (screenY + jitter.y) + 'px';
        el.className = 'dmg-num tier-' + tier + (charged ? ' charged' : '');
        void el.offsetWidth; // restart the float/pop animation even if this slot was still fading
        el.classList.add('active');
    }

    // Combo-tier color/glow escalation shared by the continuous per-frame sync
    // (updateCombo, driven every frame from juice.combo) and the one-shot event
    // pop-ins (showCombo, on perfect-deflect / kill-streak). tier 0 = base,
    // 1-3 = escalating brightness. The screen-edge glow stays amber/gold only —
    // never team red/blue — so it can never read as ball/team ownership.
    _applyComboTier(el, combo) {
        const tier = comboTier(combo);
        for (let t = 1; t <= 3; t++) el.classList.toggle('tier-' + t, t === tier);
        this._setComboGlow(tier);
        return tier;
    }

    _ensureComboGlow() {
        if (this._comboGlowEl) return this._comboGlowEl;
        const el = document.createElement('div');
        el.id = 'combo-edge-glow';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
        this._comboGlowEl = el;
        return el;
    }

    _setComboGlow(tier) {
        const el = this._ensureComboGlow();
        for (let t = 1; t <= 3; t++) el.classList.toggle('tier-' + t, t === tier);
    }

    // Combo kırıldığında (doğal timeout ya da bir kill'in resetCombo() çağırması)
    // js/juice.js#resetCombo window.UI?.comboBreak?.() ile burayı tetikler — kısa
    // "shatter" düşüş animasyonu oynatıp edge glow'u söndürür.
    comboBreak() {
        const el = document.getElementById('combo-display');
        if (el && el.classList.contains('active')) {
            el.classList.remove('active');
            el.classList.add('shatter');
            setTimeout(() => el.classList.remove('shatter'), 260);
        }
        this._comboPinnedUntil = 0;
        this._setComboGlow(0);
    }

    // --- Map Voting UI ---
    showMapVoting(options, isHost, onVote) {
        const container = document.getElementById('pg-map-vote');
        if (!container) return;
        container.classList.remove('hidden');
        // Disable play again during voting
        const playBtn = document.getElementById('pg-play-again');
        if (playBtn) playBtn.disabled = true;
        container.innerHTML = '<div class="mv-label">🗺️ VOTE FOR NEXT MAP</div>';
        const cards = document.createElement('div');
        cards.className = 'mv-cards';
        options.forEach((mapId) => {
            const config = Arena.MAPS?.[mapId];
            const name = config?.name || mapId;
            const card = document.createElement('div');
            card.className = 'mv-card';
            card.dataset.mapId = mapId;
            card.innerHTML = `<div class="mv-card-name">${name}</div>`;
            card.addEventListener('click', () => {
                if (card.classList.contains('mv-voted')) return;
                // Deselect others
                cards.querySelectorAll('.mv-card').forEach(c => c.classList.remove('mv-voted', 'mv-selected'));
                card.classList.add('mv-voted', 'mv-selected');
                onVote(mapId);
            });
            cards.appendChild(card);
        });
        container.appendChild(cards);
        if (isHost) {
            const info = document.createElement('div');
            info.className = 'mv-info';
            info.textContent = 'Waiting for votes... (20s timeout)';
            container.appendChild(info);
        }
    }

    highlightMapVote(mapId) {
        const cards = document.querySelectorAll('.mv-card');
        cards.forEach(c => {
            if (c.dataset.mapId === mapId) {
                c.classList.add('mv-voted', 'mv-selected');
            } else {
                c.classList.remove('mv-selected');
            }
        });
    }

    updateLobbyPlayers(players, isHost) {
        const redEl = document.getElementById('cs-team-red');
        const blueEl = document.getElementById('cs-team-blue');
        if (redEl) redEl.innerHTML = '';
        if (blueEl) blueEl.innerHTML = '';
        const reds = players.filter(p => p.team === 'red');
        const blues = players.filter(p => p.team === 'blue');
        const maxSlots = 6;
        const renderCard = (p, container, isPlaceholder) => {
            if (!container) return;
            if (isPlaceholder) {
                const card = document.createElement('div');
                card.className = 'cs-player-card empty';
                setText(card, 'lobby.waitingSlot');
                container.appendChild(card);
                return;
            }
            const card = document.createElement('div');
            card.className = `cs-player-card team-${p.team}${p.isYou ? ' you' : ''}${p.isBot ? ' bot' : ''}`;
            card.draggable = !!isHost && !p.isYou;
            card.dataset.playerName = p.name;
            card.dataset.playerTeam = p.team;
            const char = CHARACTERS[p.charId] || CHARACTERS.rally;
            const emoji = char?.emoji || '👤';
            const ownAvatarOnly = window.__store?.get?.('customAvatar');
            const avatarHTML = p.isYou
                ? (ownAvatarOnly?.dataURL ? `<img src="${ownAvatarOnly.dataURL}">` : emoji)
                : (p.avatar ? `<img src="${p.avatar}">` : emoji);
            const kickBtn = (isHost && !p.isYou)
                ? `<button class="cs-btn-kick" type="button" data-kick-name="${this.escapeHTML(p.name)}" data-kick-peer="${this.escapeHTML(p.peerId || '')}" data-kick-bot="${p.isBot?1:0}" aria-label="Kick ${this.escapeHTML(p.name)}" title="Kick player">X</button>`
                : '';
            const hostBadge = p.isHost ? '<span class="cs-badge cs-badge-host">HOST</span>' : '';
            const botBadge = p.isBot ? `<span class="cs-badge cs-badge-bot">${p.autoFill ? 'BOT · AUTO' : 'BOT'}</span>` : '';
            const pingHtml = p.ping != null ? `<span class="cs-badge-ping">${Math.round(p.ping)}ms</span>` : '';
            card.innerHTML = `
                <div class="cs-player-avatar">${avatarHTML}</div>
                <div class="cs-player-info">
                    <div class="cs-player-name${p.isYou ? ' you' : ''}${p.isBot ? ' bot' : ''}">${this.escapeHTML(p.name)}</div>
                    <div class="cs-player-sub" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">${hostBadge}${botBadge}${pingHtml}</div>
                </div>
                ${kickBtn}
            `;
            container.appendChild(card);
        };
        reds.forEach(p => renderCard(p, redEl));
        for (let i = reds.length; i < maxSlots; i++) renderCard(null, redEl, true);
        blues.forEach(p => renderCard(p, blueEl));
        for (let i = blues.length; i < maxSlots; i++) renderCard(null, blueEl, true);
        // Update bot count
        const botCount = players.filter(p => p.isBot).length;
        const bc = document.getElementById('cs-bot-count');
        if (bc) setText(bc, 'lobby.botCount', { n: botCount });
    }

    setRoomCode(code) {
        const el = document.getElementById('room-code');
        if (el) el.textContent = code;
        const status = document.getElementById('lobby-network-status');
        if (status) {
            setText(status, !code || code === 'LOCAL' ? 'lobby.localVsBots' : 'lobby.p2pRoom');
            status.className = '';
        }
    }

    // --- CHAT ---

    addChatMessage(rawName, rawText) {
        // Reader-side filter (Settings > Chat Filter). Names are escaped too: they
        // arrive from peers and were inserted as raw HTML in two of these logs.
        const filterOn = Store.get('settings')?.chatFilter !== false;
        const name = this.escapeHTML(filterChatText(rawName, { enabled: filterOn }));
        const text = filterChatText(rawText, { enabled: filterOn });
        // In-game chat log (floating overlay)
        const chatLog = document.getElementById('chat-log');
        if (chatLog) {
            const msg = document.createElement('div');
            msg.className = 'chat-msg';
            msg.innerHTML = `<span class="chat-name">${name}:</span> ${this.escapeHTML(text)}`;
            chatLog.appendChild(msg);
            chatLog.scrollTop = chatLog.scrollHeight;
            this.audio?.playCue('chat');
            setTimeout(() => { msg.classList.add('chat-fade'); }, 8000);
            setTimeout(() => { msg.remove(); }, 12000);
        }
        // Lobby chat log (persistent panel)
        const lobbyLog = document.getElementById('lobby-chat-log');
        if (lobbyLog) {
            const msg = document.createElement('div');
            msg.className = 'chat-msg';
            msg.innerHTML = `<span class="chat-name">${name}:</span> ${this.escapeHTML(text)}`;
            lobbyLog.appendChild(msg);
            lobbyLog.scrollTop = lobbyLog.scrollHeight;
            // Keep last 50 messages
            while (lobbyLog.children.length > 50) lobbyLog.firstChild.remove();
        }
        const postLog = document.getElementById('pg-chat-log');
        if (postLog) {
            const msg = document.createElement('div');
            msg.className = 'chat-msg';
            msg.innerHTML = `<span class="chat-name">${name}:</span> ${this.escapeHTML(text)}`;
            postLog.appendChild(msg);
            postLog.scrollTop = postLog.scrollHeight;
            while (postLog.children.length > 50) postLog.firstChild.remove();
        }
    }

    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Update HP / shield / stamina bars for the local player.
    updateVitals(hp, maxHp, shield, stamina, staminaMax, exhausted) {
        const hpPct = Math.max(0, hp / maxHp * 100);
        const stPct = Math.max(0, stamina / staminaMax * 100);
        const hpFill = document.getElementById('hp-fill');
        const shieldFill = document.getElementById('shield-fill');
        const staFill = document.getElementById('stamina-fill');
        const hpNum = document.getElementById('hp-num');
        if (hpFill) {
            hpFill.style.width = hpPct + '%';
            hpFill.className = 'vital-fill hp' + (hpPct < 30 ? ' low' : hpPct < 60 ? ' mid' : '');
        }
        // Low-health vignette lives on #hud itself (a CSS :has(#hp-fill.low) selector does
        // not match reliably here). updateVitals runs every frame, so the class is only
        // written when the threshold is actually crossed — the rest is a CSS transition.
        const critical = hpPct < 30;
        if (this._hudCritical !== critical) {
            this._hudCritical = critical;
            this.screens?.hud?.classList.toggle('hud-critical', critical);
        }
        if (shieldFill) shieldFill.style.width = `${Math.max(0, (shield || 0) / maxHp * 100)}%`;
        if (staFill) {
            staFill.style.width = stPct + '%';
            staFill.classList.toggle('exhausted', !!exhausted);
            // Dynamic stamina color gradient: green→yellow→red
            if (!exhausted) {
                const r = stPct < 50 ? 255 : Math.round(68 + (stPct - 50) / 50 * (255 - 68));
                const g = stPct > 50 ? 170 : Math.round(170 * stPct / 50);
                const b = 0;
                staFill.style.background = `linear-gradient(90deg, rgb(${Math.round(r * 0.8)},${Math.round(g * 0.8)},${b}), rgb(${r},${g},${b}))`;
            }
        }
        if (hpNum) hpNum.textContent = Math.ceil(hp) + (shield > 0 ? ' +' + Math.ceil(shield) : '');
    }

    // Red damage vignette flash (when the local player is hit)
    flashHit() {
        const el = document.getElementById('hit-flash');
        if (!el) return;
        el.classList.remove('flash');
        void el.offsetWidth; // restart animation
        el.classList.add('flash');
    }

    // kind: 'hit' | 'head' | 'kill' (a legacy boolean still means headshot).
    // Colour/size/duration live in CSS (#hit-marker.hit/.head/.kill, hud.css).
    showHitMarker(kind = 'hit') {
        const el = document.getElementById('hit-marker');
        if (!el) return;
        const markerKind = kind === true ? 'head' : kind === 'head' || kind === 'kill' ? kind : 'hit';
        el.style.color = '';
        el.style.fontSize = '';
        el.classList.remove('show', 'hit', 'head', 'kill');
        void el.offsetWidth;
        el.classList.add('show', markerKind);
        el.dataset.kind = markerKind;
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

    // Ultimate charge HUD
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

    showKillCamOverlay(killerName, duration = 2.5) {
        const el = document.getElementById('killcam-overlay');
        if (!el) return;
        el.innerHTML = `<div class="killcam-killer">KILLED BY: ${this.escapeHTML(killerName)}</div>`;
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), duration * 1000);
    }

    // Skill cooldown bar — HUD'da Q skill için.
    updateSkillCooldown(cooldowns, skillId) {
        const skill = SKILLS[skillId];
        const fill = document.getElementById('skill-fill');
        const cd = document.getElementById('skill-cd');
        const icon = document.getElementById('skill-icon');
        if (!fill || !skill) return;
        const remaining = cooldowns[skillId] || 0;
        const pct = Math.max(0, 100 - (remaining / skill.cooldown) * 100);
        fill.style.width = `${pct}%`;
        if (cd) cd.textContent = remaining > 0 ? `${remaining.toFixed(1)}s` : 'Ready';
        if (icon) icon.textContent = skill.emoji;
        fill.classList.toggle('ready', remaining <= 0);
    }

    // Kill feed — eliminations only (game.js pushes lethal rows), newest first, max 5,
    // fade after 4 s, gone at 5 s. Rows are keyed by entry so the per-frame call only
    // toggles the fade class; a row is built once, when its kill lands (slide-in).
    renderKillFeed(killFeed = []) {
        const el = document.getElementById('kill-feed');
        if (!el) return;
        const now = performance.now();
        let shown = 0;
        for (let index = 0; index < killFeed.length && shown < 5; index++) {
            const entry = killFeed[index];
            const age = now - entry?.time;
            if (!(age < 5000)) continue;
            let row = el.children[shown];
            if (!row || row._killEntry !== entry) {
                row = this._buildKillFeedRow(entry);
                el.insertBefore(row, el.children[shown] || null);
            }
            row.classList.toggle('fade-out', age > 4000);
            shown++;
        }
        while (el.children.length > shown) el.removeChild(el.lastChild);
    }

    _buildKillFeedRow(entry) {
        const teamClass = team => team === 'red' || team === 'blue' ? ` team-${team}` : '';
        const row = document.createElement('div');
        row._killEntry = entry;
        row.className = 'kill-entry' + (entry.headshot ? ' headshot' : '') + (entry.perfect ? ' perfect' : '');
        const killer = document.createElement('span');
        killer.className = 'killer' + teamClass(entry.attackerTeam);
        killer.textContent = entry.killer || entry.attacker || 'Bot';
        const icon = document.createElement('span');
        icon.className = 'weapon-icon';
        icon.textContent = entry.headshot ? '💀' : '🏐';
        const victim = document.createElement('span');
        victim.className = 'victim' + teamClass(entry.victimTeam);
        victim.textContent = entry.victim || 'Bot';
        row.append(killer, icon, victim);
        if (entry.headshot) row.append(this._killFeedTag('head', 'HEADSHOT'));
        if (entry.perfect) row.append(this._killFeedTag('perfect', 'PERFECT'));
        return row;
    }

    _killFeedTag(kind, text) {
        const tag = document.createElement('span');
        tag.className = `kill-tag kill-tag--${kind}`;
        tag.textContent = text;
        return tag;
    }

    // Kill feed — legacy.
    updateKillFeed(feed) {
        const el = document.getElementById('kill-feed');
        if (!el) return;
        el.innerHTML = '';
        feed.forEach(item => {
            const div = document.createElement('div');
            div.className = 'kf-msg';
            div.innerHTML = `<span class="kf-atk">${item.attacker || 'Ball'}</span> → <span class="kf-vic">${item.victim}</span> <span class="kf-dmg">-${item.dmg}${item.tag||''}</span>`;
            el.appendChild(div);
        });
    }

    // Damage meter — sol üstte.
    updateDamageMeter(dealt, taken) {
        const dEl = document.getElementById('dm-dealt');
        const tEl = document.getElementById('dm-taken');
        if (dEl) dEl.textContent = Math.round(dealt);
        if (tEl) tEl.textContent = Math.round(taken);
    }

    // Combo göstergesi — ortada büyük sayı (juice).
    updateCombo(combo, label) {
        const el = document.getElementById('combo-display');
        if (!el) return;
        // A one-shot showCombo() pop-in (perfect deflect / kill-streak label) briefly
        // pins the display so this continuous per-frame juice.combo sync can't stomp
        // it mid-hold — see showCombo()'s _comboPinnedUntil.
        if (this._comboPinnedUntil && performance.now() < this._comboPinnedUntil) return;
        if (combo > 1) {
            el.classList.add('active');
            el.classList.remove('shatter');
            const numEl = el.querySelector('.combo-num') || el.querySelector('.combo-count');
            const lblEl = el.querySelector('.combo-label');
            if (numEl) numEl.textContent = combo;
            if (lblEl) lblEl.textContent = label || 'COMBO';
            this._applyComboTier(el, combo);
        } else {
            el.classList.remove('active');
            this._setComboGlow(0);
        }
    }

    // Flash overlay — edge-only vignette/glow, center (ball/crosshair) stays
    // clear (docs/V3_GAMEPLAY.md: "No full-screen flash hiding the trajectory").
    // Caller (main.js) only forwards juice.flashAmt, a number — it doesn't
    // thread through juice.flashKind — so the kill-vs-generic tint is
    // re-inferred here from amt using the same >=0.4 threshold juice.js's
    // flash() uses internally (game.js's kill flash is flash(0.55)). The
    // dataset flag is only flipped on a rising edge and cleared once amt
    // decays to ~0, so a fading pulse can't flicker tint as it crosses 0.4.
    updateFlash(amt) {
        let el = document.getElementById('juice-flash');
        if (!el) {
            el = document.createElement('div');
            el.id = 'juice-flash';
            el.className = 'juice-flash';
            document.body.appendChild(el);
        }
        const prev = this._lastFlashAmt || 0;
        if (amt > prev + 0.001) {
            el.dataset.tint = amt >= 0.4 ? 'kill' : 'generic';
        } else if (amt <= 0.001) {
            delete el.dataset.tint;
        }
        this._lastFlashAmt = amt;
        el.style.opacity = Math.min(0.5, amt);
    }

    // Meta stats — main menu'de coins/level/tier.
    updateBallSkin(skinId) {
        const el = document.getElementById('hud-ball-skin');
        if (el) {
            const skin = BALL_SKINS[skinId];
            el.textContent = skin ? skin.name : '🏐';
        }
    }

    updateBallAffix(affix) {
        const el = document.getElementById('ball-affix-indicator');
        if (!el) return;
        if (affix) {
            el.classList.remove('hidden');
            el.innerHTML = `<span class="affix-dot" style="background:#${affix.color.toString(16).padStart(6,'0')}"></span><span class="affix-name">${affix.name}</span>`;
        } else {
            el.classList.add('hidden');
        }
    }

    updateMetaStats(store) {
        const c = document.getElementById('meta-coins');
        const l = document.getElementById('meta-level');
        const t = document.getElementById('meta-bp-tier');
        if (c) c.textContent = store.get('currency');
        // Prestige-aware label ("Dodger · Lv 12"), so the prestige a player earned
        // is actually visible. Falls back to the bare level for any store shape
        // that predates getAccount().
        if (l) {
            l.textContent = typeof store.getAccount === 'function'
                ? accountRankLabel(store.getAccount())
                : `Lv ${store.get('level')}`;
        }
        this._paintPrestigeBadge('meta-prestige', typeof store.getAccount === 'function'
            ? store.getAccount().prestige
            : 0);
        if (t) t.textContent = store.get('battlepass').tier;
    }

    // Shared prestige chip painter. Hidden entirely before the first prestige so
    // a fresh account shows no empty decoration.
    _paintPrestigeBadge(id, prestige) {
        const badge = document.getElementById(id);
        if (!badge) return;
        const tier = Math.floor(Number(prestige)) || 0;
        if (tier <= 0) {
            badge.hidden = true;
            badge.textContent = '';
            return;
        }
        badge.hidden = false;
        badge.dataset.prestige = String(tier);
        badge.textContent = `P${tier}`;
        badge.title = prestigeTitle(tier);
    }

    // js/main.js#onMatchComplete resolves the MVP's equipped knife/gloves/ball from
    // live game state and calls this before showPostGame() paints the report. Stashed
    // rather than rendered immediately: showPostGame() still needs to run first (it
    // resets the rest of the screen), and the matchId guard means a stash from a
    // different match can never attach to a later report.
    setPostGameMvpShowcase(matchId, loadout) {
        this._pendingMvpShowcase = typeof matchId === 'string' && matchId ? { matchId, loadout } : null;
    }

    // MVP card: name + key stats (js/mvp-select.js#selectMvp — same tie-break the AAR
    // table's MVP tag uses) plus a small 3D showcase of their knife/gloves/ball
    // (js/mvp-showcase.js). `loadout` is null until js/main.js's hook resolves it, or
    // when the match has no players at all; either way the card just shows identity
    // and stats with a default-loadout showcase rather than staying empty.
    _renderMvpCard(playerStats, loadout) {
        const card = document.getElementById('pg-mvp-card');
        const stage = document.getElementById('pg-mvp-stage');
        const nameEl = document.getElementById('pg-mvp-name');
        const statsEl = document.getElementById('pg-mvp-stats');
        this._mvpShowcase?.dispose();
        this._mvpShowcase = null;
        if (!card || !stage || !nameEl || !statsEl) return;
        stage.replaceChildren();
        const mvp = selectMvp(playerStats);
        if (!mvp) { card.hidden = true; return; }
        card.hidden = false;
        nameEl.textContent = mvp.name;
        statsEl.replaceChildren();
        const addStat = (label, value) => {
            const wrap = document.createElement('span');
            const b = document.createElement('b');
            b.textContent = String(value);
            const small = document.createElement('small');
            small.textContent = label;
            wrap.append(b, small);
            statsEl.append(wrap);
        };
        addStat(t('pg.kills'), mvp.score || 0);
        addStat(t('common.deflects'), mvp.deflections || 0);
        addStat(t('pg.damage'), Math.round(mvp.damageDealt || 0));
        this._mvpShowcase = createMvpShowcaseStage(stage, { reducedMotion: this._isReducedMotion() });
        this._mvpShowcase.mount({ ...loadout, team: loadout?.team || mvp.team });
    }

    // Per-round breakdown from scoreboard.roundHistory. Match totals alone can't
    // tell a player which round went wrong. Empty history leaves the strip empty
    // and CSS :empty hides it, so network matches without history degrade quietly.
    _renderRoundStrip(history) {
        const strip = document.getElementById('pg-round-strip');
        if (!strip) return;
        strip.innerHTML = '';
        if (!Array.isArray(history) || !history.length) return;
        const frag = document.createDocumentFragment();
        for (const entry of history) {
            const winner = entry?.winner === 'red' || entry?.winner === 'blue' ? entry.winner : '';
            const chip = document.createElement('div');
            chip.className = 'pg-round-chip';
            if (winner) chip.dataset.winner = winner;
            const score = document.createElement('b');
            score.textContent = `${entry?.red ?? 0}-${entry?.blue ?? 0}`;
            const label = document.createElement('small');
            label.textContent = `R${entry?.round ?? '?'} ${winner ? winner.toUpperCase() : '--'}`;
            chip.append(score, label);
            frag.append(chip);
        }
        strip.append(frag);
    }

    // ===== KARAKTER SELECT EKRANI =====
    renderCharacterSelect(store) {
        const grid = document.getElementById('char-grid');
        if (!grid) return;
        const iconStyle = index => `style="--icon-x:${index % 4 * 33.333}%;--icon-y:${Math.floor(index / 4) * 33.333}%"`;
        grid.innerHTML = '';
        const owned = store.get('unlockedChars');
        const selected = store.get('selectedChar');
        const selectedCharacter = CHARACTERS[selected] || CHARACTERS.rally;
        const selectedLoadout = store.get('loadout') || {};
        const selectedSkill = SKILLS[selectedLoadout.skill] || SKILLS.slow;
        const selectedRune = RUNES[(selectedLoadout.runes || [])[0]] || RUNES.deflect_power;
        const heroName = document.getElementById('hero-selected-name');
        const heroSkill = document.getElementById('hero-selected-skill');
        const heroRune = document.getElementById('hero-selected-rune');
        if (heroName) heroName.textContent = selectedCharacter.name;
        if (heroSkill) heroSkill.textContent = selectedSkill.name;
        if (heroRune) heroRune.textContent = selectedRune.name;
        Object.values(CHARACTERS).forEach((c, index) => {
            const card = document.createElement('button');
            card.type = 'button';
            const isOwned = owned.includes(c.id);
            const isSelected = selected === c.id;
            const mastery = store.getCharacterProgress(c.id);
            const masteryNeed = mastery.level < 10 ? mastery.level * 250 : 0;
            card.className = `char-card ${isSelected ? 'selected' : ''} ${!isOwned ? 'locked' : ''}`;
            card.dataset.char = c.id;
            const portraitPath = characterPortraitPath(c.id);
            const portrait = portraitPath
                ? `<div class="char-portrait generated"><img src="${portraitPath}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span style="display:none" aria-hidden="true">${c.emoji}</span></div>`
                : `<div class="char-portrait generated fallback" aria-hidden="true"><span>${c.emoji}</span></div>`;
            card.innerHTML = `
                ${portrait}
                <div class="char-name">${c.name}</div>
                <div class="char-stats">
                    ❤️${c.maxHp} 💨${c.speed} 🎯${c.deflectPower}
                </div>
                <div class="char-mastery">${t('locker.masteryLv', { level: mastery.level })}${masteryNeed ? ` · ${mastery.xp}/${masteryNeed} XP` : ` · ${t('locker.max')}`}</div>
                <div class="char-desc">${characterDesc(c)}</div>
                ${!isOwned && c.price ? `<div class="char-price">🪙 ${c.price}</div>` : ''}
            `;
            grid.appendChild(card);
        });

        // Skill grid
        const sg = document.getElementById('skill-grid');
        if (sg) {
            sg.innerHTML = '';
            const ownedSkills = store.get('ownedSkills');
            const currentSkill = store.get('loadout').skill;
            Object.values(SKILLS).forEach((s, index) => {
                const card = document.createElement('button');
                card.type = 'button';
                const owned = ownedSkills.includes(s.id);
                card.className = `skill-card ${currentSkill === s.id ? 'selected' : ''} ${!owned ? 'locked' : ''}`;
                card.dataset.skill = s.id;
                card.innerHTML = `<div class="loadout-icon" ${iconStyle(index)} aria-hidden="true"></div><div class="loadout-card-title">${s.name}</div><div class="char-desc">${localizedName('skillDescs', s.id, s.desc)}</div><div class="loadout-card-meta">${t('locker.cooldown', { seconds: s.cooldown })}</div>${!owned ? '<div class="char-price">ARENA CACHE</div>' : ''}`;
                sg.appendChild(card);
            });
        }

        // Rune grid
        const rg = document.getElementById('rune-grid');
        if (rg) {
            rg.innerHTML = '';
            const ownedRunes = store.get('ownedItems');
            const currentRunes = store.get('loadout').runes || [];
            Object.values(RUNES).forEach((r, index) => {
                const card = document.createElement('button');
                card.type = 'button';
                const owned = ownedRunes.includes(r.id);
                const equipped = currentRunes.includes(r.id);
                card.className = `rune-card ${equipped ? 'selected' : ''} ${!owned ? 'locked' : ''}`;
                card.dataset.rune = r.id;
                card.innerHTML = `<div class="loadout-icon rune-icon" ${iconStyle(index + 8)} aria-hidden="true"></div><div class="loadout-card-title">${r.name}</div><div class="char-desc">${localizedName('runeDescs', r.id, r.desc)}</div>${!owned ? '<div class="char-price">ARENA CACHE</div>' : ''}`;
                rg.appendChild(card);
            });
        }
    }

    setLockerTab(tab = 'loadout') {
        const selectedTab = ['loadout', 'inventory', 'cards'].includes(tab) ? tab : 'loadout';
        document.querySelectorAll('[data-locker-tab]').forEach(button => {
            const selected = button.dataset.lockerTab === selectedTab;
            button.classList.toggle('selected', selected);
            if (button.matches('[role="tab"]')) {
                button.setAttribute('aria-selected', String(selected));
                button.tabIndex = selected ? 0 : -1;
            }
        });
        document.querySelectorAll('[data-locker-panel]').forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.lockerPanel !== selectedTab);
        });
        return selectedTab;
    }

    _dispatchCosmeticPreview(item, source = 'shop') {
        if (!item || typeof window === 'undefined' || !window.dispatchEvent || typeof CustomEvent === 'undefined') return;
        window.dispatchEvent(new CustomEvent('warrball:shop-preview', {
            detail: Object.freeze({ type: 'cosmetic', id: item.id, cosmetic: item, source })
        }));
    }

    // ===== LOCKER (js/locker.js holds the pure filter/sort/count rules) =====
    // View state survives re-renders (equip, case drops) so the grid never jumps
    // back to "All". Seen/favourite keys are per-device conveniences in localStorage.
    _lockerView() {
        if (!this._locker) {
            this._locker = { filter: 'all', query: '', sort: 'rarity', showLocked: true, seen: null, favorites: null };
        }
        return this._locker;
    }

    _lockerStorage() {
        try {
            return typeof localStorage === 'undefined' ? null : localStorage;
        } catch {
            return null;
        }
    }

    _lockerEntries(store) {
        const view = this._lockerView();
        const storage = this._lockerStorage();
        if (!view.favorites) view.favorites = readKeySet(storage, LOCKER_FAVORITES_KEY) || new Set();
        const state = {
            ownedKnives: store.get('ownedKnives') || [],
            ownedCosmetics: store.get('ownedCosmetics') || [],
            ownedBalls: store.get('ownedBalls') || [],
            ownedAvatarSkins: store.get('ownedAvatarSkins') || [],
            equippedKnives: store.get('equippedKnives') || {},
            equippedWearables: store.get('equippedWearables') || {},
            equippedBall: store.get('equippedBall') || 'classic',
            equippedAvatar: store.get('equippedAvatarSkin') || 'default',
            favorites: view.favorites
        };
        const catalogs = { knives: KNIVES, cosmetics: COSMETICS, balls: BALL_SKINS, avatars: AVATAR_SKINS };
        if (!view.seen) {
            view.seen = readKeySet(storage, LOCKER_SEEN_KEY);
            if (!view.seen) {
                view.seen = seedSeenKeys(null, buildLockerEntries(catalogs, state));
                writeKeySet(storage, LOCKER_SEEN_KEY, view.seen);
            }
        }
        return buildLockerEntries(catalogs, { ...state, seen: view.seen });
    }

    setLockerFilter(filter, store) {
        const view = this._lockerView();
        view.filter = LOCKER_FILTERS.includes(filter) ? filter : 'all';
        if (store) this.renderLockerInventory(store);
        return view.filter;
    }

    setLockerQuery(query, store) {
        this._lockerView().query = String(query || '').slice(0, 40);
        if (store) this.renderLockerInventory(store);
    }

    setLockerSort(sort, store) {
        const view = this._lockerView();
        view.sort = LOCKER_SORTS.includes(sort) ? sort : 'rarity';
        if (store) this.renderLockerInventory(store);
    }

    setLockerShowLocked(flag, store) {
        this._lockerView().showLocked = Boolean(flag);
        if (store) this.renderLockerInventory(store);
    }

    toggleLockerFavorite(key, store) {
        const view = this._lockerView();
        if (!view.favorites) view.favorites = new Set();
        const next = !view.favorites.has(key);
        if (next) view.favorites.add(key);
        else view.favorites.delete(key);
        writeKeySet(this._lockerStorage(), LOCKER_FAVORITES_KEY, view.favorites);
        if (store) this.renderLockerInventory(store);
        return next;
    }

    // NEW clears the first time a tile is looked at (hover, focus or click); the
    // badge is removed in place so the grid does not re-render under the pointer.
    markLockerSeen(key) {
        const view = this._lockerView();
        if (!key || !view.seen || view.seen.has(key)) return false;
        view.seen.add(key);
        writeKeySet(this._lockerStorage(), LOCKER_SEEN_KEY, view.seen);
        const card = [...document.querySelectorAll('#locker-inventory-grid [data-locker-key]')].find(el => el.dataset.lockerKey === key);
        card?.classList.remove('is-new');
        card?.querySelector('.locker-new')?.remove();
        this._syncLockerNewCount(Math.max(0, (this._lockerFresh || 1) - 1));
        return true;
    }

    _syncLockerNewCount(fresh) {
        this._lockerFresh = fresh;
        const badge = document.getElementById('locker-new-count');
        if (!badge) return;
        badge.hidden = !fresh;
        badge.textContent = fresh ? String(fresh) : '';
    }

    _syncLockerToolbar(view, counts) {
        document.querySelectorAll('#locker-filters [data-locker-filter]').forEach(button => {
            const filter = button.dataset.lockerFilter;
            const count = counts[filter] || { owned: 0, total: 0, fresh: 0 };
            button.setAttribute('aria-pressed', String(filter === view.filter));
            button.classList.toggle('has-new', count.fresh > 0);
            const label = button.querySelector('.locker-filter-count');
            if (label) label.textContent = t('locker.ownedCount', { owned: count.owned, total: count.total });
        });
        const search = document.getElementById('locker-search');
        if (search && search.value !== view.query) search.value = view.query;
        const sort = document.getElementById('locker-sort');
        if (sort && sort.value !== view.sort) sort.value = view.sort;
        const locked = document.getElementById('locker-show-locked');
        if (locked) locked.checked = view.showLocked;
    }

    // Equipped-loadout slots on the Loadout tab. Hero / Ability / Rune names are
    // written by renderCharacterSelect(); this fills the cosmetic slots.
    renderLockerSlots(store) {
        const slots = document.getElementById('locker-slots');
        if (!slots) return;
        const equippedKnives = store.get('equippedKnives') || {};
        const knifeId = equippedKnives.red || equippedKnives.blue || 'training';
        const wearables = store.get('equippedWearables') || {};
        const gloveId = wearables.gloves && wearables.gloves !== 'none' ? wearables.gloves : '';
        const ballId = store.get('equippedBall') || 'classic';
        const avatarId = store.get('equippedAvatarSkin') || 'default';
        const wornIds = Object.entries(wearables).filter(([type, id]) => type !== 'gloves' && id && id !== 'none' && COSMETICS[id]).map(([, id]) => id);
        const topWorn = wornIds.map(id => COSMETICS[id]).sort((a, b) => tierRank(a.rarity) - tierRank(b.rarity))[0];
        const fill = (slot, { name, rarity = '', art = null, empty = false }) => {
            const button = document.getElementById(`locker-slot-${slot}`);
            if (!button) return;
            button.dataset.rarity = rarity || 'none';
            button.classList.toggle('is-empty', empty);
            const label = button.querySelector('.locker-slot-name');
            if (label) label.textContent = name;
            const tier = button.querySelector('.locker-slot-tier');
            if (tier) tier.innerHTML = rarity && !empty ? tierBadgeHTML(rarity) : '';
            // Real thumbnail when WebGL allows it; the slot icon underneath is the fallback.
            const holder = button.querySelector('.locker-slot-art');
            const itemKey = art && !empty ? `${art.type}:${art.item.id}` : '';
            if (holder && holder.dataset.item !== itemKey) {
                holder.dataset.item = itemKey;
                holder.classList.remove('has-item-thumb');
                holder.querySelector(':scope > img.item-thumb')?.remove();
                if (itemKey) this._attachItemThumb(holder, art.item, art.type, { lazy: false });
            }
        };
        const knife = KNIVES[knifeId];
        fill('knife', knife && knifeId !== 'training'
            ? { name: knife.name, rarity: knife.rarity, art: { item: knife, type: 'knife' } }
            : { name: t('locker.none'), empty: true });
        const glove = COSMETICS[gloveId];
        fill('gloves', glove ? { name: glove.name, rarity: glove.rarity, art: { item: glove, type: 'cosmetic' } } : { name: t('locker.none'), empty: true });
        const ball = BALL_SKINS[ballId] || BALL_SKINS.classic;
        fill('ball', { name: ball?.name || ballId, rarity: ball?.rarity || 'common', art: ball ? { item: { ...ball, id: ballId }, type: 'ball' } : null });
        const avatar = AVATAR_SKINS[avatarId];
        fill('avatar', { name: avatar?.name || avatarId, rarity: avatar?.rarity || 'common', art: avatar ? { item: avatar, type: 'avatar' } : null });
        fill('wearable', topWorn
            ? { name: wornIds.length > 1 ? t('locker.wornCount', { name: topWorn.name, count: wornIds.length - 1 }) : topWorn.name, rarity: topWorn.rarity }
            : { name: t('locker.none'), empty: true });
        const heroArt = document.querySelector('#locker-slot-hero .locker-slot-art');
        const heroId = store.get('selectedChar');
        const portrait = characterPortraitPath(heroId);
        if (heroArt && portrait && heroArt.dataset.portrait !== portrait) {
            heroArt.dataset.portrait = portrait;
            heroArt.innerHTML = `<img src="${portrait}" alt="" loading="lazy" decoding="async">`;
        }
    }

    _lockerCard(entry, { knifeStats = {}, equippedKnives = {} } = {}) {
        const group = { type: entry.group };
        const item = entry.item;
        const card = document.createElement('article');
        card.dataset.invType = group.type;
        card.dataset.invRarity = item.rarity || 'common';
        card.dataset.lockerKey = entry.key;
        card.dataset.invSlot = entry.slot;
        card.className = `shop-card inventory-card inventory-tile locker-card rarity-${item.rarity || 'common'} tier-${entry.tier.replace('+', 'plus')}`;
        card.classList.toggle('owned', entry.owned);
        card.classList.toggle('equipped', entry.equipped);
        card.classList.toggle('is-locked', !entry.owned);
        card.classList.toggle('is-new', entry.isNew);
        card.classList.toggle('is-favorite', entry.favorite);
        let art = '';
        let desc = '';
        if (group.type === 'knife') {
            card.dataset.invModel = item.model;
            art = `<div class="knife-preview knife-preview-3d model-${item.model}" style="--knife-color:${item.color};--knife-accent:${item.accent}" aria-hidden="true"></div>`;
            const restriction = knifeTeamRestriction(item.teams);
            desc = `${String(item.model || 'knife').toUpperCase()} / ${String(item.finish || 'satin').toUpperCase()}${restriction ? ` · ${t(restriction === 'blue' ? 'hud.blueCaps' : 'hud.redCaps')}` : ''}`;
        } else if (group.type === 'cosmetic') {
            card.dataset.invModel = item.type;
            card.classList.add('cosmetic-card');
            card.style.setProperty('--cosmetic-primary', item.colors?.[0] || '#ffffff');
            card.style.setProperty('--cosmetic-secondary', item.colors?.[1] || '#445566');
            art = `<div class="cosmetic-preview cosmetic-preview-${item.type}" data-style="${item.style}" aria-hidden="true"></div>`;
            desc = localizedName('cosmeticTypes', item.type, COSMETIC_TYPES[item.type] || item.type);
        } else if (group.type === 'ball') {
            card.dataset.invModel = item.shape || 'sphere';
            const hex = value => `#${Number(value || 0).toString(16).padStart(6, '0')}`;
            art = `<div class="ball-preview" data-shape="${item.shape || 'sphere'}" data-effect="${item.effect || 'core'}" style="--ball-color:${hex(item.color)};--ball-glow:${hex(item.glow)}"></div>`;
            desc = t('locker.slotBall');
        } else {
            card.dataset.invModel = item.model || 'classic';
            art = `<span class="skin-preview" style="--skin-head:${item.head};--skin-body:${item.body};--skin-arms:${item.arms};--skin-legs:${item.legs}" aria-hidden="true"></span>`;
            desc = t('locker.slotSkin');
        }
        let action;
        if (!entry.owned) {
            const source = LOCKER_SOURCE_TAB[entry.slot] || 'wearables';
            action = `<button class="btn btn-small locker-get" type="button" data-shop-tab="${source}"><svg class="ui-icon" aria-hidden="true"><use href="#i-lock"></use></svg>${t(source === 'cases' ? 'locker.openCase' : 'locker.getInShop')}</button>`;
        } else if (entry.equipped && (group.type !== 'knife' || (item.teams || ['red', 'blue']).every(team => equippedKnives[team] === item.id))) {
            action = `<span class="shop-owned locker-equipped"><svg class="ui-icon" aria-hidden="true"><use href="#i-check"></use></svg>${t('locker.equipped')}</span>`;
        } else if (group.type === 'knife') {
            action = `<button class="btn btn-small knife-equip locker-equip" type="button" data-id="${item.id}" data-team="both">${t('locker.equip')}</button>`;
        } else if (group.type === 'cosmetic') {
            action = `<button class="btn btn-small shop-equip locker-equip" type="button" data-type="cosmetic" data-id="${item.id}">${t('locker.equip')}</button>`;
        } else if (group.type === 'ball') {
            action = `<button class="btn btn-small shop-equip locker-equip" type="button" data-type="ball" data-id="${item.id}">${t('locker.equip')}</button>`;
        } else {
            action = `<button class="btn btn-small shop-equip locker-equip" type="button" data-type="avatar" data-id="${item.id}">${t('locker.equip')}</button>`;
        }
        const stat = group.type === 'knife' && entry.owned && Number(knifeStats[item.id])
            ? `<span class="locker-stat">${t('locker.kills', { count: Number(knifeStats[item.id]) || 0 })}</span>`
            : '';
        const name = this._esc ? this._esc(entry.name) : entry.name;
        card.innerHTML = `<button class="locker-preview inventory-icon-area" type="button" data-locker-key="${entry.key}" aria-label="${t('locker.previewItem', { name })}">${art}</button>`
            + (entry.isNew ? `<span class="locker-new">${t('locker.new')}</span>` : '')
            + `<button class="locker-fav" type="button" data-locker-key="${entry.key}" aria-pressed="${entry.favorite}" aria-label="${t(entry.favorite ? 'locker.unfavorite' : 'locker.favorite')}"><svg class="ui-icon" aria-hidden="true"><use href="#i-star"></use></svg></button>`
            + `<div class="inventory-card-copy">${tierBadgeHTML(item.rarity)}<div class="char-name">${name}</div><div class="char-desc">${desc}</div>${stat}</div>`
            + `<div class="inventory-actions">${action}</div>`;
        if (group.type === 'cosmetic' && item.type !== 'gloves') appendCosmeticIcon(card.querySelector('.cosmetic-preview'), item);
        return card;
    }

    renderLockerInventory(store) {
        this.renderLockerSlots(store);
        const grid = document.getElementById('locker-inventory-grid');
        if (!grid) return;
        const view = this._lockerView();
        const knifeStats = store.get('knifeStats') || {};
        const equippedKnives = store.get('equippedKnives') || {};
        const entries = this._lockerEntries(store);
        const counts = lockerCounts(entries);
        this._syncLockerToolbar(view, counts);
        this._syncLockerNewCount(counts.all.fresh);
        const shown = sortLockerEntries(filterLockerEntries(entries, view), view.sort);
        const count = document.getElementById('locker-inventory-count');
        const bucket = counts[view.filter] || counts.all;
        if (count) setText(count, 'locker.ownedOf', { owned: bucket.owned, total: bucket.total });
        grid.replaceChildren();
        const fragment = document.createDocumentFragment();
        const cards = shown.map(entry => {
            const card = this._lockerCard(entry, { knifeStats, equippedKnives });
            fragment.appendChild(card);
            return [card, entry];
        });
        grid.appendChild(fragment);
        // Real 3D thumbnails are lazy (IntersectionObserver + idle slots), so a long
        // filtered grid only renders what scrolls into view. Non-glove wearables keep
        // their vector icon, as before.
        for (const [card, entry] of cards) {
            if (entry.group !== 'cosmetic' || entry.item.type === 'gloves') {
                this._attachItemThumb(card.querySelector('.inventory-icon-area'), entry.item, entry.group);
            }
        }
        if (!shown.length) {
            const empty = document.createElement('div');
            empty.className = 'shop-empty inventory-empty';
            const title = document.createElement('strong');
            const copy = document.createElement('span');
            const filtered = Boolean(view.query) || (!view.showLocked && counts.all.owned > 0) || view.filter !== 'all';
            title.textContent = t(filtered ? 'locker.noMatches' : 'locker.emptyTitle');
            copy.textContent = t(filtered ? 'locker.noMatchesCopy' : 'locker.emptyCopy');
            empty.append(title, copy);
            grid.appendChild(empty);
        }
    }

    // Visual confirmation after an equip: the tile and its loadout slot pop once.
    flashLockerEquip(key, slot) {
        const targets = [
            [...document.querySelectorAll('#locker-inventory-grid [data-locker-key]')].find(el => el.dataset.lockerKey === key && el.classList.contains('locker-card')),
            slot ? document.getElementById(`locker-slot-${slot}`) : null
        ].filter(Boolean);
        for (const element of targets) {
            element.classList.remove('just-equipped');
            void element.offsetWidth;
            element.classList.add('just-equipped');
        }
        return targets.length;
    }

    _syncShopTabs(tab) {
        const labels = {
            chars: 'shop.characters', live: 'common.liveDeals', balls: 'shop.balls', avatars: 'shop.characterSkins',
            wearables: 'shop.wearables', cases: 'shop.cases', boosts: 'shop.boosts', tierlist: 'shop.tierList', gems: 'shop.gems'
        };
        document.querySelectorAll('#shop-tabs .shop-tab').forEach(button => {
            const selected = button.dataset.tab === tab;
            button.classList.toggle('selected', selected);
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        const grid = document.getElementById('shop-grid');
        const selectedTab = document.querySelector(`#shop-tabs .shop-tab[data-tab="${tab}"]`);
        if (grid && selectedTab?.id) grid.setAttribute('aria-labelledby', selectedTab.id);
        const title = document.getElementById('shop-catalog-title');
        if (title) title.textContent = t(labels[tab] || 'shop.collection');
        const screen = document.getElementById('shop-screen');
        if (screen) screen.dataset.shopTab = tab;
        this._syncShopFilters(tab);
        const slotLabel = document.getElementById('shop-slot-label');
        if (slotLabel) slotLabel.hidden = tab !== 'wearables';
        const slot = document.getElementById('shop-slot');
        if (slot && slot.options.length === 1) {
            Object.entries(COSMETIC_TYPES).forEach(([id, label]) => {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = label;
                slot.appendChild(option);
            });
        }
        if (slot && tab !== 'wearables') slot.value = 'all';
        const collectionLabel = document.getElementById('shop-collection-label');
        if (collectionLabel) collectionLabel.hidden = tab !== 'wearables';
        const collection = document.getElementById('shop-collection');
        if (collection && collection.options.length === 1) {
            SHOP_COLLECTIONS.forEach(entry => {
                const option = document.createElement('option');
                option.value = entry.id;
                option.textContent = `${entry.label}${entry.isNew ? ' · NEW' : ''}`;
                collection.appendChild(option);
            });
        }
        if (collection && tab !== 'wearables') collection.value = 'all';
    }

    _syncShopFilters(tab) {
        const availableByTab = {
            chars: ['all', 'owned', 'affordable'],
            avatars: ['all', 'owned', 'affordable'],
            balls: ['all', 'ball', 'owned', 'affordable'],
            live: ['all', 'ball', 'cosmetic', 'owned', 'affordable'],
            wearables: ['all', 'owned', 'affordable'],
            cases: ['all', 'affordable'],
            boosts: ['all', 'affordable'],
            tierlist: [],
            gems: []
        };
        const available = new Set(availableByTab[tab] || ['all']);
        if (!available.has(this._shopFilterId)) this._shopFilterId = 'all';
        document.querySelectorAll('#shop-filters .shop-filter-chip').forEach(chip => {
            const enabled = available.has(chip.dataset.filter);
            chip.hidden = !enabled;
            chip.disabled = !enabled;
            chip.setAttribute('aria-hidden', String(!enabled));
        });
    }

    _setShopProductCopy(store, { description = '', price = 0, owned = false, equipped = false, type = 'character' } = {}) {
        const copy = document.getElementById('shop-selected-description');
        if (copy) copy.textContent = description;
        const balance = Number(store.get('currency')) || 0;
        const state = deriveShopCardState({ price, owned, equipped, currency: balance });
        const note = document.getElementById('shop-selected-balance');
        if (note) {
            note.textContent = owned ? t('shop.inCollection') : `${t('shop.priceBalance', { price, balance })}${state.shortfall ? ` · ${t('shop.needMore', { count: state.shortfall })}` : ''}`;
            note.dataset.shortfall = String(state.shortfall > 0);
        }
        const action = document.getElementById('shop-selected-action');
        if (action) {
            action.disabled = equipped || state.shortfall > 0;
            action.setAttribute('aria-label', action.textContent);
            action.title = state.shortfall ? t('shop.earnMore', { count: state.shortfall }) : '';
        }
        const controls = document.getElementById('shop-preview-controls');
        if (controls) controls.hidden = type === 'ball';
        const hint = document.querySelector('#shop-showcase-stage .shop-rotate-hint');
        if (hint) hint.textContent = type === 'ball' ? t('shop.animatedPreview') : t('shop.dragHint');
    }

    _setShopShowcase(store, skin, previewing = false, announce = false, dispatchPreview = true) {
        const selected = skin || AVATAR_SKINS.default;
        const equippedId = store.get('equippedAvatarSkin') || 'default';
        const equipped = selected.id === equippedId;
        const owned = selected.price === 0 || store.hasAvatarAccess(selected.id);
        const stage = document.getElementById('shop-showcase-stage');
        const canvas = document.getElementById('shop-showcase-canvas');
        const fallback = stage?.querySelector('.shop-showcase-fallback');
        const name = document.getElementById('shop-selected-name');
        const meta = document.getElementById('shop-selected-meta');
        const status = document.getElementById('shop-showcase-status');
        const practice = document.getElementById('btn-shop-practice');
        const action = document.getElementById('shop-selected-action');
        const kicker = document.getElementById('shop-selected-kicker');

        if (stage) {
            stage.dataset.previewType = 'character';
            stage.dataset.skinId = selected.id;
            stage.style.setProperty('--showcase-head', selected.head);
            stage.style.setProperty('--showcase-body', selected.body);
            stage.style.setProperty('--showcase-arms', selected.arms);
            stage.style.setProperty('--showcase-legs', selected.legs);
        }
        if (canvas) canvas.dataset.skinId = selected.id;
        if (fallback) fallback.dataset.model = selected.model || 'classic';
        if (name) name.textContent = selected.name;
        if (meta) {
            const state = equipped ? t('shop.equipped') : owned ? t('shop.owned') : t('shop.credits', { count: selected.price });
            meta.textContent = `${t(selected.model === 'slim' ? 'shop.slimModel' : 'shop.classicModel')} · ${state}`;
        }
        if (status) {
            status.textContent = equipped
                ? t('shop.statusEquipped', { name: selected.name })
                : owned
                    ? t('shop.statusOwned', { name: selected.name })
                    : t('shop.statusPreview', { name: selected.name });
        }
        if (kicker) kicker.textContent = t('shop.currentLook');
        if (practice) {
            practice.hidden = false;
            practice.disabled = false;
            practice.dataset.id = selected.id;
        }
        if (action) {
            action.className = 'btn btn-primary shop-selected-action';
            action.dataset.type = 'avatar';
            action.dataset.id = selected.id;
            action.disabled = equipped;
            action.textContent = equipped ? t('shop.equipped') : owned ? t('shop.equipSkin') : t('shop.buyPrice', { price: selected.price });
            action.classList.toggle('shop-equip', !equipped && owned);
            action.classList.toggle('shop-buy', !equipped && !owned);
        }

        document.querySelectorAll('[data-shop-preview="avatar"]').forEach(control => {
            const selectedControl = control.dataset.id === selected.id;
            control.classList.toggle('is-previewing', selectedControl);
            if (control.matches('button')) control.setAttribute('aria-pressed', String(selectedControl));
        });

        const detail = Object.freeze({ type: 'avatar', id: selected.id, skin: selected, equipped, owned, previewing });
        this._setShopProductCopy(store, { description: selected.description || 'A full character skin. Try its silhouette in motion or take it to the Practice Range.', price: selected.price, owned, equipped });
        if (stage?.dispatchEvent && typeof CustomEvent !== 'undefined') {
            stage.dispatchEvent(new CustomEvent('shop-preview-change', { bubbles: true, detail }));
        }
        if (dispatchPreview && typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('warrball:shop-preview', { detail }));
        }
        const productVisual = document.getElementById('shop-selected-product-visual');
        productVisual?.setAttribute('aria-hidden', 'true');
        productVisual?.removeAttribute('role');
        productVisual?.removeAttribute('aria-label');
        if (announce && status) status.focus?.({ preventScroll: true });
    }

    _setShopCosmeticShowcase(store, item, announce = false) {
        if (!item) return false;
        const equippedWearables = store.get('equippedWearables') || {};
        const equipped = equippedWearables[item.type] === item.id;
        const owned = store.ownsCosmetic(item.id);
        const typeLabel = COSMETIC_TYPES[item.type] || item.type;
        const name = document.getElementById('shop-selected-name');
        const meta = document.getElementById('shop-selected-meta');
        const status = document.getElementById('shop-showcase-status');
        const practice = document.getElementById('btn-shop-practice');
        const action = document.getElementById('shop-selected-action');
        const kicker = document.getElementById('shop-selected-kicker');
        const stage = document.getElementById('shop-showcase-stage');
        if (stage) stage.dataset.previewType = 'character';
        this._shopPreviewCosmetic = item.id;
        if (kicker) kicker.textContent = 'WEARABLE PREVIEW';
        if (name) name.textContent = item.name;
        if (meta) meta.textContent = `${typeLabel} · ${String(item.rarity || 'rare').toUpperCase()} · ${equipped ? t('shop.equipped') : owned ? t('shop.owned') : t('shop.credits', { count: item.price })}`;
        if (status) status.textContent = `${item.name} · Preview`;
        if (practice) {
            practice.hidden = true;
            practice.disabled = true;
        }
        if (action) {
            action.className = 'btn btn-primary shop-selected-action';
            action.dataset.type = 'cosmetic';
            action.dataset.id = item.id;
            action.disabled = equipped;
            action.textContent = equipped ? `${item.name} equipped` : owned ? `Equip ${item.name}` : `Buy ${item.name} — ${item.price}`;
            action.classList.toggle('shop-equip', !equipped && owned);
            action.classList.toggle('shop-buy', !equipped && !owned);
            action.setAttribute('aria-label', action.textContent);
        }
        this._setShopProductCopy(store, { description: item.description, price: item.price, owned, equipped });
        document.querySelectorAll('.wearable-inspect').forEach(control => {
            const selected = control.dataset.id === item.id;
            control.setAttribute('aria-pressed', String(selected));
            control.closest('.cosmetic-card')?.classList.toggle('is-previewing', selected);
        });
        if (announce && status) status.focus?.({ preventScroll: true });
        return true;
    }

    _setShopBallShowcase(store, item, announce = false) {
        if (!item?.id) return false;
        this._shopPreviewBall = item.id;
        const owned = store.ownsBall(item.id);
        const equipped = store.get('equippedBall') === item.id;
        const stage = document.getElementById('shop-showcase-stage');
        const visual = document.getElementById('shop-selected-product-visual');
        const name = document.getElementById('shop-selected-name');
        const meta = document.getElementById('shop-selected-meta');
        const status = document.getElementById('shop-showcase-status');
        const practice = document.getElementById('btn-shop-practice');
        const action = document.getElementById('shop-selected-action');
        const kicker = document.getElementById('shop-selected-kicker');
        if (stage) stage.dataset.previewType = 'ball';
        if (visual) {
            visual.innerHTML = `<span class="shop-selected-ball" data-shape="${item.shape || 'sphere'}" data-effect="${item.effect || 'core'}" style="--ball-color:#${item.color.toString(16).padStart(6, '0')};--ball-glow:#${item.glow.toString(16).padStart(6, '0')}"></span><i class="shop-selected-ball-trail" aria-hidden="true"></i>`;
            visual.setAttribute('role', 'img');
            visual.setAttribute('aria-label', `${item.name} 3D preview`);
            visual.setAttribute('aria-hidden', 'false');
        }
        if (kicker) kicker.textContent = 'BALL SKIN PREVIEW';
        if (name) name.textContent = item.name;
        if (meta) meta.textContent = `${String(item.rarity || 'common').toUpperCase()} · ${(item.shape || 'sphere').toUpperCase()} · ${equipped ? t('shop.equipped') : owned ? t('shop.owned') : t('shop.credits', { count: item.price || 150 })}`;
        if (status) status.textContent = `${item.name} · Full-size model and trail preview`;
        if (practice) { practice.hidden = true; practice.disabled = true; }
        if (action) {
            action.className = 'btn btn-primary shop-selected-action';
            action.dataset.type = 'ball';
            action.dataset.id = item.id;
            action.disabled = equipped;
            action.textContent = equipped ? `${item.name} equipped` : owned ? `Equip ${item.name}` : `Buy ${item.name} — ${item.price || 150}`;
            action.classList.toggle('shop-equip', !equipped && owned);
            action.classList.toggle('shop-buy', !equipped && !owned);
        }
        this._setShopProductCopy(store, { description: item.description || 'A cosmetic ball finish. Ball speed, collision size and deflect timing stay the same.', price: item.price || 150, owned, equipped, type: 'ball' });
        document.querySelectorAll('#shop-grid .ball-inspect').forEach(control => {
            const selected = control.dataset.id === item.id;
            control.setAttribute('aria-pressed', String(selected));
            control.closest('.shop-card')?.classList.toggle('is-previewing', selected);
        });
        if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('warrball:shop-preview', {
                detail: Object.freeze({ type: 'ball', id: item.id, ball: item, source: 'shop' })
            }));
        }
        if (announce && status) status.focus?.({ preventScroll: true });
        return true;
    }

    _resetShopCosmeticShowcase(store) {
        this._shopPreviewCosmetic = null;
        document.querySelectorAll('.wearable-inspect').forEach(control => {
            control.setAttribute('aria-pressed', 'false');
            control.closest('.cosmetic-card')?.classList.remove('is-previewing');
        });
        const equippedSkin = AVATAR_SKINS[store.get('equippedAvatarSkin')] || AVATAR_SKINS.default;
        this._setShopShowcase(store, equippedSkin, false, false, false);
    }

    _setShopCharacterDetail(store, character, announce = false) {
        const selected = character || CHARACTERS.rally;
        const selectedId = store.get('selectedChar') || 'rally';
        const owned = store.ownsCharacter(selected.id);
        const equipped = selected.id === selectedId;
        const stage = document.getElementById('shop-showcase-stage');
        const name = document.getElementById('shop-selected-name');
        const meta = document.getElementById('shop-selected-meta');
        const status = document.getElementById('shop-showcase-status');
        const practice = document.getElementById('btn-shop-practice');
        const action = document.getElementById('shop-selected-action');
        const kicker = document.getElementById('shop-selected-kicker');

        if (stage) {
            stage.dataset.previewType = 'character';
            stage.dataset.characterId = selected.id;
        }
        if (kicker) kicker.textContent = 'FEATURED CHARACTER';
        if (name) name.textContent = selected.name;
        if (meta) meta.textContent = `${characterDesc(selected)} · ${equipped ? t('shop.inYourLoadout') : owned ? t('shop.unlocked') : t('shop.credits', { count: selected.price })}`;
        if (status) {
            status.textContent = equipped
                ? `${selected.name} is active in your loadout.`
                : owned
                    ? `${selected.name} is unlocked and ready to use.`
                    : `Inspecting ${selected.name}. Unlock this character permanently.`;
        }
        if (practice) {
            practice.hidden = true;
            practice.disabled = true;
        }
        if (action) {
            action.className = 'btn btn-primary shop-selected-action';
            action.dataset.type = 'char';
            action.dataset.id = selected.id;
            action.disabled = equipped;
            action.textContent = equipped ? t('shop.inLoadout') : owned ? t('shop.useCharacter') : t('shop.unlockPrice', { price: selected.price });
            action.classList.toggle('shop-equip', !equipped && owned);
            action.classList.toggle('shop-buy', !equipped && !owned);
        }
        document.querySelectorAll('[data-shop-preview="character"]').forEach(control => {
            const isSelected = control.dataset.id === selected.id;
            control.classList.toggle('is-previewing', isSelected);
            if (control.matches('button')) control.setAttribute('aria-pressed', String(isSelected));
        });
        const detail = Object.freeze({ type: 'character', id: selected.id, character: selected, equipped, owned, previewing: true });
        this._setShopProductCopy(store, { description: characterDesc(selected), price: selected.price, owned, equipped });
        if (stage?.dispatchEvent && typeof CustomEvent !== 'undefined') {
            stage.dispatchEvent(new CustomEvent('shop-preview-change', { bubbles: true, detail }));
        }
        if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('warrball:shop-preview', { detail }));
        }
        if (announce && status) status.focus?.({ preventScroll: true });
    }

    _finalizeShopCatalog(grid) {
        const count = grid.querySelectorAll?.('.shop-card').length || 0;
        const countEl = document.getElementById('shop-catalog-count');
        if (countEl) countEl.textContent = t('shop.itemCount', { count });
        grid.setAttribute?.('aria-busy', 'false');
        Array.from(grid.children).forEach((child, index) => { child.dataset.catalogOrder = String(index); });
    }

    // Shop clarity: shared card decoration (badge/dim/rarity data) and the filter-chip
    // predicate wiring. DOM-only, cheap — never rebuilds the grid, just toggles classes.
    _decorateShopCard(card, { category = '', rarity = '', price = 0, owned = false, equipped = false, currency = 0 } = {}) {
        const state = deriveShopCardState({ price, owned, equipped, currency });
        card.dataset.shopCategory = category;
        card.dataset.shopRarity = rarity;
        card.dataset.shopOwned = owned ? '1' : '0';
        card.dataset.shopPrice = String(Number.isFinite(price) ? price : 0);
        card.dataset.shopCurrency = String(Number.isFinite(currency) ? currency : 0);
        card.classList.toggle('shop-dim', state.dim);
        card.classList.toggle('owned', owned);
        card.classList.toggle('equipped', equipped);
        if (state.badge) {
            const badge = document.createElement('span');
            badge.className = `shop-status-badge is-${state.badge.toLowerCase()}`;
            badge.textContent = localizedName('shopBadges', String(state.badge).toLowerCase(), state.badge);
            card.appendChild(badge);
        }
        if (state.dim) {
            const note = document.createElement('div');
            note.className = 'shop-shortfall-note';
            note.textContent = t('shop.needCredits', { count: state.shortfall });
            card.appendChild(note);
        }
        card.querySelectorAll('.shop-buy, .live-offer-buy').forEach(button => {
            button.disabled = state.shortfall > 0;
            if (state.shortfall) button.title = t('shop.earnMore', { count: state.shortfall });
        });
        if (!owned && (card.dataset.shopPreview === 'character' || card.dataset.shopPreview === 'avatar')) {
            const cost = document.createElement('span');
            cost.className = 'shop-card-price';
            cost.textContent = t('shop.credits', { count: price });
            card.appendChild(cost);
        }
        return state;
    }

    _applyShopFilter(filterId) {
        const id = filterId || 'all';
        this._shopFilterId = id;
        const grid = document.getElementById('shop-grid');
        const query = document.getElementById('shop-search')?.value || '';
        const rarity = document.getElementById('shop-rarity')?.value || 'all';
        const slot = document.getElementById('shop-slot')?.value || 'all';
        const collection = document.getElementById('shop-collection')?.value || 'all';
        const sort = document.getElementById('shop-sort')?.value || 'featured';
        let visible = 0;
        const entries = Array.from(grid?.querySelectorAll('.shop-card') || [], card => {
            const descriptor = {
                category: card.dataset.shopCategory || '',
                owned: card.dataset.shopOwned === '1',
                price: Number(card.dataset.shopPrice) || 0,
                currency: Number(card.dataset.shopCurrency) || 0,
                name: card.querySelector('.char-name')?.textContent || '',
                description: card.querySelector('.char-desc')?.textContent || '',
                rarity: card.dataset.shopRarity || card.querySelector('.skin-rarity, .ball-rarity')?.textContent || 'common',
                collection: card.dataset.shopCollection || '',
                order: Number(card.dataset.catalogOrder) || 0
            };
            const matches = matchesShopFilter(id, descriptor) && matchesShopQuery(descriptor, { query, rarity, slot, collection });
            card.classList.toggle('shop-card-filtered-out', !matches);
            if (matches) visible++;
            return { card, ...descriptor };
        });
        // Restore authored groups before calculating visibility. Sorting intentionally
        // flattens them, so empty section headings never masquerade as results.
        const children = Array.from(grid?.children || []);
        children.sort((a, b) => Number(a.dataset.catalogOrder) - Number(b.dataset.catalogOrder));
        if (grid) children.forEach(child => grid.appendChild(child));
        grid?.querySelectorAll('.cosmetic-category-title').forEach(heading => {
            let next = heading.nextElementSibling;
            let hasItems = false;
            while (next && !next.classList.contains('cosmetic-category-title')) {
                if (!next.classList.contains('shop-card-filtered-out')) hasItems = true;
                next = next.nextElementSibling;
            }
            heading.hidden = sort !== 'featured' || query.trim().length > 0 || !hasItems;
        });
        if (sort !== 'featured') entries.sort((a, b) => compareShopItems(a, b, sort)).forEach(entry => grid.appendChild(entry.card));
        const count = document.getElementById('shop-catalog-count');
        if (count) count.textContent = `${visible} / ${entries.length} items`;
        const empty = document.getElementById('shop-no-results');
        if (empty) empty.hidden = visible > 0 || entries.length === 0;
        if (grid) grid.scrollTop = 0;
        const catalog = document.querySelector('#shop-screen .shop-catalog');
        if (catalog) catalog.scrollTop = 0;
        document.querySelectorAll('#shop-filters .shop-filter-chip').forEach(chip => {
            const selected = chip.dataset.filter === id;
            chip.classList.toggle('selected', selected);
            chip.setAttribute('aria-pressed', String(selected));
        });
    }

    _setShopBoostShowcase(store) {
        const boost = store.getShopXpBoostState?.() || { ...SHOP_XP_BOOST, active: null, affectsBattlepass: false };
        const active = boost.active;
        const description = boost.affectsBattlepass
            ? '1.5x Player XP and Battle Pass match XP for 60 minutes. No credit, rank or combat advantage.'
            : '1.5x Player XP for 60 minutes in local play. No credit, rank or combat advantage.';
        const expiry = active ? new Date(active.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const statusText = active
            ? `${active.multiplier}x XP active · ${Math.ceil(active.remainingMs / 60000)} min remaining · Ends ${expiry}`
            : boost.accountRequired ? 'Reconnect your account to buy this boost.'
                : 'Starts immediately after purchase. The timer also runs while you are away.';
        const labels = {
            'shop-selected-kicker': 'MATCH PROGRESSION',
            'shop-selected-name': 'Arena XP Boost',
            'shop-selected-meta': active ? 'Boost active' : '1.5x XP · 60 minutes',
            'shop-showcase-status': statusText
        };
        for (const [id, text] of Object.entries(labels)) {
            const element = document.getElementById(id);
            if (element) element.textContent = text;
        }
        const action = document.getElementById('shop-selected-action');
        if (action) {
            action.className = `btn btn-primary shop-selected-action${active || boost.accountRequired ? '' : ' shop-buy'}`;
            action.dataset.type = 'boost';
            action.dataset.id = SHOP_XP_BOOST.id;
            action.textContent = active ? t('shop.boostActive') : boost.accountRequired ? t('shop.reconnect') : t('shop.buyActivate', { price: SHOP_XP_BOOST.price });
        }
        this._setShopProductCopy(store, { description, price: SHOP_XP_BOOST.price, owned: Boolean(active), equipped: Boolean(active) || boost.accountRequired });
        const practice = document.getElementById('btn-shop-practice');
        if (practice) { practice.hidden = true; practice.disabled = true; }
        return { boost, description, statusText };
    }

    // Tier List: every case-obtainable item grouped S+ -> C, each row showing which
    // case(s) drop it and the exact chance (getCaseDropRates). Doubles as the odds
    // disclosure — the same numbers the case inspector shows, just all in one place.
    _renderTierList(grid) {
        const dropIndex = new Map();
        Object.values(CASES).forEach(box => {
            getCaseDropRates(box.id).forEach(drop => {
                const key = `${drop.type}:${drop.id}`;
                if (!dropIndex.has(key)) {
                    dropIndex.set(key, { id: drop.id, type: drop.type, name: drop.name, rarity: drop.rarity, sources: [] });
                }
                dropIndex.get(key).sources.push({ caseId: box.id, caseName: box.name, chance: drop.chance });
            });
        });
        const typeLabel = { knife: t('tierList.knife'), cosmetic: t('tierList.cosmetic'), ball: t('tierList.ballSkin'), avatar: t('tierList.characterSkin') };
        const groups = new Map(TIER_ORDER.map(t => [t, []]));
        for (const entry of dropIndex.values()) groups.get(tierForRarity(entry.rarity)).push(entry);

        const intro = document.createElement('div');
        intro.className = 'shop-tierlist-intro';
        intro.innerHTML = `<strong>${t('tierList.introTitle')}</strong><p>${t('tierList.introCopy')}</p>`;
        grid.appendChild(intro);

        for (const tier of TIER_ORDER) {
            const items = groups.get(tier);
            if (!items.length) continue;
            items.sort((a, b) => a.name.localeCompare(b.name));
            const section = document.createElement('section');
            section.className = `tierlist-group tier-${tier.replace('+', 'plus')}`;
            const heading = document.createElement('h3');
            heading.className = 'tierlist-heading';
            heading.innerHTML = `${tierBadgeHTML(items[0].rarity)}<span>${t('tierList.tier', { tier })}</span><small>${t('shop.itemCount', { count: items.length })}</small>`;
            section.appendChild(heading);
            const list = document.createElement('div');
            list.className = 'tierlist-items';
            items.forEach(entry => {
                const row = document.createElement('article');
                row.className = `tierlist-item rarity-${entry.rarity}`;
                const sources = entry.sources
                    .map(s => `<span class="tierlist-source"><b>${(s.chance * 100).toFixed(2)}%</b>${s.caseName}</span>`)
                    .join('');
                row.innerHTML = `<div class="tierlist-item-art" aria-hidden="true"></div><div class="tierlist-item-head"><span class="tierlist-item-type">${typeLabel[entry.type] || entry.type}</span><span class="tierlist-item-name">${entry.name}</span></div><div class="tierlist-item-sources">${sources || `<span class="tierlist-source-none">${t('tierList.notInCase')}</span>`}</div>`;
                list.appendChild(row);
                const art = row.querySelector('.tierlist-item-art');
                if (!this._attachItemThumb(art, entry, entry.type) && entry.type === 'cosmetic' && COSMETICS[entry.id]) {
                    appendCosmeticIcon(art, COSMETICS[entry.id]);
                }
            });
            section.appendChild(list);
            grid.appendChild(section);
        }
        if (!dropIndex.size) grid.innerHTML = `<div class="shop-empty"><strong>${t('tierList.empty')}</strong></div>`;
    }

    // ===== SHOP EKRANI =====
    // ===== Shop > Gems (js/gem-shop.js, docs/PAYMENTS.md) =====
    // Guests never reach these handlers: .gem-pack-buy/.gem-bp-buy are in
    // GUEST_GATED_SELECTOR (js/main.js), whose capture listener opens the account prompt.
    _renderGemShop(store, grid) {
        const draw = catalog => {
            const view = gemShopView(catalog, {
                gems: store.get('gems'),
                battlepassPremium: store.getBattlepassProgress?.().premium === true
            });
            grid.replaceChildren(buildGemShop(document, view));
            grid.querySelectorAll('.gem-pack-buy').forEach(button => {
                button.addEventListener('click', () => { void this._startGemCheckout(store, button); });
            });
            const bpButton = grid.querySelector('.gem-bp-buy');
            bpButton?.addEventListener('click', () => { void this._buyBattlepassWithGems(store, bpButton); });
            this._gemShopView = view;
            this._syncGemShopCount();
        };
        const cached = store.paymentCatalog || null;
        draw(cached);
        store.getPaymentCatalog?.().then(catalog => {
            if (this._shopTab === 'gems' && grid.isConnected !== false && catalog !== cached) draw(catalog);
        });
    }

    _syncGemShopCount() {
        const countEl = document.getElementById('shop-catalog-count');
        const view = this._gemShopView;
        if (!countEl || !view) return;
        countEl.textContent = view.loading ? t('gems.loading') : view.enabled ? t('gems.packCount', { count: view.packs.length }) : t('gems.comingSoon');
    }

    async _startGemCheckout(store, button) {
        if (button.disabled) return;
        const label = button.textContent;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = t('gems.openingCheckout');
        const result = await store.startGemCheckout(button.dataset.packId);
        if (result.ok) {
            rememberGemsBeforeCheckout(store.get('gems'));
            window.location.assign(result.url);
            return;
        }
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = label;
        this.showMessage(result.error, 3200);
    }

    async _buyBattlepassWithGems(store, button) {
        if (button.disabled) return;
        button.disabled = true;
        const ok = await store.buyPremiumBattlepassWithGems();
        this.showMessage(ok ? t('gems.premiumUnlocked') : (store.lastBattlepassError || t('gems.notEnough')), 3000);
        if (document.body.dataset.screen === 'shop' && this._shopTab === 'gems') this.renderShop(store, 'gems');
        else button.disabled = false;
    }

    // Stripe returns to /?purchase=success|cancel. Called once after account sync.
    async handlePurchaseReturn(store, onUpdated) {
        if (typeof location === 'undefined') return;
        const outcome = readPurchaseReturn(location.search);
        if (!outcome) return;
        try { history.replaceState(history.state, '', stripPurchaseParams(location.href)); } catch {}
        if (outcome === 'cancel') {
            this.showMessage(t('gems.checkoutCancelled'), 3200);
            return;
        }
        const remembered = takeGemsBeforeCheckout();
        const before = remembered ?? (Number(store.get('gems')) || 0);
        this.showMessage(t('gems.paymentReceived'), 3200);
        const credited = await awaitGemCredit({
            before,
            refresh: () => store.connectRemote(store.get('playerName')),
            readGems: () => store.get('gems')
        });
        this.showMessage(credited > 0
            ? `+${credited} gems added. Thank you!`
            : 'Payment confirmed. Gems can take a minute to appear — check the Shop shortly.', 4200);
        onUpdated?.();
        if (document.body.dataset.screen === 'shop') this.renderShop(store, this._shopTab || 'gems');
    }

    renderShop(store, tab = 'chars') {
        clearTimeout(this._shopBoostExpiryTimer);
        const grid = document.getElementById('shop-grid');
        const coinsEl = document.getElementById('shop-coins');
        if (coinsEl) coinsEl.textContent = store.get('currency');
        const gemsEl = document.getElementById('shop-gems');
        if (gemsEl) gemsEl.textContent = String(Number(store.get('gems')) || 0);
        if (!grid) return;
        const sameTab = this._shopTab === tab;
        const scrollTop = sameTab ? grid.scrollTop : 0;
        const catalog = document.querySelector('#shop-screen .shop-catalog');
        const catalogScrollTop = sameTab ? catalog?.scrollTop || 0 : 0;
        const previewCosmetic = this._shopPreviewCosmetic;
        if (!sameTab) {
            const search = document.getElementById('shop-search');
            if (search) search.value = '';
            ['shop-rarity', 'shop-slot', 'shop-collection'].forEach(id => {
                const control = document.getElementById(id);
                if (control) control.value = 'all';
            });
            this._shopFilterId = 'all';
        }
        this._shopTab = tab;
        if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('warrball:shop-preview-reset'));
        }
        window.UI?.renderEarnSlot?.();
        const coinBalance = store.get('currency') || 0;
        this._syncShopTabs(tab);
        grid.setAttribute?.('aria-busy', 'true');
        if (typeof grid.replaceChildren === 'function') grid.replaceChildren();
        else grid.innerHTML = '';

        const equippedSkin = AVATAR_SKINS[store.get('equippedAvatarSkin')] || AVATAR_SKINS.default;
        if (tab !== 'chars') this._setShopShowcase(store, equippedSkin);

        if (tab === 'live') {
            const market = store.getLiveMarket?.() || { offers: [] };
            const until = Number.isFinite(market.expiresAt)
                ? new Date(market.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
            if (!market.offers?.length) {
                grid.innerHTML = `<div class="shop-empty"><strong>${t('shop.liveUnavailable')}</strong><p>${t('shop.liveUnavailableCopy')}</p><button type="button" class="btn btn-secondary btn-small shop-live-retry">${t('shop.liveRetry')}</button></div>`;
                const countEl = document.getElementById('shop-catalog-count');
                if (countEl) countEl.textContent = t('shop.noLiveOffers');
            }
            (market.offers || []).forEach(offer => {
                const item = offer.kind === 'cosmetic' ? COSMETICS[offer.itemId] : BALL_SKINS[offer.itemId];
                if (!item) return;
                const owned = offer.kind === 'cosmetic'
                    ? store.ownsCosmetic(offer.itemId)
                    : store.ownsBall(offer.itemId);
                const card = document.createElement('div');
                card.className = `shop-card live-deal rarity-${item.rarity || 'common'} ${owned ? 'owned' : ''}`;
                const visual = offer.kind === 'cosmetic'
                    ? `<div class="cosmetic-preview cosmetic-preview-${item.type}" style="--cosmetic-primary:${item.colors[0]};--cosmetic-secondary:${item.colors[1]}"></div>`
                    : '<div class="ball-inspect-stage"><div class="ball-preview"></div><span class="ball-inspect-trail" aria-hidden="true"></span></div>';
                card.innerHTML = `<div class="live-deal-badge">${t('shop.discountToday', { discount: offer.discount })}</div>${visual}<div class="char-name">${item.name}</div><div class="char-desc">${until ? t('shop.rotatesAt', { time: until }) : t('shop.rotatesMidnight')}</div>${owned ? '' : `<button class="btn btn-primary btn-small live-offer-buy" data-offer-id="${offer.id}"><s>${offer.basePrice}</s> ${t('shop.buyPrice', { price: offer.price })}</button>`}`;
                if (offer.kind === 'cosmetic') appendCosmeticIcon(card.querySelector('.cosmetic-preview'), item);
                if (offer.kind === 'cosmetic' ? item.type === 'gloves' : true) {
                    this._attachItemThumb(card.querySelector(offer.kind === 'cosmetic' ? '.cosmetic-preview' : '.ball-inspect-stage'), { ...item, id: offer.itemId }, offer.kind === 'cosmetic' ? 'cosmetic' : 'ball');
                }
                const preview = card.querySelector('.ball-preview');
                if (preview) {
                    preview.dataset.effect = item.effect || 'core';
                    preview.dataset.shape = item.shape || 'sphere';
                    preview.style.setProperty('--ball-color', `#${item.color.toString(16).padStart(6, '0')}`);
                    preview.style.setProperty('--ball-glow', `#${item.glow.toString(16).padStart(6, '0')}`);
                }
                this._decorateShopCard(card, { category: offer.kind === 'cosmetic' ? 'cosmetic' : 'ball', rarity: item.rarity, price: offer.price, owned, currency: coinBalance });
                grid.appendChild(card);
            });
        } else if (tab === 'chars') {
            const selectedCharacter = CHARACTERS[this._shopPreviewCharacter] || CHARACTERS[store.get('selectedChar')] || CHARACTERS.rally;
            Object.values(CHARACTERS).forEach((c, index) => {
                const owned = store.ownsCharacter(c.id);
                const card = document.createElement('div');
                card.className = `shop-card char-${c.id} ${owned ? 'owned' : ''}`;
                card.style.setProperty('--char-color', `#${c.color.toString(16).padStart(6, '0')}`);
                card.dataset.nameFit = shopNameFitTier(c.name);
                card.dataset.shopPreview = 'character';
                card.dataset.id = c.id;
                const portraitPath = characterPortraitPath(c.id);
                const portraitMarkup = portraitPath
                    ? `<img src="${portraitPath}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display=''"><div class="shop-portrait-fallback" style="display:none" aria-hidden="true">${c.emoji}</div>`
                    : `<div class="shop-portrait-fallback" aria-hidden="true">${c.emoji}</div>`;
                card.innerHTML = `<button type="button" class="shop-character-select" data-shop-preview="character" data-id="${c.id}" aria-label="${t('shop.inspectName', { name: c.name })}" aria-pressed="${selectedCharacter.id === c.id}"><span class="shop-portrait">${portraitMarkup}</span><span class="char-name">${c.name}</span><span class="char-desc">${characterDesc(c)}</span><span class="shop-preview-label">${t('case.inspect')}</span></button>`;
                card.querySelector('.shop-character-select')?.addEventListener('click', () => {
                    this._shopPreviewCharacter = c.id;
                    this._setShopCharacterDetail(store, c, true);
                });
                this._decorateShopCard(card, { category: 'character', price: c.price, owned, equipped: c.id === store.get('selectedChar'), currency: coinBalance });
                grid.appendChild(card);
            });
            this._shopPreviewCharacter = selectedCharacter.id;
            this._setShopCharacterDetail(store, selectedCharacter);
        } else if (tab === 'balls') {
            const preferredBall = this._shopPreviewBall || store.get('equippedBall');
            let selectedBall = preferredBall !== 'classic' && BALL_SKINS[preferredBall] ? { ...BALL_SKINS[preferredBall], id: preferredBall } : null;
            Object.entries(BALL_SKINS).forEach(([id, b]) => {
                if (id === 'classic') return;
                if (!selectedBall) selectedBall = { ...b, id };
                const owned = store.ownsBall(id);
                const card = document.createElement('div');
                card.className = `shop-card ball-skin rarity-${b.rarity || 'common'} ${owned ? 'owned' : ''}`;
                const equipped = store.get('equippedBall') === id;
                card.innerHTML = `<div class="ball-inspect-stage"><div class="ball-preview" style="background:${'#'+b.color.toString(16).padStart(6,'0')}"></div><span class="ball-inspect-trail" aria-hidden="true"></span></div><div class="char-name">${b.name}</div><button class="btn btn-small ball-inspect" data-id="${id}" aria-pressed="false">Inspect trail</button>${owned ? (equipped ? '<div class="shop-owned">Equipped</div>' : `<button class="btn btn-small shop-equip" data-type="ball" data-id="${id}">Equip</button>`) : `<button class="btn btn-primary btn-small shop-buy" data-type="ball" data-id="${id}">COINS 150</button>`}`;
                const preview = card.querySelector('.ball-preview');
                // Model skins (js/ball.js BALL_SKINS carry a `shape`) look identical to every
                // other skin as a flat CSS disc. The shape rides on the card and the preview so
                // the silhouette reads in the grid, and .ball-inspect can spin the real geometry.
                const shape = b.shape || 'sphere';
                card.dataset.ballShape = shape;
                if (preview) {
                    preview.style.background = '';
                    preview.dataset.shape = shape;
                    preview.dataset.effect = b.effect || 'core';
                    preview.style.setProperty('--ball-color', `#${b.color.toString(16).padStart(6, '0')}`);
                    preview.style.setProperty('--ball-glow', `#${b.glow.toString(16).padStart(6, '0')}`);
                }
                if (b.rarity) {
                    const rarity = document.createElement('div');
                    rarity.className = 'ball-rarity';
                    rarity.textContent = b.rarity;
                    card.querySelector('.char-name')?.after(rarity);
                }
                if (b.shape) {
                    const shapeTag = document.createElement('span');
                    shapeTag.className = 'ball-shape-tag';
                    shapeTag.textContent = 'MODEL SKIN';
                    card.querySelector('.ball-inspect-stage')?.appendChild(shapeTag);
                    const inspect = card.querySelector('.ball-inspect');
                    if (inspect) inspect.textContent = 'Inspect in 3D';
                }
                const buy = card.querySelector('.shop-buy');
                if (buy) buy.textContent = `Buy — ${b.price || 150}`;
                card.querySelector('.ball-inspect')?.addEventListener('click', () => this._setShopBallShowcase(store, { ...b, id }, true));
                this._attachItemThumb(card.querySelector('.ball-inspect-stage'), { ...b, id }, 'ball');
                this._decorateShopCard(card, { category: 'ball', rarity: b.rarity, price: b.price || 150, owned, equipped, currency: coinBalance });
                grid.appendChild(card);
            });
            if (selectedBall) this._setShopBallShowcase(store, selectedBall);
        } else if (tab === 'avatars') {
            const visibleSkins = Object.values(AVATAR_SKINS).filter(s => s.id !== 'default');
            const previewId = AVATAR_SKINS[this._shopPreviewAvatar]?.id || equippedSkin.id;
            visibleSkins.forEach(s => {
                const owned = s.price === 0 || store.hasAvatarAccess(s.id);
                const equipped = store.get('equippedAvatarSkin') === s.id;
                const card = document.createElement('article');
                card.className = `shop-card avatar-skin-card ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}`;
                card.dataset.shopPreview = 'avatar';
                card.dataset.id = s.id;

                const select = document.createElement('button');
                select.type = 'button';
                select.className = 'shop-preview-select';
                select.dataset.shopPreview = 'avatar';
                select.dataset.id = s.id;
                select.setAttribute('aria-label', `Preview ${s.name}`);
                select.setAttribute('aria-pressed', String(previewId === s.id));
                select.innerHTML = `<span class="skin-preview" style="--skin-head:${s.head};--skin-body:${s.body};--skin-arms:${s.arms};--skin-legs:${s.legs}" aria-hidden="true"></span><span class="shop-card-copy"><span class="char-name">${s.name}</span><span class="char-desc">${s.model === 'slim' ? 'Slim' : 'Classic'} player model</span></span><span class="shop-preview-label">Preview</span>`;
                select.addEventListener('click', () => {
                    this._shopPreviewAvatar = s.id;
                    this._setShopShowcase(store, s, true, true);
                });
                card.appendChild(select);

                this._decorateShopCard(card, { category: 'cosmetic', rarity: s.rarity, price: s.price, owned, equipped, currency: coinBalance });
                grid.appendChild(card);
            });
            const selectedSkin = AVATAR_SKINS[previewId] || equippedSkin;
            this._shopPreviewAvatar = selectedSkin.id;
            this._setShopShowcase(store, selectedSkin, false);
        } else if (tab === 'wearables') {
            const equipped = store.get('equippedWearables') || {};
            const fresh = Object.values(COSMETICS).filter(item => shopCollectionForItem(item)?.isNew);
            const groups = [
                ['new', 'New arrivals · Court Carnival + Orbital Club', fresh],
                ...Object.entries(COSMETIC_TYPES).map(([type, label]) => [type, label, cosmeticsByType(type).filter(item => !shopCollectionForItem(item)?.isNew)])
            ];
            groups.forEach(([type, label, items]) => {
                const heading = document.createElement('h3');
                heading.className = 'cosmetic-category-title';
                heading.textContent = label;
                if (equipped[type] && equipped[type] !== 'none') {
                    const clear = document.createElement('button');
                    clear.className = 'btn btn-small cosmetic-clear';
                    clear.dataset.type = type;
                    clear.textContent = `Remove ${label}`;
                    heading.appendChild(clear);
                }
                grid.appendChild(heading);
                items.forEach(item => {
                    const owned = store.ownsCosmetic(item.id);
                    const active = equipped[item.type] === item.id;
                    const card = document.createElement('article');
                    card.className = `shop-card cosmetic-card rarity-${item.rarity} ${owned ? 'owned' : ''} ${active ? 'equipped' : ''}`;
                    card.dataset.cosmeticId = item.id;
                    const collection = shopCollectionForItem(item);
                    card.dataset.shopCollection = collection?.id || '';
                    if (collection?.isNew) card.dataset.newArrival = 'true';
                    card.style.setProperty('--cosmetic-primary', item.colors[0]);
                    card.style.setProperty('--cosmetic-secondary', item.colors[1]);
                    const preview = document.createElement('div');
                    preview.className = `cosmetic-preview cosmetic-preview-${item.type}`;
                    preview.dataset.style = item.style;
                    appendCosmeticIcon(preview, item);
                    // Gloves get the real first-person fist; other slots keep their icon.
                    if (item.type === 'gloves') this._attachItemThumb(preview, item, 'cosmetic');
                    preview.setAttribute('aria-hidden', 'true');
                    const name = document.createElement('div');
                    name.className = 'char-name';
                    name.textContent = item.name;
                    const rarity = document.createElement('span');
                    rarity.className = `skin-rarity rarity-${item.rarity}`;
                    rarity.textContent = item.rarity;
                    const tierWrap = document.createElement('div');
                    tierWrap.innerHTML = tierBadgeHTML(item.rarity);
                    const tier = tierWrap.firstElementChild;
                    const description = document.createElement('div');
                    description.className = 'char-desc';
                    description.textContent = item.description;
                    const action = document.createElement('button');
                    action.className = owned ? 'btn btn-small shop-equip' : 'btn btn-primary btn-small shop-buy';
                    action.dataset.type = 'cosmetic';
                    action.dataset.id = item.id;
                    action.textContent = active ? t('shop.equipped') : owned ? t('case.equip') : t('shop.buyPrice', { price: item.price });
                    action.disabled = active;
                    const actions = document.createElement('div');
                    actions.className = 'shop-card-actions';
                    const inspect = document.createElement('button');
                    inspect.type = 'button';
                    inspect.className = 'btn btn-small wearable-inspect';
                    inspect.dataset.id = item.id;
                    inspect.setAttribute('aria-pressed', 'false');
                    inspect.textContent = t('case.inspect');
                    inspect.addEventListener('click', () => this._dispatchCosmeticPreview(item));
                    actions.append(inspect, action);
                    card.append(preview, name, rarity, tier, description, actions);
                    this._decorateShopCard(card, { category: item.type, rarity: item.rarity, price: item.price, owned, equipped: active, currency: coinBalance });
                    grid.appendChild(card);
                });
            });
            const selectedCosmetic = COSMETICS[previewCosmetic] || fresh[0];
            if (selectedCosmetic) this._dispatchCosmeticPreview(selectedCosmetic);
        } else if (tab === 'boosts') {
            const { boost, description, statusText } = this._setShopBoostShowcase(store);
            const card = document.createElement('div');
            card.className = 'shop-card xp-boost-card';
            card.innerHTML = '<div class="skill-emoji" aria-hidden="true">1.5×</div><div class="char-name">Arena XP Boost</div><div class="char-desc"></div><p class="shop-boost-status" role="status"></p><button class="btn btn-primary btn-small" data-type="boost" data-id="xp-15"></button>';
            card.querySelector('.char-desc').textContent = description;
            card.querySelector('.shop-boost-status').textContent = statusText;
            const buy = card.querySelector('button');
            const blocked = Boolean(boost.active) || boost.accountRequired || coinBalance < SHOP_XP_BOOST.price;
            buy.disabled = blocked;
            buy.classList.toggle('shop-buy', !boost.active && !boost.accountRequired);
            buy.textContent = boost.active ? t('shop.boostActive') : boost.accountRequired ? t('shop.reconnect') : t('shop.buyActivate', { price: SHOP_XP_BOOST.price });
            this._decorateShopCard(card, { category: 'boost', price: SHOP_XP_BOOST.price, owned: Boolean(boost.active), currency: coinBalance });
            grid.appendChild(card);
            if (boost.active) this._shopBoostExpiryTimer = setTimeout(() => {
                if (document.body.dataset.screen === 'shop' && this._shopTab === 'boosts') this.renderShop(store, 'boosts');
            }, Math.min(2147483647, Math.max(1, boost.active.remainingMs + 25)));
        } else if (tab === 'cases') {
            // Group cases by their skin-theme collection (js/cosmetics.js COLLECTIONS):
            // a labeled header in the collection's accent colour + tagline precedes its
            // case card. Cases outside any collection render exactly as before.
            const collectionByCaseId = Object.fromEntries(Object.values(COLLECTIONS).map(entry => [entry.case, entry]));
            let lastCollectionId = null;
            Object.values(CASES).forEach(box => {
                const collection = collectionByCaseId[box.id] || null;
                if (collection && collection.id !== lastCollectionId) {
                    const header = document.createElement('h3');
                    header.className = 'cosmetic-category-title case-collection-title';
                    header.style.setProperty('--collection-accent', collection.accent);
                    header.innerHTML = `<span class="case-collection-name">${collection.name}</span><span class="case-collection-tagline">${collection.tagline}</span>`;
                    grid.appendChild(header);
                }
                lastCollectionId = collection ? collection.id : null;
                const card = document.createElement('article');
                card.className = `shop-card case-card case-${box.id}${collection ? ' case-collection-item' : ''}`;
                if (collection) card.style.setProperty('--collection-accent', collection.accent);
                const pity = store.getCasePityState(box.id);
                const earned = store.getEarnedCaseState?.(box.id)?.cases || 0;
                card.innerHTML = `
                    <div class="case-art"><img src="${box.art}" width="512" height="512" loading="lazy" alt="${box.name} crate"></div>
                    <div class="case-card-head"><div>${collection ? `<span class="case-series case-collection-tag">${collection.name.toUpperCase()}</span>` : `<span class="case-series">${t('cases.arenaDrop')}</span>`}<div class="char-name">${box.name}</div></div><strong>${box.price}</strong></div>
                    <div class="case-balance">${t('cases.balance', { count: store.get('currency') })}</div>
                    ${earned ? `<div class="case-earned">${t('cases.earnedReady', { count: earned })}</div>` : `<div class="case-earned muted">${t('cases.earnFree')}</div>`}
                    <div class="case-pity ${pity.nextGuaranteed ? 'ready' : ''}">
                        ${t('cases.pity')}: ${pity.nextGuaranteed ? t('cases.nextOpen') : `${pity.count}/${pity.threshold}`}
                    </div>
                    <button class="btn btn-primary btn-small case-select" type="button" data-id="${box.id}" aria-label="${t('shop.inspectName', { name: box.name })}">${t('cases.inspectOpen')}</button>`;
                this._decorateShopCard(card, { category: 'case', price: earned > 0 ? 0 : box.price, owned: false, currency: coinBalance });
                grid.appendChild(card);
            });
        } else if (tab === 'tierlist') {
            this._renderTierList(grid);
        } else if (tab === 'gems') {
            this._renderGemShop(store, grid);
        }
        this._finalizeShopCatalog(grid);
        if (!this._shopFiltersBound) {
            document.getElementById('shop-filters')?.addEventListener('click', e => {
                const chip = e.target.closest('.shop-filter-chip');
                if (chip) this._applyShopFilter(chip.dataset.filter);
            });
            ['shop-search', 'shop-rarity', 'shop-sort', 'shop-slot', 'shop-collection'].forEach(id => {
                document.getElementById(id)?.addEventListener(id === 'shop-search' ? 'input' : 'change', () => this._applyShopFilter(this._shopFilterId));
            });
            document.getElementById('shop-clear-filters')?.addEventListener('click', () => {
                document.getElementById('shop-search').value = '';
                document.getElementById('shop-rarity').value = 'all';
                document.getElementById('shop-slot').value = 'all';
                const collection = document.getElementById('shop-collection');
                if (collection) collection.value = 'all';
                document.getElementById('shop-sort').value = 'featured';
                this._applyShopFilter('all');
                document.getElementById('shop-search').focus();
            });
            this._shopFiltersBound = true;
        }
        if (tab === 'tierlist') {
            const countEl = document.getElementById('shop-catalog-count');
            if (countEl) countEl.textContent = `${grid.querySelectorAll('.tierlist-item').length} items · every case-obtainable drop`;
        } else if (tab === 'gems') {
            this._syncGemShopCount();
        } else {
            this._applyShopFilter(this._shopFilterId || 'all');
        }
        grid.scrollTop = scrollTop;
        if (catalog) catalog.scrollTop = catalogScrollTop;
    }

    updateContractTracker(daily, store) {
        const tracker = document.getElementById('contract-tracker');
        if (!tracker) return;
        // Authenticated objectives must mirror the server-owned UTC catalog;
        // guests retain the existing deterministic local Daily fallback.
        const dailies = store?.getDailyChallenges?.() || daily?.getChallenges?.() || [];
        const contracts = store?.getSeasonContracts?.() || [];
        const items = [
            ...dailies.filter(item => !item.claimed).slice(0, 2).map(item => ({ ...item, tag: 'DAILY' })),
            ...contracts.filter(item => !item.claimed).slice(0, 1).map(item => ({ ...item, tag: 'WEEKLY' }))
        ];
        if (!items.length) {
            tracker.dataset.ready = 'false';
            return tracker.classList.add('hidden');
        }
        tracker.dataset.ready = 'true';
        tracker.classList.add('hidden');
        tracker.innerHTML = `<header>LIVE OBJECTIVES</header>${items.map(item => {
            const progress = Math.min(item.target, item.progress || 0);
            return `<div class="contract-track-row"><small>${item.tag}</small><b>${item.name}</b><span>${progress}/${item.target}</span><i><em style="width:${Math.round(progress / item.target * 100)}%"></em></i></div>`;
        }).join('')}`;
    }

    _isCaseReelReduced() {
        return document.documentElement.classList.contains('reduce-motion')
            || document.body.classList.contains('reduced-motion');
    }

    _isReducedMotion() {
        return document.documentElement.classList.contains('reduce-motion')
            || document.body.classList.contains('reduced-motion')
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    _setupHoverAudio() {
        document.addEventListener('pointerenter', (e) => {
            if (!this.audio?.playCue) return;
            const target = e.target;
            const interactiveSelectors = ['button', '.btn', '.tab', '.ow-tab', '.shop-card', '.case-select'];
            for (const sel of interactiveSelectors) {
                if ((target.matches && target.matches(sel)) || target.closest?.(sel)) {
                    this.audio.playCue('ui-hover');
                    break;
                }
            }
        }, true);
    }

    showCaseReel(box, result, { onSettled, onInspect, onEquip, onOpenAnother, onClose } = {}) {
        const overlay = document.getElementById('case-reel');
        const track = document.getElementById('case-reel-track');
        const resultEl = document.getElementById('case-reel-result');
        if (!overlay || !track || !resultEl || !result?.reward) return;
        this._caseReelCleanup?.(false);
        const generation = (this._caseReelGeneration || 0) + 1;
        this._caseReelGeneration = generation;
        const getReturnFocus = () => document.querySelector(`.case-select[data-id="${box?.id}"]`)
            || document.getElementById('shop-tab-cases')
            || document.getElementById('btn-shop-back');
        const actions = document.getElementById('case-reel-actions');
        const inspectAction = document.getElementById('case-reel-inspect');
        const equipAction = document.getElementById('case-reel-equip');
        const anotherAction = document.getElementById('case-reel-open-another');
        const closeAction = document.getElementById('case-reel-close');
        const skipAction = document.getElementById('case-reel-skip');
        actions?.classList.add('hidden');
        if (skipAction) {
            skipAction.hidden = false;
            skipAction.disabled = false;
        }
        if (equipAction) {
            equipAction.disabled = false;
            equipAction.textContent = result.reward.type === 'knife' ? 'Manage in Locker' : 'Equip';
        }
        const drops = getCaseDropRates(box?.id);
        const targetIndex = 24;
        const items = Array.from({ length: 31 }, (_, index) => drops[index % Math.max(1, drops.length)] || result.reward);
        items[targetIndex] = result.reward;
        // CS:GO-style near-miss tension: reposition (never replace) filler tiles
        // so a high-rarity item often sits right beside the winner. Pure shuffle —
        // drop-rate odds are untouched, only where each already-rolled filler lands.
        const arrangedItems = arrangeNearMissFillers(items, targetIndex, { windowSize: 2, minAdjacent: 1 });
        track.className = 'case-reel-track';
        // `settleImmediately()` uses an inline animation reset so Escape/Skip
        // cannot leave the spinner half-way through a stale keyframe. The reel
        // node is intentionally reused, therefore that reset must be cleared
        // before every new opening or the next CSS spin is silently overridden
        // and appears to reveal the reward immediately.
        track.style.removeProperty('animation');
        track.style.removeProperty('transform');
        track.style.removeProperty('--case-reel-stop');
        track.innerHTML = arrangedItems.map(item => {
            const type = this._caseReelTypeLabel(item);
            const rarity = item.rarity || result.reward.rarity || 'rare';
            const kind = item.type === 'avatar' ? 'avatar'
                : item.type === 'ball' ? 'ball'
                : item.type === 'cosmetic' ? 'cosmetic'
                : 'knife';
            return `<div class="case-reel-item rarity-${rarity}" data-rarity="${rarity}">${tierBadgeHTML(rarity)}<div class="case-reel-art" aria-hidden="true"><span class="case-reel-orb" data-type="${kind}"></span></div><small>${type}</small><b>${item.name || item.id}</b></div>`;
        }).join('');
        // Real 3D renders replace the orbs as they arrive (warmed by the inspector).
        this._attachReelThumbnails(track, arrangedItems, targetIndex);
        resultEl.textContent = '';
        resultEl.removeAttribute('data-rarity');
        const preview = document.getElementById('case-reward-preview');
        if (preview) {
            preview.className = 'case-reward-preview';
            preview.removeAttribute('style');
        }
        // Reset flourishes left over from a previous reveal on this reused
        // overlay — confetti pieces are removed outright, not just hidden.
        overlay.querySelectorAll('.case-confetti-piece').forEach(node => node.remove());
        overlay.classList.remove('case-reveal-pulse', 'case-reveal-prestop');
        const staleGlow = document.getElementById('case-reveal-glow');
        if (staleGlow) { staleGlow.style.opacity = 0; staleGlow.className = 'case-reveal-glow'; }
        overlay.classList.remove('hidden');
        let settled = false;
        // The reel is the reward moment: only the explicit in-game "Reduce motion"
        // setting collapses it. An OS-level preference alone keeps the spin but drops
        // the screen flash, confetti and pulses.
        const presentation = revealPresentationForRarity(result.reward.rarity, { reducedMotion: this._isCaseReelReduced() });
        if (!presentation.reducedMotion && this._isReducedMotion()) {
            presentation.flash = 0;
            presentation.confetti = false;
            presentation.pulse = false;
        }
        overlay.dataset.revealTier = presentation.tier;
        overlay.dataset.revealRarity = presentation.rarity;
        // 3D reveal stage: built now so its WebGL context and shaders are ready by
        // the time the reel settles; null (no WebGL) keeps the classic reveal.
        let revealStage = this._prepareCaseRevealStage(overlay, result.reward, presentation);
        let flashFadeTimer = null;
        let preStopTimer = null;
        let tickTimers = [];
        let timer = null;
        let onKeyDown = null;
        const closeReel = (restoreFocus = true) => {
            if (this._caseReelGeneration !== generation) return false;
            clearTimeout(timer);
            clearTimeout(flashFadeTimer);
            clearTimeout(preStopTimer);
            tickTimers.forEach(clearTimeout);
            if (onKeyDown) overlay.removeEventListener('keydown', onKeyDown);
            revealStage?.dispose();
            revealStage = null;
            this._resetCaseRevealStage(overlay);
            overlay.classList.add('hidden');
            actions?.classList.add('hidden');
            this._closeExclusive('caseReel');
            this._caseReelCleanup = null;
            this._caseReelGeneration = generation + 1;
            if (restoreFocus) getReturnFocus()?.focus?.({ preventScroll: true });
            return true;
        };
        this._caseReelCleanup = closeReel;
        this._openExclusive('caseReel', () => closeReel(true));
        const finish = () => {
            if (settled || this._caseReelGeneration !== generation) return;
            settled = true;
            clearTimeout(flashFadeTimer);
            clearTimeout(preStopTimer);
            tickTimers.forEach(clearTimeout);
            track.classList.add('settled');
            track.children[targetIndex]?.classList.add('is-winner');
            const rewardPreview = document.getElementById('case-reward-preview');
            if (rewardPreview) {
                rewardPreview.className = `case-reward-preview active rarity-${result.reward.rarity || 'common'} ${result.reward.type === 'avatar' ? 'avatar' : `model-${result.reward.model || 'classic'}`}`;
                rewardPreview.style.setProperty('--reward-color', result.reward.color || result.reward.body || '#55eadc');
                rewardPreview.style.setProperty('--reward-accent', result.reward.accent || result.reward.head || '#153e64');
            }
            resultEl.dataset.rarity = result.reward.rarity || 'common';
            resultEl.innerHTML = `<span>${result.duplicate ? formatDuplicateConversion(result.refund) : 'UNLOCKED - INVENTORY READY'}</span><strong>${result.reward.name}</strong>`;
            actions?.classList.remove('hidden');
            if (skipAction) skipAction.hidden = true;
            inspectAction?.focus?.({ preventScroll: true });
            if (revealStage) this._playCaseRevealStage(overlay, revealStage, result.reward, generation);
            // The legacy knife preview is only needed when the 3D stage is unavailable.
            else this.onCaseRewardReveal?.(result.reward);
            this.audio?.playCaseRevealSting?.(presentation.rarity);
            // Result toast/CTA belongs to the locked reel state. `settled`
            // above guarantees normal, skip and reduced-motion paths fire it once.
            onSettled?.(result);
            // Rarity-tinted glow (blue/purple/gold) — dedicated element, not the
            // shared #juice-flash combat uses, so colors never fight each other.
            if (presentation.glow && presentation.flash > 0) {
                flashFadeTimer = setTimeout(() => {
                    const glow = this._ensureCaseRevealGlow(presentation.rarity);
                    glow.style.opacity = presentation.flash;
                    const decayTime = 280;
                    const decaySteps = 28;
                    let step = 0;
                    const fadeOut = () => {
                        if (this._caseReelGeneration !== generation) return;
                        step++;
                        glow.style.opacity = presentation.flash * Math.max(0, 1 - step / decaySteps);
                        if (step < decaySteps) flashFadeTimer = setTimeout(fadeOut, decayTime / decaySteps);
                    };
                    fadeOut();
                }, 220);
            }
            if (presentation.pulse) overlay.classList.add('case-reveal-pulse');
            if (presentation.confetti) this._spawnCaseConfetti(overlay);
            if (presentation.sfx && this.audio?.playSfx) {
                this.audio.playSfx(presentation.sfx, 0.7);
            }
        };
        const settleImmediately = () => {
            clearTimeout(timer);
            clearTimeout(flashFadeTimer);
            clearTimeout(preStopTimer);
            tickTimers.forEach(clearTimeout);
            track.classList.remove('spin');
            track.style.animation = 'none';
            finish();
        };
        onKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (settled) closeReel(true);
                else settleImmediately();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...overlay.querySelectorAll('button:not([hidden]):not([disabled])')]
                .filter(node => node.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!focusable.includes(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        overlay.addEventListener('keydown', onKeyDown);
        requestAnimationFrame(() => {
            if (this._caseReelGeneration !== generation) return;
            const selected = track.children[targetIndex];
            const stop = Math.round(
                overlay.querySelector('.case-reel-window').clientWidth / 2
                - (selected.offsetLeft + selected.offsetWidth / 2)
            );
            track.style.setProperty('--case-reel-stop', `${stop}px`);
            if (settled) {
                track.style.transform = `translate3d(${stop}px, 0, 0)`;
                return;
            }
            if (presentation.reducedMotion) {
                // Reduced motion: skip the 6-7s CS:GO crawl outright — jump
                // straight to the settled position with a short opacity fade
                // instead of the spin; ticks never fire (nothing is crossing).
                track.style.transform = `translate3d(${stop}px, 0, 0)`;
                track.classList.add('case-reel-reduced');
                requestAnimationFrame(() => {
                    if (this._caseReelGeneration === generation) track.classList.add('case-reel-reduced-in');
                });
                finish();
                return;
            }
            // CS:GO pacing: fast launch -> long decelerate -> crawl -> a tiny
            // overshoot/back-correction, all driven by @keyframes case-reel-spin
            // (css/polish.css) — a single `transform`-only CSS animation, so
            // adding the class is enough; no transition reflow-forcing needed.
            track.style.animationDuration = presentation.spinMs + 'ms';
            track.classList.add('spin');
            tickTimers = this._scheduleReelTicks(presentation.spinMs, targetIndex);
        });
        // Legendary-only: a brief hitch just before the reel settles. This is
        // a CSS filter pulse on the window frame, not a Juice.slowMo() call —
        // the case reel is a shop/menu overlay with no live Juice instance in
        // scope (Juice only exists per in-match Game), and cosmetics.js's own
        // slowMo contract already drives spinMs via CSS animation-duration.
        // A real timeScale call would either no-op here or bleed into an
        // unrelated match loop, so the "slowdown" stays in the same CSS-driven
        // lane as the rest of the reel's pacing.
        if (!presentation.reducedMotion) {
            if (presentation.preStop) {
                const hitchLead = Math.min(260, Math.max(0, presentation.spinMs - 200));
                preStopTimer = setTimeout(() => overlay.classList.add('case-reveal-prestop'), Math.max(0, presentation.spinMs + 100 - hitchLead));
            }
            timer = setTimeout(finish, presentation.spinMs + 100);
        }
        if (skipAction) skipAction.onclick = settleImmediately;
        if (inspectAction) inspectAction.onclick = () => {
            if (!settled || !closeReel(false)) return;
            onInspect?.(result);
        };
        if (equipAction) equipAction.onclick = async () => {
            if (!settled || equipAction.disabled) return;
            if (result.reward.type === 'knife') {
                if (!closeReel(false)) return;
                onInspect?.(result);
                return;
            }
            equipAction.disabled = true;
            const equipped = await onEquip?.(result);
            equipAction.textContent = equipped === false ? 'Unavailable' : 'Equipped';
            if (equipped === false) equipAction.disabled = false;
        };
        if (anotherAction) anotherAction.onclick = () => {
            if (!settled || !closeReel(false)) return;
            onOpenAnother?.(box, result);
        };
        if (closeAction) closeAction.onclick = () => {
            if (!closeReel(true)) return;
            onClose?.(result);
        };
        overlay.querySelector('.case-reel-card')?.focus?.({ preventScroll: true });
    }

    // Schedules WebAudio tick cues for the case-reel spin — one per tile
    // crossing, computed analytically from computeCaseReelTickSchedule
    // (cosmetics.js) rather than polled every frame. Chosen over a rAF
    // watcher reading the live transform: the crossing times are fully known
    // up front from the same bezier driving the CSS animation, so this is
    // ~20-30 one-shot setTimeout calls (cheap, self-cleaning on skip) instead
    // of a persistent per-frame poller running for the whole 6-7s spin.
    _scheduleReelTicks(spinMs, targetIndex) {
        const schedule = computeCaseReelTickSchedule(spinMs, targetIndex);
        return schedule.map(({ index, timeMs }, order) => setTimeout(() => {
            const progress = index / Math.max(1, targetIndex);
            // Gap to the previous crossing: widens as the reel decelerates, and the
            // detent sound (Audio#playCaseReelTick) gets lower/heavier with it.
            const gapMs = order > 0 ? timeMs - schedule[order - 1].timeMs : 40;
            if (this.audio?.playCaseReelTick) this.audio.playCaseReelTick(progress, gapMs);
            else this.audio?.playCaseTick?.(0.85 + progress * 0.55);
        }, timeMs));
    }

    // ===== ITEM THUMBNAILS / 3D REVEAL (js/item-thumbnails.js, js/case-reveal-3d.js) =====
    // `typeof` guards: tests load this class with its import lines stripped, where
    // those module bindings do not exist — every caller then keeps the CSS art.
    _itemThumbs() {
        return typeof ItemThumbnails === 'undefined' ? null : ItemThumbnails;
    }

    _attachItemThumb(container, item, typeHint = null, options = {}) {
        try {
            return this._itemThumbs()?.attachItemThumbnail(container, item, typeHint, options) === true;
        } catch {
            return false;
        }
    }

    _caseReelTypeLabel(item = {}) {
        if (item.type === 'avatar') return 'CHARACTER SKIN';
        if (item.type === 'ball') return 'BALL SKIN';
        if (item.type === 'cosmetic') {
            const slot = COSMETICS[item.id]?.type || 'cosmetic';
            return String(COSMETIC_TYPES[slot] || slot).toUpperCase();
        }
        const model = item.model || KNIVES[item.id]?.model;
        if (model === 'butterfly') return 'BUTTERFLY KNIFE';
        if (model === 'karambit') return 'KARAMBIT';
        return 'KNIFE';
    }

    _attachReelThumbnails(track, items, targetIndex) {
        const arts = track?.querySelectorAll?.('.case-reel-art') || [];
        arts.forEach((art, index) => {
            const item = items[index];
            if (item) this._attachItemThumb(art, item, item.type || null, { lazy: false, priority: index === targetIndex });
        });
    }

    _resetCaseRevealStage(overlay) {
        overlay?.classList?.remove('has-reveal-stage', 'reveal-stage-playing');
        const stage = document.getElementById('case-reveal-stage');
        if (!stage) return;
        stage.hidden = true;
        stage.removeAttribute('data-rarity');
        stage.replaceChildren();
    }

    _prepareCaseRevealStage(overlay, reward, presentation) {
        this._resetCaseRevealStage(overlay);
        const stage = document.getElementById('case-reveal-stage');
        if (!stage || typeof createCaseReveal3D !== 'function') return null;
        try {
            return createCaseReveal3D(stage, reward, {
                typeHint: reward?.type || null,
                reducedMotion: presentation.reducedMotion,
                // OS preference only: spin stays, particles/rays go (mirrors flash/confetti).
                calmMotion: !presentation.reducedMotion && this._isReducedMotion()
            });
        } catch {
            return null;
        }
    }

    _playCaseRevealStage(overlay, reveal, reward, generation) {
        const stage = document.getElementById('case-reveal-stage');
        if (!stage || !reveal) return;
        const rarity = reward.rarity || 'common';
        stage.dataset.rarity = rarity;
        const caption = document.createElement('div');
        caption.className = 'case-reveal-caption';
        caption.innerHTML = `${tierBadgeHTML(rarity)}<small></small><strong></strong>`;
        caption.querySelector('small').textContent = `${rarity.toUpperCase()} ${this._caseReelTypeLabel(reward)}`;
        caption.querySelector('strong').textContent = reward.name || reward.id;
        stage.appendChild(caption);
        stage.hidden = false;
        overlay.classList.add('has-reveal-stage');
        reveal.play().then(shown => {
            if (this._caseReelGeneration !== generation) return;
            if (shown) {
                overlay.classList.add('reveal-stage-playing');
                return;
            }
            this._resetCaseRevealStage(overlay);
            this.onCaseRewardReveal?.(reward);
        });
    }

    // Case inspector: an "In this case" strip of real thumbnails, chase items first.
    // Queued with priority so the reel's tiles are cached before the case is opened.
    _decorateCaseInspector() {
        if (typeof document === 'undefined') return;
        try {
            const boxId = document.getElementById('case-inspector-open')?.dataset?.id;
            const knivesEl = document.getElementById('case-inspector-knives');
            const drops = boxId ? getCaseDropRates(boxId) : [];
            if (!drops.length || !knivesEl?.parentNode) return;
            let strip = document.getElementById('case-inspector-drops');
            if (!strip) {
                strip = document.createElement('div');
                strip.id = 'case-inspector-drops';
                strip.className = 'case-inspector-drops';
                strip.setAttribute('aria-label', 'Items in this case');
                knivesEl.parentNode.insertBefore(strip, knivesEl);
            }
            const label = document.createElement('small');
            label.textContent = 'IN THIS CASE';
            const list = document.createElement('div');
            list.className = 'case-inspector-drop-list';
            const sorted = drops.slice().sort((a, b) => tierRank(a.rarity) - tierRank(b.rarity) || a.chance - b.chance);
            for (const drop of sorted) {
                const tile = document.createElement('figure');
                tile.className = `case-drop-tile rarity-${drop.rarity}`;
                tile.title = `${drop.name} · ${(drop.chance * 100).toFixed(2)}%`;
                const art = document.createElement('div');
                art.className = 'case-drop-art';
                art.setAttribute('aria-hidden', 'true');
                const caption = document.createElement('figcaption');
                caption.innerHTML = `${tierBadgeHTML(drop.rarity)}<span class="case-drop-name"></span><b></b>`;
                caption.querySelector('.case-drop-name').textContent = drop.name;
                caption.querySelector('b').textContent = `${(drop.chance * 100).toFixed(drop.chance < 0.01 ? 2 : 1)}%`;
                tile.append(art, caption);
                list.appendChild(tile);
                if (!this._attachItemThumb(art, drop, drop.type, { lazy: false, priority: true }) && drop.type === 'cosmetic' && drop.preview) {
                    appendCosmeticIcon(art, drop.preview);
                }
            }
            strip.replaceChildren(label, list);
        } catch {
            // Decoration only — the inspector itself is owned and rendered by main.js.
        }
    }

    // Persistent full-screen rarity-tinted glow for case reveals (mirrors the
    // updateFlash()/#juice-flash pattern but kept separate so combat's flash
    // color never mixes with a case-reveal color).
    _ensureCaseRevealGlow(rarity) {
        let el = document.getElementById('case-reveal-glow');
        if (!el) {
            el = document.createElement('div');
            el.id = 'case-reveal-glow';
            document.body.appendChild(el);
        }
        el.className = `case-reveal-glow rarity-${rarity}`;
        return el;
    }

    // Lightweight DOM/CSS confetti burst for legendary reveals. Only ever
    // called once per reveal (not per-frame), so per-piece allocation here is
    // fine — this is not the render loop.
    _spawnCaseConfetti(overlay) {
        const colors = ['#ffd36b', '#ffc02e', '#fff3c4', '#ffe08a'];
        for (let i = 0; i < 18; i++) {
            const piece = document.createElement('span');
            piece.className = 'case-confetti-piece';
            piece.style.setProperty('--confetti-x', `${Math.round((Math.random() - 0.5) * 260)}px`);
            piece.style.setProperty('--confetti-delay', `${Math.round(Math.random() * 160)}ms`);
            piece.style.setProperty('--confetti-color', colors[i % colors.length]);
            overlay.appendChild(piece);
        }
    }

    // ===== BATTLEPASS EKRANI =====
    // ponytail: every dynamic label goes through textContent, never innerHTML — no
    // user-controlled strings render here, but this keeps the whole screen XSS-safe
    // by convention like the rest of the codebase.
    _bpRewardIcon(kind) {
        return kind === 'currency' ? '🪙' : kind === 'ball' ? '🏐' : kind === 'xpboost' ? '⚡' : '✨';
    }

    _buildBpTierRow(reward, track, bp, hasPremium) {
        const row = document.createElement('div');
        const state = rewardRowState(bp, reward.tier, track, { hasPremium });
        row.className = `bp-reward bp-reward-row bp-reward-${track} bp-reward-${state}`;

        const tag = document.createElement('span');
        tag.className = `bp-track-tag bp-track-tag-${track}`;
        tag.textContent = track === 'premium' ? '🔒 Premium' : 'Free';
        row.appendChild(tag);

        const label = document.createElement('span');
        label.className = 'bp-reward-label';
        label.textContent = `${this._bpRewardIcon(reward.kind)} ${reward.name}`;
        row.appendChild(label);

        const status = document.createElement('span');
        status.className = 'bp-reward-status';
        if (state === 'claimable') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-primary btn-small bp-claim';
            btn.dataset.tier = String(reward.tier);
            btn.dataset.track = track;
            btn.textContent = 'Claim';
            status.appendChild(btn);
        } else if (state === 'claimed') {
            status.classList.add('bp-reward-done');
            status.textContent = '✓ Claimed';
        } else if (state === 'locked-premium') {
            status.classList.add('bp-reward-need-premium');
            status.textContent = 'Needs Premium';
        }
        // 'locked-tier' (a future reward): status stays empty — the card's own
        // dimmed "future" state already communicates that, without repeating
        // a "Premium" badge on rewards nobody can act on yet.
        row.appendChild(status);
        return row;
    }

    _ensureBpPremiumToggle(store) {
        const hero = document.querySelector('#battlepass-screen .progression-hero');
        if (!hero) return;
        let btn = document.getElementById('bp-premium-buy');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'bp-premium-buy';
            btn.className = 'btn btn-secondary btn-small bp-premium-buy';
            hero.appendChild(btn);
        }
        const bp = store.getBattlepassProgress();
        if (bp.premium) {
            btn.textContent = 'Premium unlocked';
            btn.disabled = true;
        } else {
            btn.disabled = false;
            btn.textContent = `Unlock Premium Track — 🪙 ${store.getBattlepassPremiumPrice()}`;
        }
    }

    _renderBattlepassSeasonValue(store, bp, free, premium, xpNeeded) {
        const nextEl = document.getElementById('bp-value-next');
        const claimsEl = document.getElementById('bp-value-claims');
        const boostsEl = document.getElementById('bp-value-boosts');
        const statusEl = document.getElementById('bp-boost-status');
        const action = document.getElementById('bp-boost-action');
        const claimedFree = new Set(Array.isArray(bp.claimedFree) ? bp.claimedFree : []);
        const claimedPremium = new Set(Array.isArray(bp.claimedPremium) ? bp.claimedPremium : []);
        const readyClaims = free.filter(reward => reward.tier <= bp.tier && !claimedFree.has(reward.tier)).length
            + (bp.premium === true
                ? premium.filter(reward => reward.tier <= bp.tier && !claimedPremium.has(reward.tier)).length
                : 0);
        const remainingXp = xpNeeded ? Math.max(0, xpNeeded - Math.max(0, Number(bp.xp) || 0)) : 0;
        const boostState = store.getBattlepassBoostState?.() || { active: null, ownedCount: 0, strongestAvailable: null };
        if (nextEl) nextEl.textContent = xpNeeded ? `${remainingXp} XP` : 'Complete';
        if (claimsEl) claimsEl.textContent = `${readyClaims} ${readyClaims === 1 ? 'reward' : 'rewards'}`;
        if (boostsEl) boostsEl.textContent = `${boostState.ownedCount} owned`;
        if (!statusEl || !action) return;

        action.disabled = true;
        delete action.dataset.boostId;
        if (boostState.active) {
            const multiplier = Number(boostState.active.multiplier).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
            const remainingSeconds = Math.max(0, Math.ceil(Number(boostState.active.remainingMs) / 1000));
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            const expiry = new Date(Number(boostState.active.expiresAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            statusEl.textContent = `${multiplier}x XP active | ${minutes}m ${seconds}s left | ends ${expiry}`;
            action.textContent = 'Boost active';
            action.setAttribute('aria-label', `${multiplier} times Battle Pass XP boost active`);
            return;
        }
        const strongest = boostState.strongestAvailable;
        if (strongest) {
            const multiplier = Number(strongest.multiplier).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
            const durationMinutes = Math.max(1, Math.round(Number(strongest.durationMs) / 60000));
            statusEl.textContent = `${multiplier}x XP boost ready for ${durationMinutes} minutes`;
            action.textContent = `Activate ${multiplier}x | ${durationMinutes} min`;
            action.dataset.boostId = strongest.boostId;
            action.disabled = false;
            action.setAttribute('aria-label', `Activate ${multiplier} times Battle Pass XP boost for ${durationMinutes} minutes`);
            return;
        }
        statusEl.textContent = 'No XP boost active | earn boosts on the season track';
        action.textContent = 'No boost available';
        action.setAttribute('aria-label', 'No Battle Pass XP boost available');
    }

    renderBattlepass(store) {
        const trackEl = document.getElementById('bp-track');
        const tierEl = document.getElementById('bp-tier');
        const xpEl = document.getElementById('bp-xp');
        const bp = store.getBattlepassProgress();
        const hasPremium = bp.premium === true;
        if (tierEl) tierEl.textContent = String(bp.tier);
        if (xpEl) xpEl.textContent = String(bp.xp);
        const tierLabel = tierEl?.parentElement?.querySelector('small');
        if (tierLabel) tierLabel.textContent = `tier / 50`;
        const xpLabel = xpEl?.parentElement?.querySelector('small');
        const xpNeeded = store.getBattlepassXpForNextTier();
        if (xpLabel) xpLabel.textContent = xpNeeded ? `XP / ${xpNeeded}` : 'MAX TIER';
        const seasonLabel = document.querySelector('#battlepass-screen .shell-header .shell-kicker');
        if (seasonLabel) seasonLabel.textContent = `SEASON ${String(bp.seasonId).padStart(2, '0')}`;
        this._ensureBpPremiumToggle(store);
        const { free, premium } = store.getBattlepassRewards();
        this._renderBattlepassSeasonValue(store, bp, free, premium, xpNeeded);
        if (!trackEl) return;
        trackEl.innerHTML = '';
        const nextFree = free.find(reward => reward.tier > bp.tier);
        const nextEl = document.getElementById('bp-next-reward');
        const ringIconEl = document.getElementById('bp-progress-ring-icon');
        const ringEl = document.getElementById('bp-progress-ring');
        const ring = document.querySelector('.progression-ring');
        if (nextEl) nextEl.textContent = nextFree
            ? `Tier ${nextFree.tier}: ${nextFree.name}`
            : 'Season track complete';
        if (ringIconEl) ringIconEl.textContent = nextFree ? this._bpRewardIcon(nextFree.kind) : '🏆';
        const ringPercent = xpNeeded ? Math.round((bp.xp / xpNeeded) * 100) : 100;
        if (ringEl) ringEl.textContent = `${ringPercent}%`;
        if (ring) ring.style.setProperty('--bp-progress', `${ringPercent}%`);
        let currentCell = null;
        for (let tier = 1; tier <= free.length; tier++) {
            const freeReward = free[tier - 1];
            const premiumReward = premium[tier - 1];
            const cell = document.createElement('div');
            const cardState = tierCardState(bp, tier);
            cell.className = `bp-tier ${cardState}`;
            if (cardState === 'current') currentCell = cell;
            const num = document.createElement('div');
            num.className = 'bp-tier-num';
            num.textContent = String(tier);
            cell.appendChild(num);
            cell.appendChild(this._buildBpTierRow(freeReward, 'free', bp, hasPremium));
            cell.appendChild(this._buildBpTierRow(premiumReward, 'premium', bp, hasPremium));
            trackEl.appendChild(cell);
        }
        // Land on the tier the player is actually working toward, not tier 1
        // of a 50-tier strip. main.js calls renderBattlepass() *before*
        // showScreen() removes the "hidden" (display:none) class, so scrolling
        // here would act on a zero-size container and silently no-op — defer
        // one frame so showScreen has already run by the time this fires.
        // Instant jump under reduced motion.
        if (currentCell) {
            const reducedMotion = this._isReducedMotion();
            requestAnimationFrame(() => {
                const maxLeft = Math.max(0, trackEl.scrollWidth - trackEl.clientWidth);
                const centeredLeft = currentCell.offsetLeft - (trackEl.clientWidth - currentCell.offsetWidth) / 2;
                const targetLeft = Math.max(0, Math.min(maxLeft, centeredLeft));
                if (typeof trackEl.scrollTo === 'function') {
                    trackEl.scrollTo({
                        left: targetLeft,
                        top: trackEl.scrollTop,
                        behavior: reducedMotion ? 'auto' : 'smooth'
                    });
                } else {
                    trackEl.scrollLeft = targetLeft;
                }
            });
        }
    }

    // ===== ACHIEVEMENTS EKRANI =====
    renderAchievements(store) {
        const grid = document.getElementById('achievement-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const unlocked = store.get('unlockedAchievements') || [];
        const achievements = Object.values(ACHIEVEMENTS);
        const unlockedAchievements = achievements.filter(a => unlocked.includes(a.id));
        const earned = unlockedAchievements.reduce((total, a) => total + (Number(a.reward) || 0), 0);
        const unlockedCount = document.getElementById('achievement-unlocked-count');
        const totalCount = document.getElementById('achievement-total-count');
        const rewardTotal = document.getElementById('achievement-reward-total');
        if (unlockedCount) unlockedCount.textContent = String(unlockedAchievements.length);
        if (totalCount) totalCount.textContent = String(achievements.length);
        if (rewardTotal) rewardTotal.textContent = String(earned);
        achievements.forEach((a, index) => {
            const isUnlocked = unlocked.includes(a.id);
            const card = document.createElement('article');
            card.className = `achievement-card ${isUnlocked ? 'unlocked' : 'locked'}`;
            card.innerHTML = `
                <div class="achievement-mark" aria-hidden="true"><svg class="ui-icon"><use href="#i-trophy"></use></svg><span>${String(index + 1).padStart(2, '0')}</span></div>
                <div class="achievement-copy"><span class="achievement-state">${isUnlocked ? 'UNLOCKED' : 'LOCKED'}</span><div class="ach-name">${a.name}</div><div class="ach-desc">${a.desc}</div></div>
                <div class="ach-reward"><svg class="ui-icon" aria-hidden="true"><use href="#i-coins"></use></svg>${a.reward}</div>
            `;
            grid.appendChild(card);
        });
    }

    // ===== DAILY CHALLENGES EKRANI =====
    renderDaily(daily, store) {
        const grid = document.getElementById('daily-grid');
        if (!grid) return;
        grid.innerHTML = '';
        if (store) {
            const state = store.getDailyRewardState();
            // Same server-owned streak as the menu badge — one login reward, one source of truth.
            const streak = store.getLoginStreakState();
            const login = document.createElement('div');
            login.className = `daily-card daily-login-card ${streak.claimed ? 'claimed' : 'ready'}`;
            login.innerHTML = `
                <div class="daily-symbol">LOGIN</div>
                <div class="daily-name">Daily Login</div>
                <div class="daily-count">Day ${streak.day} - ${streak.reward} coins</div>
                <button class="btn btn-primary btn-small daily-login-claim" ${streak.claimed ? 'disabled' : ''}>
                    ${streak.claimed ? 'Claimed' : 'Claim Coins'}
                </button>`;
            grid.appendChild(login);

            const freeCase = document.createElement('div');
            const dailyPity = store.getCasePityState('kickoff');
            const dailyRates = getCaseDropRates('kickoff', dailyPity.nextGuaranteed ? { minimumRarity: 'epic' } : {});
            freeCase.className = `daily-card daily-case-card ${state.freeCaseClaimed ? 'claimed' : 'ready'}`;
            freeCase.innerHTML = `
                <div class="daily-symbol">CASE</div>
                <div class="daily-name">Daily Kickoff Case</div>
                <div class="daily-count">One free opening every day</div>
                <div class="case-pity ${dailyPity.nextGuaranteed ? 'ready' : ''}">
                    Epic+ guarantee: ${dailyPity.nextGuaranteed ? 'THIS OPEN' : `${dailyPity.count}/10`}
                </div>
                <div class="case-drop-rates">${dailyRates.map(drop =>
                    `<span class="rarity-${drop.rarity}"><b>${drop.name}</b><em>${(drop.chance * 100).toFixed(0)}%</em></span>`
                ).join('')}</div>
                <button class="btn btn-primary btn-small daily-case-open" data-id="kickoff" ${state.freeCaseClaimed ? 'disabled' : ''}>
                    ${state.freeCaseClaimed ? 'Opened Today' : 'Open Free'}
                </button>`;
            grid.appendChild(freeCase);
        }
        const challenges = store?.getDailyChallenges?.() || daily.getChallenges();
        const completed = challenges.filter(c => c.progress >= c.target).length;
        const readyRewards = challenges.filter(c => c.progress >= c.target && !c.claimed).reduce((total, c) => total + (Number(c.reward) || 0), 0);
        const completeCount = document.getElementById('challenge-complete-count');
        const rewardTotal = document.getElementById('challenge-reward-total');
        if (completeCount) completeCount.textContent = String(completed);
        if (rewardTotal) rewardTotal.textContent = String(readyRewards);
        challenges.forEach(c => {
            const pct = Math.min(100, (c.progress / c.target) * 100);
            const done = c.progress >= c.target;
            const card = document.createElement('div');
            card.className = `daily-card ${c.claimed ? 'claimed' : ''} ${done && !c.claimed ? 'ready' : ''}`;
            card.innerHTML = `
                <div class="daily-symbol">GOAL</div>
                <div class="daily-name">${c.name}</div>
                <div class="daily-progress-bar"><div class="daily-progress-fill" style="width:${pct}%"></div></div>
                <div class="daily-count">${c.progress}/${c.target}</div>
                <div class="ach-reward"><svg class="ui-icon" aria-hidden="true"><use href="#i-coins"></use></svg>${c.reward}</div>
                ${done && !c.claimed ? `<button class="btn btn-primary btn-small daily-claim" data-id="${c.id}">Claim</button>` : ''}
                ${c.claimed ? '<div class="daily-complete">COMPLETED</div>' : ''}
            `;
            grid.appendChild(card);
        });
    }

    // ===== RANKED EKRANI =====
    renderRanked(store) {
        const el = document.getElementById('ranked-info');
        if (!el) return;
        const elo = store.getElo();
        const prog = getRankProgress(elo);
        const stats = store.get('stats');
        el.innerHTML = `
            <div class="ranked-rank" style="color:${prog.rank.color}">
                <span class="ranked-emoji">${prog.rank.emoji}</span>
                <span class="ranked-name">${prog.rank.name}</span>
            </div>
            <div class="ranked-elo">ELO: ${elo}</div>
            <div class="ranked-progress-bar"><div class="ranked-progress-fill" style="width:${prog.pct}%;background:${prog.rank.color}"></div></div>
            ${prog.next ? `<div class="ranked-next">Next: ${prog.next.emoji} ${prog.next.name} (${prog.next.min - elo} ELO)</div>` : '<div class="ranked-next">Max rank reached! 👑</div>'}
            <div class="ranked-stats">
                <div>Ranked Games: ${stats.rankedGames || 0}</div>
                <div>Win Streak: ${store.getWinStreak()} 🔥</div>
                <div>Total Wins: ${stats.totalWins}</div>
            </div>
        `;
    }

    renderCareer(store) {
        const el = document.getElementById('ranked-info');
        if (!el) return;
        const elo = store.getElo();
        const prog = getRankProgress(elo);
        const stats = store.get('stats');
        const games = Math.max(0, stats.gamesPlayed || 0);
        const wins = Math.max(0, stats.totalWins || 0);
        const winRate = games ? Math.round(wins / games * 100) : 0;
        const contracts = store.getSeasonContracts();
        const rankedState = store.get('rankedState') || {};
        const season = rankedState.currentSeason || {};
        const history = Array.isArray(season.matches) ? season.matches.slice(-8).reverse() : [];
        const placementTarget = Number(season.placements?.required) || 5;
        const placementGames = Math.min(
            placementTarget,
            Number(season.placements?.completed) || 0
        );
        el.innerHTML = `
            <div class="career-dashboard">
                <section class="career-rank-card">
                    <span class="shell-kicker">CURRENT RANK</span>
                    <div class="ranked-rank" style="color:${prog.rank.color}">
                        <span class="ranked-emoji">${prog.rank.emoji}</span>
                        <span class="ranked-name">${prog.rank.name}</span>
                    </div>
                    <div class="ranked-elo">${elo} ELO</div>
                    <div class="ranked-progress-bar"><div class="ranked-progress-fill" style="width:${prog.pct}%;background:${prog.rank.color}"></div></div>
                    <div class="ranked-next">${prog.next ? `${prog.next.min - elo} ELO to ${prog.next.name}` : 'Top rank reached'}</div>
                </section>
                <section class="career-stats-grid">
                    <div class="career-stat-card"><b>${games}</b><span>Matches</span></div>
                    <div class="career-stat-card"><b>${wins}</b><span>Wins</span></div>
                    <div class="career-stat-card"><b>${winRate}%</b><span>Win rate</span></div>
                    <div class="career-stat-card"><b>${stats.totalHits || 0}</b><span>Hits</span></div>
                    <div class="career-stat-card"><b>${stats.totalDeflects || 0}</b><span>Deflects</span></div>
                    <div class="career-stat-card"><b>${store.getWinStreak()}</b><span>Win streak</span></div>
                </section>
                <section class="career-milestones">
                    <div class="career-milestone-card"><span class="shell-kicker">RALLY</span><strong>${stats.bestRally || 0}</strong><p>Best rally chain</p></div>
                    <div class="career-milestone-card"><span class="shell-kicker">RANKED</span><strong>${stats.rankedGames || 0}</strong><p>Competitive matches</p></div>
                    <div class="career-milestone-card"><span class="shell-kicker">MASTERY</span><strong>${store.get('level') || 1}</strong><p>Account level</p></div>
                </section>
                <section class="career-season-history">
                    <header><span class="shell-kicker">COMPETITIVE</span><h2>${season.id || 'Launch Season'}</h2><small>Placements ${placementGames}/${placementTarget}</small></header>
                    <div class="career-placement-track"><i style="width:${placementGames / placementTarget * 100}%"></i></div>
                    <div class="career-history-list">${history.length ? history.map(match => `<div><b class="${match.result === 'win' ? 'win' : 'loss'}">${match.result.toUpperCase()}</b><span>Opponent ${match.opponentElo} ELO</span><strong>${match.delta >= 0 ? '+' : ''}${match.delta || 0} ELO</strong></div>`).join('') : '<p>Complete competitive matches to build your history.</p>'}</div>
                </section>
                <section class="career-contracts">
                    <header><span class="shell-kicker">LAUNCH SEASON</span><h2>Season Contracts</h2></header>
                    <div class="career-contract-grid">${contracts.map(contract => {
                        const pct = Math.min(100, contract.progress / contract.target * 100);
                        const ready = contract.progress >= contract.target && !contract.claimed;
                        return `<article class="career-contract ${ready ? 'ready' : ''} ${contract.claimed ? 'claimed' : ''}">
                            <div><strong>${contract.name}</strong><span>${contract.description}</span></div>
                            <div class="career-contract-track"><i style="width:${pct}%"></i></div>
                            <small>${Math.floor(contract.progress)}/${contract.target} - ${contract.reward} coins</small>
                            ${ready ? `<button class="btn btn-primary btn-small contract-claim" data-id="${contract.id}">Claim</button>` : ''}
                            ${contract.claimed ? '<b class="contract-complete">COMPLETED</b>' : ''}
                        </article>`;
                    }).join('') || '<p class="career-empty">No active season contracts.</p>'}</div>
                </section>
            </div>`;
    }

    _renderClassSwitch(game) {
        const list = document.getElementById('class-switch-list');
        const status = document.getElementById('class-switch-status');
        const detail = document.getElementById('class-switch-detail');
        if (!list) return;
        const round = Number(game.scoreboard?.roundNum) || 0;
        const locked = game.state === 'PLAYING' && game.player?._classChangeRound === round;
        if (status) status.textContent = locked ? t('team.classUsed') : t('team.classOnce');
        const selected = CHARACTERS[game.player?.charId] || CHARACTERS.rally;
        if (detail) {
            detail.replaceChildren();
            const badge = document.createElement('span');
            badge.className = 'class-switch-detail-badge';
            badge.textContent = selected.emoji || selected.name.slice(0, 1);
            badge.style.setProperty('--class-color', `#${selected.color.toString(16).padStart(6, '0')}`);
            const copy = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = selected.name;
            const desc = document.createElement('p');
            desc.textContent = characterDesc(selected);
            copy.append(title, desc);
            const stats = document.createElement('small');
            stats.textContent = `HP ${selected.maxHp} | SPD ${selected.speed} | POWER ${selected.deflectPower.toFixed(2)}`;
            detail.append(badge, copy, stats);
        }
        list.replaceChildren(...Object.values(CHARACTERS).map(character => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `class-switch-choice${game.player?.charId === character.id ? ' selected' : ''}`;
            button.setAttribute('role', 'listitem');
            button.setAttribute('aria-label', `${character.name}: ${characterDesc(character)}`);
            button.style.setProperty('--class-color', `#${character.color.toString(16).padStart(6, '0')}`);
            const badge = document.createElement('span');
            badge.className = 'class-switch-avatar';
            badge.textContent = character.emoji || character.name.slice(0, 1);
            const name = document.createElement('b');
            name.textContent = character.name;
            const stat = document.createElement('small');
            stat.textContent = `${character.maxHp} HP`;
            button.append(badge, name, stat);
            button.disabled = locked || game.player?.charId === character.id;
            button.addEventListener('click', () => this.onClassSelect?.(character.id));
            return button;
        }));
    }

    // ===== LEADERBOARD EKRANI =====
    // Real ranked/season/wins boards from the server (server/profile-store.js
    // rankedState). No fake bots, no localStorage roster — see js/leaderboard.js.
    async renderLeaderboard(store, board = 'ranked') {
        const tbody = document.getElementById('leaderboard-body');
        if (!tbody) return;
        const podium = document.getElementById('leaderboard-podium');
        const statusEl = document.getElementById('leaderboard-status');
        const guestBanner = document.getElementById('leaderboard-guest-banner');
        const yourRank = document.getElementById('leaderboard-your-rank');

        // A later call (e.g. a fast tab switch) makes this render stale;
        // drop the response instead of overwriting a newer view.
        const requestId = (this._leaderboardRequestId = (this._leaderboardRequestId || 0) + 1);
        const showStatus = (message, tone = 'loading') => {
            if (!statusEl) return;
            statusEl.classList.toggle('hidden', !message);
            statusEl.classList.toggle('is-error', tone === 'error');
            statusEl.textContent = message || '';
        };

        const isGuest = Leaderboard.isGuest();
        guestBanner?.classList.toggle('hidden', !isGuest);
        if (guestBanner) {
            // Lead text / button / tail text: word order differs per language.
            const texts = [...guestBanner.childNodes].filter(node => node.nodeType === 3);
            if (texts[0]) texts[0].data = t('lb.guestLead');
            if (texts.length > 1) texts[texts.length - 1].data = t('lb.guestTail');
            const cta = document.getElementById('leaderboard-create-account');
            if (cta) cta.textContent = t('lb.guestCta');
        }
        if (guestBanner && !guestBanner.dataset.bound) {
            guestBanner.dataset.bound = '1';
            document.getElementById('leaderboard-create-account')?.addEventListener('click', () => {
                document.getElementById('auth-modal')?.classList.remove('hidden');
            });
        }
        tbody.innerHTML = '';
        if (podium) { podium.innerHTML = ''; podium.classList.add('hidden'); }
        yourRank?.classList.add('hidden');
        showStatus(t('lb.loading'));

        const result = await Leaderboard.fetchBoard(board, { limit: 50, around: !isGuest });
        if (requestId !== this._leaderboardRequestId) return;

        if (!result.ok) {
            showStatus(result.offline ? t('lb.offline') : (result.error || t('lb.loadFailed')), 'error');
            return;
        }
        const entries = result.entries;
        if (!entries.length) {
            showStatus(t('lb.empty'));
            return;
        }
        showStatus('');

        if (podium) {
            entries.slice(0, 3).forEach(entry => {
                const rank = getRank(entry.elo);
                const slot = document.createElement('div');
                slot.className = `leaderboard-podium-slot place-${entry.rank}`;
                const rankEl = document.createElement('span');
                rankEl.className = 'leaderboard-podium-rank';
                rankEl.textContent = `#${entry.rank}`;
                const nameEl = document.createElement('strong');
                nameEl.textContent = entry.displayName;
                const tierEl = document.createElement('b');
                tierEl.style.color = rank.color;
                tierEl.textContent = `${rank.emoji} ${rank.name}`;
                const eloEl = document.createElement('em');
                eloEl.textContent = `${entry.elo} ELO`;
                slot.append(rankEl, nameEl, tierEl, eloEl);
                podium.appendChild(slot);
            });
            podium.classList.remove('hidden');
        }

        const myPublicCode = result.me?.entry?.publicCode || '';
        entries.forEach(entry => {
            const rank = getRank(entry.elo);
            const isMe = !!myPublicCode && entry.publicCode === myPublicCode;
            const row = document.createElement('tr');
            row.className = isMe ? 'is-you' : '';
            const record = `${entry.wins}-${Math.max(0, entry.games - entry.wins)}`;
            const cells = [entry.rank, entry.displayName, entry.elo, `${rank.emoji} ${rank.name}`, record];
            cells.forEach((value, index) => {
                const cell = document.createElement('td');
                cell.textContent = String(value);
                if (index === 3) cell.style.color = rank.color;
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });

        // Pin the caller's own row at the bottom when their real position
        // isn't already visible in the slice above.
        if (yourRank) {
            if (isGuest) {
                yourRank.classList.add('hidden');
            } else if (result.me?.entry) {
                const mine = result.me.entry;
                const alreadyVisible = entries.some(entry => entry.publicCode === mine.publicCode);
                if (alreadyVisible) {
                    yourRank.classList.add('hidden');
                } else {
                    const rank = getRank(mine.elo);
                    yourRank.innerHTML = `<span>${t('lb.yourPosition')}</span><strong>#${mine.rank}</strong><b style="color:${rank.color}">${rank.emoji} ${rank.name}</b><em>${mine.elo} ELO</em>`;
                    yourRank.classList.remove('hidden');
                }
            } else {
                const rank = getRank(store.getElo());
                yourRank.innerHTML = `<span>${t('lb.yourPosition')}</span><strong>${t('lb.unranked')}</strong><b style="color:${rank.color}">${rank.emoji} ${rank.name}</b><em>${t('lb.finishPlacements')}</em>`;
                yourRank.classList.remove('hidden');
            }
        }
    }

    renderReplays(replays) {
        const list = document.getElementById('replay-list');
        if (!list) return;
        list.innerHTML = '';
        if (!replays.length) {
            list.innerHTML = '<p>No saved replays yet.</p>';
            return;
        }
        replays.slice().reverse().forEach((replay, reverseIndex) => {
            const index = replays.length - 1 - reverseIndex;
            const card = document.createElement('div');
            card.className = 'replay-card';
            const duration = Math.max(0, Math.round((replay.duration || 0) / 1000));
            const highlights = replay.highlights || [];
            card.innerHTML = `
                <div>
                    <strong>${replay.meta?.map || 'Unknown map'}</strong>
                    <span>${replay.meta?.mode || 'classic'} - ${duration}s - ${(replay.events || []).length} events</span>
                    ${highlights.length ? `<div class="replay-highlights">${highlights.map((highlight, highlightIndex) =>
                        `<button class="replay-highlight" data-index="${index}" data-highlight="${highlightIndex}">
                            <span>HIGHLIGHT ${highlightIndex + 1}</span><b>${highlight.label}</b>
                        </button><button class="replay-highlight-copy" data-index="${index}" data-highlight="${highlightIndex}" aria-label="Copy highlight ${highlightIndex + 1}">Copy</button>`
                    ).join('')}</div>` : '<small class="replay-no-highlight">No highlight event detected</small>'}
                </div>
                <div class="btn-row">
                    <button class="btn btn-small replay-play" data-index="${index}">Play</button>
                    <button class="btn btn-small replay-export" data-index="${index}">Copy</button>
                    <button class="btn btn-small btn-secondary replay-delete" data-index="${index}">Delete</button>
                </div>`;
            list.appendChild(card);
        });
    }

    // ===== TOURNAMENT EKRANI =====
    async renderTournament(tournament) {
        const el = document.getElementById('tournament-bracket');
        if (!el) return;
        const bracket = tournament.getBracket();
        if (!bracket) { el.innerHTML = '<p>No active tournament</p>'; return; }
        el.innerHTML = '';
        bracket.rounds.forEach((round, ri) => {
            const roundDiv = document.createElement('div');
            roundDiv.className = 'bracket-round';
            roundDiv.innerHTML = `<h3>Round ${ri+1}</h3>`;
            round.forEach(m => {
                const matchDiv = document.createElement('div');
                matchDiv.className = `bracket-match ${m.played ? 'played' : ''}`;
                const p1Win = m.winner === m.p1;
                const p2Win = m.winner === m.p2;
                matchDiv.innerHTML = `
                    <div class="bracket-player ${p1Win ? 'win' : ''}">${m.p1} ${m.played ? `<span>${m.score1}</span>` : ''}</div>
                    <div class="bracket-player ${p2Win ? 'win' : ''}">${m.p2} ${m.played ? `<span>${m.score2}</span>` : ''}</div>
                    ${!m.played && !m.p1.startsWith('BYE') && !m.p2.startsWith('BYE') ? `<button class="btn btn-primary btn-small bracket-play" data-match="${m.id}">Play</button>` : ''}
                `;
                roundDiv.appendChild(matchDiv);
            });
            el.appendChild(roundDiv);
        });
        if (bracket.champion) {
            const champDiv = document.createElement('div');
            champDiv.className = 'bracket-champion';
            champDiv.innerHTML = `🏆 Champion: ${bracket.champion}`;
            el.appendChild(champDiv);
        }
    }

    showProfile() {
        const stats = MatchHistory.getStats();
        const elo = this.store?.data?.elo || 1000;
        const { rank, pct } = getRankProgress(elo);

        document.getElementById('profile-rank').innerHTML = `
            <svg class="profile-rank-badge" viewBox="0 0 32 36" aria-hidden="true" style="--rank-color:${rank.color}"><path d="M16 2 28 7v11c0 7-5.1 12.7-12 16C9.1 30.7 4 25 4 18V7l12-5Z"></path><path d="m16 9 2 4 4.4.6-3.2 3.1.8 4.4-4-2.1-4 2.1.8-4.4-3.2-3.1 4.4-.6 2-4Z"></path></svg>
            <div class="rank-name" style="color:${rank.color}">${rank.name}</div>
            <div class="rank-progress"><div class="rank-bar" style="width:${pct}%"></div></div>
            <div style="color:#aaa;font-size:12px">${elo} ELO</div>`;

        document.getElementById('profile-stats').innerHTML = `
            <div class="stat-card"><div class="stat-value">${stats.wins}</div><div class="stat-label">Wins</div></div>
            <div class="stat-card"><div class="stat-value">${stats.losses}</div><div class="stat-label">Losses</div></div>
            <div class="stat-card"><div class="stat-value">${MatchHistory.getWinRate()}%</div><div class="stat-label">Win Rate</div></div>
            <div class="stat-card"><div class="stat-value">${stats.kills}</div><div class="stat-label">Kills</div></div>
            <div class="stat-card"><div class="stat-value">${stats.deaths}</div><div class="stat-label">Deaths</div></div>
            <div class="stat-card"><div class="stat-value">${stats.damage}</div><div class="stat-label">Damage</div></div>`;

        // `screens` is keyed by the product route (`profile`), not by the
        // DOM id. Using the id hid Main Menu without revealing a target.
        this.showScreen('profile');
    }

    hideProfile() { this.showScreen('mainMenu'); }

    showMatchResult(winner, stats) {
        const el = document.getElementById('match-result');
        if (!el) return;
        const textEl = el.querySelector('.result-text');
        const isVictory = winner === 'red' || winner === 'blue';
        textEl.textContent = isVictory ? 'VICTORY' : 'DEFEAT';
        textEl.className = 'result-text ' + (isVictory ? 'victory' : 'defeat');
        document.getElementById('mr-kills').textContent = stats.kills || 0;
        document.getElementById('mr-deaths').textContent = stats.deaths || 0;
        document.getElementById('mr-damage').textContent = Math.round(stats.damage || 0);
        el.classList.remove('hidden');
        requestAnimationFrame(() => el.classList.add('show'));
    }
}
import { getCompetitiveHUDView } from './competitive-hud.js';
