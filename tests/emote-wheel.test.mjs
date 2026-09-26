// Emote wheel regressions (owner report: "the emote menu seems broken").
// Covers the real js/emotes.js DOM wheel + sprite lifecycle, the Game emote rules and
// the App wiring. Before the fix: sprites were never updated (stuck at the world
// origin, never faded), Enter/Space/Esc leaked to the game (chat opened, jump, pause),
// hovering turned the camera and clicking an emote swung the knife, emotes were never
// networked, and an open wheel survived death / round end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { compileGameMethod } from './game-source.mjs';

// ---- Minimal DOM with real bubbling (enough for js/emotes.js) --------------------
class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parent = null;
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
        this.style = { setProperty(key, value) { this[key] = value; } };
        const classes = new Set();
        this.classList = {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle: (name, force) => ((force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name))
        };
        this._classes = classes;
        this.id = '';
        this.innerHTML = '';
    }
    set className(value) { this._classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c)); }
    get className() { return [...this._classes].join(' '); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter(child => child !== this);
        this.parent = null;
    }
    querySelector(selector) {
        if (selector === 'strong') return (this._strong ||= new FakeElement('strong'));
        return null;
    }
    closest(selector) {
        const className = selector.replace(/^\./, '');
        for (let node = this; node; node = node.parent) if (node._classes?.has(className)) return node;
        return null;
    }
    focus() { globalThis.document.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== listener); }
    getContext() { return { fillText() {}, set font(_) {}, set textAlign(_) {}, set textBaseline(_) {} }; }
}

function fire(target, type, props = {}) {
    const event = {
        type, target, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...props
    };
    for (let node = target; node; node = node.parent) {
        for (const listener of node.listeners[type] || []) listener(event);
        if (event.propagationStopped) break;
    }
    return event;
}

function installDom() {
    const documentElement = new FakeElement('html');
    const body = documentElement.appendChild(new FakeElement('body'));
    const document = Object.assign(documentElement, {
        body,
        activeElement: body,
        createElement: tag => new FakeElement(tag),
        getElementById(id) {
            const walk = node => (node.id === id ? node : node.children.map(walk).find(Boolean) || null);
            return walk(documentElement);
        }
    });
    globalThis.document = document;
    globalThis.window = { innerWidth: 1280, innerHeight: 720 };
    return document;
}

const threeUrl = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        return specifier === 'three' ? { url: threeUrl, shortCircuit: true } : nextResolve(specifier, context);
    }
});
installDom();
const { EmoteSystem, EMOTES, EMOTE_DURATION, EMOTE_PAGES, isEmoteId } = await import('../js/emotes.js');
// The wheel shows one page at a time; page 0 holds the classic emotes.
const PAGE0 = EMOTE_PAGES[0].ids;

function openWheel() {
    const document = installDom();
    const reachedGame = [];
    for (const type of ['keydown', 'mousemove', 'mousedown', 'mouseup']) {
        document.addEventListener(type, event => reachedGame.push(`${type}:${event.key || ''}`));
    }
    const system = new EmoteSystem({ add() {}, remove() {} });
    const chosen = [];
    let cancelled = 0;
    system.onEmoteSelect = id => chosen.push(id);
    system.onWheelCancel = () => cancelled++;
    system.showWheel({ x: 640, y: 360 });
    const wheel = document.getElementById('emote-wheel');
    const buttons = wheel.children.filter(child => child.tagName === 'BUTTON');
    return { document, system, wheel, buttons, chosen, reachedGame, cancelled: () => cancelled };
}

