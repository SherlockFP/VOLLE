// In-match team switch (M menu) — rules, Game wiring and key ownership.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    TEAM_MENU_KEYS, autoAssignTeam, botRebalanceMoves, canOpenTeamMenu, effectiveTeam, teamCounts, teamSwitchMode
} from '../js/team-switch.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hudCss = readFileSync(new URL('../css/hud.css', import.meta.url), 'utf8');
const en = readFileSync(new URL('../js/locales/en.js', import.meta.url), 'utf8');
const tr = readFileSync(new URL('../js/locales/tr.js', import.meta.url), 'utf8');

test('switch mode: instant before the first round, next round once live, blocked after the match / in FFA', () => {
    assert.equal(teamSwitchMode('LOBBY'), 'instant');
    assert.equal(teamSwitchMode('COUNTDOWN'), 'instant');
    for (const state of ['PLAYING', 'ROUND_END', 'PAUSED']) assert.equal(teamSwitchMode(state), 'nextRound');
    for (const state of ['CELEBRATION', 'GAME_OVER', 'SOCIAL_HUB']) assert.equal(teamSwitchMode(state), 'blocked');
    assert.equal(teamSwitchMode('PLAYING', { ffa: true }), 'blocked');
    assert.equal(canOpenTeamMenu('ROUND_END'), true);
    assert.equal(canOpenTeamMenu('CELEBRATION'), false);
    assert.equal(canOpenTeamMenu('PLAYING', { ffa: true }), false);
});

test('roster helpers: queued and next-round picks count on their destination side', () => {
    const roster = [
        { name: 'You', team: 'red', nextRoundTeam: 'blue' },
        { name: 'Late', team: 'red', queuedForNextRound: true, pendingTeam: 'blue' },
        { name: 'B1', team: 'blue', isBot: true },
        { name: 'B2', team: 'red', isBot: true }
    ];
    assert.equal(effectiveTeam(roster[0]), 'blue');
    assert.equal(effectiveTeam(roster[1]), 'blue');
    assert.deepEqual(teamCounts(roster), { red: 1, blue: 3 });
    assert.deepEqual(botRebalanceMoves(roster), [{ name: 'B1', team: 'red' }]);
    assert.deepEqual(botRebalanceMoves([{ name: 'P', team: 'blue' }, { name: 'H', team: 'blue' }]), [], 'humans never move');
    assert.equal(autoAssignTeam([{ name: 'P', team: 'red' }, { name: 'B', team: 'blue', isBot: true }], 'P', 'red'), 'red');
    assert.equal(autoAssignTeam([{ name: 'P', team: 'red' }, { name: 'B', team: 'red', isBot: true }], 'P', 'red'), 'blue');
});

function fakeGame(state, extra = {}) {
    const calls = { messages: [], sent: [], respawn: 0, rendered: 0 };
    const scoreboard = { players: new Map([['You', { team: 'red', deflections: 4 }], ['Bot-1', { team: 'blue', deflections: 1 }]]), addPlayer() {} };
    const bot = { name: 'Bot-1', team: 'blue', setTeam(team) { this.team = team; } };
    const game = {
        state, playerName: 'You', scoreboard, bots: [bot], remotePlayers: new Map(), network: null,
        player: { team: 'red', nextRoundTeam: null, setTeam(team) { this.team = team; }, respawn() { calls.respawn++; } },
        ui: { showMessage: text => calls.messages.push(text), isTeamPopupOpen: () => true, _renderTeamLists: () => { calls.rendered++; } },
        getCourtConfinementSide: team => (team === 'red' ? -1 : 1),
        getPlayerList() {
            return [{ name: 'You', team: this.player.team, nextRoundTeam: this.player.nextRoundTeam },
                ...this.bots.map(b => ({ name: b.name, team: b.team, isBot: true }))];
        },
        updateLobbyUI() {},
        ...extra
    };
    const globals = {
        STATES: { LOBBY: 'LOBBY', MENU: 'MENU', COUNTDOWN: 'COUNTDOWN', PLAYING: 'PLAYING' },
        t: (key, params) => (params?.team ? `${key}:${params.team}` : key),
        isTeam: team => team === 'red' || team === 'blue',
        teamSwitchMode, botRebalanceMoves
    };
    globals.activateQueuedEntity = entity => {
        if (!entity?.queuedForNextRound) return false;
        entity.team = entity.pendingTeam === 'blue' || entity.pendingTeam === 'red' ? entity.pendingTeam : entity.team;
        entity.queuedForNextRound = false;
        entity.pendingTeam = null;
        return true;
    };
    for (const name of ['switchTeam', '_teamSwitchModeNow', '_setLocalTeam', '_moveScoreboardEntry', '_rebalanceBots',
        '_syncLocalTeamChange', '_refreshTeamMenu', '_applyNextRoundTeams', '_placeRemoteAtSpawn',
        '_inLobbyTeamState', '_settleLobbyTeams', 'switchPlayerTeam', 'selectQueuedLocalTeam']) {
        game[name] = compileGameMethod(name, globals);
    }
    return { game, calls, bot };
}

