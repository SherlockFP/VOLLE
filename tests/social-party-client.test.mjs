import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FriendsList, normalizeAvailablePlayers, normalizePartySnapshot } from '../js/friends.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');
const friends = fs.readFileSync(new URL('../js/friends.js', import.meta.url), 'utf8');

test('available player normalization is bounded, sanitized and exposes no durable profile id', () => {
    const rows = normalizeAvailablePlayers(Array.from({ length: 25 }, (_, index) => ({
        accountId: `account-${index}`, profileId: `private-profile-${index}`,
        username: `<b>Player ${index}</b>`, state: index === 0 ? 'match' : 'invalid', region: 'EU'
    })));
    assert.equal(rows.length, 20);
    assert.equal('profileId' in rows[0], false);
    assert.equal(rows[0].state, 'match');
    assert.equal(rows[1].state, 'menu');
    assert.equal(rows[0].region, 'eu');
});

test('party snapshot is capped and server leadership remains authoritative', () => {
    const snapshot = normalizePartySnapshot({ party: { partyId: 'party', leaderAccountId: 'leader', maxMembers: 999, revision: 4, memberAccountIds: ['leader', ...Array.from({ length: 12 }, (_, n) => `p${n}`)] }, invites: [] });
    assert.equal(snapshot.party.maxMembers, 8);
    assert.equal(snapshot.party.memberAccountIds.length, 8);
    assert.equal(snapshot.party.leaderAccountId, 'leader');
    assert.match(friends, /isPartyLeader\(accountId/);
    assert.match(main, /Friends\.isPartyLeader\(account\.getAccount\(\)\?\.id\)/);
});

test('older overlapping party refresh cannot overwrite a newer accepted snapshot', async () => {
    const friendsList = new FriendsList();
    const pending = [];
    friendsList._request = () => new Promise(resolve => pending.push(resolve));
    const older = friendsList.refreshParty();
    const newer = friendsList.refreshParty();
    pending[1]({ party: { partyId: 'accepted', leaderAccountId: 'leader', memberAccountIds: ['leader', 'me'], revision: 2 }, invites: [] });
    await newer;
    pending[0]({ party: null, invites: [{ id: 'old-pending', senderAccountId: 'leader', recipientAccountId: 'me', status: 'pending', expiresAt: Date.now() + 30000 }] });
    const stale = await older;
    assert.equal(stale.stale, true);
    assert.equal(friendsList.party.partyId, 'accepted');
    assert.deepEqual(friendsList.partyInvites, []);
});

test('an action invalidates a pre-action party refresh before fetching authoritative state', async () => {
    const friendsList = new FriendsList();
    const gets = [];
    friendsList._request = (path, options = {}) => {
        if (path === '/api/party' && !options.method) return new Promise(resolve => gets.push(resolve));
        return Promise.resolve({ state: 'accepted' });
    };
    const preAction = friendsList.refreshParty();
    const action = friendsList.actOnPartyInvite('invite', 'accept');
    await Promise.resolve();
    assert.equal(gets.length, 2);
    gets[1]({ party: { partyId: 'accepted', leaderAccountId: 'leader', memberAccountIds: ['leader', 'me'], revision: 2 }, invites: [] });
    await action;
    gets[0]({ party: null, invites: [{ id: 'invite', senderAccountId: 'leader', recipientAccountId: 'me', status: 'pending', expiresAt: Date.now() + 30000 }] });
    await preAction;
    assert.equal(friendsList.party.partyId, 'accepted');
});

test('menu social DOM keeps exact eight navigation items and accessible invite controls', () => {
    const menu = html.slice(html.indexOf('<div id="main-menu"'), html.indexOf('<!-- ===== MODE SELECT ====='));
    assert.equal((menu.match(/data-menu-route=/g) || []).length, 8);
    for (const id of ['friends-sidebar', 'fbar-sheet-handle', 'fbar-directory', 'fbar-discoverable', 'fbar-party-members', 'party-invite-dialog', 'party-invite-accept', 'party-invite-decline']) assert.match(menu, new RegExp(`id="${id}"`));
    assert.doesNotMatch(menu, /id="fbar-region"/);
    assert.match(menu, /Worldwide P2P/);
    assert.match(main, /_saveSocialDiscoveryPreferences\(discoverable\?\.checked !== false, 'global'\)/);
    assert.doesNotMatch(main, /region\?\.value/);
    assert.match(menu, /role="alertdialog"/);
    assert.match(menu, /aria-modal="true"/);
    assert.match(menu, /data-fbar-tab="friends"[\s\S]*data-fbar-tab="online"[\s\S]*data-fbar-tab="nearby"/);
});

test('heartbeat and polling support two-window identity, bounded convergence and gameplay invite gate', () => {
    assert.match(main, /instanceId: this\.network\.playerId/);
    assert.match(main, /function presenceStateFor\(screen, gameState\)/);
    assert.match(main, /PARTY_INVITE_BLOCKED_STATES\.has\(this\.game\.state\)/);
    assert.match(main, /setInterval\(poll, 5000\)/);
    assert.match(main, /event\.detail\?\.screen === 'mainMenu'\) this\._socialPollNow\?\.\(\)/);
    assert.match(main, /document\.getElementById\('party-invite-accept'\)\?\.focus\(\)/);
    assert.match(main, /event\.key === 'Tab'/);
    assert.match(main, /copy\.textContent =/);
});

