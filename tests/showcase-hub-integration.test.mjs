import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shop preview connects the reusable renderer to cosmetic practice', () => {
    const source = read('js/main.js');
    assert.match(source, /new ShopShowcaseRenderer\(canvas/);
    assert.match(source, /warrball:shop-preview/);
    assert.match(source, /detail\.previewing && !this\.cosmeticPractice\.active/);
    assert.match(source, /this\._startCosmeticPractice\(detail\.id\)/);
    assert.match(source, /createShowcaseAvatar\(/);
    assert.match(source, /cosmeticStudio\?\.previewAnchor\?\.add/);
});

test('cosmetic studio commerce and exit controls are wired', () => {
    const source = read('js/main.js');
    const html = read('index.html');
    for (const id of ['cosmetic-practice-prev', 'cosmetic-practice-next', 'cosmetic-practice-buy', 'cosmetic-practice-equip', 'cosmetic-practice-exit']) {
        assert.match(html, new RegExp(`id="${id}"`));
        assert.match(source, new RegExp(`bind\\('${id}'`));
    }
    assert.match(source, /this\.store\.purchase\('avatar', snapshot\.selectedSkinId\)/);
    assert.match(source, /this\.store\.equipAvatarSkin\(snapshot\.selectedSkinId\)/);
    assert.match(source, /this\._exitPracticeSession\(\)/);
});

test('cosmetic studio uses a walk-only state outside combat simulation', () => {
    const main = read('js/main.js');
    const game = read('js/game.js');
    assert.match(game, /COSMETIC_PRACTICE:\s*'COSMETIC_PRACTICE'/);
    assert.match(main, /setState\(STATES\.COSMETIC_PRACTICE\)/);
    assert.match(main, /state === STATES\.COSMETIC_PRACTICE[\s\S]*?player\.update\(dt\)[\s\S]*?ball\.deactivate\(\)/);
    assert.doesNotMatch(main, /state === STATES\.COSMETIC_PRACTICE[\s\S]{0,240}game\.update\(dt\)/);
    assert.match(main, /_exitPracticeSession\(\);\s*this\.game\.setState\(STATES\.MENU\)/);
});

test('practice-only maps stay out of competitive rotation', () => {
    const game = read('js/game.js');
    const consoleSource = read('js/console.js');
    assert.ok((game.match(/hiddenFromRotation/g) || []).length >= 3);
    assert.match(consoleSource, /MAPS\[mapId\]\?\.hiddenFromRotation/);
});

test('estate is the only social runtime and obsolete assets are removed', () => {
    const paths = ['js/main.js', 'js/social-lobby.js', 'server.js', 'index.html', 'css/polish.css'];
    const runtime = paths.map(read).join('\n');
    assert.doesNotMatch(runtime, /\bisland\b/i);
    assert.match(read('server.js'), /mapId !== 'estate'/);
    assert.match(read('js/main.js'), /queueMicrotask\(\(\) => this\._enterSocialLobby\('estate', \{ autoLock: false \}\)\)/);
    assert.equal(existsSync(new URL('../assets/user-content/olann-island/olann-island.glb', import.meta.url)), false);
});

test('social hub API accepts estate and rejects the retired map id', async t => {
    const port = 24000 + (process.pid % 10000);
    const child = spawn(process.execPath, ['server.js'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore'
    });
    t.after(() => child.kill());
    const endpoint = `http://127.0.0.1:${port}/api/social-hubs`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            const response = await fetch(endpoint);
            if (response.ok) { ready = true; break; }
        } catch {}
        await delay(25);
    }
    assert.equal(ready, true, 'social hub server did not become ready');

    const post = mapId => fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: `QA${process.pid}`, mapId, hostName: 'QA', players: 1 })
    });
    const estate = await post('estate');
    assert.equal(estate.status, 200);
    assert.equal((await estate.json()).ok, true);
    const rooms = await (await fetch(endpoint)).json();
    assert.equal(rooms.find(room => room.code === `QA${process.pid}`)?.mapId, 'estate');
    const retired = await post('island');
    assert.equal(retired.status, 400);
});
