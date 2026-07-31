// tests/menu-flow.test.mjs — source-contract coverage for the consolidated main-menu
// multiplayer entry point (single "Play Online" button routing into the existing
// multiplayer screen) instead of separate Host Game / Join Game buttons.
// Style mirrors tests/endgame-controls.test.mjs: read the real source, assert on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function mainMenuBlock() {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const start = html.indexOf('<div id="main-menu"');
    const end = html.indexOf('<!-- ===== 3D SOCIAL LOBBY HUD', start);
    assert.ok(start >= 0 && end > start, 'could not locate the #main-menu block in index.html');
    return html.slice(start, end);
}

async function multiplayerMenuBlock() {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const start = html.indexOf('<div id="multiplayer-menu"');
    const end = html.indexOf('<!-- ===== JOIN MENU', start);
    assert.ok(start >= 0 && end > start, 'could not locate the #multiplayer-menu block in index.html');
    return html.slice(start, end);
}

test('#main-menu exposes a single Play Online button, not separate Host/Join buttons', async () => {
    const block = await mainMenuBlock();
    assert.match(block, /id="btn-play-online"/);
    assert.doesNotMatch(block, /id="btn-host-game"/);
    assert.doesNotMatch(block, /id="btn-join-game"/);
});

test('#main-menu keeps Quick Play as the primary CTA and Practice/Tournament/Avatar around Play Online', async () => {
    const block = await mainMenuBlock();
    // Quick Play (ow-play) must still exist and precede the secondary group in markup order.
    const quickPlayIdx = block.indexOf('id="btn-play-solo"');
    const secondaryGroupIdx = block.indexOf('ow-secondary ow-secondary-right');
    const playOnlineIdx = block.indexOf('id="btn-play-online"');
    const practiceIdx = block.indexOf('id="btn-practice"');
    const tournamentIdx = block.indexOf('id="btn-tournament"');
    const avatarIdx = block.indexOf('id="btn-avatar"');
    assert.ok(quickPlayIdx >= 0 && secondaryGroupIdx > quickPlayIdx, 'Quick Play must stay the primary CTA above the secondary button group');
    // Play Online is the first (most prominent) secondary action, ahead of Practice/Tournament/Avatar.
    assert.ok(playOnlineIdx > secondaryGroupIdx, 'Play Online must live inside the secondary button group');
    assert.ok(playOnlineIdx < practiceIdx && practiceIdx < tournamentIdx && tournamentIdx < avatarIdx,
        'expected order: Play Online, Practice, Tournament, Avatar');
});

test('multiplayer screen still exposes a reachable host action (btn-mp-create) for Play Online to route into', async () => {
    const block = await multiplayerMenuBlock();
    assert.match(block, /id="btn-mp-create"/);
    assert.match(block, /id="btn-mp-join"/);
    assert.match(block, /id="btn-mp-solo"/);
});

test('btn-play-online binds exactly the old btn-join-game routing (multiplayer screen + lobby refresh)', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /bind\('btn-host-game'/);
    assert.doesNotMatch(source, /bind\('btn-join-game'/);

    const bindIdx = source.indexOf("bind('btn-play-online'");
    assert.ok(bindIdx >= 0, 'expected a bind(\'btn-play-online\', ...) handler in main.js');
    const handlerSlice = source.slice(bindIdx, bindIdx + 900);
    assert.match(handlerSlice, /this\.ui\.showScreen\('multiplayerMenu'\)/);
    assert.match(handlerSlice, /this\._refreshLobbyList\(\)/);
    assert.match(handlerSlice, /this\._mpRefreshTimer = setInterval\(\(\) => this\._refreshLobbyList\(\), 5000\)/);
});

test('hosting (_doHostGame) remains wired to the in-screen Create Lobby button, not removed', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(source, /bind\('btn-mp-create', \(\) => \{[\s\S]*?this\._doHostGame\(\);/);
});
