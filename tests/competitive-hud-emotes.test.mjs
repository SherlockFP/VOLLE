import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, emotes, main, ui] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../css/polish.css', import.meta.url), 'utf8'),
    readFile(new URL('../js/emotes.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8')
]);

test('quick-chat wheel uses a shared SVG family and supports pointer plus keyboard selection', () => {
    for (const icon of ['thumb-up', 'handshake', 'alert', 'spark', 'flame', 'tear', 'laugh', 'angry', 'clap', 'flex', 'heart', 'skull']) {
        assert.match(html, new RegExp(`id="i-${icon}"`));
        assert.match(emotes, new RegExp(`icon: 'i-${icon}'`));
    }
    assert.match(emotes, /role', 'menu'/);
    assert.match(emotes, /role', 'menuitemradio'/);
    assert.match(emotes, /pointermove/);
    assert.match(emotes, /Math\.atan2\(dy, dx\)/);
    assert.match(emotes, /ArrowRight/);
    assert.match(emotes, /event\.key === 'Enter' \|\| event\.key === ' '/);
    assert.match(css, /\.emote-wheel-item\.is-selected/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.emote-wheel, \.emote-wheel-item/);
});

test('choosing an emote closes the exclusive overlay through the one close path', () => {
    const block = main.slice(main.indexOf('    openEmoteWheel()'), main.indexOf('    closeEmoteWheel()'));
    assert.match(block, /this\.game\.showEmote\(this\.player, emoteId\);\s*this\.closeEmoteWheel\(\);/);
    assert.doesNotMatch(block, /this\.player\.lock\(\)/);
});

test('scoreboard keeps labels while the hot path only replaces nested values', () => {
    assert.match(html, /id="hud-score-red"><span>RED<\/span><b data-score-value>0<\/b>/);
    assert.match(html, /id="hud-round-timer"><span>ROUND<\/span><b data-timer-value>5:00<\/b>/);
    assert.match(html, /id="hud-score-blue"><span>BLUE<\/span><b data-score-value>0<\/b>/);
    assert.match(ui, /timerEl\.querySelector\('\[data-timer-value\]'\) \|\| timerEl/);
    assert.match(ui, /node\.querySelector\('\[data-score-value\]'\) \|\| node/);
    assert.match(css, /#hud \.hud-score-panel[\s\S]*?height: 50px;[\s\S]*?border-radius: 4px;/);
});

test('spectator surface exposes only implemented camera modes and 44px target controls', () => {
    for (const mode of ['first-person', 'chase', 'free-roam']) assert.match(html, new RegExp(`data-spectator-mode="${mode}"`));
    assert.doesNotMatch(html, /data-spectator-mode="ball"/);
    assert.match(main, /import \{ CAMERA_MODES, Spectator \} from '\.\/spectator\.js'/);
    assert.match(main, /bind\('spectator-prev-target', \(\) => Spectator\.prevTarget\(\)\)/);
    assert.match(main, /button\.addEventListener\('click', \(\) => Spectator\.setCameraMode\(button\.dataset\.spectatorMode\)\)/);
    assert.match(css, /\.spectator-target-row > button \{[\s\S]*?width: 44px;[\s\S]*?min-height: 44px;/);
});

test('network diagnostics are text-only and retain readable shadow contrast', () => {
    assert.match(css, /\.network-diagnostics,[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?text-shadow:/);
});
