// First load was 2046 KiB, over half of it assets no first screen shows: the
// match-end trophy (443 KiB GLB), a 297 KiB logo PNG and hidden-screen art. These
// pins keep them off the boot path (measured after the fix: 1034 KiB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const arena = read('js/arena.js');
const game = read('js/game.js');

test('the match-end trophy loads with a real match, not with the boot-time menu arena', () => {
    const ctor = arena.slice(arena.indexOf('constructor('), arena.indexOf('preloadMatchDecor() {'));
    assert.doesNotMatch(ctor, /preloadTrophyTemplate\(\)/);
    assert.match(arena, /preloadMatchDecor\(\) \{\s+return preloadTrophyTemplate\(\);/);
    assert.match(game, /this\.onMatchStart\?\.\(\);\s+if \(!this\._practiceMode\) this\.arena\?\.preloadMatchDecor\?\.\(\);/);
});

test('in-page logos and the favicon use the small encodes; hidden-screen art is lazy', () => {
    const logoImgs = [...html.matchAll(/<img class="brand-mark [^"]*" src="([^"]+)"/g)].map(m => m[1]);
    assert.equal(logoImgs.length, 4);
    for (const src of logoImgs) assert.equal(src, 'assets/generated/volle-logo-384.webp');
    assert.match(html, /<link rel="icon" type="image\/png" href="assets\/generated\/volle-logo-64\.png">/);
    for (const art of ['volle-shop-roster.webp', 'cases/kickoff-case.webp', 'postgame/victory-arena-broadcast-v1.webp']) {
        assert.match(html, new RegExp(`<img[^>]+src="assets/generated/${art.replace(/[./]/g, '\\$&')}"[^>]*loading="lazy"`), art);
    }
    assert.ok(statSync(new URL('../assets/generated/volle-logo-384.webp', import.meta.url)).size < 64 * 1024);
    assert.ok(statSync(new URL('../assets/generated/volle-logo-64.png', import.meta.url)).size < 16 * 1024);
});
