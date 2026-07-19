import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_CROSSHAIR_CODE_LENGTH,
    exportCrosshairCode,
    importCrosshairCode,
    normalizeCrosshairConfig,
    renderCrosshair
} from '../js/crosshair.js';

function checksum(payload) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index++) {
        hash ^= payload.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function codeFor(value) {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `VOLLE-X1.${payload}.${checksum(payload)}`;
}

function createTarget() {
    const classes = new Set(['crosshair']);
    const properties = new Map();
    const target = {
        children: [],
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name))
        },
        style: {
            setProperty: (name, value) => properties.set(name, value)
        },
        ownerDocument: {
            createElement: () => ({ className: '', style: {} })
        },
        appendChild(child) {
            this.children.push(child);
        },
        replaceChildren() {
            this.children = [];
        },
        setAttribute(name, value) {
            this[name] = value;
        }
    };
    return { target, classes, properties };
}

test('normalization clamps finite numbers, validates hex, and does not mutate input', () => {
    const input = {
        style: 'script',
        color: '#AbC',
        size: 999,
        gap: -4,
        thickness: Infinity,
        dot: 'yes',
        outline: true,
        outlineThickness: 99,
        opacity: -1,
        dynamicGap: 80
    };
    const before = structuredClone(input);
    const config = normalizeCrosshairConfig(input);

    assert.deepEqual(input, before);
    assert.deepEqual(config, {
        style: 'cross',
        color: '#aabbcc',
        size: 64,
        gap: 0,
        thickness: 2,
        dot: true,
        outline: true,
        outlineThickness: 4,
        opacity: 0,
        dynamicGap: 32
    });
    assert.equal(normalizeCrosshairConfig({ color: 'red' }).color, '#00ff88');
});

test('render applies classes, custom properties, dynamic gap, and parts', () => {
    const { target, classes, properties } = createTarget();
    const input = {
        style: 'cross',
        color: '#123456',
        size: 10,
        gap: 4,
        thickness: 3,
        dot: false,
        outline: true,
        outlineThickness: 2,
        opacity: 0.5,
        dynamicGap: 8
    };

    assert.deepEqual(renderCrosshair(null, input, 1), input);
    renderCrosshair(target, input, 0.5);

    assert.equal(classes.has('crosshair-rendered'), true);
    assert.equal(classes.has('crosshair-style-cross'), true);
    assert.equal(properties.get('--crosshair-gap'), '8px');
    assert.equal(properties.get('--crosshair-color'), '#123456');
    assert.equal(target.style.opacity, '0.5');
    assert.equal(target.children.length, 4);
    assert.equal(target.children[0].className, 'crosshair-line top');
    assert.equal(target.children[0].style.boxShadow, '0 0 0 2px #000000');
});

test('export and import round-trip a normalized config without mutation', () => {
    const input = {
        style: 'circle',
        color: '#f0a',
        size: 20,
        gap: 3,
        thickness: 4,
        dot: false,
        outline: true,
        outlineThickness: 1.5,
        opacity: 0.75,
        dynamicGap: 7
    };
    const before = structuredClone(input);
    const code = exportCrosshairCode(input);

    assert.match(code, /^VOLLE-X1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    assert.deepEqual(importCrosshairCode(code), normalizeCrosshairConfig(input));
    assert.deepEqual(input, before);
});

test('invalid checksum and unknown payload keys are rejected', () => {
    const valid = exportCrosshairCode({});
    const last = valid.at(-1);
    const tampered = `${valid.slice(0, -1)}${last === '0' ? '1' : '0'}`;
    const config = normalizeCrosshairConfig();

    assert.equal(importCrosshairCode(tampered), null);
    assert.equal(importCrosshairCode(codeFor({ ...config, extra: true })), null);
});

test('malformed, oversized, and non-object imports fail closed', () => {
    assert.equal(importCrosshairCode(null), null);
    assert.equal(importCrosshairCode('VOLLE-X2.bad.00000000'), null);
    assert.equal(importCrosshairCode('VOLLE-X1.***.00000000'), null);
    assert.equal(importCrosshairCode(codeFor([])), null);
    assert.equal(importCrosshairCode('x'.repeat(MAX_CROSSHAIR_CODE_LENGTH + 1)), null);
});
