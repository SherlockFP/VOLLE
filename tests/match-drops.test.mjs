// CS:GO-style match drops: per-player rolls, the extra card roll, and a feed that
// tells the whole lobby who got what (ids only on the wire, host-stamped names).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { BONUS_CARD_CHANCE, shouldAwardBonusCard } from '../js/cards.js';
import { DropFeed, packDrops, resolveDrop, MAX_DROPS_PER_PLAYER } from '../js/drop-feed.js';

const require = createRequire(import.meta.url);
const serverCards = require('../server/card-catalog.js');
const { ProfileStore } = require('../server/profile-store.js');

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-drops-'));
    return { dir, store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

// Just enough DOM for the feed: elements, ids, children, classes, text.
function fakeDocument() {
    const byId = new Map();
    const make = tag => {
        const el = {
            tagName: tag, children: [], parent: null, className: '', textContent: '', hidden: false, attrs: {},
            classList: { add(name) { el.className = `${el.className} ${name}`.trim(); } },
            set id(value) { el._id = value; byId.set(value, el); }, get id() { return el._id; },
            setAttribute(k, v) { el.attrs[k] = v; },
            append(...nodes) { nodes.forEach(n => el.appendChild(n)); },
            appendChild(node) { node.parent = el; el.children.push(node); return node; },
            remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); el.parent = null; },
            replaceChildren() { el.children = []; },
            get firstElementChild() { return el.children[0]; },
            text() { return [el.textContent, ...el.children.map(c => c.text())].filter(Boolean).join(' '); }
        };
        return el;
    };
    const body = make('body');
    return { body, createElement: make, getElementById: id => byId.get(id) || null, make };
}

test('rolls are per player: one lobby, one match id, different drops', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const players = Array.from({ length: 4 }, (_, i) => store.authenticate(store.session('', `P${i}`).token));
    let differed = false;
    for (let m = 0; m < 12 && !differed; m++) {
        const results = players.map(p => store.reward(p, { matchId: `lobby-match-${m}`, won: true }));
        const keys = results.map(r => `${r.earnedCase}|${r.cardReward?.card?.id}|${r.bonusCard?.card?.id}`);
        differed = new Set(keys).size > 1;
    }
    assert.equal(differed, true, 'a shared matchId seed used to hand the whole lobby the same drop');
});

test('the extra card: an independent ~20% roll, granted, receipted and replay-stable', t => {
    assert.equal(BONUS_CARD_CHANCE, 0.2);
    assert.equal(serverCards.BONUS_CARD_CHANCE, BONUS_CARD_CHANCE);
    let hits = 0;
    for (let i = 0; i < 4000; i++) {
        const seed = `m-${i}:acct`;
        assert.equal(shouldAwardBonusCard(seed), serverCards.shouldAwardBonusCard(seed), 'client and server agree');
        if (shouldAwardBonusCard(seed)) hits++;
    }
    assert.ok(hits > 4000 * 0.17 && hits < 4000 * 0.23, `bonus rate ${hits / 4000}`);

    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = store.authenticate(store.session('', 'Lucky').token);
    let found = null;
    for (let i = 0; i < 60 && !found; i++) {
        const matchId = `bonus-hunt-${i}`;
        const before = { ...profile.cardCollection };
        const result = store.reward(profile, { matchId, won: false });
        if (result.bonusCard) found = { matchId, result, before };
    }
    assert.ok(found, 'some match in 60 rolls the extra card');
    const { card } = found.result.bonusCard;
    const main = found.result.cardReward?.card?.id === card.id ? 1 : 0;
    assert.equal(profile.cardCollection[card.id], (found.before[card.id] || 0) + 1 + main, 'the extra card lands in the collection');
    const replay = store.reward(profile, { matchId: found.matchId, won: false });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.bonusCard, found.result.bonusCard, 'a retry reports the same extra card, never a new one');
});