test('wheel opens with every emote, keyboard selection works and keys stay inside the wheel', () => {
    const h = openWheel();
    assert.equal(h.system.wheelOpen, true);
    assert.equal(h.buttons.length, PAGE0.length);
    assert.equal(h.wheel.dataset.selectedIndex, '0');
    assert.equal(h.document.activeElement, h.buttons[0], 'focus moves into the wheel');

    fire(h.buttons[0], 'keydown', { key: 'ArrowRight', code: 'ArrowRight' });
    assert.equal(h.wheel.dataset.selectedIndex, '1');
    fire(h.buttons[1], 'keydown', { key: 'ArrowLeft', code: 'ArrowLeft' });
    fire(h.buttons[0], 'keydown', { key: 'ArrowLeft', code: 'ArrowLeft' });
    assert.equal(h.wheel.dataset.selectedIndex, String(PAGE0.length - 1), 'selection wraps');
    const enter = fire(h.buttons.at(-1), 'keydown', { key: 'Enter', code: 'Enter' });
    assert.deepEqual(h.chosen, [PAGE0.at(-1)]);
    assert.equal(enter.defaultPrevented, true);
    fire(h.buttons[0], 'keydown', { key: ' ', code: 'Space' });
    assert.equal(h.chosen.length, 2);
    fire(h.buttons[0], 'keydown', { key: 'Escape', code: 'Escape' });
    assert.equal(h.cancelled(), 1, 'Esc cancels');
    assert.deepEqual(h.reachedGame, [], 'Enter/Space/arrows/Esc never reach the game (chat, jump, pause)');

    // G / Z must still reach App's toggle.
    fire(h.buttons[0], 'keydown', { key: 'g', code: 'KeyG' });
    assert.deepEqual(h.reachedGame, ['keydown:g']);
});

test('pointer: hover aims, clicks choose, and the game never sees the mouse', () => {
    const h = openWheel();
    const move = fire(h.wheel, 'mousemove', { movementX: 40, movementY: 0 });
    assert.equal(move.propagationStopped, true, 'hovering does not turn the camera');
    const down = fire(h.wheel, 'mousedown', { button: 0 });
    assert.equal(down.defaultPrevented, true, 'focus stays in the wheel');
    fire(h.buttons[3], 'mousedown', { button: 0 });
    assert.deepEqual(h.reachedGame, [], 'clicking an emote does not swing the knife');

    fire(h.buttons[3], 'click');
    assert.deepEqual(h.chosen, [PAGE0[3]]);

    // Dead centre click = cancel; aimed click = choose the aimed slice.
    fire(h.wheel, 'pointermove', { clientX: 150, clientY: 150 });
    fire(h.wheel, 'click');
    assert.equal(h.cancelled(), 1);
    fire(h.wheel, 'pointermove', { clientX: 300, clientY: 150 }); // straight right = quarter turn
    fire(h.wheel, 'click');
    assert.equal(h.chosen.at(-1), PAGE0[PAGE0.length / 4]);
});

test('pages: Tab / the mouse wheel switch to Callouts, digits send a slot, the last emote reopens its page', () => {
    const h = openWheel();
    assert.deepEqual(EMOTE_PAGES.map(page => page.id), ['emotes', 'callouts']);
    assert.equal(new Set(EMOTE_PAGES.flatMap(page => page.ids)).size, EMOTES.length, 'every emote is on exactly one page');
    const tab = fire(h.buttons[0], 'keydown', { key: 'Tab', code: 'Tab' });
    assert.equal(tab.defaultPrevented, true);
    assert.equal(h.wheel.dataset.page, 'callouts');
    let buttons = h.wheel.children.filter(child => child.tagName === 'BUTTON');
    assert.equal(buttons.length, EMOTE_PAGES[1].ids.length, 'the ring shows only the open page');
    assert.ok(buttons.every(button => button._classes.has('is-callout')));
    const digit = fire(buttons[0], 'keydown', { key: '3', code: 'Digit3' });
    assert.equal(digit.propagationStopped, true, 'digits never reach the game');
    assert.deepEqual(h.chosen, [EMOTE_PAGES[1].ids[2]]);
    fire(h.wheel, 'wheel', { deltaY: 120 });
    assert.equal(h.wheel.dataset.page, 'emotes', 'scrolling cycles the pages');
    assert.deepEqual(h.reachedGame, []);

    const again = openWheel();
    again.system.showWheel({ x: 0, y: 0 }, { selectedId: 'thanks', hint: 'Release Z' });
    const wheel = again.document.getElementById('emote-wheel');
    assert.equal(wheel.dataset.page, 'callouts');
    assert.equal(wheel.dataset.selectedIndex, String(EMOTE_PAGES[1].ids.indexOf('thanks')));
});