test('mid-round pick is queued (no teleport, stats kept), applied with a respawn + bot rebalance at round start', () => {
    const { game, calls, bot } = fakeGame('PLAYING');
    assert.equal(game.switchTeam('blue'), 'nextRound');
    assert.equal(game.player.team, 'red', 'no mid-rally side change');
    assert.equal(game.player.nextRoundTeam, 'blue');
    assert.equal(calls.respawn, 0);
    assert.deepEqual(calls.messages, ['toast.teamNextRound:hud.blueCaps']);
    assert.equal(game.switchTeam('blue'), false, 'same pick again is a no-op');
    assert.equal(game.switchTeam('red'), 'cancelled', 'picking your side again cancels');
    assert.equal(game.player.nextRoundTeam, null);
    game.switchTeam('blue');
    assert.equal(game._applyNextRoundTeams(), true);
    assert.equal(game.player.team, 'blue');
    assert.equal(game.player.nextRoundTeam, null);
    assert.equal(calls.respawn, 1, 'respawned on the new half');
    assert.deepEqual(game.scoreboard.players.get('You'), { team: 'blue', deflections: 4 }, 'stats survive the move');
    assert.equal(bot.team, 'red', 'the bot fills the side you left');
    assert.equal(game.scoreboard.players.get('Bot-1').team, 'red');
});

test('countdown pick is instant with a respawn; celebration / FFA refuse', () => {
    const { game, calls, bot } = fakeGame('COUNTDOWN');
    assert.equal(game.switchTeam('blue'), 'instant');
    assert.equal(game.player.team, 'blue');
    assert.equal(game.player.courtSide, 1);
    assert.equal(calls.respawn, 1);
    assert.equal(bot.team, 'red');
    assert.equal(fakeGame('CELEBRATION').game.switchTeam('blue'), false);
    assert.equal(fakeGame('PLAYING', { _ffa: true }).game.switchTeam('blue'), false);
});

test('client sends its request; host rebroadcasts; lobby switch stays instant without respawn', () => {
    const sent = [];
    const { game } = fakeGame('PLAYING', { network: { connected: true, isHost: false, send: msg => sent.push(msg) } });
    game.switchTeam('blue');
    assert.equal(JSON.stringify(sent), JSON.stringify([{ type: 'teamChange', name: 'You', team: 'blue' }]));
    const lobby = fakeGame('LOBBY');
    assert.equal(lobby.game.switchTeam('blue'), 'instant');
    assert.equal(lobby.calls.respawn, 0);
    assert.equal(lobby.game.player.team, 'blue');
    assert.equal(lobby.bot.team, 'red', 'lobby: the bot fills the side you left (no 2v0 waiting on Start)');
    assert.equal(lobby.game.switchTeam('red'), 'instant', 'and straight back, instantly');
    assert.equal(lobby.game.player.team, 'red');
});

