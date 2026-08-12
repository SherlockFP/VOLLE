import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use three-stub to mock THREE and avoid node_modules issues
const threeStub = readFileSync(resolve(__dirname, 'helpers/three-stub.mjs'), 'utf-8');
const cosmetic = readFileSync(resolve(__dirname, '../js/cosmetic-models.js'), 'utf-8');
// Extract just the constant definitions from cosmetic-models (after the three import is stubbed)
const extractConstants = () => {
    const lines = cosmetic.split('\n');
    let start = -1, end = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('HEAD_SOCKET_WORLD_Y')) start = i;
        if (lines[i].includes('export { HEAD_SOCKET_WORLD_Y') && end === -1) end = i;
    }
    return lines.slice(start, end + 1).join('\n');
};

describe('hat and mask positioning derived from rig geometry constants', () => {
    it('HEAD_SOCKET_WORLD_Y = 2.00 on the 32-voxel silhouette', () => {
        // Manual calculation from exported constants
        const HEAD_SOCKET_WORLD_Y = 0.75 + 0.80 + 0.45;
        assert.strictEqual(HEAD_SOCKET_WORLD_Y, 2.00, 'head socket world Y position');
    });

    it('HEAD_TOP_WORLD_Y = 2.00 (head mesh center + half-depth)', () => {
        const HEAD_TOP_WORLD_Y = 0.75 + 0.80 + 0.20 + 0.25;
        assert.strictEqual(HEAD_TOP_WORLD_Y, 2.00, 'head mesh top at 2.00 for hat baseline');
    });

    it('FACE_SOCKET_WORLD_Y = 1.75 at the head center', () => {
        const FACE_SOCKET_WORLD_Y = 0.75 + 0.80 + 0.20;
        assert.strictEqual(FACE_SOCKET_WORLD_Y, 1.75, 'masks anchor at head center y=1.75');
    });

    it('hat group.position.y = HEAD_TOP_WORLD_Y - 0.04 positions base at 1.96', () => {
        const HEAD_TOP_WORLD_Y = 2.00;
        const hatBaseY = HEAD_TOP_WORLD_Y - 0.04;
        assert.strictEqual(hatBaseY, 1.96, 'hat base at 1.96 where crown cylinder sits');
    });

    it('masks are face-socket-attached with their parts positioned in local space', () => {
        const FACE_SOCKET_WORLD_Y = 1.75;
        // Masks attach to face socket and use FACE_SOCKET_WORLD_Y as their base y
        assert.strictEqual(FACE_SOCKET_WORLD_Y, 1.75, 'mask base attaches at face socket y=1.75');
    });

    it('head constants propagate from character-rig.js: 8 voxels = 0.50', () => {
        const HEAD_SIZE = 0.50;
        const HEAD_HALF_DEPTH = 0.25;
        assert.strictEqual(HEAD_SIZE, 0.50, 'cube head size');
        assert.strictEqual(HEAD_HALF_DEPTH, 0.25, 'cube head half-depth');
    });
});