// Owner report: aiming picked the mirrored slot. The pointer stays locked in
// play, so mouse events target the canvas with a frozen position: the wheel now
// aims with movement from the centre and swallows the input (no camera turn, no
// knife swing) until it closes.
test('pointer lock: movement aims from the centre, a click sends, look and knife never get the input', () => {
    const h = openWheel();
    const canvas = h.document.body.appendChild(new FakeElement('canvas'));
    const move = fire(canvas, 'mousemove', { movementX: 80, movementY: 0, clientX: 0, clientY: 0 });
    assert.equal(move.propagationStopped, true, 'the camera does not turn');
    assert.deepEqual(h.system.wheelSelection(), { id: PAGE0[PAGE0.length / 4], aimed: true }, 'right = the right-hand slot');
    fire(canvas, 'mousemove', { movementX: -80, movementY: -60 });
    assert.deepEqual(h.system.wheelSelection(), { id: PAGE0[0], aimed: true }, 'up = the top slot');
    fire(canvas, 'mousemove', { movementX: 0, movementY: 50 });
    assert.equal(h.system.wheelSelection().aimed, false, 'back near the centre: nothing aimed');
    fire(canvas, 'mousemove', { movementX: 0, movementY: -500 });
    fire(canvas, 'mousemove', { movementX: 0, movementY: 200 });
    assert.deepEqual(h.system.wheelSelection(), { id: PAGE0[PAGE0.length / 2], aimed: true },
        'the virtual cursor is capped: after a big flick up, 200 px down already points down');
    const down = fire(canvas, 'mousedown', { button: 0 });
    assert.equal(down.defaultPrevented, true);
    assert.equal(down.propagationStopped, true, 'the knife does not swing');
    assert.deepEqual(h.chosen, [PAGE0[PAGE0.length / 2]]);
    fire(canvas, 'mousedown', { button: 2 });
    assert.equal(h.cancelled(), 1, 'right click cancels');
    h.system.hideWheel();
    assert.equal(fire(canvas, 'mousemove', { movementX: 50, movementY: 0 }).propagationStopped, false, 'released with the wheel');
});

test('hold and release: wheelSelection reports whether a slot was aimed; confirmWheel sends it', () => {
    const h = openWheel();
    assert.deepEqual(h.system.wheelSelection(), { id: PAGE0[0], aimed: false }, 'just opened: nothing aimed');
    fire(h.wheel, 'pointermove', { clientX: 300, clientY: 150 });
    assert.deepEqual(h.system.wheelSelection(), { id: PAGE0[PAGE0.length / 4], aimed: true });
    fire(h.wheel, 'pointermove', { clientX: 150, clientY: 150 });
    assert.equal(h.system.wheelSelection().aimed, false, 'back in the dead centre');
    fire(h.buttons[0], 'keydown', { key: 'ArrowRight', code: 'ArrowRight' });
    assert.equal(h.system.wheelSelection().aimed, true, 'keyboard selection counts as aimed');
    assert.equal(h.system.confirmWheel(), true);
    assert.deepEqual(h.chosen, [PAGE0[PAGE0.length / 4 + 1]], 'the arrow moved on from the aimed slot');
    h.system.hideWheel();
    assert.equal(h.system.wheelSelection(), null);
    assert.equal(h.system.confirmWheel(), false);
});

test('callout sprites carry their label and are twice as wide', () => {
    installDom();
    const scene = { added: [], add(sprite) { this.added.push(sprite); }, remove() {} };
    const system = new EmoteSystem(scene);
    const written = [];
    globalThis.document.createElement = tag => {
        const element = new FakeElement(tag);
        element.getContext = () => ({ fillText: text => written.push(text), strokeText() {} });
        return element;
    };
    system.label = emote => (emote.id === 'incoming' ? 'Geliyor!' : emote.text);
    system.show({ position: { x: 0, y: 0, z: 0 }, alive: true }, 'incoming');
    assert.deepEqual(written, ['⚠️', 'Geliyor!']);
    system.update(1);
    assert.ok(scene.added[0].scale.x > scene.added[0].scale.y * 1.9);
});