test('lobby: a stale late-join queue never turns a pick into "next round" (host, client, solo)', () => {
    // Local player who late-joined the last match and came back to the lobby.
    const solo = fakeGame('LOBBY');
    Object.assign(solo.game.player, { queuedForNextRound: true, pendingTeam: 'red' });
    assert.equal(solo.game.switchTeam('blue'), 'instant');
    assert.equal(solo.game.player.team, 'blue');
    assert.equal(solo.game.player.queuedForNextRound, false);
    assert.equal(solo.calls.messages.some(text => /teamNextRound/.test(text)), false);

    // Client in the lobby (state MENU on clients): instant locally + request to host.
    const sent = [];
    const client = fakeGame('MENU', { network: { connected: true, isHost: false, send: msg => sent.push(msg) } });
    Object.assign(client.game.player, { queuedForNextRound: true, pendingTeam: 'red' });
    assert.equal(client.game.switchTeam('blue'), 'instant');
    assert.equal(JSON.stringify(sent), JSON.stringify([{ type: 'teamChange', name: 'You', team: 'blue' }]));

    // Host applying a client's request for a remote that is still flagged queued.
    const host = fakeGame('LOBBY', { network: { connected: true, isHost: true, broadcast() {} } });
    const remote = { name: 'Friend', team: 'red', queuedForNextRound: true, pendingTeam: 'red', peerId: 'p', setTeam(team) { this.team = team; } };
    host.game.remotePlayers.set('friend', remote);
    host.game.scoreboard.players.set('Friend', { team: 'red' });
    host.game.getPlayerList = function () {
        return [{ name: 'You', team: this.player.team }, { name: 'Friend', team: remote.team },
            ...this.bots.map(b => ({ name: b.name, team: b.team, isBot: true }))];
    };
    host.game.switchPlayerTeam('Friend', 'blue');
    assert.equal(remote.team, 'blue');
    assert.equal(remote.queuedForNextRound, false);
    assert.equal(host.game.scoreboard.players.get('Friend').team, 'blue');

    // Entering the lobby settles every queued late joiner onto their picked side.
    const settle = fakeGame('LOBBY', { network: { connected: true, isHost: true } });
    const late = { name: 'Late', team: 'red', queuedForNextRound: true, pendingTeam: 'blue', nextRoundTeam: 'red' };
    settle.game.remotePlayers.set('late', late);
    settle.game.scoreboard.players.set('Late', { team: 'red', queuedForNextRound: true, pendingTeam: 'blue' });
    settle.game._settleLobbyTeams();
    assert.deepEqual([late.team, late.queuedForNextRound, late.nextRoundTeam], ['blue', false, null]);
    assert.deepEqual(settle.game.scoreboard.players.get('Late'), { team: 'blue', queuedForNextRound: false, pendingTeam: null });
});

