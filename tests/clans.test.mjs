// Server clans: create / join by tag / leave (owner hand-off, disband), a clan
// chat, the top list, and clan matches recorded from settled lobby matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { ClanClient } from '../js/clan-client.js';
import { readAppSource } from './app-source.mjs';

const require = createRequire(import.meta.url);
const { ClanStore, CLAN_LIMITS } = require('../server/clan-store.js');
const { MatchAuthority } = require('../server/match-authority.js');
const { ProfileStore } = require('../server/profile-store.js');

const profile = (id, name = id) => ({ id, playerName: name });

function tempFile(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-clans-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'clans.json');
}

test('create, join by tag, leave: validation, uniqueness, owner hand-off, disband', t => {
    let now = 1000;
    const store = new ClanStore(tempFile(t), { now: () => now++ });
    const [ada, bora, cem] = [profile('a', 'Ada'), profile('b', 'Bora'), profile('c', 'Cem')];
    assert.equal(store.create(ada, { name: 'x', tag: 'OK' }).code, 'bad_name');
    assert.equal(store.create(ada, { name: 'Valid Name', tag: 'x' }).code, 'bad_tag');
    const made = store.create(ada, { name: 'Kanka Ekip', tag: 'knk' });
    assert.equal(made.status, 200);
    assert.equal(made.clan.tag, 'KNK');
    assert.equal(store.create(ada, { name: 'Other', tag: 'OTH' }).code, 'in_clan');
    assert.equal(store.create(bora, { name: 'kanka ekip', tag: 'ZZZ' }).code, 'name_taken');
    assert.equal(store.create(bora, { name: 'Other', tag: 'KNK' }).code, 'tag_taken');
    assert.equal(store.join(bora, { tag: 'nope' }).code, 'not_found');
    assert.equal(store.join(bora, { tag: 'knk' }).status, 200);
    store.join(cem, { tag: 'KNK' });
    assert.deepEqual(store.mine(bora).members.map(m => [m.name, m.role, m.you]), [['Ada', 'owner', false], ['Bora', 'member', true], ['Cem', 'member', false]]);
    store.leave(ada);
    assert.equal(store.mine(bora).members.find(m => m.name === 'Bora').role, 'owner', 'the oldest member inherits');
    store.leave(bora);
    store.leave(cem);
    assert.equal(store.mine(cem), null);
    assert.equal(Object.keys(store.clans).length, 0, 'the last one out disbands it');
});

test('clan matches: all winners in one clan, all losers in another; records, recent and top list', t => {
    const store = new ClanStore(tempFile(t), { now: () => 5000 });
    const ids = ['a1', 'a2', 'b1', 'b2', 'solo'];
    store.create(profile('a1'), { name: 'Alpha Team', tag: 'ALP' });
    store.join(profile('a2'), { tag: 'ALP' });
    store.create(profile('b1'), { name: 'Bravo Team', tag: 'BRV' });
    store.join(profile('b2'), { tag: 'BRV' });
    assert.deepEqual(store.recordClanMatch(['a1', 'a2'], ['b1', 'b2']), { winner: 'ALP', loser: 'BRV' });
    assert.equal(store.recordClanMatch(['a1', 'solo'], ['b1']), null, 'a clanless winner: not a clan match');
    assert.equal(store.recordClanMatch(['a1'], ['a2']), null, 'same clan: not a clan match');
    assert.equal(store.recordClanMatch(['a1'], []), null);
    assert.deepEqual(store.mine(profile('a1')).record, { matches: 1, wins: 1, losses: 0 });
    assert.deepEqual(store.mine(profile('b2')).recent, [{ vs: 'ALP', won: false, at: 5000 }]);
    assert.deepEqual(store.top().map(c => [c.rank, c.tag, c.wins, c.losses]), [[1, 'ALP', 1, 0], [2, 'BRV', 0, 1]]);
    assert.ok(ids.length);
});

