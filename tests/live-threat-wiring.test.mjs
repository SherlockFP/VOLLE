import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INTERVAL = 0.05;

function createThreatHarness({ state = 'PLAYING', warmup = false, ballActive = true, targeted = true, alive = true } = {}) {
    const calls = [];
    return {
        state, warmup, ballActive, targeted, alive, timer: 0, active: false, calls,
        tick(dt) {
            const live = (this.state === 'PLAYING' || (this.state === 'COUNTDOWN' && this.warmup))
                && this.ballActive && this.targeted && this.alive;
            if (!live) {
                this.timer = 0;
                if (this.active) {
                    this.active = false;
                    calls.push('ui:false', 'audio:false');
                }
                return;
            }
            this.timer = Math.min(INTERVAL, this.timer + Math.max(0, dt));
            if (this.timer < INTERVAL) return;
            this.timer = 0;
            this.active = true;
            calls.push('ui:true', 'audio:true');
        }
    };
}

test('live threat sampling is bounded and cleans up once on an inactive transition', () => {
    const threat = createThreatHarness();
    threat.tick(0.02);
    threat.tick(0.02);
    assert.deepEqual(threat.calls, []);
    threat.tick(0.02);
    assert.deepEqual(threat.calls, ['ui:true', 'audio:true']);
    threat.tick(1);
    assert.deepEqual(threat.calls, ['ui:true', 'audio:true', 'ui:true', 'audio:true'], 'a long frame must not catch up with repeated samples');
    threat.targeted = false;
    threat.tick(0.01);
    threat.tick(0.01);
    assert.deepEqual(threat.calls.slice(-2), ['ui:false', 'audio:false']);
    assert.equal(threat.calls.filter(call => call === 'ui:false').length, 1);
    assert.equal(threat.calls.filter(call => call === 'audio:false').length, 1);
});

test('only a live targeted player or countdown warmup produces threat samples', () => {
    for (const state of [
        { targeted: false }, { alive: false }, { ballActive: false },
        { state: 'COUNTDOWN', warmup: false }, { state: 'ROUND_END' }
    ]) {
        const threat = createThreatHarness(state);
        threat.tick(INTERVAL);
        assert.deepEqual(threat.calls, [], JSON.stringify(state));
    }
    const warmup = createThreatHarness({ state: 'COUNTDOWN', warmup: true });
    warmup.tick(INTERVAL);
    assert.deepEqual(warmup.calls, ['ui:true', 'audio:true']);
});

test('Game wires allocation-safe live threat samples after local and network ball updates', async () => {
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const updateStart = game.indexOf('    update(dt) {');
    const updateEnd = game.indexOf('\n    _clearPlayerThreat(', updateStart);
    const threatStart = updateEnd;
    const threatEnd = game.indexOf('\n    updatePlaying(dt) {', threatStart);
    assert.ok(updateStart >= 0 && threatStart > updateStart && threatEnd > threatStart);
    const update = game.slice(updateStart, updateEnd);
    const threat = game.slice(threatStart, threatEnd);

    assert.match(update, /this\.updatePlaying\(dt\);\s*this\.updatePlayerThreat\(dt\);/);
    assert.match(update, /this\.ball\.(?:update|_clientVisualUpdate)\(dt\);[\s\S]*?this\.updatePlayerThreat\(dt\);/);
    assert.match(threat, /const isWarmup = this\.state === STATES\.COUNTDOWN && this\.ball\?\._warmup;/);
    assert.match(threat, /ball\.targetPlayer === this\.player/);
    assert.match(threat, /this\.player\.position\?\.distanceTo\s*\? this\.player\.position\s*:\s*this\.player\.getPosition\?\.\(\)/);
    assert.match(threat, /ball\.position\.distanceTo\(playerPosition\)/);
    assert.match(threat, /PLAYER_THREAT_SAMPLE_INTERVAL/);
    assert.match(threat, /this\.ui\?\.setPlayerTarget\?\.\(true, speed, distance\);/);
    assert.match(threat, /this\.audio\?\.updateThreatAudio\?\.\(\{ active: true, speed, distance \}\);/);
    assert.match(threat, /this\.ui\?\.setPlayerTarget\?\.\(false\);[\s\S]*?active: false/);
    assert.doesNotMatch(threat, /\.clone\(|new THREE\.|ball\.update\(|network\.|damage/);
});
