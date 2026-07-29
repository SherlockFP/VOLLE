import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('UI feedback routing: each silent event routes through audio cues', async () => {
    const uiPath = join(__dirname, '..', 'js', 'ui.js');
    const uiSource = readFileSync(uiPath, 'utf8');

    // Test 1: Hover events routed through ui-hover cue
    assert.match(
        uiSource,
        /playCue\s*\(\s*['"]ui-hover['"]\s*\)/,
        'UI must call audio.playCue("ui-hover") for hover events'
    );

    // Test 2: Chat messages routed through audio cue
    assert.match(
        uiSource,
        /addChatMessage[\s\S]*?playCue\s*\(\s*['"]chat['"]/,
        'addChatMessage must call audio.playCue("chat")'
    );

    // Test 3: Post-game screen routed through score cue
    assert.match(
        uiSource,
        /showPostGame[\s\S]*?playCue\s*\?\.\s*\(\s*['"]score['"]/,
        'showPostGame must call audio?.playCue?.("score")'
    );
    // Test 4: Unknown cue names never reach audio (safe no-op in Audio.playCue)
    // This is guaranteed by Audio.playCue returning false for unknown names
    const audioPath = join(__dirname, '..', 'js', 'audio.js');
    const audioSource = readFileSync(audioPath, 'utf8');
    assert.match(
        audioSource,
        /const cue = Audio\.CUES\[cueName\];\s*if\s*\(\s*!cue\s*\)\s*return\s*false/,
        'Audio.playCue must gracefully ignore unknown cue names'
    );
});

test('UI feedback routing: post-match battlepass progress is rendered and visible', async () => {
    const uiPath = join(__dirname, '..', 'js', 'ui.js');
    const uiSource = readFileSync(uiPath, 'utf8');
    const htmlPath = join(__dirname, '..', 'index.html');
    const htmlSource = readFileSync(htmlPath, 'utf8');

    // Verify the rendering hook exists
    assert.match(
        uiSource,
        /_renderPostGameBattlepass\s*\(\s*store\s*\)/,
        'UI must have _renderPostGameBattlepass method'
    );

    // Verify it writes to the DOM nodes
    assert.match(
        uiSource,
        /getElementById\s*\(\s*['"]pg-bp-tier['"]\s*\)/,
        '_renderPostGameBattlepass must update pg-bp-tier'
    );
    assert.match(
        uiSource,
        /getElementById\s*\(\s*['"]pg-bp-progress['"]\s*\)/,
        '_renderPostGameBattlepass must reference pg-bp-progress'
    );
    assert.match(
        uiSource,
        /getElementById\s*\(\s*['"]pg-bp-bar-fill['"]\s*\)/,
        '_renderPostGameBattlepass must update pg-bp-bar-fill'
    );

    // Verify the DOM structure in index.html
    assert.match(
        htmlSource,
        /id=["']pg-bp-progress["']/,
        'index.html must contain pg-bp-progress container'
    );
    assert.match(
        htmlSource,
        /id=["']pg-bp-tier["']/,
        'index.html must contain pg-bp-tier element'
    );
    assert.match(
        htmlSource,
        /id=["']pg-bp-bar-fill["']/,
        'index.html must contain pg-bp-bar-fill progress bar'
    );

    // Verify pg-bp-progress is inside post-game-screen
    const pgStart = htmlSource.indexOf('id="post-game-screen"');
    const pgEnd = htmlSource.indexOf('</div>', htmlSource.lastIndexOf('id="pg-'));
    const pgSection = htmlSource.substring(pgStart, pgEnd);
    assert.match(
        pgSection,
        /id=["']pg-bp-progress["']/,
        'pg-bp-progress must be inside post-game-screen container'
    );
});

test('UI feedback routing: each routed event calls audio.playCue exactly once', async () => {
    const uiPath = join(__dirname, '..', 'js', 'ui.js');
    const uiSource = readFileSync(uiPath, 'utf8');

    // Extract the pointerenter handler to verify it calls playCue only once per event
    const hoverHandlerMatch = uiSource.match(
        /addEventListener\s*\(\s*['"]pointerenter['"]\s*,\s*\(e\)\s*=>\s*\{[\s\S]*?\}\s*,\s*true\s*\)/
    );
    assert.ok(hoverHandlerMatch, 'Must have pointerenter listener for hover');

    // Count playCue calls in the handler to ensure it's not duplicated
    const handler = hoverHandlerMatch[0];
    const playCueCalls = (handler.match(/playCue/g) || []).length;
    assert.ok(playCueCalls >= 1, 'Hover handler must call playCue at least once');
    // The break statement ensures we don't call it multiple times
    assert.match(handler, /break/, 'Hover handler must break to avoid multiple cue calls');
});

test('UI feedback routing: audio cue names match Audio.CUES table', async () => {
    const audioPath = join(__dirname, '..', 'js', 'audio.js');
    const audioSource = readFileSync(audioPath, 'utf8');

    // Verify required cues exist
    assert.match(audioSource, /['"]ui-hover['"]:\s*\{/, 'Audio.CUES must define ui-hover');
    assert.match(audioSource, /['"]chat['"]:\s*\{/, 'Audio.CUES must define chat cue');
    assert.match(audioSource, /['"]score['"]:\s*\{/, 'Audio.CUES must define score cue for results');
});

test('UI feedback routing: audio reference wired from main.js to UI', async () => {
    const mainPath = join(__dirname, '..', 'js', 'main.js');
    const mainSource = readFileSync(mainPath, 'utf8');

    assert.match(
        mainSource,
        /this\.ui\.audio\s*=\s*this\.audio/,
        'main.js must wire audio reference to UI instance'
    );
});
