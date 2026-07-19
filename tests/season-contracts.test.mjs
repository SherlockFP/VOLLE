import test from 'node:test'
import assert from 'node:assert/strict'

import {
    SEASON_CONTRACTS,
    claimSeasonContract,
    createSeasonContractState,
    progressSeasonContracts
} from '../js/season-contracts.js'

test('season progress is bounded and advances matching contract types', () => {
    const next = progressSeasonContracts(createSeasonContractState(), {
        games: 1,
        wins: 1,
        deflects: 12,
        longjumpDistance: 42.5,
        rocketJumps: 2
    })
    assert.equal(next.progress.matchmaker, 1)
    assert.equal(next.progress.winner, 1)
    assert.equal(next.progress.wall, 12)
    assert.equal(next.progress.flight, 42.5)
    assert.equal(next.progress.soldier, 2)
    assert.equal(Object.keys(next.progress).length, SEASON_CONTRACTS.length)
})

test('season contract claims exactly once after completion', () => {
    const complete = progressSeasonContracts(createSeasonContractState(), { games: 999 })
    const first = claimSeasonContract(complete, 'matchmaker')
    const second = claimSeasonContract(first.state, 'matchmaker')
    assert.equal(first.reward, 700)
    assert.equal(second.reward, 0)
})
