import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function section(css, startMarker, endMarker, fromLast = false) {
    const start = fromLast ? css.lastIndexOf(startMarker) : css.indexOf(startMarker);
    assert.ok(start >= 0, `${startMarker} must exist`);
    const end = css.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
    return css.slice(start, end);
}

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

test('short desktop lobby keeps the fixed start lane while leaving chat composer usable', async () => {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const short = section(css, '@media (min-width: 981px) and (max-height: 760px)', '@media (max-width: 980px)', true);

    const body = rule(short, '#lobby-screen .cs-body');
    assert.match(body, /min-height:\s*0;/);
    assert.match(body, /padding:\s*10px 18px 10px;/);
    assert.doesNotMatch(body, /86px/, 'the flex action bar must not be reserved twice');

    const center = rule(short, '#lobby-screen .cs-center');
    assert.match(center, /min-height:\s*0;/);
    assert.match(center, /overflow-y:\s*auto;/);
    assert.match(center, /scroll-padding-block:\s*4px 12px;/);

    // Eleven mode choices must use two compact rows; otherwise the composer
    // is pushed under the persistent Start Game action lane at 1280x720.
    const modes = rule(short, '#lobby-screen .cs-mode-row');
    assert.match(modes, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/);
    assert.match(rule(short, '#lobby-screen .rally-duel-mode'), /grid-column:\s*span 2;/);
    const modeButton = rule(short, '#lobby-screen .cs-mode-btn');
    assert.match(modeButton, /min-height:\s*38px;/);
    assert.match(modeButton, /font-size:\s*\.64rem;/);

    const chat = rule(short, '#lobby-screen .cs-section-chat');
    assert.match(chat, /min-height:\s*104px;/);
    assert.match(chat, /flex:\s*0 1 104px;/);
    assert.match(chat, /padding:\s*8px 10px;/);

    const log = rule(short, '#lobby-screen #lobby-chat-log');
    assert.match(log, /min-height:\s*26px;/);
    assert.match(log, /max-height:\s*34px;/);
    assert.match(log, /margin-bottom:\s*4px;/);
    assert.match(rule(short, '#lobby-screen #lobby-chat-input'), /min-height:\s*40px;/);
    const send = rule(short, '#lobby-screen .cs-btn-chat-send');
    assert.match(send, /flex:\s*0 0 44px;/);
    assert.match(send, /min-height:\s*40px;/);
    assert.match(rule(short, '#lobby-screen .cs-bottom'), /min-height:\s*74px;/);
    assert.match(rule(short, '#lobby-screen .cs-btn-start'), /min-height:\s*52px;/);
});

test('mobile lobby keeps the action bar visible and uses its existing body scroll lane to reach chat', async () => {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const mobile = section(css, '@media (max-width: 700px) {\n    /* The viewport stays fixed;', '\n}');

    assert.match(rule(mobile, '#lobby-screen'), /min-height:\s*0;/);
    assert.match(rule(mobile, '#lobby-screen'), /overflow:\s*hidden;/);
    const body = rule(mobile, '#lobby-screen .cs-body');
    assert.match(body, /flex:\s*1 1 0;/);
    assert.match(body, /min-height:\s*0;/);
    assert.match(body, /padding:\s*12px 10px 18px;/);
    assert.match(body, /scroll-padding-block:\s*12px 104px;/);
    assert.match(body, /touch-action:\s*pan-y;/);
    assert.match(body, /overscroll-behavior:\s*contain;/);
    assert.match(mobile, /#lobby-screen \.cs-center,\s*#lobby-screen \.cs-section-chat\s*\{\s*scroll-margin-bottom:\s*104px;/);
    assert.match(rule(mobile, '#lobby-screen .cs-bottom'), /min-height:\s*86px;/);
});
