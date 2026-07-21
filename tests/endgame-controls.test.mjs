import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Escape pauses and resumes endgame states without forcing PLAYING', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(source, /STATES\.ROUND_END, STATES\.CELEBRATION/);
    assert.match(source, /this\._pausedFromState = this\.game\.state/);
    assert.match(source, /this\.game\.setState\(this\._pausedFromState \|\| STATES\.PLAYING\)/);
});

test('round transitions retain pointer lock and chat Enter submits before editable guards', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const chatStart = source.indexOf('if (this.chatOpen)');
    const editableGuard = source.indexOf("if (isEditableTarget(e.target) && e.code !== 'Escape') return;");

    assert.ok(chatStart >= 0 && chatStart < editableGuard);
    assert.match(source, /STATES\.COUNTDOWN\r?\n\s*\|\| this\.game\.state === STATES\.ROUND_END/);
    assert.match(source, /this\.sendChatFromInput\(\);/);
});

test('celebration respawns players and shows one local Victory or Lose banner', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');

    assert.match(source, /this\.player\._celebNoAttack = \(this\.player\.team !== this\._winningTeam\);\r?\n\s*this\.player\.respawn\(\);/);
    assert.match(source, /this\._won \? 'VICTORY' : 'LOSE'/);
    assert.match(source, /if \(subEl\) subEl\.textContent = '';/);
});

test('celebration movement remains in the P2P position sync state set', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const positionSync = source.slice(source.indexOf('// P2P: adaptive rate position send'), source.indexOf('// Attack intent:'));

    assert.match(positionSync, /this\.game\.state === STATES\.CELEBRATION/);
});

test('kicking a lobby bot broadcasts the reconciled lobby state', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const kickHandler = source.slice(source.indexOf('// Delegated kick click'), source.indexOf('// Host kicks a human player'));

    assert.match(kickHandler, /removeBotByName\(name\);\s*this\.broadcastLobbyState\(\);/);
});

test('practice disables bot additions and returns a bounced ball to the player', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(game, /if \(this\._practiceMode\) return null;/);
    assert.match(main, /this\.game\._practiceMode = true;\s*document\.querySelectorAll\('#btn-add-bot-red, #btn-add-bot-blue'\)/);
    assert.match(game, /if \(this\._practiceMode && !this\.guidedDrill\.active && bounced\) \{\s*this\.ball\.setTarget\(this\.player\);\s*this\.ball\.state = 'homing';/);
    assert.match(game, /this\.ball\.active && !this\._practiceMode && !this\.ball\._affixGhost/);
});

test('guided practice consumes frame remainder and fully clears power-up state', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(game, /clearPowerUps\(\) \{\s*this\._clearAllPowerUps\(\);/);
    assert.match(game, /let remainingMs = Math\.min\(Math\.max\(dt \* 1000, 0\), 250\);/);
    assert.match(game, /while \(remainingMs > 0 && this\.guidedDrill\.active && guard\+\+ < 8\)/);
    assert.match(game, /this\._megaballToken !== token \|\| !this\._megaballActive/);
    assert.match(game, /this\.player\._powerUpDamageMul = null;/);
    assert.match(main, /_exitPracticeSession\(\) \{[\s\S]*?this\.game\.selectMode\(restore\.modeId\);[\s\S]*?this\.game\.selectMap\(restore\.mapId\);[\s\S]*?this\.player\.setTeam/);
});

test('map pickups are rare, contested interactions with a recovery core', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');

    assert.match(source, /id: 'recovery'.*RECOVERY CORE/);
    assert.match(source, /this\._maxPowerUps = 1;/);
    assert.match(source, /POWERUP_FIRST_SPAWN = 30/);
    assert.match(source, /POWERUP_RESPAWN = 45/);
    assert.match(source, /timer: POWERUP_LIFETIME/);
    assert.match(source, /new THREE\.TorusGeometry\(0\.72/);
});

test('new matches cancel old countdowns and rebuild a zero-score board', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');

    assert.match(game, /this\.cancelPreGame\(\);/);
    assert.match(game, /this\.ui\.cancelCountdown\?\.\(\);/);
    assert.match(game, /this\.ui\.hideMatchIntro\?\.\(\);/);
    assert.match(game, /this\.scoreboard = new Scoreboard\(\);/);
    assert.match(ui, /cancelCountdown\(\)/);
});

test('match completion awards exactly five coins for wins and one for losses', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(source, /const coins = won \? 5 : 1;/);
    assert.match(source, /this\.game\.onMatchComplete = \(\) => \{/);
});

test('every non-practice match records an ELO result', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(source, /awardMatchRewards\(\) \{[\s\S]*?const ranked = this\.store\.recordRankedMatch\(/);
    assert.doesNotMatch(source, /awardMatchRewards\(\) \{[\s\S]*?if \(this\._rankedMatch\) \{/);
});

test('lethal remote players hide their character model before spectators cycle', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(game, /hitTarget\.alive = false;\s*if \(hitTarget\.group\) hitTarget\.group\.visible = false;/);
    assert.match(main, /Spectator\.handlePointerButton\(e\)/);
    assert.match(main, /TEAM \$\{view\.distance <= 1 \? 'POV' : 'TPS'\}/);
});

test('spectator Escape reaches the normal pause menu flow', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const spectatorBlock = source.slice(source.indexOf('if (Spectator.active && !this.chatOpen)'), source.indexOf('// Chat'));

    assert.doesNotMatch(spectatorBlock, /if \(e\.code === 'KeyM'[\s\S]*?\n\s*return;/);
    assert.match(source, /ESC falls through to the normal pause\/settings flow\./);
});
