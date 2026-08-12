import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function blockAfter(css, marker) {
    const start = css.indexOf(marker);
    assert.ok(start >= 0, `${marker} must exist`);
    return css.slice(start);
}

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

test('375px lobby gives the body one vertical scroll lane and keeps content columns non-shrinking', async () => {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const mobile = blockAfter(css, '/* One scroll owner:');

    const body = rule(mobile, '#lobby-screen .cs-body');
    assert.match(body, /display:\s*flex;/);
    assert.match(body, /flex-direction:\s*column;/);
    assert.match(body, /justify-content:\s*flex-start;/);
    assert.match(body, /align-items:\s*stretch;/);
    assert.match(body, /min-height:\s*0;/);
    assert.match(body, /overflow-x:\s*hidden;/);
    assert.match(body, /overflow-y:\s*auto;/);
    const laterBodyRules = mobile.match(/#lobby-screen \.cs-body\s*\{[^}]*\}/g) || [];
    assert.ok(laterBodyRules.length >= 1);
    for (const laterRule of laterBodyRules.slice(1)) {
        assert.doesNotMatch(laterRule, /display:|flex-direction:|justify-content:|align-items:|overflow-[xy]:/, 'later sizing rules cannot replace the one mobile scroll owner');
    }
    assert.match(mobile, /#lobby-screen \.cs-center,\s*#lobby-screen \.cs-team-col\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-width:\s*0;/);
    assert.match(mobile, /#lobby-screen \.cs-center\s*\{[\s\S]*?order:\s*-1;[\s\S]*?overflow:\s*visible;[\s\S]*?box-sizing:\s*border-box;/);
    assert.match(mobile, /#lobby-screen \.cs-team-players\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/);
    assert.match(mobile, /#lobby-screen \.cs-team-col\s*\{\s*min-height:\s*280px;/);
    assert.match(css, /#lobby-screen \.cs-mode-btn\s*\{[\s\S]*?min-height:\s*44px;/);
});

test('375px lobby topbar wraps into bounded, reachable rows without UUID overflow', async () => {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const mobile = blockAfter(css, '/* Keep the room token from pushing the lobby header off-screen. */');

    assert.match(mobile, /#lobby-screen \.cs-topbar\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto auto;[\s\S]*?"room room leave"[\s\S]*?"name name name"[\s\S]*?"info info network"[\s\S]*?max-height:\s*150px;[\s\S]*?overflow:\s*hidden;/);
    assert.match(mobile, /#lobby-screen \.cs-roomcode\s*\{[\s\S]*?grid-area:\s*room;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(mobile, /#lobby-screen \.cs-roomcode span\s*\{[\s\S]*?max-width:\s*20ch;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(mobile, /#lobby-screen \.cs-lobby-name\s*\{[\s\S]*?grid-area:\s*name;[\s\S]*?min-width:\s*0;[\s\S]*?margin:\s*0;/);
    assert.match(mobile, /#lobby-screen \.cs-top-info\s*\{[\s\S]*?grid-area:\s*info;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(mobile, /#lobby-screen \.cs-top-info > span\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
    assert.doesNotMatch(css, /\.lobby-region/);
    assert.doesNotMatch(await readFile(new URL('../index.html', import.meta.url), 'utf8'), /id="lobby-region"/);
    assert.match(mobile, /#lobby-screen #lobby-network-status\s*\{\s*grid-area:\s*network;/);
    assert.match(mobile, /#lobby-screen \.cs-btn-back\s*\{[\s\S]*?grid-area:\s*leave;[\s\S]*?min-height:\s*44px;/);
});

test('desktop and client-lobby contracts remain intact outside the mobile fix', async () => {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const mobileStart = css.indexOf('@media (max-width: 700px) {');
    const beforeMobile = css.slice(0, mobileStart);
    const desktopBody = rule(beforeMobile, '#lobby-screen .cs-body');

    assert.match(desktopBody, /grid-template-columns:\s*minmax\(190px, 230px\) minmax\(460px, 1fr\) minmax\(190px, 230px\);/);
    assert.match(css, /#lobby-screen\.lobby-client \.cs-lobby-host-controls\s*\{\s*display:\s*none;/);
    assert.doesNotMatch(desktopBody, /overflow-x:\s*hidden;/);
});
