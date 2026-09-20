import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COSMETIC_ICON_TYPES,
    sanitizeIconColor,
    cosmeticIconType,
    cosmeticIconDescriptor,
    createCosmeticIcon,
    appendCosmeticIcon
} from '../js/cosmetic-icons.js';

class FakeNode {
    constructor(name, ownerDocument) { this.name = name; this.ownerDocument = ownerDocument; this.attributes = {}; this.children = []; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    append(child) { this.children.push(child); }
    querySelector() { return null; }
}

const fakeDocument = { createElementNS: (_namespace, name) => new FakeNode(name, fakeDocument) };

test('every wearable category has a dedicated supported silhouette type', () => {
    assert.deepEqual(COSMETIC_ICON_TYPES, [
        'cape', 'pet', 'shoes', 'aura', 'impact', 'hat', 'mask', 'wings',
        'backpack', 'banner', 'trail', 'finisher', 'gloves'
    ]);
    for (const type of COSMETIC_ICON_TYPES) assert.equal(cosmeticIconType({ type }), type);
    assert.equal(cosmeticIconType({ type: 'hitEffect' }), 'impact');
});

test('colours are restricted to hex literals before they reach SVG attributes', () => {
    assert.equal(sanitizeIconColor('#aBc'), '#aBc');
    assert.equal(sanitizeIconColor('#1a2B3c'), '#1a2B3c');
    assert.equal(sanitizeIconColor('url(javascript:alert(1))'), '#67e8f9');
    assert.equal(sanitizeIconColor('red'), '#67e8f9');
    assert.equal(sanitizeIconColor('#12345z', '#010203'), '#010203');
});

test('descriptor ignores untrusted fields and falls back safely for unknown categories', () => {
    const descriptor = cosmeticIconDescriptor({
        type: '<img onerror=alert(1)>',
        name: '<script>bad()</script>',
        colors: ['#f6af32', 'expression(alert(1))']
    });
    assert.deepEqual(descriptor, { type: 'aura', style: null, primary: '#f6af32', secondary: '#1e3a8a' });
    assert.ok(Object.isFrozen(descriptor));
});

test('only catalog-supported style variants alter their category silhouette', () => {
    assert.equal(cosmeticIconDescriptor({ type: 'hat', style: 'headset' }).style, 'headset');
    assert.equal(cosmeticIconDescriptor({ type: 'backpack', style: 'court_bag' }).style, 'court_bag');
    assert.equal(cosmeticIconDescriptor({ type: 'pet', style: 'axolotl' }).style, 'axolotl');
    assert.equal(cosmeticIconDescriptor({ type: 'hat', style: '<svg onload=alert(1)>' }).style, null);
    assert.equal(cosmeticIconDescriptor({ type: 'hat', style: 'court_bag' }).style, null, 'a bag style cannot alter a hat');
});

test('creation does not require a DOM, so shop data tests stay server-safe', () => {
    assert.equal(createCosmeticIcon({ type: 'hat' }, null), null);
});

test('SVG is assembled through DOM nodes and never copies a product name into attributes', () => {
    const container = new FakeNode('div', fakeDocument);
    const icon = appendCosmeticIcon(container, {
        type: 'backpack', name: '\"><script>throw new Error()</script>', colors: ['#f6af32', 'bad;stroke:red']
    });
    assert.equal(container.children[0], icon);
    assert.equal(icon.name, 'svg');
    assert.equal(icon.attributes.class, 'cosmetic-item-icon cosmetic-item-icon-backpack');
    assert.equal(icon.attributes['aria-hidden'], 'true');
    const serializedAttributes = JSON.stringify(icon);
    assert.doesNotMatch(serializedAttributes, /script|stroke:red/);
    assert.ok(icon.children.length > 1, 'category silhouette has multiple SVG primitives');
});

test('headset, court bag and axolotl variants produce a distinct SVG class and primitives', () => {
    for (const item of [
        { type: 'hat', style: 'headset' },
        { type: 'backpack', style: 'court_bag' },
        { type: 'pet', style: 'axolotl' }
    ]) {
        const icon = createCosmeticIcon(item, fakeDocument);
        assert.match(icon.attributes.class, /cosmetic-item-icon-(headset|court_bag|axolotl)/);
        assert.ok(icon.children.length >= 4);
    }
});
