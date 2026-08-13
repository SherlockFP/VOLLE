// Quick Play lobby-board contracts: empty board states must not repeat the
// primary Host action in the persistent footer strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = path => readFile(new URL(path, import.meta.url), 'utf8');

test('loading lobby board has one in-context host action, semantic guidance, and starts with its strip hidden', async () => {
    const html = await file('../index.html');
    const start = html.indexOf('<div id="multiplayer-menu"');
    const end = html.indexOf('<!-- ===== JOIN MENU', start);
    const board = html.slice(start, end);
    assert.match(board, /id="mp-lobby-list"[^>]*data-lobby-state="loading"[^>]*aria-live="polite"/);
    assert.match(board, /aria-busy="true"/);
    assert.match(board, /data-empty-kind="loading"/);
    assert.match(board, /LIVE DIRECTORY[\s\S]*?Finding public rooms[\s\S]*?Join by Code[\s\S]*?Host a game/);
    assert.equal((board.match(/mp-lobby-empty-cta/g) || []).length, 1, 'loading state has one host CTA');
    assert.equal((board.match(/id="btn-mp-host-strip"/g) || []).length, 1, 'one populated-list fallback strip remains in markup');

    const css = await file('../css/polish.css');
    assert.match(css, /#mp-lobby-list:not\(\[data-lobby-state="populated"\]\) \+ \.mp-host-strip\s*\{\s*display:\s*none;/);
});

test('lobby refresh labels every board state and keeps join-by-code secondary to one host CTA', async () => {
    const main = await file('../js/main.js');
    const renderStart = main.indexOf('_renderLobbyEmpty(container, message, state = \'empty\')');
    const refreshStart = main.indexOf('async _refreshLobbyList()');
    assert.ok(renderStart >= 0 && refreshStart > renderStart, 'expected stateful empty renderer before refresh');
    const render = main.slice(renderStart, refreshStart);
    assert.match(render, /container\.dataset\.lobbyState = state;/);
    assert.match(render, /container\.toggleAttribute\('aria-busy', state === 'loading'\);/);
    assert.match(render, /No public rooms right now/);
    assert.match(render, /Public rooms unavailable/);
    assert.match(render, /No rooms match these filters/);
    assert.match(render, /mp-lobby-empty-join/);
    assert.doesNotMatch(render, /querySelector\('\.mp-lobby-empty-cta'\)/, 'empty CTA uses the single delegated handler');

    const refresh = main.slice(refreshStart, main.indexOf('async _startQuickPlay()', refreshStart));
    assert.match(refresh, /_renderLobbyEmpty\(container, 'Lobby service unreachable[^']*', 'error'\)/);
    assert.match(refresh, /_renderLobbyEmpty\(container, 'Try widening mode, map, queue, or open-slot filters\.', 'filtered'\)/);
    assert.match(refresh, /container\.dataset\.lobbyState = 'populated';[\s\S]*?container\.removeAttribute\('aria-busy'\);/);
    assert.match(main, /getElementById\('mp-lobby-list'\)\?\.addEventListener\('click', event => \{[\s\S]*?event\.target\.closest\('\.mp-lobby-empty-cta'\)[\s\S]*?getElementById\('btn-mp-create'\)\?\.click\(\)[\s\S]*?event\.target\.closest\('\.mp-lobby-empty-join'\)[\s\S]*?getElementById\('btn-mp-join'\)\?\.click\(\)/);
});

test('empty board presentation fills the list area without a second host strip', async () => {
    const css = await file('../css/polish.css');
    assert.match(css, /#multiplayer-menu \.mp-lobby-list:not\(\[data-lobby-state="populated"\]\)[\s\S]*?flex:\s*1 1 260px;[\s\S]*?min-height:\s*clamp\(250px, 36vh, 440px\);/);
    assert.match(css, /#multiplayer-menu \.mp-lobby-empty \{[\s\S]*?min-height:\s*100%;[\s\S]*?align-content:\s*center;/);
    assert.match(css, /#mp-lobby-list:not\(\[data-lobby-state="populated"\]\) \+ \.mp-host-strip\s*\{\s*display:\s*none;/);
});
