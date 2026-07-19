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
    assert.match(source, /STATES\.COUNTDOWN\n\s*\|\| this\.game\.state === STATES\.ROUND_END/);
    assert.match(source, /this\.sendChatFromInput\(\);/);
});

test('celebration respawns players and shows one local Victory or Lose banner', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');

    assert.match(source, /this\.player\._celebNoAttack = \(this\.player\.team !== this\._winningTeam\);\n\s*this\.player\.respawn\(\);/);
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

test('new matches cancel old countdowns and rebuild a zero-score board', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');

    assert.match(game, /this\._cancelCountdown\?\.\(\);/);
    assert.match(game, /this\.ui\.cancelCountdown\?\.\(\);/);
    assert.match(game, /this\.scoreboard = new Scoreboard\(\);/);
    assert.match(ui, /cancelCountdown\(\)/);
});

test('match completion awards exactly five coins for wins and one for losses', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(source, /const coins = won \? 5 : 1;/);
    assert.match(source, /this\.game\.onMatchComplete = \(\) => \{/);
});
