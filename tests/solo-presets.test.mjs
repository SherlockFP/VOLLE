import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SOLO_PRESET_IDS,
    SOLO_PRESETS,
    applySoloPreset,
    getSoloPreset
} from '../js/solo-presets.js';

test('short solo presets expose a distinct, bounded warmup, duel, pressure and matched route', () => {
    assert.deepEqual(SOLO_PRESETS.map(preset => preset.id), ['warmup', 'rally_duel', 'pressure', 'matched']);
    assert.deepEqual(SOLO_PRESETS.map(preset => preset.modeId), ['instagib', 'rally_duel', 'instagib', 'classic']);
    assert.deepEqual(SOLO_PRESETS.map(preset => preset.mapId), ['beach_open', 'industrial', 'esport_arena', 'grand_stadium']);
    for (const preset of SOLO_PRESETS) {
        assert.ok(preset.maxRounds >= 3 && preset.maxRounds <= 5);
        assert.ok(preset.timeLimit > 0 && preset.timeLimit <= 180);
        assert.match(preset.botDifficulty, /^(easy|medium|hard|auto)$/, 'auto = the adaptive level (js/adaptive-difficulty.js)');
        assert.ok(Object.isFrozen(preset));
    }
    assert.equal(Object.isFrozen(SOLO_PRESETS), true);
    assert.equal(getSoloPreset(SOLO_PRESET_IDS.RALLY_DUEL), SOLO_PRESETS[1]);
    assert.equal(getSoloPreset('unknown'), null);
    assert.equal(getSoloPreset('constructor'), null);
    assert.equal(getSoloPreset('__proto__'), null);
});

function makeGame() {
    const calls = [];
    const scoreboard = {
        setMaxRounds(value) { calls.push(['rounds', value]); },
        setTimeLimit(value) { calls.push(['time', value]); }
    };
    const game = {
        bots: [{ name: 'Old one' }, { name: 'Old two' }],
        botCounter: 7,
        botDifficulty: 'medium',
        network: { connected: false },
        remotePlayers: new Map(),
        scoreboard,
        removeBot() { calls.push(['remove', this.bots.at(-1).name]); this.bots.pop(); },
        setMatchModifier(value) { calls.push(['modifier', value]); },
        selectMode(value) { calls.push(['mode', value]); },
        selectMap(value) { calls.push(['map', value]); },
        addBot(team, options) {
            this.botCounter++;
            calls.push(['add', team, options, this.botDifficulty]);
            this.bots.push({ name: options.name, team, difficulty: this.botDifficulty });
        }
    };
    return { game, calls };
}

test('applySoloPreset clears stale roster and FFA state through a real mode selection before one bot', () => {
    const { game, calls } = makeGame();
    const result = applySoloPreset(game, SOLO_PRESET_IDS.RALLY_DUEL);

    assert.deepEqual(result, { accepted: true, preset: getSoloPreset('rally_duel'), reason: null });
    assert.equal(game.botCounter, 1);
    assert.equal(game.botDifficulty, 'medium');
    assert.deepEqual(game.bots, [{ name: 'Rally BOT', team: 'blue', difficulty: 'medium' }]);
    assert.deepEqual(calls, [
        ['remove', 'Old two'],
        ['remove', 'Old one'],
        ['modifier', 'none'],
        ['mode', 'rally_duel'],
        ['map', 'industrial'],
        ['rounds', 3],
        ['time', 180],
        ['add', 'blue', { name: 'Rally BOT' }, 'medium']
    ]);
});

test('applySoloPreset rejects unknown presets and incomplete game contracts without mutations', () => {
    const { game, calls } = makeGame();
    assert.deepEqual(applySoloPreset(game, 'nope'), { accepted: false, preset: null, reason: 'unknown-preset' });
    assert.deepEqual(calls, []);
    assert.deepEqual(applySoloPreset({ bots: [] }, SOLO_PRESET_IDS.WARMUP), {
        accepted: false, preset: null, reason: 'unsupported-game'
    });
});

test('applySoloPreset refuses a live peer or an existing remote human before roster changes', () => {
    const live = makeGame();
    live.game.network.connected = true;
    assert.deepEqual(applySoloPreset(live.game, SOLO_PRESET_IDS.WARMUP), {
        accepted: false, preset: null, reason: 'not-solo'
    });
    assert.deepEqual(live.calls, []);

    const remote = makeGame();
    remote.game.remotePlayers.set('peer', { name: 'Human' });
    assert.deepEqual(applySoloPreset(remote.game, SOLO_PRESET_IDS.WARMUP), {
        accepted: false, preset: null, reason: 'not-solo'
    });
    assert.deepEqual(remote.calls, []);
});
