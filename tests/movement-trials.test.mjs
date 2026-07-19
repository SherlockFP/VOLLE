import test from 'node:test'
import assert from 'node:assert/strict'

import { MOVEMENT_TRIALS, MovementTrialClass, getGhostPoint } from '../js/movement-trials.js'

test('ghost interpolation returns a smooth point between samples', () => {
    assert.deepEqual(getGhostPoint([
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 100, x: 10, y: 4, z: 2 }
    ], 50), { x: 5, y: 2, z: 1 })
})

test('bhop trial completes only after distance and speed requirements', () => {
    let now = 0
    const trials = new MovementTrialClass({ now: () => now })
    trials.start('bhop_sprint', { x: 0, y: 0, z: 0 })
    now = 1000
    const running = trials.update({ x: 150, y: 0, z: 0 }, { speed: 17, onGround: false, dt: 1 })
    assert.equal(running.status, 'running')
    now = 1100
    const complete = trials.update({ x: 151, y: 0, z: 0 }, { speed: 20, onGround: false, dt: 0.1 })
    assert.equal(complete.status, 'completed')
    assert.equal(complete.record.trialId, 'bhop_sprint')
})

test('movement hub currently exposes only the bhop course', () => {
    assert.deepEqual(Object.keys(MOVEMENT_TRIALS), ['bhop_sprint'])
})
