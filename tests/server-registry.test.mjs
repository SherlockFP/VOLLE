import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeLobbyRecord } = require('../server.js');

test('lobby registry normalizes live late-join metadata', () => {
    const record = normalizeLobbyRecord({
        code: 'room',
        active: true,
        allowLateJoin: false,
        players: 4
    }, 123);

    assert.equal(record.active, true);
    assert.equal(record.allowLateJoin, false);
    assert.equal(record.players, 4);
    assert.equal(record.updatedAt, 123);
});