test('Z release: a tap keeps the wheel open, a hold sends the aimed emote or closes, timed by the events', async () => {
    const { compileMethod } = await import('./method-source.mjs');
    const release = compileMethod('js/app-emote-wheel.js', '_releaseEmoteWheelKey', { performance: { now: () => 99999 }, EMOTE_HOLD_MS: 220 });
    const app = aimed => {
        const calls = [];
        return {
            calls,
            _emoteWheelHeldSince: 1000,
            closeEmoteWheel: () => calls.push('close'),
            game: { emotes: { wheelOpen: true, wheelSelection: () => ({ id: 'gg', aimed }), confirmWheel: () => { calls.push('send'); return true; } } }
        };
    };
    const tap = app(true);
    assert.equal(release.call(tap, 1150), false, 'released after 150 ms: a tap');
    assert.deepEqual(tap.calls, [], 'the wheel stays open (performance.now() is far later: a slow frame does not matter)');
    const aimedHold = app(true);
    assert.equal(release.call(aimedHold, 1400), true);
    assert.deepEqual(aimedHold.calls, ['send']);
    const blindHold = app(false);
    release.call(blindHold, 1400);
    assert.deepEqual(blindHold.calls, ['close'], 'nothing aimed: just closes');
    assert.equal(blindHold._emoteWheelHeldSince, null);
});

test('a teammate\'s callout is also a HUD line; plain emotes, opponents, yourself and FFA are not', async () => {
    const { compileMethod } = await import('./method-source.mjs');
    const bind = compileMethod('js/app-emote-wheel.js', '_bindEmoteWheel', { t: key => key });
    const label = compileMethod('js/app-emote-wheel.js', '_emoteLabel', { t: key => (key === 'emotes.incoming' ? 'Geliyor!' : key) });
    const shown = [];
    const me = { team: 'red' };
    const app = { player: me, game: { emotes: {}, _ffa: false }, ui: { showMessage: text => shown.push(text) }, _emoteLabel: label };
    bind.call(app);
    const incoming = EMOTES.find(e => e.id === 'incoming');
    app.game.emotes.onEmote(incoming, { name: 'Deniz', team: 'red' });
    app.game.emotes.onEmote(incoming, { name: 'Rakip', team: 'blue' });
    app.game.emotes.onEmote(incoming, me);
    app.game.emotes.onEmote(EMOTES.find(e => e.id === 'gg'), { name: 'Deniz', team: 'red' });
    app.game._ffa = true;
    app.game.emotes.onEmote(incoming, { name: 'Deniz', team: 'red' });
    assert.deepEqual(shown, ['Deniz: ⚠️ Geliyor!']);
    assert.equal(app.game.emotes.label(EMOTES.find(e => e.id === 'gg')), 'GG', 'a missing translation falls back to the English text');
});

