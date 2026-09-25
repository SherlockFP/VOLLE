import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { matchOutcomeFacts, maxRoundDeficit } from '../js/balance-outcome.js';
import { normalizeProductEvent as normalizeClientEvent } from '../js/product-analytics.js';
import { readAppSource } from './app-source.mjs';
import { extractMethod } from './frame-contact-sim.mjs';

const require = createRequire(import.meta.url);
const { normalizeProductEvent: normalizeServerEvent } = require('../server/product-analytics.js');
const { buildBalanceReport } = require('../scripts/balance-report.js');

const soloWin = () => matchOutcomeFacts({
    queue: 'solo', mapId: 'beach', result: 'win', team: 'red', character: 'rally',
    players: [{ team: 'red', isYou: true }, { team: 'blue', isBot: true }],
    bots: [{ team: 'blue', difficulty: 'medium' }],
    redScore: 3, blueScore: 2,
    roundHistory: [{ red: 0, blue: 1 }, { red: 0, blue: 2 }, { red: 1, blue: 2 }, { red: 2, blue: 2 }, { red: 3, blue: 2 }],
    kills: 7, deaths: 4, bestRally: 12
});

test('a solo comeback win reports difficulty, team size and the deficit it came back from', () => {
    const facts = soloWin();
    assert.deepEqual(facts.dimensions, { queue: 'solo', map: 'beach', result: 'win', difficulty: 'medium', character: 'rally', teamSize: '1v1' });
    assert.deepEqual(facts.metrics, { roundsWon: 3, roundsLost: 2, maxDeficit: 2, kills: 7, deaths: 4, bestRally: 12, botCount: 1, humanCount: 1 });
    assert.equal(maxRoundDeficit([{ red: 2, blue: 0 }, { red: 2, blue: 1 }], 'blue'), 2);
});

test('outcome facts never carry free text: custom maps, odd ids, mixed bots and FFA collapse', () => {
    const facts = matchOutcomeFacts({
        queue: 'weird', mapId: 'custom-abc123', result: 'maybe', team: 'blue', character: 'Sher Lock <b>',
        players: [{ team: 'blue' }, { team: 'blue', isBot: true }, { team: 'red', isBot: true }, { team: 'red', isBot: true }],
        bots: [{ team: 'blue', difficulty: 'easy' }, { team: 'red', difficulty: 'hard' }, { team: 'red', difficulty: 'medium' }],
        redScore: 500, blueScore: -3, kills: 1e9
    });
    assert.deepEqual(facts.dimensions, { queue: 'solo', map: 'custom', result: 'loss', difficulty: 'mixed', character: 'unknown', teamSize: '2v2' });
    assert.equal(facts.metrics.roundsWon, 0);
    assert.equal(facts.metrics.roundsLost, 99);
    assert.equal(facts.metrics.kills, 999);
    assert.equal(facts.metrics.botCount, 3);
    const ffa = matchOutcomeFacts({ ffa: true, players: [{}, {}, {}, {}], bots: [{ team: 'red', difficulty: 'hard' }], redScore: 4 });
    assert.equal(ffa.dimensions.teamSize, 'ffa4');
    assert.equal(ffa.dimensions.difficulty, 'hard', 'in FFA every bot is an opponent');
    assert.equal(ffa.metrics.roundsWon, 0);
    assert.equal(matchOutcomeFacts({ players: [{ team: 'red' }, { team: 'blue' }] }).dimensions.difficulty, 'none');
});

test('client and server analytics both keep the balance facts on match_complete', () => {
    const facts = soloWin();
    const event = {
        eventId: 'product_event_balance01', sessionId: 'session_123456', name: 'match_complete',
        dimensions: { mode: 'classic', ...facts.dimensions }, metrics: { matchDurationSec: 180, ...facts.metrics }
    };
    const client = normalizeClientEvent(event);
    assert.deepEqual({ ...client.dimensions }, event.dimensions);
    assert.deepEqual({ ...client.metrics }, event.metrics);
    const server = normalizeServerEvent(event, 'profile_123456', 'test-product-analytics-secret-that-is-long-enough', Date.now());
    assert.ok(server, 'the server accepts the whole event');
    assert.deepEqual(server.metrics, event.metrics);
    assert.equal(normalizeServerEvent({ ...event, dimensions: { ...event.dimensions, playerName: 'Sher' } }, 'profile_123456', 'x'.repeat(40), Date.now()), null);
    assert.equal(normalizeServerEvent({ ...event, metrics: { kills: 5000 } }, 'profile_123456', 'x'.repeat(40), Date.now()), null);
});

