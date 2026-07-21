import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    createDraftState, hasModeWinner, rankQueueCandidates, shouldStartOvertime, updateDraftPick
} from '../js/competitive-service.js';
import {
    createParty, createSocialProfile, inviteToParty, isPartyReady, rememberPlayer, setPartyReady
} from '../js/social-service.js';
import { RuntimeSafety } from '../js/runtime-safety.js';
import { normalizeNetcode, predictPosition, rebaseSnapshotBuffer, rewindSnapshot } from '../js/experimental-netcode.js';

const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

test('draft requires team, class and ready', () => {
    let state = createDraftState([{ id: '1', name: 'Sher' }], ['scout', 'soldier']);
    state = updateDraftPick(state, '1', { team: 'blue', classId: 'soldier', ready: true });
    assert.equal(state.active, false);
    assert.equal(state.players[0].classId, 'soldier');
});

test('ranked queue prefers closest eligible lobby', () => {
    const result = rankQueueCandidates([
        { code: 'far', ranked: true, averageElo: 1800, players: 1 },
        { code: 'near', ranked: true, averageElo: 1080, players: 2 }
    ], { elo: 1000 });
    assert.equal(result[0].code, 'near');
});

test('all modes can enter overtime on a tie', () => {
    assert.equal(shouldStartOvertime({ redScore: 3, blueScore: 3, timeUp: true }), true);
});

test('party ready check and recent players are deterministic', () => {
    let party = createParty('Sher', ['Ada']);
    party = inviteToParty(party, 'Grace');
    party = setPartyReady(party, 'Sher', true);
    party = setPartyReady(party, 'Ada', true);
    party = setPartyReady(party, 'Grace', true);
    assert.equal(isPartyReady(party), true);
    const state = rememberPlayer(createSocialProfile(), { name: 'Ada', elo: 1200 }, 10);
    assert.deepEqual(state.recent[0], { name: 'Ada', elo: 1200, at: 10 });
});

test('runtime audit records invalid transitions', () => {
    const log = new RuntimeSafety(10);
    assert.equal(log.auditTransition('MENU', 'PLAYING'), false);
    assert.equal(log.events.at(-1).type, 'invalid-state');
});

test('experimental netcode clamps and rewinds', () => {
    assert.equal(normalizeNetcode({ enabled: true, interpolationMs: 999 }).interpolationMs, 150);
    assert.deepEqual(predictPosition({ x: 0, y: 0, z: 0 }, { x: 10 }, 100, 1), { x: 1, y: 0, z: 0 });
    const sample = rewindSnapshot([{ time: 0 }, { time: 100 }], 100, 100, 160);
    assert.equal(sample.alpha, 0.5);
});

test('experimental netcode toggle rebases live snapshots without losing movement', () => {
    const rebased = rebaseSnapshotBuffer([
        { time: 900, x: 1 },
        { time: 950, x: 2 },
        { time: Number.NaN, x: 99 }
    ], -10, 1000);
    assert.deepEqual(rebased, [
        { time: 890, x: 1 },
        { time: 940, x: 2 }
    ]);
    assert.ok(rebased[1].x > rebased[0].x);
    assert.match(gameSource, /setExperimentalNetcode\(config, now = performance\.now\(\)\)/);
    assert.match(mainSource, /const applied = this\.game\.setExperimentalNetcode\(config\)/);
    assert.match(mainSource, /this\.game\.state === STATES\.PAUSED[\s\S]{0,120}_clientVisualUpdate/);
});

test('Competitive ends at seven wins while six and Classic continue', () => {
    const competitive = { mutators: { winTarget: 7 } };
    assert.equal(hasModeWinner(competitive, 6, 5), false);
    assert.equal(hasModeWinner(competitive, 7, 6), true);
    assert.equal(hasModeWinner({ mutators: {} }, 99, 0), false);
});
