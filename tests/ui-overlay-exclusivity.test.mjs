// tests/ui-overlay-exclusivity.test.mjs — UIOverlapFix pass (2026-07-30).
//
// Repro this test file locks down: js/ui.js's floating overlays (pause,
// settings, emote wheel, chat, team popup, case inspector, earn overlay)
// used to have zero coordination. Opening chat with Enter/Y/T while the
// team popup (M) or emote wheel (Z/G) was open left both visible at once —
// the chat input has no z-index so it silently rendered *behind* the team
// popup, and case-inspector's Escape handling lived in a totally separate
// `document.addEventListener` that didn't know about anything else that
// might be open. `UI._openExclusive(name, closeFn)` fixes this: opening a
// new exclusive overlay always closes whichever different one was tracked.
//
// Same data-URI-import technique as tests/ui-foundation.test.mjs (js/ui.js
// can't be imported directly under plain Node — it pulls in browser-only
// dependency chains — so strip the import lines and load the class body).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

async function loadUiClass() {
    const source = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return (await import(moduleUrl)).UI;
}

const UI = await loadUiClass();

function freshUi() {
    return Object.create(UI.prototype);
}

// --- pure registry behavior -------------------------------------------------

test('_openExclusive closes a different tracked overlay before taking over', () => {
    const ui = freshUi();
    let pauseClosed = 0;
    let chatClosed = 0;
    ui._openExclusive('pause', () => { pauseClosed++; });
    assert.equal(ui.exclusiveOverlayOpen(), 'pause');
    assert.equal(pauseClosed, 0, 'opening pause must not immediately call its own closeFn');

    ui._openExclusive('chat', () => { chatClosed++; });
    assert.equal(pauseClosed, 1, 'opening chat must close the previously-open pause overlay');
    assert.equal(ui.exclusiveOverlayOpen(), 'chat');
    assert.equal(chatClosed, 0);
});

test('_openExclusive re-opening the same name is a no-op (no self-close)', () => {
    const ui = freshUi();
    let closes = 0;
    ui._openExclusive('emoteWheel', () => { closes++; });
    ui._openExclusive('emoteWheel', () => { closes++; });
    assert.equal(closes, 0, 'the same overlay opening again must never call its own closeFn');
    assert.equal(ui.exclusiveOverlayOpen(), 'emoteWheel');
});

test('_closeExclusive only clears the slot when the name matches (stale closes are ignored)', () => {
    const ui = freshUi();
    ui._openExclusive('teamPopup', () => {});
    ui._closeExclusive('chat'); // some other, unrelated overlay closing
    assert.equal(ui.exclusiveOverlayOpen(), 'teamPopup', 'an unrelated close must not clear the active overlay');

    ui._closeExclusive('teamPopup');
    assert.equal(ui.exclusiveOverlayOpen(), null);
});

test('a third overlay opening while two are chained only closes the immediately-previous one', () => {
    const ui = freshUi();
    const order = [];
    ui._openExclusive('a', () => order.push('a-closed'));
    ui._openExclusive('b', () => order.push('b-closed'));
    ui._openExclusive('c', () => order.push('c-closed'));
    // 'a' was already replaced by 'b' (and its closeFn already ran then);
    // only 'b' should close when 'c' opens.
    assert.deepEqual(order, ['a-closed', 'b-closed']);
    assert.equal(ui.exclusiveOverlayOpen(), 'c');
});

// --- DOM-mocked overlay methods ---------------------------------------------

function fakeClassList() {
    const values = new Set();
    return {
        add: name => values.add(name),
        remove: name => values.delete(name),
        contains: name => values.has(name)
    };
}

function fakeOverlayEl() {
    return { classList: fakeClassList(), querySelector: () => null };
}

test('showTeamPopup + a later _openExclusive call closes the team popup overlay (chat-over-team-popup repro)', () => {
    const teamOverlay = fakeOverlayEl();
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById: id => (id === 'team-overlay' ? teamOverlay : null) };
    try {
        const ui = freshUi();
        ui.showTeamPopup({ player: { pendingTeam: 'red', team: 'red' } });
        assert.equal(teamOverlay.classList.contains('hidden'), false, 'team popup must be visible after showTeamPopup');
        assert.equal(ui.exclusiveOverlayOpen(), 'teamPopup');

        // Simulate main.js openChat()'s registry call: chat opening while the
        // team popup is still open must close the team popup instead of
        // stacking blindly on top of it.
        ui._openExclusive('chat', () => {});
        assert.equal(teamOverlay.classList.contains('hidden'), true, 'opening chat must close the still-open team popup');
        assert.equal(ui.exclusiveOverlayOpen(), 'chat');
    } finally {
        globalThis.document = previousDocument;
    }
});

test('hideTeamPopup clears the registry slot even when called directly (Escape path)', () => {
    const teamOverlay = fakeOverlayEl();
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById: id => (id === 'team-overlay' ? teamOverlay : null) };
    try {
        const ui = freshUi();
        ui.showTeamPopup({ player: { pendingTeam: 'red', team: 'red' } });
        ui.hideTeamPopup();
        assert.equal(teamOverlay.classList.contains('hidden'), true);
        assert.equal(ui.exclusiveOverlayOpen(), null, 'hideTeamPopup must clear the exclusive-overlay slot it registered');
    } finally {
        globalThis.document = previousDocument;
    }
});