test('App wiring: Z ignores key repeat, a held Z sends the aimed emote on release, callouts reach teammates', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const wheel = await readFile(new URL('../js/app-emote-wheel.js', import.meta.url), 'utf8');
    assert.match(main, /e\.preventDefault\(\);\s*if \(e\.repeat\) return;\s*if \(this\.game\.emotes\.wheelOpen\) \{/);
    assert.match(main, /this\._emoteWheelHeldSince = e\.code === 'KeyZ' \? \(e\.timeStamp \|\| performance\.now\(\)\) : null;/);
    assert.match(main, /if \(e\.code === 'KeyZ'\) \{\s*this\._releaseEmoteWheelKey\?\.\(e\.timeStamp\);/, 'tap vs hold from event timestamps');
    assert.match(main, /showWheel\(\{ x: cx, y: cy \}, \{ selectedId: this\._lastEmoteId, hint: this\._emoteWheelHint\?\.\(\) \}\);/);
    assert.match(main, /this\._lastEmoteId = emoteId;/);
    assert.match(wheel, /if \(now - since < EMOTE_HOLD_MS\) return false;/, 'a quick tap keeps the wheel open');
    assert.match(wheel, /if \(this\.game\.emotes\.wheelSelection\?\.\(\)\?\.aimed\) return this\.game\.emotes\.confirmWheel\(\);/);
    assert.match(wheel, /if \(entity\.team !== this\.player\?\.team \|\| this\.game\?\._ffa\) return;/, 'only teammates, never in FFA');
});

test('hideWheel removes the DOM and reopening never duplicates it', () => {
    const h = openWheel();
    h.system.showWheel({ x: 0, y: 0 });
    assert.equal(h.document.body.children.filter(child => child.id === 'emote-wheel').length, 1);
    h.system.hideWheel();
    assert.equal(h.system.wheelOpen, false);
    assert.equal(h.document.getElementById('emote-wheel'), null);
});

test('emote sprites appear above the entity at once, float, fade and are disposed', () => {
    installDom();
    const scene = { added: [], removed: [], add(sprite) { this.added.push(sprite); }, remove(sprite) { this.removed.push(sprite); } };
    const system = new EmoteSystem(scene);
    const entity = { position: { x: 4, y: 1.7, z: -3 }, alive: true };
    assert.equal(system.show(entity, 'fire', { offsetY: 1.3 }), true);
    const sprite = scene.added[0];
    assert.ok(Math.abs(sprite.position.x - 4) < 1e-9 && sprite.position.y > 2.9, 'never parked at the world origin');
    let disposed = 0;
    sprite.material.map.dispose = () => disposed++;
    const y0 = sprite.position.y;
    system.update(0.5);
    assert.ok(sprite.position.y > y0, 'floats up');
    // Same entity again replaces (and disposes) the old sprite.
    system.show(entity, 'gg');
    assert.equal(scene.removed[0], sprite);
    assert.equal(disposed, 1);
    system.update(EMOTE_DURATION + 0.1);
    assert.equal(system.activeEmotes.size, 0, 'expires');
    assert.equal(scene.removed.length, 2);
    // Two players sharing a display name keep separate emotes.
    system.show({ name: 'Player', position: { x: 0, y: 0, z: 0 } }, 'gg');
    system.show({ name: 'Player', position: { x: 1, y: 0, z: 0 } }, 'gg');
    assert.equal(system.activeEmotes.size, 2);
    // A dead entity's emote goes away with it.
    const doomed = { position: { x: 0, y: 0, z: 0 }, alive: true };
    system.show(doomed, 'skull');
    doomed.alive = false;
    system.update(0.016);
    assert.equal([...system.activeEmotes.keys()].includes(doomed), false);
    assert.equal(system.show(entity, 'not-an-emote'), false);
    assert.equal(isEmoteId('fire'), true);
});

// ---- Game rules --------------------------------------------------------------------
const STATES = { PLAYING: 'PLAYING', COUNTDOWN: 'COUNTDOWN', ROUND_END: 'ROUND_END', CELEBRATION: 'CELEBRATION', SOCIAL_HUB: 'SOCIAL_HUB', MENU: 'MENU', LOBBY: 'LOBBY' };

test('who can hold the wheel: live players, the social hub, spectators all match long', () => {
    const can = compileGameMethod('canUseEmoteWheel', { STATES });
    const game = (state, extra = {}) => ({ state, localSpectator: false, player: { alive: true }, ...extra });
    assert.equal(can.call(game('PLAYING')), true);
    assert.equal(can.call(game('PLAYING', { player: { alive: false } })), false, 'dead players close it');
    assert.equal(can.call(game('ROUND_END')), false, 'round end closes it for players');
    assert.equal(can.call(game('SOCIAL_HUB')), true);
    assert.equal(can.call(game('MENU')), false);
    assert.equal(can.call(game('ROUND_END', { localSpectator: true })), true);
    assert.equal(can.call(game('CELEBRATION', { localSpectator: true })), true);
    assert.equal(can.call(game('LOBBY', { localSpectator: true })), false);
});

test('local emotes are rate limited, confirmed on the HUD and sent to everyone', () => {
    let now = 1000;
    const globals = { performance: { now: () => now }, t: key => key, isEmoteId, getEmote: id => EMOTES.find(e => e.id === id), LOCAL_EMOTE_COOLDOWN_MS: 1200 };
    const claim = compileGameMethod('_claimLocalEmote', globals);
    const sendPacket = compileGameMethod('_sendEmotePacket', globals);
    const sendPlayer = compileGameMethod('sendPlayerEmote', globals);
    const messages = [];
    const sent = [];
    const game = {
        localSpectator: false,
        ui: { showMessage: text => messages.push(text) },
        network: { connected: true, isHost: false, playerId: 'me', send: packet => sent.push(packet), broadcast: packet => sent.push(packet) },
        _claimLocalEmote: claim,
        _sendEmotePacket: sendPacket
    };
    assert.equal(sendPlayer.call(game, 'fire'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'emote', emote: 'fire' }]);
    assert.match(messages[0], /On fire!/);
    now += 500;
    assert.equal(sendPlayer.call(game, 'gg'), false, 'spam is blocked locally too');
    assert.equal(sent.length, 1);
    now += 1300;
    game.network.isHost = true;
    assert.equal(sendPlayer.call(game, 'gg'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'emote', playerId: 'me', emote: 'gg' }, 'host broadcasts with its own id');
    assert.equal(sendPlayer.call(game, 'bogus'), false);
});

