import test from 'node:test'
import assert from 'node:assert/strict'

import { MOVEMENT_TRIALS, MovementTrialClass, getGhostPoint } from '../js/movement-trials.js'

test('ghost interpolation returns a smooth point between samples', () => {
    assert.deepEqual(getGhostPoint([
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 100, x: 10, y: 4, z: 2 }
    ], 50), { x: 5, y: 2, z: 1 })
})

test('movement courses stay disabled until dedicated maps ship', () => {
    assert.deepEqual(Object.keys(MOVEMENT_TRIALS), [])
})