test('lobby wiring: entering LOBBY settles teams; host applies lobby requests instantly; columns click-to-join', () => {
    assert.match(extractGameMethod('setState'), /if \(\(s === STATES\.LOBBY \|\| s === STATES\.MENU\) && prev !== s\) this\._settleLobbyTeams\(\);/);
    assert.match(mainSource, /if \(p\?\.queuedForNextRound && this\.game\.state !== STATES\.LOBBY\) \{/);
    assert.match(mainSource, /col\.addEventListener\('click', e => \{[\s\S]*?this\.game\.switchTeam\(team\);/);
    assert.match(mainSource, /this\.network\?\.send\?\.\(\{ type: 'teamChange', name, team: targetTeam \}\);\s*this\.broadcastLobbyState\(\);/);
});

test('Game wiring: round start applies picks (host/solo), roster carries nextRoundTeam, menu closes after the match', () => {
    assert.match(extractGameMethod('startRound'), /this\.activateQueuedPlayers\(\);\s+if \(!fromNetwork && \(!this\.network\?\.connected \|\| this\.network\.isHost\)\) this\._applyNextRoundTeams\(\);/);
    assert.match(extractGameMethod('getPlayerList'), /nextRoundTeam: isTeam\(this\.player\.nextRoundTeam\)/);
    assert.match(extractGameMethod('applyLobbyState'), /this\.player\.nextRoundTeam = isTeam\(pl\.nextRoundTeam\)/);
    assert.match(extractGameMethod('startRoundFromNetwork'), /if \(movedTeam && !this\.localSpectator\) \{\s+this\.player\.respawn\(\);/);
    assert.match(extractGameMethod('setState'), /s === STATES\.CELEBRATION \|\| s === STATES\.GAME_OVER[^\n]*\n[^\n]*nextRoundTeam = null;\s+if \(this\.ui\?\.isTeamPopupOpen\?\.\(\)\) this\.ui\.hideTeamPopup\?\.\(\);/);
    assert.doesNotMatch(extractGameMethod('switchTeam'), /Switched to \$\{/, 'toast is localized');
    assert.doesNotMatch(extractGameMethod('switchPlayerTeam'), /scoreboard\.removePlayer/, 'stats are not wiped');
});

test('main.js: menu owns its keys, M ignores key repeat, Esc and confirm re-lock the pointer', () => {
    assert.deepEqual([...TEAM_MENU_KEYS].sort(), ['ArrowLeft', 'ArrowRight', 'Digit1', 'Digit2', 'Enter', 'Numpad1', 'Numpad2', 'NumpadEnter', 'Space', 'Tab'].sort());
    const bail = mainSource.indexOf("if (this.ui.isTeamPopupOpen?.() && TEAM_MENU_KEYS.includes(e.code)) return;");
    const chat = mainSource.indexOf("if ((e.code === 'KeyY' || e.code === 'KeyT' || (e.code === 'Enter'");
    const tab = mainSource.indexOf("if (e.code === 'Tab' && [STATES.PLAYING");
    assert.ok(bail > 0 && bail < chat && bail < tab, 'bail-out runs before chat (Enter) and scoreboard (Tab)');
    assert.match(mainSource, /if \(!e\.repeat\) this\.toggleTeamPopup\(\);/);
    assert.match(mainSource, /if \(this\.ui\.isTeamPopupOpen\(\)\) \{ this\.closeTeamPopup\(\); return; \}/);
    const close = mainSource.slice(mainSource.indexOf('    closeTeamPopup() {'), mainSource.indexOf('    _confirmTeamSelection(team) {'));
    assert.match(close, /this\.player\.lock\(\);/);
    const confirm = mainSource.slice(mainSource.indexOf('    _confirmTeamSelection(team) {'), mainSource.indexOf('    _handlePlayerSafety('));
    assert.match(confirm, /result === 'instant' \|\| result === 'nextRound' \|\| result === 'cancelled'\) this\.closeTeamPopup\(\);/);
    assert.doesNotMatch(confirm, /toast\.selectedTeam/, 'one toast per switch');
});

test('ui.js / markup / locales: localized badges, next-round rule, focus handling, EN/TR parity', () => {
    assert.match(uiSource, /col\.dataset\.currentLabel = t\('team\.current'\);/);
    assert.match(hudCss, /content: attr\(data-current-label\);/);
    assert.doesNotMatch(hudCss, /content: 'YOUR TEAM'/);
    assert.match(html, /<p class="team-switch-rule" id="team-switch-rule" role="status" aria-live="polite" hidden><\/p>/);
    assert.match(uiSource, /this\._focusTeamDoor\(this\.selectedTeam\);/);
    assert.match(uiSource, /confirm\.onclick = \(\) => \{ if \(!confirm\.disabled\) this\.onTeamConfirm\?\.\(target\); \};/);
    for (const key of ['current', 'stayOn', 'joinNextRound', 'queuedFor', 'nextRoundRule', 'pendingNote', 'botBalance', 'unavailable', 'classUsed', 'classOnce']) {
        assert.match(en, new RegExp(`\\n        ${key}: '`), `en team.${key}`);
        assert.match(tr, new RegExp(`\\n        ${key}: '`), `tr team.${key}`);
    }
    for (const key of ['switchedTeam', 'teamNextRound', 'teamSwitchCancelled', 'botsRebalanced']) {
        assert.match(en, new RegExp(`\\n        ${key}: '`), `en toast.${key}`);
        assert.match(tr, new RegExp(`\\n        ${key}: '`), `tr toast.${key}`);
    }
});