test('the balance report groups outcomes and flags difficulties and characters off their bands', () => {
    const now = Date.UTC(2026, 8, 25);
    const outcome = (i, dimensions, metrics = {}) => ({
        name: 'match_complete', serverTimestamp: now - i * 1000, profileKey: `p${i % 7}`,
        dimensions: { mode: 'classic', map: 'beach', character: 'rally', teamSize: '1v1', ...dimensions },
        metrics: { roundsWon: 3, roundsLost: 1, maxDeficit: 0, botCount: 1, matchDurationSec: 120, ...metrics }
    });
    const events = [];
    // Easy bots beat players most of the time: flagged.
    for (let i = 0; i < 20; i++) events.push(outcome(i, { queue: 'solo', difficulty: 'easy', result: i < 6 ? 'win' : 'loss' }, { roundsWon: 1, roundsLost: 3 }));
    // Medium lands in its band: not flagged.
    for (let i = 0; i < 20; i++) events.push(outcome(100 + i, { queue: 'solo', difficulty: 'medium', result: i % 2 ? 'win' : 'loss' }, { maxDeficit: i % 2 ? 2 : 0 }));
    // PvP: "tank" wins 80% of human-vs-human matches.
    for (let i = 0; i < 20; i++) events.push(outcome(200 + i, { queue: 'casual', character: 'tank', result: i < 16 ? 'win' : 'loss' }, { botCount: 0 }));
    // Too old, other events and match_complete without a result are ignored.
    events.push(outcome(0, { queue: 'solo', difficulty: 'hard', result: 'win' }), { name: 'session_start', dimensions: {} }, { name: 'match_complete', dimensions: { mode: 'classic' } });
    events.at(-3).serverTimestamp = now - 60 * 24 * 60 * 60 * 1000;
    const report = buildBalanceReport(events, now, { minMatches: 20, days: 30 });
    assert.equal(report.overall.matches, 60);
    assert.equal(report.soloByDifficulty.easy.winRate, 0.3);
    assert.equal(report.soloByDifficulty.medium.winRate, 0.5);
    assert.equal(report.soloByDifficulty.medium.comebackRate, 0.5);
    assert.equal(report.soloByDifficulty.hard, undefined);
    assert.equal(report.pvpByCharacter.tank.winRate, 0.8);
    assert.equal(report.pvpByCharacter.rally, undefined, 'bot matches never judge a character');
    assert.equal(report.byTeamSize['1v1'].matches, 60);
    assert.deepEqual(report.flags.map(flag => `${flag.section}:${flag.name}`).sort(), ['pvpByCharacter:tank', 'soloByDifficulty:easy']);
    assert.ok(buildBalanceReport(events, now, { minMatches: 50 }).flags.length === 0, 'small samples are never flagged');
});

test('main attaches the balance facts to match_complete before the reward grant runs', () => {
    const main = readAppSource();
    const hook = main.slice(main.indexOf('this.game.onMatchComplete = () => {'), main.indexOf('this.game.onRoundEnd ='));
    assert.ok(hook.indexOf('const balance = this._matchBalanceFacts?.() || null;') < hook.indexOf('this.awardMatchRewards();'));
    assert.match(hook, /\.\.\.balance\?\.dimensions,/);
    assert.match(hook, /\.\.\.balance\?\.metrics\s*\}\);/);
    const method = extractMethod(main, '_matchBalanceFacts');
    assert.match(method, /if \(this\.game\.localSpectator \|\| this\.game\._practiceMode\) return null;/);
    assert.match(method, /queue: this\._activeMatchMode/);
});