test('network emotes land on the right entity and never on bots, queued or dead players', () => {
    const show = compileGameMethod('showNetworkEmote', { isEmoteId, PLAYER_EMOTE_OFFSET_Y: 1.3 });
    const shown = [];
    const remote = { alive: true };
    const game = {
        network: { playerId: 'me' },
        spectators: { has: id => id === 'fan' },
        showSpectatorEmote: (id, emote) => { shown.push(['crowd', id, emote]); return true; },
        remotePlayers: new Map([['p1', remote], ['bot:x', { isBotEntity: true }], ['q', { queuedForNextRound: true }], ['dead', { alive: false }]]),
        emotes: { show: (entity, emote, options) => { shown.push(['player', entity, emote, options.offsetY]); return true; } }
    };
    assert.equal(show.call(game, 'fan', 'clap'), true);
    assert.equal(show.call(game, 'p1', 'gg'), true);
    for (const id of ['bot:x', 'q', 'dead', 'nobody', 'me']) assert.equal(show.call(game, id, 'gg'), false, id);
    assert.equal(show.call(game, 'p1', 'nope'), false);
    assert.deepEqual(shown, [['crowd', 'fan', 'clap'], ['player', remote, 'gg', 1.3]]);
});

test('App wiring: toggle gate, per-frame auto-close, host relay and client handler', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(main, /\(e\.code === 'KeyZ' \|\| e\.code === 'KeyG'\) && \(this\.game\.emotes\.wheelOpen \|\| this\.game\.canUseEmoteWheel\(\)\)/);
    assert.match(main, /this\._syncJoinedSpectatorView\(\);\s*this\._syncEmoteWheel\(\);/);
    assert.match(main, /_syncEmoteWheel\(\) \{\s*if \(this\.game\.emotes\?\.wheelOpen && !this\.game\.canUseEmoteWheel\?\.\(\)\) this\.closeEmoteWheel\(\);/);
    assert.match(main, /this\.game\.emotes\.onWheelCancel = \(\) => this\.closeEmoteWheel\(\);/);
    assert.match(main, /this\.network\.onEmote = \(playerId, emote\) => \{\s*if \(!this\.game\.showNetworkEmote\(playerId, emote\)\) return;\s*this\.network\.broadcast\(\{ type: 'emote', playerId, emote \}\);/);
    assert.match(main, /this\.network\.onEmote = \(playerId, emote\) => this\.game\.showNetworkEmote\(playerId, emote\);/);
    assert.match(main, /else if \(this\.game\.sendPlayerEmote\(emoteId\)\) this\.game\.showEmote\(this\.player, emoteId\);/);
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(game, /this\.emotes\.update\(dt\);/, 'emote sprites are ticked every frame');
});
