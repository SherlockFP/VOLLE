// cover-state-cue.test.mjs — the per-match props roll (js/game.js rollMapProps,
// 30% on) is visible: a countdown chip "COVER ON" / "OPEN COURT", a one-line
// state on the Tab scoreboard, and a lobby note that cover is rolled per match.
// Host and client must agree: 20 seeded starts drive the real host roll, the
// real Arena.setPropsEnabled, the real Game.startGameFromNetwork /
// handleLateJoin adoption and the real UI methods, and compare the texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { runInNewContext } from 'node:vm';
import { installFakeDocument } from './helpers/fake-canvas.mjs';
import { compileGameMethod } from './game-source.mjs';

const vendor = new URL('../vendor/three/', import.meta.url);
const threeUrl = new URL('three.module.js', vendor).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`addons/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});
installFakeDocument();
globalThis.window ||= { innerWidth: 1280, innerHeight: 720 };

const THREE = await import(threeUrl);
const { Arena } = await import('../js/arena.js');
const i18n = await import('../js/i18n.js');
const en = (await import('../js/locales/en.js')).default;
const tr = (await import('../js/locales/tr.js')).default;
const [gameSource, uiSource, mainSource, styleSource] = await Promise.all(
    ['js/game.js', 'js/ui.js', 'js/main.js', 'css/style.css'].map(f => readFile(new URL(`../${f}`, import.meta.url), 'utf8')));

const STATES = { MENU: 'MENU', LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN', PLAYING: 'PLAYING', SOCIAL_HUB: 'SOCIAL_HUB' };

// The shipped host roll (js/game.js), not a copy.
const rollSource = gameSource.slice(gameSource.indexOf('export const MAP_PROPS_CHANCE'), gameSource.indexOf('\n}', gameSource.indexOf('export function rollMapProps')) + 2);
const { MAP_PROPS_CHANCE, rollMapProps } = runInNewContext(`${rollSource.replace(/export /g, '')}\n({ MAP_PROPS_CHANCE, rollMapProps })`);

// Both countdown intro calls in startGame, exactly as shipped.
const INTRO_CALL = "this.ui.showMatchIntro(this.arena.config?.name || 'Arena', this.mode?.name || 'Classic', { cover: this.arena?.propsEnabled !== false });";
const introCalls = gameSource.split(INTRO_CALL).length - 1;
const runIntroCall = new Function(INTRO_CALL);

// --- a tiny DOM, enough for the three UI methods ------------------------------
class El {
    constructor(tag, id = '') {
        this.tagName = tag; this.id = id; this.children = []; this.parent = null; this.dataset = {}; this.attrs = {};
        this.textContent = ''; this.className = ''; this.style = {};
        const classes = new Set();
        this.classList = {
            add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
            toggle: (c, on) => (on ?? !classes.has(c) ? classes.add(c) : classes.delete(c))
        };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    insertBefore(child, ref) {
        const i = ref ? this.children.indexOf(ref) : -1;
        child.parent = this;
        if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
        return child;
    }
    querySelector(sel) { return this.all().find(el => matches(el, sel)) || null; }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
}
function matches(el, sel) {
    const last = sel.trim().split(/\s+/).pop();
    return last.startsWith('#') ? el.id === last.slice(1) : last.startsWith('.') ? el.className.split(/\s+/).includes(last.slice(1)) : el.tagName === last;
}
function makeDocument() {
    const body = new El('body');
    const intro = body.appendChild(new El('div', 'match-intro'));
    intro.appendChild(new El('div', 'mi-map-name'));
    intro.appendChild(new El('div', 'mi-mode-name'));
    const overlay = body.appendChild(new El('div', 'scoreboard-overlay'));
    const shell = overlay.appendChild(new El('div'));
    shell.className = 'scoreboard-shell';
    const hint = shell.appendChild(new El('span'));
    hint.className = 'scoreboard-hint';
    return {
        body,
        createElement: tag => new El(tag),
        getElementById: id => body.all().find(el => el.id === id) || null,
        querySelector: sel => (sel.startsWith('#scoreboard-overlay') ? overlay.querySelector(sel.split(' ').pop()) : body.querySelector(sel))
    };
}

// Compile the shipped UI methods onto a bare object bound to a fake document.
function extractUiMethod(name) {
    const start = uiSource.indexOf(`\n    ${name}(`) + 1;
    assert.ok(start > 0, `UI.${name} exists`);
    let depth = 0;
    for (let i = uiSource.indexOf('{', uiSource.indexOf(')', start)); i < uiSource.length; i++) {
        if (uiSource[i] === '{') depth++;
        if (uiSource[i] === '}' && --depth === 0) return uiSource.slice(start, i + 1);
    }
    throw new Error(`UI.${name} incomplete`);
}
const COVER_CHIP_VISIBLE_MS = Number(uiSource.match(/export const COVER_CHIP_VISIBLE_MS = (\d+);/)?.[1]);
function makeUi(document) {
    const timers = [];
    const methods = ['showMatchIntro', 'showCoverChip', 'scheduleMatchIntroHide', 'hideMatchIntro', '_updateScoreboardCover']
        .map(extractUiMethod).join(',\n');
    const ui = runInNewContext(`({ ${methods} })`, {
        document, t: i18n.t, setText: i18n.setText, COVER_CHIP_VISIBLE_MS,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}
    });
    ui.timers = timers;
    return ui;
}

function chipText(ui, document) {
    const chip = document.getElementById('match-cover-chip');
    return chip && !chip.classList.contains('hidden') ? chip.textContent : null;
}

test('the countdown chip names the rolled state, outlives the 1.5 s intro pill, and follows the language', () => {
    for (const [lang, on, off] of [['en', 'COVER ON', 'OPEN COURT'], ['tr', 'SİPER VAR', 'AÇIK SAHA']]) {
        i18n.setLanguage(lang, { persist: false, root: null });
        for (const [cover, text] of [[true, on], [false, off]]) {
            const document = makeDocument();
            const ui = makeUi(document);
            ui.showMatchIntro('Dojo', 'Classic', { cover });
            assert.equal(chipText(ui, document), text);
            assert.equal(document.getElementById('match-cover-chip').dataset.cover, cover ? 'on' : 'off');
            // The intro pill is hidden at 1.5 s; the chip keeps its own >= 2.5 s timer.
            ui.hideMatchIntro();
            assert.equal(chipText(ui, document), text, 'hiding the intro pill leaves the chip up');
            const chipTimer = ui.timers.at(-1);
            assert.ok(chipTimer.ms >= 2500, `chip visible ${chipTimer.ms} ms`);
            chipTimer.fn();
            assert.equal(chipText(ui, document), null);
        }
        const document = makeDocument();
        const ui = makeUi(document);
        ui.showMatchIntro('Dojo', 'Classic');
        assert.equal(document.getElementById('match-cover-chip'), null, 'no cover state, no chip');
    }
    i18n.setLanguage('en', { persist: false, root: null });
});

test('Tab scoreboard repeats the cover state as one line (hidden when unknown)', () => {
    const document = makeDocument();
    const ui = makeUi(document);
    ui._updateScoreboardCover(true);
    const line = document.getElementById('scoreboard-cover');
    assert.equal(line.textContent, en.match.coverStateOn);
    assert.equal(line.parent.className, 'scoreboard-shell');
    assert.ok(line.parent.children.indexOf(line) < line.parent.children.findIndex(c => c.className === 'scoreboard-hint'), 'above the hold-Tab hint');
    ui._updateScoreboardCover(false);
    assert.equal(line.textContent, en.match.coverStateOff);
    ui._updateScoreboardCover(undefined);
    assert.ok(line.classList.contains('hidden'));
    assert.match(uiSource, /updateScoreboard\(stats, ffa = false, \{ cover \} = \{\}\) \{[\s\S]*?this\._updateScoreboardCover\(cover\);/);
    assert.match(mainSource, /this\.ui\.updateScoreboard\(this\.game\.scoreboard\.getPlayerStats\(\), this\.game\._ffa,\s*\{ cover: this\.game\.arena\?\.propsEnabled !== false \}\);/);
});

test('host and client show the same cue in 20 seeded starts, including late join', () => {
    assert.equal(introCalls, 2, 'both startGame intro calls pass the live cover state');
    assert.match(gameSource, /props: this\.arena\?\.propsEnabled !== false,/, 'the snapshot carries the rolled props');
    const startGameFromNetwork = compileGameMethod('startGameFromNetwork', { STATES });
    const handleLateJoin = compileGameMethod('handleLateJoin', { STATES, THREE, performance: { now: () => 0 } });
    const hostArena = new Arena({ scene: new THREE.Scene(), _quality: 'low', renderer: { setClearColor() {}, toneMappingExposure: 1 }, createToonMaterial: c => new THREE.MeshBasicMaterial({ color: c }), shouldLightDecor: () => true, setBloomProfile() {} }, 'dojo');
    const clientArena = new Arena({ scene: new THREE.Scene(), _quality: 'low', renderer: { setClearColor() {}, toneMappingExposure: 1 }, createToonMaterial: c => new THREE.MeshBasicMaterial({ color: c }), shouldLightDecor: () => true, setBloomProfile() {} }, 'dojo');
    const lateArena = new Arena({ scene: new THREE.Scene(), _quality: 'low', renderer: { setClearColor() {}, toneMappingExposure: 1 }, createToonMaterial: c => new THREE.MeshBasicMaterial({ color: c }), shouldLightDecor: () => true, setBloomProfile() {} }, 'dojo');
    // Any other member a late-join handler touches is an inert, callable stub.
    const inert = () => new Proxy(function () {}, {
        get: (target, key) => (key === Symbol.toPrimitive ? () => 0 : key === 'size' || key === 'length' ? 0 : inert()),
        apply: () => inert(), set: () => true
    });
    let seed = 99;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const seen = { on: 0, off: 0 };
    for (let start = 0; start < 20; start++) {
        // Host/solo: startGame rolls, then shows its intro with the live state.
        hostArena.setPropsEnabled(rollMapProps(rng));
        const hostDoc = makeDocument();
        const hostUi = makeUi(hostDoc);
        runIntroCall.call({ arena: hostArena, mode: { name: 'Classic' }, ui: hostUi });
        const snapshot = { map: 'dojo', props: hostArena.propsEnabled !== false, weatherSeed: 7, state: STATES.COUNTDOWN, mode: 'classic', matchId: `m${start}` };

        // Client at countdown: adopts `props`, then startGame's intro call runs.
        const clientDoc = makeDocument();
        const clientUi = makeUi(clientDoc);
        const client = {
            network: { isHost: false }, arena: clientArena, mode: { name: 'Classic' }, ui: clientUi, preGameDuration: 10,
            onMatchLoading() {}, selectMode() {}, _applyOvertimeSnapshot() {},
            startGame() { runIntroCall.call(this); return true; }
        };
        startGameFromNetwork.call(client, snapshot);

        // Late joiner mid-match: no countdown, so the Tab line carries the cue.
        const lateDoc = makeDocument();
        const lateUi = makeUi(lateDoc);
        const late = new Proxy({ network: { isHost: false }, arena: lateArena, _skipPreGame: false }, {
            get: (target, key) => (key in target ? target[key] : inert())
        });
        handleLateJoin.call(late, { ...snapshot, state: STATES.PLAYING, red: 1, blue: 0, round: 2, time: 60 });
        lateUi._updateScoreboardCover(lateArena.propsEnabled !== false);

        const expected = hostArena.propsEnabled ? 'COVER ON' : 'OPEN COURT';
        seen[hostArena.propsEnabled ? 'on' : 'off']++;
        assert.equal(chipText(hostUi, hostDoc), expected, `start ${start}: host chip`);
        assert.equal(chipText(clientUi, clientDoc), expected, `start ${start}: client chip`);
        assert.equal(clientArena.propsEnabled, hostArena.propsEnabled, `start ${start}: client arena`);
        assert.equal(lateArena.propsEnabled, hostArena.propsEnabled, `start ${start}: late-join arena`);
        assert.equal(lateDoc.getElementById('scoreboard-cover').textContent,
            hostArena.propsEnabled ? en.match.coverStateOn : en.match.coverStateOff, `start ${start}: late-join Tab line`);
    }
    assert.ok(seen.on > 0 && seen.off > 0, `both states covered (${seen.on} on / ${seen.off} off)`);
    for (const arena of [hostArena, clientArena, lateArena]) arena.clearMap();
});

test('the lobby says cover is rolled per match, in EN and TR, from the real chance', () => {
    assert.equal(MAP_PROPS_CHANCE, 0.3);
    assert.match(en.match.coverRolled, /\{pct\}%/);
    assert.match(tr.match.coverRolled, /%\{pct\}/);
    i18n.setLanguage('en', { persist: false, root: null });
    assert.equal(i18n.t('match.coverRolled', { pct: 30 }), 'Cover is rolled each match (30% chance)');
    i18n.setLanguage('tr', { persist: false, root: null });
    assert.equal(i18n.t('match.coverRolled', { pct: 30 }), 'Siper her maç yeniden belirlenir (%30 şans)');
    i18n.setLanguage('en', { persist: false, root: null });
    for (const key of ['coverOn', 'coverOff', 'coverStateOn', 'coverStateOff', 'coverRolled']) {
        assert.equal(typeof en.match[key], 'string', `en match.${key}`);
        assert.equal(typeof tr.match[key], 'string', `tr match.${key}`);
    }
    assert.match(mainSource, /this\._drawLobbyMapPreview\(config\);\r?\n\s*this\._showLobbyCoverNote\(\);/);
    assert.match(mainSource, /setText\(note, 'match\.coverRolled', \{ pct: Math\.round\(MAP_PROPS_CHANCE \* 100\) \}\);/);
    assert.match(mainSource, /document\.querySelector\('#carousel-card \.carousel-info'\)/);
});

test('the chip sits below the countdown digits, never over them, and never takes input', () => {
    const rule = styleSource.slice(styleSource.indexOf('#match-cover-chip {'), styleSource.indexOf('}', styleSource.indexOf('#match-cover-chip {')));
    const countdown = styleSource.slice(styleSource.indexOf('#countdown {'), styleSource.indexOf('}', styleSource.indexOf('#countdown {')));
    const chipTop = Number(rule.match(/top: max\((\d+)px/)?.[1]);
    const countdownTop = Number(countdown.match(/top: max\((\d+)px/)?.[1]);
    const countdownEm = Number(countdown.match(/font-size: ([\d.]+)em/)?.[1]);
    // 6em digits at 16 px in a ~1.3 line box, pulsing from 1.5x about their centre
    // (countPulse): the box bottom peaks at top + 1.25 * height (284 px, measured).
    const lineBox = countdownEm * 16 * 1.3;
    assert.ok(chipTop >= countdownTop + 1.25 * lineBox, `chip top ${chipTop}px clears the pulsing countdown box`);
    assert.match(styleSource, /@keyframes coverChipIn \{\s*from \{ opacity: 0; \}\s*to \{ opacity: 1; \}\s*\}/, 'the fade never overrides translateX(-50%)');
    assert.match(rule, /pointer-events: none;/);
    assert.match(rule, /max-width: calc\(100vw - 32px\)/);
    assert.match(rule, /white-space: nowrap;/);
});
