// Deterministic bot-match playtest. This keeps the defense timing contract
// executable without requiring a browser WebGL scene or the Three.js import map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const LEVELS = {
    easy: { reaction: 0.65, windUp: 0.30 },
    medium: { reaction: 0.35, windUp: 0.15 },
    hard: { reaction: 0.18, windUp: 0.08 }
};
const SHOTS = [
    { name: 'left', delta: { x: -1, y: 0, z: 0 } },
    { name: 'right', delta: { x: 1, y: 0, z: 0 } },
    { name: 'rear', delta: { x: 0, y: 0, z: -1 } }
];

function radialVelocity(delta, velocity) {
    const length = Math.hypot(delta.x, delta.y, delta.z);
    return (velocity.x * delta.x + velocity.y * delta.y + velocity.z * delta.z) / length;
}

function isIncoming(delta, velocity) {
    return radialVelocity(delta, velocity) < -0.001;
}

// Mirrors Bot.observeDefenseIntent + Bot.tryDeflect for an always-accepted
// incoming opportunity. One result represents one complete launch at a bot.
function playShot(level, shot, hz, speed = 17, attackRange = 2) {
    const dt = 1 / hz;
    const alertRange = speed * (level.reaction + level.windUp) + attackRange;
    const velocity = {
        x: -shot.delta.x * speed,
        y: -shot.delta.y * speed,
        z: -shot.delta.z * speed
    };
    let distance = alertRange;
    let reaction = 0;
    let windUp = 0;
    let telegraphs = 0;
    for (let frame = 0; frame < 360; frame++) {
        const delta = {
            x: shot.delta.x * distance,
            y: shot.delta.y * distance,
            z: shot.delta.z * distance
        };
        if (!isIncoming(delta, velocity)) return { committed: false, telegraphs, frame, reason: 'not-incoming' };
        if (frame === 0) telegraphs++;
        reaction += dt;
        if (reaction >= level.reaction) windUp += dt;
        if (windUp >= level.windUp && distance <= attackRange) {
            return { committed: true, telegraphs, frame, distance };
        }
        distance -= speed * dt;
    }
    return { committed: false, telegraphs, reason: 'timeout' };
}

test('30/60/144 Hz bot-match sweep commits every accepted left/right/rear deflect exactly once', () => {
    let completed = 0;
    for (const [name, level] of Object.entries(LEVELS)) {
        for (const shot of SHOTS) {
            for (const hz of [30, 60, 144]) {
                const result = playShot(level, shot, hz);
                assert.equal(result.committed, true, `${name} ${shot.name} ${hz}Hz: ${JSON.stringify(result)}`);
                assert.equal(result.telegraphs, 1, `${name} ${shot.name} ${hz}Hz must show one readable brace`);
                completed++;
            }
        }
    }
    assert.equal(completed, 27);
});

test('outgoing left/right/rear shots never start a fake bot deflect telegraph', () => {
    for (const shot of SHOTS) {
        const outgoing = { x: shot.delta.x * 17, y: shot.delta.y * 17, z: shot.delta.z * 17 };
        assert.equal(isIncoming(shot.delta, outgoing), false, `${shot.name} outgoing ball is not a threat`);
    }
});

test('source gates a new telegraph on radial incoming velocity and preserves an existing readable decision', async () => {
    const source = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');
    assert.match(source, /export function isIncomingDefenseThreat\(ball, dx, dy, dz, distance\)/);
    assert.match(source, /return \(velocity\.x \* dx \+ velocity\.y \* dy \+ velocity\.z \* dz\) \/ distance < -0\.001;/);
    assert.match(source, /if \(!this\._deflectDecided && !isIncomingDefenseThreat\(ball, dx, dy, dz, dist\)\) \{\s*this\._resetDefenseIntent\(\);\s*return 'none';/);
});
