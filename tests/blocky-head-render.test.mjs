// tests/blocky-head-render.test.mjs — verify the blocky rig can be constructed and renders
// without errors. Since THREE is CDN-only in this project, we test the mock construction
// to confirm all geometries/materials are valid and disposal is clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerThreeStub } from './helpers/three-loader.mjs';

registerThreeStub();

const { createCharacterRig } = await import('../js/character-rig.js');

test('rig constructs with all required meshes (head is a cube, not a sphere)', () => {
    const rig = createCharacterRig({ team: 'blue', skinId: 'default' });
    assert.ok(rig, 'rig should be created');
    assert.ok(rig.root, 'rig.root should exist');
    
    // Verify all critical meshes are present
    const headMesh = rig.joints.head.children.find(c => c.name === 'head-mesh');
    assert.ok(headMesh, 'head-mesh should exist under joints.head');
    assert.equal(headMesh.geometry.constructor.name, 'BoxGeometry', 'head must be a box');
    
    const neckMesh = rig.joints.torso.children.find(c => c.name === 'neck-mesh');
    assert.equal(neckMesh, undefined, 'exact Minecraft base should not render a neck');
    
    // Verify face decal exists
    const faceMesh = rig.joints.head.children.find(c => c.name === 'face-mesh');
    assert.ok(faceMesh, 'face-mesh should exist under joints.head');
    assert.equal(faceMesh.visible, false, 'face-mesh should be hidden by default');
    
    rig.dispose();
});

test('rig disposes all geometries and materials without leaks', () => {
    const rig = createCharacterRig({ team: 'red' });
    
    // Collect all geometries before disposal
    const geometries = new Set();
    rig.root.traverse(node => {
        if (node.geometry) geometries.add(node.geometry);
    });
    
    assert.ok(geometries.size > 10, `should have multiple geometries, got ${geometries.size}`);
    
    // Before disposal, all should have 0 dispose calls
    for (const geo of geometries) {
        assert.equal(geo.disposeCalls, 0, 'geometry should not be disposed yet');
    }
    
    // Dispose
    rig.dispose();
    
    // After disposal, each geometry should be disposed exactly once
    for (const geo of geometries) {
        assert.equal(geo.disposeCalls, 1, `geometry should be disposed exactly once, got ${geo.disposeCalls}`);
    }
});

test('rig can be disposed twice without error (idempotent)', () => {
    const rig = createCharacterRig({});
    assert.doesNotThrow(() => rig.dispose());
    assert.doesNotThrow(() => rig.dispose(), 'second dispose should not throw');
});

test('setHeadTexture toggles visibility of visor and face decal', () => {
    const rig = createCharacterRig({});
    
    // Find visor and face meshes directly from the head joint
    const visorMesh = rig.joints.head.children.find(c => c.name === 'visor');
    const faceMesh = rig.joints.head.children.find(c => c.name === 'face-mesh');
    
    assert.ok(visorMesh, 'visor-mesh should exist');
    assert.ok(faceMesh, 'face-mesh should exist');
    
    // Initially: visor visible, face hidden
    assert.equal(visorMesh.visible, true, 'visor should be visible initially');
    assert.equal(faceMesh.visible, false, 'face should be hidden initially');
    
    // Create a mock texture
    const mockTexture = { isTexture: true, dispose: () => {} };
    
    // After setHeadTexture: visor hidden, face visible
    rig.setHeadTexture(mockTexture);
    assert.equal(visorMesh.visible, false, 'visor should be hidden after setHeadTexture');
    assert.equal(faceMesh.visible, true, 'face should be visible after setHeadTexture');
    
    // After clearing texture: visor visible again, face hidden
    rig.setHeadTexture(null);
    assert.equal(visorMesh.visible, true, 'visor should be visible after clearing texture');
    assert.equal(faceMesh.visible, false, 'face should be hidden after clearing texture');
    
    rig.dispose();
});
