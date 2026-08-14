import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
    SPORT_IDS,
    canHostSport,
    lobbySportId,
    normalizeSportId,
    resolveSportRoute,
    sportDefinition
} from '../js/sports.js';

const require = createRequire(import.meta.url);
const { normalizeLobbySportPayload } = require('../server.js');

test('legacy rooms and unknown sport input normalize to Dodgeball', () => {
    assert.equal(normalizeSportId(), SPORT_IDS.DODGEBALL);
    assert.equal(lobbySportId({ mode: 'Classic' }), SPORT_IDS.DODGEBALL);
    assert.equal(normalizeSportId('hostile-value'), SPORT_IDS.DODGEBALL);
});

test('Volleyball V1 is one bounded court route and cannot host yet', () => {
    const route = resolveSportRoute({
        sportId: SPORT_IDS.VOLLEYBALL,
        rulesetId: 'not-allowed',
        mapId: 'industrial'
    });
    assert.deepEqual(route, {
        sportId: 'volleyball',
        rulesetId: 'volleyball_rally_v1',
        mapId: 'beach_open',
        maxPlayers: 8,
        hostEnabled: false
    });
    assert.equal(canHostSport('volleyball'), false);
    assert.equal(sportDefinition('volleyball').status, 'IN DEVELOPMENT');
});

test('server allowlists sport routes and retains legacy Dodgeball compatibility', () => {
    assert.deepEqual(normalizeLobbySportPayload({ mode: 'Classic', map: 'Beach Arena' }), {
        sportId: 'dodgeball', rulesetId: 'classic', mapId: 'beach_open', maxPlayers: 8
    });
    assert.deepEqual(normalizeLobbySportPayload({
        sportId: 'volleyball', rulesetId: 'volleyball_rally_v1', mapId: 'beach_open', maxPlayers: 16
    }), {
        sportId: 'volleyball', rulesetId: 'volleyball_rally_v1', mapId: 'beach_open', maxPlayers: 8
    });
    assert.equal(normalizeLobbySportPayload({ sportId: 'volleyball', rulesetId: 'classic', mapId: 'beach_open' }), null);
    assert.equal(normalizeLobbySportPayload({ sportId: 'volleyball', rulesetId: 'volleyball_rally_v1', mapId: 'industrial' }), null);
    assert.equal(normalizeLobbySportPayload({ sportId: 'unknown' }), null);
});

test('Quick Play routes through sport selection and feature-gates Volleyball hosting', async () => {
    const [html, main, server, css] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../js/main.js', import.meta.url), 'utf8'),
        readFile(new URL('../server.js', import.meta.url), 'utf8'),
        readFile(new URL('../css/polish.css', import.meta.url), 'utf8')
    ]);
    assert.match(html, /id="sport-select-stage"[^>]*tabindex="-1"/);
    assert.match(html, /<button[^>]*type="button"[^>]*data-sport-select="dodgeball"/);
    assert.match(html, /<button[^>]*type="button"[^>]*data-sport-select="volleyball"/);
    const dodgeballCard = html.indexOf('data-sport-select="dodgeball"');
    const volleyballCard = html.indexOf('data-sport-select="volleyball"');
    const back = html.indexOf('id="btn-sport-back"');
    assert.ok(dodgeballCard < volleyballCard && volleyballCard < back,
        'native button DOM order must be Dodgeball, Volleyball, then Back for Tab/Enter/Space');
    assert.match(html, /class="mp-layout hidden" inert aria-hidden="true"/);
    assert.match(html, /id="cs-lobby-sport"/);
    assert.match(main, /this\._showSportSelect\(\);/);
    assert.match(main, /if \(stage\) stage\.inert = false/);
    assert.match(main, /if \(browser\) browser\.inert = true/);
    assert.match(main, /stage\?\.focus\(\{ preventScroll: true \}\)/,
        'focus starts on the non-tabbable heading surface so the first Tab reaches Dodgeball');
    assert.match(main, /if \(stage\) stage\.inert = true/);
    assert.match(main, /if \(browser\) browser\.inert = false/);
    for (const id of ['btn-mp-quick', 'btn-mp-create', 'btn-mp-host-strip', 'btn-mp-solo', 'btn-mp-join', 'btn-mp-refresh', 'btn-mp-party-follow']) {
        assert.match(main, new RegExp(`'${id}'`), `${id} must participate in the Volleyball directory gate`);
    }
    for (const id of ['mp-lobby-mode-filter', 'mp-lobby-map-filter', 'mp-lobby-queue-filter', 'mp-lobby-open-filter']) {
        assert.match(main, new RegExp(`getElementById\\('${id}'\\)`), `${id} must be disabled for gated Volleyball`);
    }
    assert.match(main, /directory\.inert = !hostEnabled/);
    assert.match(main, /const sportGated = id === 'btn-mp-party-follow' && !canHostSport\(this\._selectedSportId\);[\s\S]*?action\.disabled = sportGated \|\| this\._partyFollowInFlight;[\s\S]*?action\.inert = sportGated;/,
        'party rendering must not reopen the gated Volleyball follow action');
    assert.match(main, /if \(!canHostSport\(this\._selectedSportId\)\) \{[\s\S]*?container\.dataset\.lobbyState = 'sport-gated';[\s\S]*?return;/,
        'a gated sport must render zero lobby cards without requesting the directory');
    assert.match(css, /#multiplayer-menu \.sport-select-stage \{\s*box-sizing: border-box;/,
        'desktop height must include the stage padding instead of overflowing by it');
    assert.match(css, /@media \(min-width: 981px\) \{[\s\S]*?#multiplayer-menu\[data-sport="volleyball"\] \{\s*padding: 12px;\s*overflow: hidden;/,
        'the gated desktop route must own a fixed 12px viewport inset without document scroll');
    assert.match(css, /#multiplayer-menu\[data-sport="volleyball"\] \.mp-layout \{\s*height: calc\(100dvh - 24px\);\s*min-height: 0;\s*max-height: calc\(100dvh - 24px\);/,
        'the gated shell plus its 24px outer inset must equal the desktop viewport height');
    assert.match(css, /#multiplayer-menu\[data-sport="volleyball"\] :is\([\s\S]*?\.quick-play-fields,[\s\S]*?\.mp-lobby-filters,[\s\S]*?#btn-mp-refresh[\s\S]*?\) \{ display: none; \}/,
        'disabled directory controls must not consume gated Volleyball height');
    assert.match(css, /#multiplayer-menu\[data-sport="volleyball"\] \.mp-lobby-list\[data-lobby-state="sport-gated"\] \{\s*min-height: 0;\s*margin-bottom: 0;/,
        'the gated status must not inherit the empty-directory height floor');
    assert.match(main, /filterLobbies\(sportLobbies, \{[\s\S]*?sportId: this\._selectedSportId/);
    assert.match(main, /if \(!canHostSport\(this\._selectedSportId\)\)/);
    assert.match(server, /HOSTABLE_LOBBY_SPORTS = new Set\(\['dodgeball'\]\)/);
    assert.match(server, /error: 'lobby sport is locked'/);
});
