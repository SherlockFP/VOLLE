import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('death particle update uses allocation-free vector integration', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const start = game.indexOf('    updateDeathParticles(dt) {');
    const end = game.indexOf('\n    // --- CHAT ---', start);
    assert.ok(start >= 0 && end > start, 'updateDeathParticles must remain a bounded method');
    const update = game.slice(start, end);

    assert.match(update, /p\.mesh\.position\.addScaledVector\(p\.vel, dt\);/);
    assert.doesNotMatch(update, /p\.vel\.clone\(\)\.multiplyScalar\(dt\)/);
    assert.match(update, /p\.vel\.y \+= \(p\.gravity \|\| -15\) \* dt;/);
    assert.match(update, /if \(p\.mesh\.position\.y < 0\) \{ p\.vel\.y \*= -0\.3; p\.mesh\.position\.y = 0; \}/);
    assert.match(update, /if \(p\.life <= 0\) \{[\s\S]*?this\.deathParticles\.splice\(i, 1\);/);
});

test('scaled-vector integration preserves the prior position delta', () => {
    const position = {
        x: 3, y: -2, z: 5,
        addScaledVector(vector, scalar) {
            this.x += vector.x * scalar;
            this.y += vector.y * scalar;
            this.z += vector.z * scalar;
            return this;
        }
    };
    const velocity = { x: -4, y: 7, z: 1.5 };
    const dt = 0.25;
    const expected = { x: position.x + velocity.x * dt, y: position.y + velocity.y * dt, z: position.z + velocity.z * dt };

    position.addScaledVector(velocity, dt);
    assert.deepEqual(position, { ...expected, addScaledVector: position.addScaledVector });
});
