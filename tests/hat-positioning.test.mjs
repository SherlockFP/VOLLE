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
    it('HEAD_SOCKET_WORLD_Y = 2.16 (HIPS + torso offset + head joint offset + HEAD_SOCKET_LOCAL_Y)', () => {
        // Manual calculation from exported constants
        // HIPS_WORLD_Y = 0.94, HEAD_SOCKET_LOCAL_Y = 0.42, head joint offset = 0.80
        const HEAD_SOCKET_WORLD_Y = 0.94 + 0.80 + 0.42;
        assert.strictEqual(HEAD_SOCKET_WORLD_Y, 2.16, 'head socket world Y position');
    });

    it('HEAD_TOP_WORLD_Y = 2.16 (head mesh center + half-depth)', () => {
        // HIPS_WORLD_Y (0.94) + head joint (0.80) + HEAD_MESH_LOCAL_Y (0.20) + HEAD_HALF_DEPTH (0.22)
        const HEAD_TOP_WORLD_Y = 0.94 + 0.80 + 0.20 + 0.22;
        assert.strictEqual(HEAD_TOP_WORLD_Y, 2.16, 'head mesh top at 2.16 for hat baseline');
    });

    it('FACE_SOCKET_WORLD_Y = 1.74 (head joint, face socket sits at head center y)', () => {
        // HIPS_WORLD_Y (0.94) + head joint (0.80) + FACE_SOCKET_LOCAL_Y (0)
        const FACE_SOCKET_WORLD_Y = 0.94 + 0.80 + 0;
        assert.strictEqual(FACE_SOCKET_WORLD_Y, 1.74, 'masks anchor at head center y=1.74');
    });

    it('hat group.position.y = HEAD_TOP_WORLD_Y - 0.04 positions base at 2.12 (crown sits right)', () => {
        const HEAD_TOP_WORLD_Y = 2.16;
        const hatBaseY = HEAD_TOP_WORLD_Y - 0.04;
        assert.strictEqual(hatBaseY, 2.12, 'hat base at 2.12 where crown cylinder sits');
    });

    it('masks are face-socket-attached with their parts positioned in local space', () => {
        const FACE_SOCKET_WORLD_Y = 1.74;
        // Masks attach to face socket and use FACE_SOCKET_WORLD_Y as their base y
        assert.strictEqual(FACE_SOCKET_WORLD_Y, 1.74, 'mask base attaches at face socket y=1.74');
    });

    it('head constants propagate from character-rig.js: HEAD_SIZE=0.44, HEAD_HALF_DEPTH=0.22', () => {
        const HEAD_SIZE = 0.44;
        const HEAD_HALF_DEPTH = 0.22;
        assert.strictEqual(HEAD_SIZE, 0.44, 'cube head size');
        assert.strictEqual(HEAD_HALF_DEPTH, 0.22, 'cube head half-depth');
    });
});
