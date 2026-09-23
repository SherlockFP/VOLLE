import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, game, arena, polish, html, ui] = await Promise.all([
    'js/main.js', 'js/game.js', 'js/arena.js', 'css/polish.css', 'index.html', 'js/ui.js'
].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));

test('Escape closes menu sub-screens through their own Back buttons, never the lobby', () => {
    const table = main.match(/const ESC_BACK_BUTTONS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '';
    for (const pair of ["'map-editor-screen', 'btn-map-editor-back'", "'shop-screen', 'btn-shop-back'", "'screen-profile', 'btn-profile-back'"]) {
        assert.ok(table.includes(pair), `missing ${pair}`);
    }
    assert.doesNotMatch(table, /lobby-screen/);
    for (const [, screen, button] of table.matchAll(/\['([\w-]+)', '([\w-]+)'\]/g)) {
        assert.match(html, new RegExp(`id="${screen}"`), `screen ${screen} exists`);
        assert.match(html, new RegExp(`id="${button}"`), `button ${button} exists`);
    }
    assert.match(main, /this\.game\.state === STATES\.MENU && !isEditableTarget\(e\.target\)/);
});

test('post-match map rotation refreshes the lobby map UI', () => {
    const calls = game.match(/this\.onMapChange\?\.\((picked|winner|winningMap)\)/g) || [];
    assert.equal(calls.length, 3);
});

test('night skies tint clouds from the horizon instead of painting them white', () => {
    assert.doesNotMatch(arena, /color = mix\(color, vec3\(1\.0\), clouds \* 0\.24\)/);
    assert.match(arena, /vec3 cloudTint = mix\(horizonColor \* 1\.8 \+ 0\.035, vec3\(1\.0\), smoothstep\(0\.05, 0\.32, skyLum\)\)/);
});

test('collapsed social rail is a header-height pill, not a full-height strip over the hero', () => {
    assert.match(polish, /#main-menu \.friends-sidebar\.collapsed \{ transform: translateX\(calc\(100% - 44px\)\); bottom: auto; height: 48px;/);
    assert.match(polish, /\.friends-sidebar\.collapsed \{ transform: translateY\(calc\(100% - 58px\)\); bottom: 0; height: min\(78dvh, 620px\); \}/);
});

test('postgame key art is a sticky frame and its image cannot stretch the grid', () => {
    const rule = polish.match(/\n#post-game-screen \.pg-key-art \{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(rule, /position: sticky;/);
    assert.match(rule, /align-self: start;/);
    assert.doesNotMatch(rule, /height: 100%;/);
    const img = polish.match(/\n#post-game-screen \.pg-key-art img \{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(img, /position: absolute;/);
});

test('lobby action buttons size to their labels and lobby chrome is localized', () => {
    assert.match(polish, /#lobby-screen \.cs-btn-action \{\s*width: auto; min-width: 44px;[^}]*white-space: nowrap;/);
    assert.match(html, /id="btn-lobby-lock"[^>]*data-i18n="lobby\.lock"/);
    assert.match(html, /<span data-i18n="lobby\.startGame">START GAME<\/span>/);
    assert.match(html, /id="btn-party-ready"[^>]*data-i18n="lobby\.ready"/);
    assert.match(ui, /setText\(bc, 'lobby\.botCount', \{ n: botCount \}\)/);
    assert.match(ui, /setText\(card, 'lobby\.waitingSlot'\)/);
});

test('Mouse1 spam cannot keep a deflect hitbox up: live window is shorter than the recovery', async () => {
    const player = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
    const active = Number(player.match(/export const SWING_ACTIVE_WINDOW = ([\d.]+);/)?.[1]);
    const cooldown = Number(player.match(/const ATTACK_COOLDOWN = ([\d.]+);/)?.[1]);
    assert.ok(active > 0.15 && active <= 0.25, 'still a fair, readable timing window');
    assert.ok(cooldown - active >= 0.3, 'spam leaves a real dead gap between swings');
    assert.match(player, /this\.attackActive = Math\.min\(SWING_ACTIVE_WINDOW, this\.attackDuration\);/);
    assert.match(player, /if \(this\.attackActive <= 0\) \{\s*this\.attackActive = 0;\s*this\.attacking = false;/);
    assert.match(game, /const swingWindow = Number\(player\.attackActive\) \|\|/);
});

test('in-court props are rolled per match (mostly off) and follow the host on clients', async () => {
    const arenaSrc = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
    const { MAP_PROPS_CHANCE, rollMapProps } = await import('../js/game.js').catch(() => ({}));
    const chance = MAP_PROPS_CHANCE ?? Number(game.match(/export const MAP_PROPS_CHANCE = ([\d.]+);/)?.[1]);
    assert.ok(chance > 0 && chance < 0.5, 'props appear sometimes, but mostly off');
    if (rollMapProps) {
        assert.equal(rollMapProps(() => chance - 0.01), true);
        assert.equal(rollMapProps(() => chance), false);
    }
    assert.match(arenaSrc, /if \(this\.propsEnabled\) \{\s*this\.buildGameplayLayout\(\);\s*this\.buildParkour\(\);\s*\}/);
    assert.match(arenaSrc, /if \(this\.propsEnabled\) this\.buildParkour\(\);/);
    assert.match(game, /if \(!this\.network\?\.connected \|\| this\.network\.isHost\) this\.arena\.setPropsEnabled\?\.\(rollMapProps\(\)\);/);
    assert.match(game, /props: this\.arena\?\.propsEnabled !== false,/);
    assert.equal((game.match(/this\.arena\.rebuild\(data\.map, typeof data\.props === 'boolean' \? \{ props: data\.props \} : \{\}\)/g) || []).length, 2);
});

test('a targeted ball phases through props briefly after a prop bounce instead of pinning to them', async () => {
    const ballSrc = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
    const ghost = Number(ballSrc.match(/export const PROP_GHOST_SECONDS = ([\d.]+);/)?.[1]);
    assert.ok(ghost >= 0.3 && ghost <= 1);
    assert.match(ballSrc, /if \(this\.arena\.collidables && !\(this\._propGhost > 0 && this\.targetPlayer\)\) \{/);
    assert.match(ballSrc, /if \(this\.bounceCount > propBouncesBefore && this\.targetPlayer\) this\._propGhost = PROP_GHOST_SECONDS;/);
});