test('logout closes invite UI and countdown before clearing authenticated state', () => {
    const logout = main.slice(main.indexOf('    async _logout() {'), main.indexOf('    _getKnifeStyle('));
    assert.ok(logout.indexOf('this._closePartyInviteDialog();') < logout.indexOf('this._authenticated = false;'));
    assert.match(main, /_closePartyInviteDialog\(\) \{[\s\S]*clearInterval\(this\._partyInviteCountdownTimer\)[\s\S]*this\._presentedPartyInviteId = null/);
});

test('desktop and mobile layout gates are explicit and keep actions touch-safe', () => {
    assert.match(css, /warrball-arena-menu-bg-v1\.webp/);
    assert.match(css, /width: 328px/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.friends-sidebar[\s\S]*bottom: 0/);
    assert.match(css, /\.fbar-tabs button,[\s\S]*min-height: 44px/);
    assert.match(css, /\.party-invite-card button \{ min-height: 48px/);
    assert.match(css, /\.fbar-toggle-btn \{ width: 44px; min-width: 44px; height: 44px/);
    assert.match(css, /\.fbar-worldwide \{ min-height: 44px/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.ow-topbar \{ order: 0; max-height: none;[\s\S]*overflow: visible[\s\S]*\.ow-tabs[\s\S]*justify-content: flex-start[\s\S]*overflow-x: auto[\s\S]*\.ow-showcase \{ order: 1; min-height: 300px; height: 300px; max-height: 330px[\s\S]*\.ow-action-heading \{ display: none[\s\S]*\.ow-play \{ min-height: 64px/);
    assert.match(css, /\.ow-menu \{ height: auto; min-height: calc\(100dvh - 70px\)[^}]*overflow: visible/);
    assert.match(css, /friends-sidebar:not\(\.mobile-open\) \.friends-sidebar-body \{ visibility: hidden; pointer-events: none/);
});

test('collapsed desktop social rail keeps its reopen control inside the visible edge', () => {
    assert.match(css, /\.friends-sidebar\.collapsed \.friends-sidebar-header \{[\s\S]*?padding: 8px 0;[\s\S]*?justify-content: flex-start;/);
    assert.match(main, /desktopToggle\.setAttribute\('aria-label', next \? 'Collapse social panel' : 'Open social panel'\)/);
    assert.match(main, /desktopToggle\.querySelector\('use'\)\?\.setAttribute\('href', next \? '#i-arrow-left' : '#i-arrow-right'\)/);
    assert.match(main, /setDesktopRailExpanded\(sidebar\.classList\.contains\('collapsed'\)\)/);
    assert.match(main, /setDesktopRailExpanded\(compactRailQuery\?\.matches !== true\)/);
});

test('social rail exposes professional async, empty and friend-request states', () => {
    for (const id of ['fbar-sync-state', 'fbar-directory-title', 'fbar-own-tag-code', 'fbar-add-toggle', 'fbar-add-form', 'fbar-add-submit', 'fbar-add-status']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(main, /this\._socialRailSyncing = true;[\s\S]*this\._socialRailError = results\.find/);
    assert.match(main, /className = 'fbar-empty-state'/);
    assert.match(main, /title\.textContent = 'Social is offline'/);
    assert.match(main, /submit\.disabled = true; submit\.textContent = 'Sending'/);
    assert.match(css, /\.fbar-empty-state \{/);
    assert.match(css, /\.fbar-skeleton \{/);
    assert.match(css, /\.fbar-actions button \{[\s\S]*min-width: 44px;[\s\S]*height: 44px;/);
});

test('closed mobile social sheet is inert and restores deterministic focus', () => {
    assert.match(main, /body\.inert = mobile && !expanded/);
    assert.match(main, /body\.setAttribute\('aria-hidden', String\(mobile && !expanded\)\)/);
    assert.match(main, /if \(expanded\) document\.querySelector\('\[data-fbar-tab\]\[aria-selected="true"\]'\)\?\.focus\(\)/);
    assert.match(main, /else handle\.focus\(\)/);
    assert.match(main, /mobileRailQuery\?\.addEventListener\?\.\('change'/);
});

test('App listener lifetime exists before social sidebar init and owns its responsive listener', () => {
    const constructor = main.slice(main.indexOf('    constructor() {'), main.indexOf('    async _beginAuthenticatedBoot()'));
    const controllerAt = constructor.indexOf('this._mainAbort = new AbortController();');
    const friendsInitAt = constructor.indexOf('this.initFriendsSidebar();');
    assert.ok(controllerAt >= 0 && controllerAt < friendsInitAt, 'AbortController must exist before initFriendsSidebar binds listeners');
    assert.equal((constructor.match(/this\._mainAbort = new AbortController\(\);/g) || []).length, 1, 'controller cannot be replaced after listeners bind');
    assert.match(main, /mobileRailQuery\?\.addEventListener\?\.\('change',[\s\S]*?signal: this\._mainAbort\.signal/);
});