test('clan chat: members only, cleaned, rate limited; everything survives a restart', t => {
    const file = tempFile(t);
    let now = 10_000;
    const store = new ClanStore(file, { now: () => now });
    store.create(profile('a', 'Ada'), { name: 'Chat Crew', tag: 'CHT' });
    assert.equal(store.post(profile('x'), 'hi').code, 'not_in_clan');
    assert.equal(store.post(profile('a', 'Ada'), 'selam‮ ekip').status, 200);
    assert.equal(store.post(profile('a', 'Ada'), 'spam').code, 'rate_limited');
    now += 1500;
    store.post(profile('a', 'Ada'), 'ikinci');
    assert.deepEqual(store.chat(profile('a'), 0).messages.map(m => m.text), ['selam ekip', 'ikinci']);
    assert.deepEqual(store.chat(profile('a'), 1).messages.map(m => m.text), ['ikinci']);
    const reloaded = new ClanStore(file, { now: () => now });
    assert.equal(reloaded.mine(profile('a')).tag, 'CHT');
    assert.equal(reloaded.chat(profile('a'), 0).messages.length, 2);
    assert.ok(CLAN_LIMITS.members >= 2);
});

test('a settled casual lobby match between two clans is recorded and reported to both players', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-clanmatch-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let now = 1_000_000;
    const profiles = new ProfileStore(path.join(dir, 'p.json'));
    const a = profiles.authenticate(profiles.session('', 'A').token);
    const b = profiles.authenticate(profiles.session('', 'B').token);
    const clans = new ClanStore(path.join(dir, 'clans.json'));
    clans.create(a, { name: 'Alpha Team', tag: 'ALP' });
    clans.create(b, { name: 'Bravo Team', tag: 'BRV' });
    const lobbies = new Map([['casual', { ranked: false, memberProfileIds: new Set([a.id, b.id]) }]]);
    const authority = new MatchAuthority(profiles, { getLobby: code => lobbies.get(code), now: () => now, minDurationMs: 100, clans });
    const matchId = 'clan-match-0000000000000001';
    authority.start(a, { matchId, mode: 'casual', lobbyCode: 'casual' });
    authority.start(b, { matchId, mode: 'casual', lobbyCode: 'casual' });
    now += 200;
    authority.complete(a, { matchId, mode: 'casual', lobbyCode: 'casual', result: 'win' });
    const done = authority.complete(b, { matchId, mode: 'casual', lobbyCode: 'casual', result: 'loss' });
    assert.equal(done.httpStatus, 200);
    assert.deepEqual(done.completion.clanMatch, { winner: 'ALP', loser: 'BRV' });
    assert.deepEqual(clans.top().map(c => c.tag), ['ALP', 'BRV']);
});

test('client: token-less calls stop early; wiring shows the clans screen from Community', async () => {
    const client = new ClanClient({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }), getToken: () => '' });
    assert.deepEqual(await client.mine(), { ok: false, code: 'sign_in_required' });
    const calls = [];
    const open = new ClanClient({ fetchImpl: async (url, init) => { calls.push([url, init.method, init.headers.Authorization]); return { ok: true, json: async () => ({ clans: [] }) }; }, getToken: () => 'tok' });
    await open.top();
    await open.create('Name', 'TAG');
    assert.deepEqual(calls, [['/api/clans/top', 'GET', undefined], ['/api/clans/create', 'POST', 'Bearer tok']]);
    const main = readAppSource();
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    assert.match(html, /<button id="btn-open-clans"/);
    assert.match(main, /bind\('btn-open-clans', \(\) => \{\s+this\.ui\.showScreen\('social'\);/);
    assert.match(main, /row\.textContent = `\$\{message\.author\}: \$\{this\._chatClean\(message\.text\)\}`;/);
    assert.match(server, /new MatchAuthority\(profiles, \{ getLobby: code => lobbies\.get\(code\) \|\| null, clans \}\)/);
    assert.doesNotMatch(html, /Local social preview/);
});