test('the feed only names real catalog items; ids travel, text never does', () => {
    assert.equal(resolveDrop({ type: 'card', id: 'glacier-lock' }).rarity, 'rare');
    assert.equal(resolveDrop({ type: 'case', id: 'kickoff' }).name, 'Kickoff Case');
    assert.equal(resolveDrop({ type: 'card', id: '<img src=x>' }), null);
    assert.equal(resolveDrop({ type: 'knife', id: 'kickoff' }), null);
    const packed = packDrops([
        { type: 'card', id: 'apex-smash', name: 'FAKE LEGENDARY', bonus: true },
        { type: 'case', id: 'chroma', name: '<b>x</b>' },
        { type: 'card', id: 'nope' },
        ...Array.from({ length: 9 }, () => ({ type: 'card', id: 'vital-core' }))
    ]);
    assert.deepEqual(packed[0], { type: 'card', id: 'apex-smash', bonus: true });
    assert.deepEqual(packed[1], { type: 'case', id: 'chroma' });
    assert.equal(packed.length, MAX_DROPS_PER_PLAYER);
    assert.ok(packed.every(drop => !('name' in drop)));
});

test('your drops show on the right, others on the left; the report lists who got what', () => {
    const doc = fakeDocument();
    const wrap = doc.make('section'); wrap.id = 'pg-drop-log'; wrap.hidden = true;
    const list = doc.make('ol'); list.id = 'pg-drop-log-list';
    const heard = [];
    const feed = new DropFeed(doc, { onDrop: entry => heard.push(entry.self) });
    feed.bindLog('match-1');
    assert.equal(feed.announce({ matchId: 'match-1', playerKey: 'me', name: 'Kaan', self: true, drops: [{ type: 'card', id: 'rift-step', bonus: true }] }), 1);
    assert.equal(feed.announce({ matchId: 'match-1', playerKey: 'p2', name: 'Deniz', drops: [{ type: 'case', id: 'kickoff' }, { type: 'card', id: 'vital-core' }] }), 2);
    assert.equal(feed.announce({ matchId: 'match-1', playerKey: 'p2', name: 'Deniz', drops: [{ type: 'case', id: 'kickoff' }] }), 0, 'relay echo / retry');
    assert.equal(feed.announce({ matchId: 'match-1', playerKey: 'p3', name: 'Bot', drops: [{ type: 'card', id: 'fake' }] }), 0);
    const right = doc.getElementById('drop-feed-self');
    const left = doc.getElementById('drop-feed-others');
    assert.match(right.className, /drop-feed-right/);
    assert.match(left.className, /drop-feed-left/);
    assert.equal(right.children.length, 1);
    assert.equal(left.children.length, 2);
    assert.match(right.children[0].text(), /You received: Rift Step epic · Arena card · Extra drop/);
    assert.match(left.children[0].text(), /Deniz has received: Kickoff Case Case/);
    assert.match(left.children[1].className, /rarity-common/);
    assert.deepEqual(heard, [true, false]);
    assert.equal(wrap.hidden, false);
    assert.deepEqual(list.children.map(row => [row.className, row.children[0].textContent, row.children[1].children.length]),
        [['pg-drop-row is-self', 'Kaan', 1], ['pg-drop-row', 'Deniz', 2]]);
    feed.bindLog('match-2');
    assert.equal(wrap.hidden, true, 'a new match starts with an empty report');
});

test('wiring: the host stamps the sender, clients trust only the host, main announces fresh drops', () => {
    const network = readFileSync(new URL('../js/network.js', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(network, /const trusted = \{ type: 'matchDrops', matchId: data\.matchId, playerId, name: player\.name, drops \};/);
    assert.match(network, /if \(!player \|\| data\.matchId !== this\.game\.matchId\) break;/);
    assert.match(network, /\} else if \(peerId === this\.hostConn\?\.peer && data\.playerId !== this\.playerId\) \{/);
    assert.match(main, /this\._announceMatchDrops\?\.\(matchId, matchDrops\);/);
    assert.match(main, /\[\{ reward: cardReward, bonus: false \}, \{ reward: bonusCard, bonus: true \}\]/);
    assert.match(main, /this\.dropFeed\?\.bindLog\?\.\(this\.game\.matchId\);/);
    assert.match(html, /<section id="pg-drop-log" class="pg-drop-log"[^>]*hidden/);
});
