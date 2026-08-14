// Hit presentation contract: ordinary hits must never consume elimination FX.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function presentHit({ lethal }) {
    const effects = ['damage-number', lethal ? 'kill-burst' : 'hit-burst', 'shockwave', 'hit-stop', 'flash'];
    if (lethal) effects.push('death-explosion', 'explosion-sfx', 'explosion-cue', 'elimination-feed');
    effects.push('hit-sfx');
    return effects;
}

test('nonlethal and lethal presentation gates preserve normal impact feedback', () => {
    assert.deepEqual(presentHit({ lethal: false }), [
        'damage-number', 'hit-burst', 'shockwave', 'hit-stop', 'flash', 'hit-sfx'
    ]);
    assert.deepEqual(presentHit({ lethal: true }), [
        'damage-number', 'kill-burst', 'shockwave', 'hit-stop', 'flash',
        'death-explosion', 'explosion-sfx', 'explosion-cue', 'elimination-feed', 'hit-sfx'
    ]);
});

test('local and P2P source paths gate death FX but retain normal hit feedback', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const localStart = game.indexOf('    _doApplyHit(hitTarget, name, scorerName, attacker, shot) {');
    const clientStart = game.indexOf('    applyPlayerHit(data = {}) {');
    const clientEnd = game.indexOf('    _reconcileHostRevive(', clientStart);
    assert.ok(localStart >= 0 && clientStart > localStart && clientEnd > clientStart);
    const local = game.slice(localStart, clientStart);
    const client = game.slice(clientStart, clientEnd);

    assert.match(local, /const presentedLethal = isLethal\s*\? this\._presentLethalImpact\(hitPos, hitTarget\.team, scorerName, name, this\.rallyCount\)/);
    assert.match(local, /if \(!isLethal\) \{\s*this\.juice\.hitBurst\(hitPos\);\s*this\.juice\.shockwave\(hitPos, 0xff8844\);\s*this\.juice\.hitStop\(35\);\s*this\.juice\.flash\(0\.22\);/);
    assert.equal((local.match(/tf2_scout_scream/g) || []).length, 1, 'local victim grunt must play once per hit');

    assert.match(client, /const presentedLethal = isLethal\s*\? this\._presentLethalImpact\(/);
    assert.match(client, /if \(!isLethal\) \{\s*this\.juice\.hitBurst\(hitPos\);\s*this\.juice\.shockwave\(hitPos, 0xff8844\);\s*this\.juice\.hitStop\(35\);\s*this\.juice\.flash\(0\.22\);/);
    assert.match(client, /if \(target === this\.player\) \{[\s\S]*?this\.audio\.playSfx\('tf2_scout_scream', 0\.45\);[\s\S]*?if \(isLethal\) \{/);
    assert.equal((client.match(/tf2_scout_scream/g) || []).length, 1, 'P2P victim grunt must play once per hit');

    const presenterStart = game.indexOf('    _presentLethalImpact(');
    const presenterEnd = game.indexOf('    _showMatchMessage(', presenterStart);
    const presenter = game.slice(presenterStart, presenterEnd);
    assert.match(presenter, /this\.juice\.killBurst\(hitPos\);[\s\S]*?this\.juice\.hitStop\(150\);[\s\S]*?this\.juice\.flash\(0\.55\);/);
    assert.match(presenter, /this\.audio\.playSfx\('tf2_explosion', 0\.5\);[\s\S]*?window\.addKillFeed\?\.\([\s\S]*?this\.audio\.playExplosion\(\);/);
});
