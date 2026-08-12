import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

const helperStart = gameSource.indexOf('const OPENING_WARMUP_VISIBLE_MS');
const helperEnd = gameSource.indexOf('\n}', helperStart) + 2;
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'opening serve helper must be extractable');
const { openingServeSpeed } = await import(`data:text/javascript,${encodeURIComponent(gameSource.slice(helperStart, helperEnd))}`);

test('host opening serve keeps every assigned player at least one second away without delaying GO', () => {
    assert.equal(openingServeSpeed(8, 17), 8, 'short opening lanes are speed-capped to a one-second ETA');
    assert.equal(openingServeSpeed(24, 17), 17, 'a naturally safe serve keeps its normal speed');
    assert.equal(openingServeSpeed(8, 17, 2), 4, 'the helper remains deterministic for a stricter ETA');

    const roundStart = gameSource.slice(gameSource.indexOf('    startRound('), gameSource.indexOf('\n    // Rebuild the arena', gameSource.indexOf('    startRound(')));
    assert.match(roundStart, /const targetPosition = first\.position\?\.distanceTo[\s\S]*?first\.getPosition\?\.\(\);[\s\S]*?targetPosition\?\.distanceTo[\s\S]*?openingServeSpeed\(distance, this\.ball\.currentSpeed\)[\s\S]*?this\.ball\.setTarget\(first\);/);
    assert.match(roundStart, /if \(this\.ball\.active && \(!this\.network\?\.connected \|\| this\.network\?\.isHost\)\)/, 'only solo/host authority chooses the opening target');
});

test('warmup identity stays visible while the countdown starts and never covers the countdown', () => {
    assert.match(gameSource, /const OPENING_WARMUP_VISIBLE_MS = 1500;/);
    const countdownStart = gameSource.indexOf('// Pre-game countdown');
    const normalCountdown = gameSource.slice(countdownStart, gameSource.indexOf('this._notifyCountdownReady();', countdownStart));
    assert.match(normalCountdown, /showMatchIntro[\s\S]*?scheduleMatchIntroHide\?\.\(OPENING_WARMUP_VISIBLE_MS\)[\s\S]*?this\.ball\.spawn\(\)[\s\S]*?this\.ball\._warmup = true/);
    assert.match(normalCountdown, /this\._preGameActive = false;\s*this\.audio\.playGo\(\);\s*this\.startRound\(\);/);
    assert.match(gameSource, /startRound\(\{ fromNetwork = false \} = \{\}\) \{\s*this\.ui\.hideMatchIntro\(\);/);
    assert.match(uiSource, /modeEl\.textContent = `WARMUP/);
    assert.match(uiSource, /scheduleMatchIntroHide\(durationMs\) \{\s*clearTimeout\(this\._matchIntroHideTimer\);/);
    assert.match(uiSource, /hideMatchIntro\(\) \{\s*clearTimeout\(this\._matchIntroHideTimer\);/);

    const intro = styleSource.slice(styleSource.indexOf('#match-intro {'), styleSource.indexOf('#match-intro.hidden'));
    const countdown = styleSource.slice(styleSource.indexOf('#countdown {'), styleSource.indexOf('.countdown-anim'));
    assert.doesNotMatch(intro, /inset:\s*0/);
    assert.match(intro, /pointer-events:\s*none/);
    assert.match(intro, /z-index:\s*180/);
    assert.match(intro, /top:\s*max\(84px/);
    assert.match(intro, /max-width:\s*calc\(100vw - 32px\)/);
    assert.match(intro, /animation:\s*miFade 1\.5s/);
    assert.match(styleSource, /body\.countdown-ui #controls-hint,[\s\S]*?#incoming-indicator/);
    assert.match(countdown, /z-index:\s*200/);
    assert.match(countdown, /top:\s*max\(128px/);
});
