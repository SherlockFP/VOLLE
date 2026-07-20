const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CreatorMapStore } = require('../server/creator-map-store');

function config(name = 'Circuit') {
    return {
        version: 1, name,
        dimensions: { width: 80, length: 100, wallHeight: 20, ceilingHeight: 30 },
        colors: { floorRed: '#aa2233', floorBlue: '#2255aa', wall: '#cccccc', sky: '#112233', fog: '#445566' },
        weather: 'indoor',
        flags: { openSides: false, openAir: false, lowGravity: false, slippery: false, portals: false },
        props: []
    };
}

test('creator maps expose aggregate votes but never voter identities', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-maps-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new CreatorMapStore(path.join(dir, 'maps.json'));
    const creator = { id: 'creator_12345678', playerName: 'Creator' };
    const voter = { id: 'voter_12345678', playerName: 'Voter' };
    const published = store.publish(creator, { config: config() });
    const id = published.map.id;
    assert.equal(store.moderate(id, 'approved').status, 200);
    assert.equal(store.vote(creator, id, 1).status, 403);
    const result = store.vote(voter, id, 1);
    assert.equal(result.map.score, 1);
    assert.equal(result.map.viewerVote, 1);
    const listed = store.list({ viewerId: voter.id, sort: 'trending' }).maps[0];
    assert.equal(listed.upvotes, 1);
    assert.equal(JSON.stringify(listed).includes(voter.id), false);
});

test('new creator map revisions reset votes before review', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-maps-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new CreatorMapStore(path.join(dir, 'maps.json'));
    const creator = { id: 'creator_12345678', playerName: 'Creator' };
    const voter = { id: 'voter_12345678', playerName: 'Voter' };
    const first = store.publish(creator, { config: config() }).map;
    store.moderate(first.id, 'approved');
    store.vote(voter, first.id, 1);
    const updated = store.publish(creator, { mapId: first.id, config: config('Circuit II') }).map;
    assert.equal(updated.status, 'pending');
    assert.equal(updated.score, 0);
    assert.equal(updated.upvotes, 0);
});