// showEarnOverlay pulls in BALL_SKINS (js/ball.js) and Store defaults that
// aren't reachable once ui.js's own imports are stripped for this load
// technique (see loadUiClass() above) — assert the registry wiring at the
// source level instead, the same way the openChat/openEmoteWheel/
// openSettingsModal contract is asserted further down.
const uiSourceForEarnOverlay = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
test('showEarnOverlay/hideEarnOverlay register and release the exclusive slot', () => {
    assert.match(
        uiSourceForEarnOverlay,
        /showEarnOverlay\(store = Store\) \{\s*const el = document\.getElementById\('earn-overlay'\);\s*if \(!el\) return;\s*this\._openExclusive\('earnOverlay', \(\) => this\.hideEarnOverlay\(\)\);/
    );
    assert.match(
        uiSourceForEarnOverlay,
        /hideEarnOverlay\(\) \{\s*const el = document\.getElementById\('earn-overlay'\);\s*if \(el\) el\.classList\.add\('hidden'\);\s*this\._closeExclusive\('earnOverlay'\);/
    );
});

test('showScreen resets the exclusive-overlay slot when navigating between full screens', () => {
    const ui = freshUi();
    ui.screens = {};
    ui._exclusiveOverlay = { name: 'pause', closeFn: () => {} };
    const previousDocument = globalThis.document;
    globalThis.document = {
        body: { dataset: {} },
        getElementById: () => null
    };
    try {
        ui.showScreen('mainMenu');
        assert.equal(ui.exclusiveOverlayOpen(), null);
    } finally {
        globalThis.document = previousDocument;
    }
});

// --- Escape priority ordering (source-level contract) ------------------------
// The 5 named overlap scenarios from the audit are guarded by the single
// capture-phase keydown('Escape') chain in js/main.js. Assert the topmost-
// first order textually: team popup > earn overlay > case inspector >
// settings > pause, each with its own `return` so a single Escape keypress
// only ever closes the single topmost layer.

const mainSource = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

test('Escape closes team popup, then earn overlay, then case inspector, before settings/pause are even inspected', () => {
    const teamIdx = mainSource.indexOf("if (this.ui.isTeamPopupOpen())");
    const earnIdx = mainSource.indexOf("document.getElementById('earn-overlay')");
    const inspectorIdx = mainSource.indexOf("document.getElementById('case-inspector')");
    const settingsIdx = mainSource.indexOf("document.getElementById('unified-settings')");
    const pauseIdx = mainSource.indexOf("document.getElementById('pause-menu')");
    assert.ok(teamIdx > 0 && earnIdx > 0 && inspectorIdx > 0 && settingsIdx > 0 && pauseIdx > 0);
    assert.ok(teamIdx < earnIdx, 'team popup must be checked before the earn overlay');
    assert.ok(earnIdx < inspectorIdx, 'earn overlay must be checked before the case inspector');
    assert.ok(inspectorIdx < settingsIdx, 'case inspector must be checked before settings');
    assert.ok(settingsIdx < pauseIdx, 'settings must be checked before pause opens/resumes');
});

test('case inspector Escape handling no longer lives in a separate uncoordinated listener', () => {
    // Old bug: a second `document.addEventListener('keydown', ...)` closed
    // #case-inspector on Escape regardless of what else was open, bypassing
    // the priority chain above entirely.
    const rogueListenerPattern = /document\.addEventListener\('keydown', event => \{\s*if \(event\.key !== 'Escape'\) return;\s*const inspector = document\.getElementById\('case-inspector'\);/;
    assert.doesNotMatch(mainSource, rogueListenerPattern);
    // It must instead be inside the single capture-phase chain and stop there.
    assert.match(
        mainSource,
        /const inspectorEl = document\.getElementById\('case-inspector'\);\s*if \(inspectorEl && !inspectorEl\.classList\.contains\('hidden'\)\) \{\s*inspectorEl\.classList\.add\('hidden'\);\s*this\.ui\._closeExclusive\('caseInspector'\);\s*return;\s*\}/
    );
});

test('opening chat, emote wheel, and settings each register with the shared exclusive-overlay registry', () => {
    assert.match(mainSource, /openChat\(\) \{\s*this\.ui\.hideScoreboard\(\);\s*this\.ui\._openExclusive\('chat', \(\) => this\.closeChat\(\)\);/);
    assert.match(mainSource, /openEmoteWheel\(\) \{\s*if \(this\.game\.emotes\.wheelOpen\) return;\s*this\.ui\._openExclusive\('emoteWheel', \(\) => this\.closeEmoteWheel\(\)\);/);
    assert.match(mainSource, /openSettingsModal\(\) \{\s*this\.ui\.hideScoreboard\(\);\s*this\.ui\._openExclusive\('settings', \(\) => this\.closeSettingsModal\(\)\);/);
});
