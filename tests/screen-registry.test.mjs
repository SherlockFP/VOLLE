// Screen registry contract: a screen is only reachable when three places agree —
// the id exists in index.html, ui.js registers it in this.screens, and the key
// callers pass to showScreen() matches that registration.
//
// This exists because 'practiceMenu' drifted: index.html had
// #practice-menu-screen and main.js called showScreen('practiceMenu'), but the
// registry never listed it. showScreen() hides every screen and then shows
// this.screens[name], so an unregistered key silently left the player on a blank
// page with only the 3D background still rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const jsDir = new URL('../js/', import.meta.url);
const uiSource = fs.readFileSync(new URL('ui.js', jsDir), 'utf8');
const markup = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// key -> element id, as registered in the ui.js constructor.
function readRegistry() {
    const start = uiSource.indexOf('this.screens = {');
    assert.notEqual(start, -1, 'ui.js must declare this.screens');
    const open = uiSource.indexOf('{', start);
    const close = uiSource.indexOf('};', open);
    assert.ok(close > open, 'this.screens block must terminate');
    const body = uiSource.slice(open + 1, close);
    const registry = new Map();
    for (const [, key, id] of body.matchAll(
        /([A-Za-z]+)\s*:\s*document\.getElementById\(\s*'([^']+)'\s*\)/g
    )) {
        registry.set(key, id);
    }
    assert.ok(registry.size > 5, 'registry parse found suspiciously few screens');
    return registry;
}

// Every showScreen('key') across the client bundle.
function readCalledKeys() {
    const called = new Map();
    for (const entry of fs.readdirSync(jsDir)) {
        if (!entry.endsWith('.js')) continue;
        const source = fs.readFileSync(new URL(entry, jsDir), 'utf8');
        for (const [, key] of source.matchAll(/showScreen\(\s*'([A-Za-z]+)'/g)) {
            if (!called.has(key)) called.set(key, entry);
        }
    }
    assert.ok(called.size > 5, 'call-site parse found suspiciously few showScreen calls');
    return called;
}

const registry = readRegistry();
const called = readCalledKeys();

test('every screen key passed to showScreen is registered', () => {
    for (const [key, file] of called) {
        assert.ok(
            registry.has(key),
            `js/${file} calls showScreen('${key}') but ui.js never registers it, `
            + 'so the call blanks the page instead of opening a screen'
        );
    }
});

test('every registered screen points at an id that exists in index.html', () => {
    for (const [key, id] of registry) {
        assert.ok(
            markup.includes(`id="${id}"`),
            `ui.js registers ${key} -> #${id}, but index.html has no such element`
        );
    }
});

test('the practice menu specifically stays reachable', () => {
    // Regression lock for the drift described at the top of this file.
    assert.equal(registry.get('practiceMenu'), 'practice-menu-screen');
    assert.ok(called.has('practiceMenu'), 'something must still open the practice menu');
});

test('screen ids are not registered twice under different keys', () => {
    const seen = new Map();
    for (const [key, id] of registry) {
        const previous = seen.get(id);
        assert.equal(
            previous,
            undefined,
            `#${id} is registered as both ${previous} and ${key}; showScreen would be ambiguous`
        );
        seen.set(id, key);
    }
});
