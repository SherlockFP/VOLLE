import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { Ball, BALL_SKINS } = await import(
    `data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`
);

class ColorValue {
    setHex(hex) { this.hex = hex; return this; }
    lerp(target, amount) {
        const blend = (from, to) => Math.round(from + (to - from) * amount);
        const r = blend((this.hex >> 16) & 255, (target.hex >> 16) & 255);
        const g = blend((this.hex >> 8) & 255, (target.hex >> 8) & 255);
        const b = blend(this.hex & 255, target.hex & 255);
        this.hex = (r << 16) | (g << 8) | b;
        return this;
    }
}

test('setSkin normalizes the id and refreshes shape, trail, and live material', () => {
    const calls = [];
    const context = {
        starMat: { color: new ColorValue() },
        _applyShape: shape => calls.push(['shape', shape]),
        clearTrail: () => calls.push(['trail']),
        updateColor: () => calls.push(['material'])
    };

    assert.equal(Ball.prototype.setSkin.call(context, 'dark_eater'), 'dark_eater');
    assert.equal(context.skinId, 'dark_eater');
    assert.equal(context.skinConfig, BALL_SKINS.dark_eater);
    assert.deepEqual(calls, [['shape', 'orb'], ['trail'], ['material']]);

    assert.equal(Ball.prototype.setSkin.call(context, 'missing_skin'), 'classic');
    assert.equal(context.skinId, 'classic');
    assert.equal(context.skinConfig, BALL_SKINS.classic);
});

test('spawn and deflect color refresh preserves equipped cosmetic identity', () => {
    const material = new ColorValue();
    const glow = new ColorValue();
    const context = {
        currentSpeed: 17,
        baseSpeed: 17,
        skinConfig: BALL_SKINS.ice,
        _skinHeatColor: { hex: 0xffffff },
        _affixGlowColor: null,
        mat: { uniforms: { uColor: { value: material } } },
        glowMat: { color: glow, opacity: 0 }
    };

    Ball.prototype.updateColor.call(context);
    assert.equal(material.hex, BALL_SKINS.ice.color);
    assert.equal(glow.hex, BALL_SKINS.ice.glow);

    context.currentSpeed = 68;
    Ball.prototype.updateColor.call(context);
    assert.notEqual(material.hex, BALL_SKINS.classic.color);
    assert.ok((material.hex & 255) >= (BALL_SKINS.ice.color & 255), 'heat brightens without replacing ice blue');
});
