import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('party casual quick play is leader-only and reserves every squad slot without touching ranked flow', () => {
    const quick = main.slice(main.indexOf('    async _startQuickPlay() {'), main.indexOf('\n    _esc(', main.indexOf('    async _startQuickPlay() {')));
    assert.match(quick, /const partyQuickPlay = queue === 'casual' && partySize > 1/);
    assert.match(quick, /Only the party leader can start Casual Quick Play/);
    assert.match(quick, /await this\._beginPartyCasualQueue\(party\)/);
    assert.match(quick, /minOpenSlots: partySize/);
    assert.match(quick, /: pickQuickLobby\(lobbies, \{ queue, mode, map, openOnly: true \}\)/);
    assert.match(quick, /if \(partyQuickPlay && joined\) await this\._publishPartyLobbyTarget\(match\.code, party\)/);
    assert.match(quick, /if \(partyQuickPlay\) await this\._publishPartyLobbyTarget\(this\._lobbyCode, party\)/);
});

test('members get one safe auto-follow attempt and explicit fallback actions on every eligible menu', () => {
    const follow = main.slice(main.indexOf('    async _followPartyLobbyTarget'), main.indexOf('\n    _startSocialPolling', main.indexOf('    async _followPartyLobbyTarget')));
    assert.match(main, /PARTY_FOLLOW_SCREENS\.has\(document\.body\.dataset\.screen\)/);
    assert.match(main, /!this\.network\?\.connected/);
    assert.match(follow, /this\._partyFollowAttemptedTarget === key/);
    assert.match(follow, /_quickJoin\(target\.code, \{ partyFollow: true \}\)/);
    assert.match(follow, /party_queue_follow_success/);
    assert.match(follow, /party_queue_follow_failure/);
    assert.doesNotMatch(follow, /\.broadcast\(|\.send\(/, 'party follow must not alter the P2P protocol');
    for (const id of ['btn-menu-party-follow', 'btn-mp-party-follow', 'btn-join-party-follow', 'fbar-party-follow']) {
        assert.match(html, new RegExp(`id="${id}"`));
        assert.match(main, new RegExp(`'${id}'`));
    }
});

test('server target publication is private to the current party, capacity checked, and purged with its lobby', () => {
    assert.match(server, /urlPath === '\/api\/party\/lobby-target' && req\.method === 'GET'/);
    assert.match(server, /urlPath === '\/api\/party\/queue-state' && req\.method === 'POST'/);
    assert.match(server, /occupied \+ Math\.max\(0, partySize - 1\) > lobby\.maxPlayers/);
    assert.match(server, /partyStore\.clearLobbyTargetByCode\(code\)/);
});
