import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, createBot, createBall, createContactGame, SimPlayer, straightPath } from './frame-contact-sim.mjs';

// js/ball.js with vendored three.js and its FX stubbed (as tests/ball-orbit-regression.test.mjs).
const threeUrl = new URL('../vendor/three/three.module.js', import.meta.url).href;
const poolUrl = new URL('../js/objectPool.js', import.meta.url).href;
const ballSource = readFileSync(new URL('../js/ball.js', import.meta.url), 'utf8')
    .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
    .replace("import { ObjectPool } from './objectPool.js';", `import { ObjectPool } from '${poolUrl}';`)
    .replace(/import \{[^}]*\} from '\.\/ball-skin-fx\.js';/, 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} }');
const { GHOST_SOLID_MIN_RANGE, GHOST_SOLID_SECONDS, ghostBallSolidFor } = await import(`data:text/javascript;base64,${Buffer.from(ballSource).toString('base64')}`);

const at = (x, y = 0, z = 0) => ({ getPosition: () => new Vector3(x, y, z) });

test('a Ghost ball is solid only for its own target, and only in its last moment', () => {
    const target = at(0);
    const bystander = at(5);
    const ball = { _affixGhost: true, targetPlayer: target, currentSpeed: 10, position: new Vector3(20, 0, 0) };
    assert.equal(ghostBallSolidFor(ball, target), false, 'far away: still phased');
    ball.position.set(GHOST_SOLID_MIN_RANGE - 0.1, 0, 0);
    assert.equal(ghostBallSolidFor(ball, target), true, 'inside the last stretch: solid');
    assert.equal(ghostBallSolidFor(ball, bystander), false, 'anyone else is always phased through');
    ball.currentSpeed = 40;
    ball.position.set(40 * GHOST_SOLID_SECONDS - 0.1, 0, 0);
    assert.equal(ghostBallSolidFor(ball, target), true, 'a fast ball turns solid earlier');
    assert.equal(ghostBallSolidFor({ ...ball, _affixGhost: false }, bystander), true, 'no affix: normal');
    assert.equal(ghostBallSolidFor({ ...ball, targetPlayer: null }, bystander), true, 'no target: normal');
});

// Before, the Ghost affix switched hits off for the whole flight: a ball homing
// at a player ended inside them and circled there forever (the owner's report).
test('the real frame contacts: a Ghost ball passes a bystander and then hits its target', () => {
    const dt = 1 / 60;
    const speed = 12;
    const target = createBot({ x: 0, committed: false });
    const bystander = createBot({ x: 8, committed: false });
    const idle = new SimPlayer({ team: 'red', x: -40 });
    const path = straightPath({ speed, contactTime: 2, aimY: 1.25 });
    const ball = createBall({ position: path.at(0), speed, target });
    ball._affixGhost = true;
    ball.ghostSolidFor = function (who) { return ghostBallSolidFor(this, who); };
    const game = createContactGame({ player: idle, bots: [target, bystander], ball, throwerTeam: 'red' });
    let hit = null;
    for (let frame = 1; frame <= 180 && !hit; frame++) {
        ball._prevPosition.copy(ball.position);
        path.at(frame * dt, ball.position);
        game.events.length = 0;
        if (game._resolveFrameContacts(dt, true, false) === 'hit') hit = game.events.find(event => event.kind === 'hit');
    }
    assert.ok(hit, 'the ghost ball resolves as a hit');
    assert.equal(hit.target, target, 'it phased through the bystander in its path');

    const plain = createBall({ position: path.at(0), speed, target });
    const plainGame = createContactGame({ player: idle, bots: [target, bystander], ball: plain, throwerTeam: 'red' });
    let first = null;
    for (let frame = 1; frame <= 180 && !first; frame++) {
        plain._prevPosition.copy(plain.position);
        path.at(frame * dt, plain.position);
        plainGame.events.length = 0;
        if (plainGame._resolveFrameContacts(dt, true, false) === 'hit') first = plainGame.events.find(event => event.kind === 'hit');
    }
    assert.equal(first?.target, bystander, 'without the affix the body in the way takes the hit');
});

test('wiring: both hit paths use the ghost rule, and hits are no longer switched off', () => {
    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.doesNotMatch(game, /!this\.ball\._affixGhost &&/);
    assert.match(game, /if \(ball\._affixGhost\) candidates = candidates\.filter\(target => ball\.ghostSolidFor\?\.\(target\) === true\);/);
    assert.match(game, /if \(this\.ball\._affixGhost && this\.ball\.ghostSolidFor\?\.\(target\) !== true\) return true;/, 'hidden-tab settlement too');
    assert.match(ballSource, /ghostSolidFor\(target\) \{ return ghostBallSolidFor\(this, target\); \}/);
});
