import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { COMPETITIVE_RULESET, normalizeCompetitiveEntity } from '../js/competitive-rules.js';
import {
    RALLY_DUEL_DEFAULT_MAP,
    RALLY_DUEL_MAPS,
    normalizeRallyDuelMap,
    planRallyDuelRoster
} from '../js/rally-duel.js';

test('rally duel is a distinct normalized mode with two safe maps', async () => {
    const modes = await readFile(new URL('../js/gamemodes.js', import.meta.url), 'utf8');
    assert.match(modes, /rally_duel:\s*\{[\s\S]*?id: RALLY_DUEL_MODE_ID/);
    assert.match(modes, /rallyDuel: true/);
    assert.deepEqual(RALLY_DUEL_MAPS, ['industrial', 'temple_sym']);
    assert.equal(normalizeRallyDuelMap('temple_sym'), 'temple_sym');
    assert.equal(normalizeRallyDuelMap('lava'), RALLY_DUEL_DEFAULT_MAP);
});

test('rally duel roster accepts one human, rejects extras, and plans a bot fallback', () => {
    const opponent = { id: 'peer-a' };
    const queued = { id: 'peer-b', queuedForNextRound: true };
    const humanPlan = planRallyDuelRoster({ remotePlayers: [opponent, queued] });
    assert.equal(humanPlan.accepted, true);
    assert.equal(humanPlan.opponent, opponent);
    assert.equal(humanPlan.needsFallbackBot, false);
    assert.equal(planRallyDuelRoster({ remotePlayers: [opponent, { id: 'peer-c' }] }).accepted, false);
    assert.equal(planRallyDuelRoster({ remotePlayers: [] }).needsFallbackBot, true);
    assert.equal(planRallyDuelRoster({
        remotePlayers: [],
        allowFallbackBot: false
    }).reason, 'waiting-for-opponent');
});

test('competitive normalization removes powers and equalizes duel stats', () => {
    const entity = {
        maxHp: 250,
        hp: 12,
        speed: 18,
        moveSpeed: 22,
        deflectPower: 3,
        staminaMax: 200,
        stamina: 4,
        passive: 'lifesteal',
        loadout: { runes: ['power'] },
        skillCooldowns: { dash: 8 },
        ultimateCharge: 90,
        drawHpBar() {}
    };
    normalizeCompetitiveEntity(entity, COMPETITIVE_RULESET);
    assert.equal(entity.maxHp, 100);
    assert.equal(entity.hp, 100);
    assert.equal(entity.speed, 10);
    assert.equal(entity.moveSpeed, 10);
    assert.equal(entity.deflectPower, 1);
    assert.equal(entity.staminaMax, 100);
    assert.equal(entity.stamina, 100);
    assert.equal(entity.passive, 'none');
    assert.deepEqual(entity.runeBonuses, {
        hp: 0,
        dmgResist: 0,
        deflect: 0,
        speed: 0,
        stamRegen: 0,
        cdr: 0,
        lifesteal: 0,
        thorns: 0
    });
    assert.equal(entity.ultimateCharge, 0);
});

test('rally duel lobby control is accessible and host-authoritative', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(html, /role="group" aria-label="Game mode"/);
    assert.match(html, /data-mode="rally_duel" aria-pressed="false"/);
    assert.match(main, /Only the lobby host can change the mode\./);
    assert.match(game, /if \(this\._rallyDuel\) mapId = normalizeRallyDuelMap\(mapId\);/);
    assert.match(game, /if \(this\._powerUpsDisabled\) return false;/);
    assert.match(game, /startGame\(skipPreGame = false, matchId = null\) \{\s*if \(this\._rallyDuel && !this\._prepareRallyDuel\(\)\) return false;/);
    assert.match(main, /const started = this\.game\.startGame\(\);[\s\S]*?if \(started === false\)/);
    assert.match(main, /const started = this\.game\.startGame\(false, matchId\);[\s\S]*?if \(started === false\)/);
    assert.match(main, /const started = this\.game\.startGame\(\);[\s\S]*?if \(started === false\)[\s\S]*?clearInterval\(this\._lobbyKeepAlive\)/);
    assert.match(main, /const rollback = this\.rematchVote\.snapshot\(\);[\s\S]*?this\.rematchVote\.begin\(sourceMatchId, rollback\.requiredPlayerIds\)/);
});
