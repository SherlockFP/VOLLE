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

    assert.match(local, /if \(isLethal\) \{[\s\S]*?this\.juice\.killBurst\(hitPos\);[\s\S]*?\} else \{\s*this\.juice\.hitBurst\(hitPos\);/);
    assert.match(local, /this\.juice\.shockwave\(hitPos, isLethal \? 0xff3333 : 0xff8844\);[\s\S]*?this\.juice\.hitStop\(isLethal \? 150 : 35\);[\s\S]*?this\.juice\.flash\(isLethal \? 0\.55 : 0\.22\);/);
    const localDeathStart = local.indexOf('// Elimination-only presentation.');
    const localDeathEnd = local.indexOf('this.audio.playHit();', localDeathStart);
    assert.ok(localDeathStart >= 0 && localDeathEnd > localDeathStart);
    const localDeath = local.slice(localDeathStart, localDeathEnd);
    assert.match(local, /if \(hitTarget === this\.player\) this\.audio\.playSfx\('tf2_scout_scream', 0\.45\);\s*\/\/ Elimination-only presentation\./);
    assert.equal((local.match(/tf2_scout_scream/g) || []).length, 1, 'local victim grunt must play once per hit');
    assert.match(localDeath, /if \(isLethal\) \{[\s\S]*?this\.spawnDeathExplosion\(hitPos, hitTarget\.team\);[\s\S]*?this\.audio\.playSfx\('tf2_explosion', 0\.5\);[\s\S]*?window\.addKillFeed\?\.\([\s\S]*?this\.audio\.playExplosion\(\);[\s\S]*?this\.audio\.playSfx\('tf2_you_are_dead', 0\.5\);/);
    assert.doesNotMatch(localDeath, /tf2_scout_scream/);

    const clientFxStart = client.indexOf('// Elimination effects are reserved');
    const clientFxEnd = client.indexOf('// Kill feed', clientFxStart);
    assert.ok(clientFxStart >= 0 && clientFxEnd > clientFxStart);
    const clientFx = client.slice(clientFxStart, clientFxEnd);
    assert.match(clientFx, /if \(isLethal\) \{\s*this\.spawnDeathExplosion\(hitPos, data\.victimTeam\);\s*this\.audio\.playSfx\('tf2_explosion', 0\.5\);\s*\}/);
    assert.match(clientFx, /if \(isLethal\) \{[\s\S]*?this\.juice\.killBurst\(hitPos\);[\s\S]*?\} else \{\s*this\.juice\.hitBurst\(hitPos\);/);
    assert.match(clientFx, /this\.juice\.shockwave\(hitPos, isLethal \? 0xff3333 : 0xff8844\);[\s\S]*?this\.juice\.shake\(isLethal \? 0\.6 : 0\.25\);[\s\S]*?this\.juice\.hitStop\(isLethal \? 100 : 50\);[\s\S]*?this\.juice\.flash\(isLethal \? 0\.4 : 0\.2\);[\s\S]*?this\.audio\.playHit\(\);/);
    assert.match(client, /if \(target === this\.player\) \{[\s\S]*?this\.audio\.playSfx\('tf2_scout_scream', 0\.45\);[\s\S]*?if \(isLethal\) \{/);
    assert.equal((client.match(/tf2_scout_scream/g) || []).length, 1, 'P2P victim grunt must play once per hit');
});
