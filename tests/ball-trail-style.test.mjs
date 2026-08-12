import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { Ball, TRAIL_STYLE_PROFILES } = await import(
    `data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`
);

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; }
    distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
    lerpVectors(a, b, t) {
        this.x = a.x + (b.x - a.x) * t;
        this.y = a.y + (b.y - a.y) * t;
        this.z = a.z + (b.z - a.z) * t;
        return this;
    }
}

test('trail styles map to the approved shared geometry silhouettes', () => {
    assert.equal(TRAIL_STYLE_PROFILES.comet.geometry, 'orb');
    assert.equal(TRAIL_STYLE_PROFILES.ember.geometry, 'shard');
    assert.equal(TRAIL_STYLE_PROFILES.frost.geometry, 'crystal');
    assert.equal(TRAIL_STYLE_PROFILES.spark.geometry, 'pixel');
    assert.equal(TRAIL_STYLE_PROFILES.plasma.geometry, 'pixel');
    assert.equal(TRAIL_STYLE_PROFILES.prism.geometry, 'crystal');
    assert.equal(TRAIL_STYLE_PROFILES.void.geometry, 'crystal');
    assert.match(source, /if \(!sharedTrailGeometries\)/);
    assert.equal((source.match(/new THREE\.(?:Sphere|Tetrahedron|Octahedron|Box)Geometry/g) || []).length >= 4, true);
});
test('trail sampling reuses persistent vectors and preserves the five-sample cap', () => {
    const last = new Vector3(0, 0, 0);
    const sample = new Vector3();
    const points = [];
    const ctx = {
        velocity: { length: () => 200 },
        position: new Vector3(4, 0, 0),
        trailTimer: 1,
        _trailLastPosition: last,
        _trailSamplePosition: sample,
        _trailHasLastPosition: true,
        addTrailDot(point) { points.push([point.x, point.y, point.z]); }
    };
    Ball.prototype._emitTrail.call(ctx, 1 / 60);
    assert.equal(points.length, 5);
    assert.equal(ctx._trailLastPosition, last);
    assert.equal(ctx._trailSamplePosition, sample);
    assert.deepEqual(points.at(-1), [4, 0, 0]);

    const emitBody = source.slice(source.indexOf('    _emitTrail(dt) {'), source.indexOf('    addTrailDot(', source.indexOf('    _emitTrail(dt) {')));
    assert.doesNotMatch(emitBody, /\.clone\(/);
    assert.match(emitBody, /clamp\(Math\.ceil\(distance \/ spacing\), 1, 5\)/);
});

test('style geometry and non-uniform scale are applied without changing the radius cap', () => {
    const dot = {
        material: { color: { setHex() {} } },
        scale: { set(x, y, z) { this.value = [x, y, z]; } },
        position: { copy() {}, x: 0, z: 0 }
    };
    const ctx = {
        currentSpeed: 34,
        baseSpeed: 17,
        spin: 0,
        skinConfig: { trailStyle: 'ember', trail: 0xff5500 },
        skinId: 'fire',
        _affixTrailColor: null,
        _trailPool: { acquire: () => dot, release() {} },
        _trailGeometries: { shard: 'shared-shard' },
        scene: { add() {} },
        trail: []
    };
    Ball.prototype.addTrailDot.call(ctx, new Vector3());
    assert.equal(dot.geometry, 'shared-shard');
    assert.ok(dot.scale.value[2] > dot.scale.value[0]);
    assert.ok(ctx.trail[0].radius <= 0.3);
});
