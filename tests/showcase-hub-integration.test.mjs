import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shop preview updates the reusable renderer; only the explicit CTA enters cosmetic practice', () => {
    const source = read('js/main.js');
    assert.match(source, /new ShopShowcaseRenderer\(canvas/);
    assert.match(source, /warrball:shop-preview/);
    assert.match(source, /detail\?\.type === 'avatar' && AVATAR_SKINS\[detail\.id\]/);
    assert.doesNotMatch(source, /queueMicrotask\(\(\) => this\._startCosmeticPractice\(detail\.id\)\)/);
    assert.match(source, /bind\('btn-shop-practice'/);
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

test('social runtimes use local allowlisted maps and obsolete assets stay removed', () => {
    const paths = ['js/main.js', 'js/social-lobby.js', 'server.js', 'index.html', 'css/polish.css'];
    const runtime = paths.map(read).join('\n');
    assert.doesNotMatch(runtime, /\bisland\b/i);
    assert.match(read('server.js'), /plaza: 'Neon Clubhouse'/);
    for (const retired of ['estate', 'skyline', 'harbor']) {
        assert.doesNotMatch(read('server.js'), new RegExp(`\\b${retired}\\b`), `retired hub map "${retired}" still allowlisted`);
    }
    assert.doesNotMatch(read('js/main.js'), /queueMicrotask\(\(\) => this\._enterSocialLobby\(/);
    assert.equal(existsSync(new URL('../assets/user-content/olann-island/olann-island.glb', import.meta.url)), false);
});

test('all non-gameplay avatar surfaces share the saved-atlas resolver, including cosmetic practice', () => {
    const source = read('js/main.js');
    assert.match(source, /_resolveAvatarPreview\(skinId, characterId = this\.store\.get\('selectedChar'\), atlasOverride = null\)/);
    assert.match(source, /resolveAvatarAtlas\(resolvedSkinId, this\.store\.get\('customAvatar'\)\)/);
    assert.match(source, /_syncAvatarPreview\(this\.shopShowcase, selected, characterId \|\| this\.store\.get\('selectedChar'\)\)/);
    assert.match(source, /_syncAvatarPreview\(this\.menuHero, skinId\)/);
    assert.match(source, /_syncAvatarPreview\(this\.avatarStage3D, this\.avatarPainter\.skinId, this\.store\.get\('selectedChar'\), \{/);
    const practice = source.slice(source.indexOf('    _renderCosmeticPractice('), source.indexOf('    _selectCosmeticPracticeSkin('));
    assert.match(practice, /_syncAvatarPreview\(this\._cosmeticPracticeAvatar, snapshot\.selectedSkinId\)/);
    assert.doesNotMatch(practice, /this\.store\.(set|update|save)/, 'previewing must not mutate saved avatar state');
});

test('leaving the social hub restores its renderer overrides before clearing hub state', () => {
    const source = read('js/main.js');
    const leave = source.slice(source.indexOf('    _leaveSocialLobby() {'), source.indexOf('    _exitSocialLobby() {'));
    assert.match(leave, /this\.renderer\.sun\.intensity = this\._hubVisualState\.sunIntensity/);
    assert.match(leave, /this\.renderer\.renderer\.toneMappingExposure = this\._hubVisualState\.exposure/);
    assert.ok(
        leave.indexOf('toneMappingExposure = this._hubVisualState.exposure') < leave.indexOf('this._hubVisualState = null'),
        'hub renderer overrides must restore before the saved visual state is cleared'
    );
    const sidebar = source.slice(source.indexOf('    initFriendsSidebar() {'), source.indexOf('    refreshFriendsSidebar() {'));
    assert.doesNotMatch(sidebar, /_hubVisualState\.sunIntensity|_hubVisualState\.exposure/);
});

test('social hub API accepts each current map and rejects the retired map id', async t => {
    const port = 24000 + (process.pid % 10000);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'warrball-showcase-hub-'));
    const child = spawn(process.execPath, ['server.js'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
        stdio: 'ignore'
    });
    t.after(async () => {
        if (child.exitCode === null) {
            child.kill();
            await once(child, 'exit');
        }
        rmSync(dataDir, { recursive: true, force: true });
    });
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

    const registration = await fetch(`http://127.0.0.1:${port}/api/account/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `Hub${process.pid}`, email: `hub${process.pid}@example.com`, password: 'test-password-123' })
    });
    assert.equal(registration.status, 201);
    const { sessionToken } = await registration.json();
    assert.equal(typeof sessionToken, 'string');

    const post = (mapId, code = `QA${process.pid}`) => fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ code, mapId, hostName: 'QA', players: 1 })
    });
    for (const [index, mapId] of ['plaza'].entries()) {
        const response = await post(mapId, `QA${process.pid}${index}`);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ok, true);
    }
    const rooms = await (await fetch(endpoint)).json();
    assert.deepEqual(rooms.filter(room => room.code.startsWith(`QA${process.pid}`)).map(room => [room.mapId, room.mapName]), [
        ['plaza', 'Neon Clubhouse']
    ]);
    for (const retired of ['island', 'estate', 'skyline', 'harbor']) {
        assert.equal((await post(retired)).status, 400, `retired map id "${retired}" must be rejected`);
    }
    const prototypeKey = await post('__proto__');
    assert.equal(prototypeKey.status, 400);
});
