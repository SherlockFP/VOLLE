// Integration tests for GET /api/leaderboard against the real HTTP server
// (server.js), following the pattern in tests/server-presence-party.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-leaderboard-http-'));
process.env.DATA_DIR = dataDir;
const { server, accounts, __resetLeaderboardCacheForTests } = require('../server.js');
const profiles = accounts.profiles;
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

let baseUrl;
async function api(pathname, { token = '', method = 'GET' } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(baseUrl + pathname, { method, headers });
    return { status: response.status, body: await response.json() };
}

// Goes straight through AccountStore rather than the HTTP endpoint: this
// suite creates more accounts than the 'account' bucket's 10-per-minute
// cap (a network-abuse guard, unrelated to what's under test here), and the
// leaderboard route itself is still exercised entirely over real HTTP below.
async function register(username) {
    const result = await accounts.register(username, 'hunter22', `${username.toLowerCase()}@example.com`);
    return { status: result.status, body: result };
}

function seedRanked(profileId, { elo, startingElo = 1000, games, wins, losses = 0, placed = true, required = 5, completed = 5 }) {
    const record = profiles.getById(profileId);
    record.rankedState = {
        elo,
        currentSeason: {
            id: 'season-1', startedAt: 0, startingElo,
            placements: { required, completed: placed ? required : completed, placed },
            record: { games, wins, losses, draws: 0, highestElo: elo, lowestElo: startingElo },
            matches: []
        },
        pastSeasons: []
    };
    return record;
}

test.before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the leaderboard cache constant matches the ~30s window the task requires', () => {
    assert.match(serverSource, /const LEADERBOARD_CACHE_TTL = 30000;/);
});

test('guests (no auth) can read the ranked board; unsupported board/season are rejected', async () => {
    const anon = await api('/api/leaderboard?board=ranked&limit=5');
    assert.equal(anon.status, 200);
    assert.ok(Array.isArray(anon.body.entries));
    assert.equal(anon.body.board, 'ranked');
    assert.equal(anon.body.season, 'current');

    assert.equal((await api('/api/leaderboard?board=nonsense')).status, 400);
    assert.equal((await api('/api/leaderboard?season=season-2')).status, 400);
});

test('ranked board sorts by elo desc and excludes profiles below the placement threshold', async () => {
    const high = (await register('LadderHigh')).body;
    const low = (await register('LadderLow')).body;
    const unplaced = (await register('LadderUnplaced')).body;
    seedRanked(high.profile.id, { elo: 4990, games: 10, wins: 7 });
    seedRanked(low.profile.id, { elo: 4980, games: 6, wins: 2 });
    // Below the required placement games: must never appear on any board.
    seedRanked(unplaced.profile.id, { elo: 4999, games: 2, wins: 2, placed: false, required: 5, completed: 2 });

    __resetLeaderboardCacheForTests();
    const board = await api('/api/leaderboard?board=ranked&limit=50');
    assert.equal(board.status, 200);
    const codes = board.body.entries.map(e => e.publicCode);
    const highEntry = board.body.entries.find(e => e.displayName === 'LadderHigh');
    const lowEntry = board.body.entries.find(e => e.displayName === 'LadderLow');
    assert.ok(highEntry && lowEntry, 'both placed profiles are listed');
    assert.ok(highEntry.rank < lowEntry.rank, 'higher elo ranks better');
    assert.ok(board.body.entries.findIndex(e => e.rank === highEntry.rank) < board.body.entries.findIndex(e => e.rank === lowEntry.rank));
    assert.equal(board.body.entries.some(e => e.displayName === 'LadderUnplaced'), false, 'unplaced profile excluded despite a high elo');
});

test('season board ranks by season elo delta while wins board ranks by win count, diverging from the ranked board', async () => {
    // Player A: high lifetime elo but barely moved this season and few wins.
    const a = (await register('SeasonA')).body;
    seedRanked(a.profile.id, { elo: 4700, startingElo: 4690, games: 5, wins: 2 });
    // Player B: lower lifetime elo, but big season gain and many wins.
    const b = (await register('SeasonB')).body;
    seedRanked(b.profile.id, { elo: 4650, startingElo: 4300, games: 15, wins: 12 });

    __resetLeaderboardCacheForTests();
    const ranked = await api('/api/leaderboard?board=ranked&limit=50');
    const rankedA = ranked.body.entries.find(e => e.displayName === 'SeasonA');
    const rankedB = ranked.body.entries.find(e => e.displayName === 'SeasonB');
    assert.ok(rankedA.rank < rankedB.rank, 'ranked board: A (higher elo) leads B');

    const season = await api('/api/leaderboard?board=season&limit=50');
    const seasonA = season.body.entries.find(e => e.displayName === 'SeasonA');
    const seasonB = season.body.entries.find(e => e.displayName === 'SeasonB');
    assert.ok(seasonB.rank < seasonA.rank, 'season board: B (bigger season gain) leads A');

    const wins = await api('/api/leaderboard?board=wins&limit=50');
    const winsA = wins.body.entries.find(e => e.displayName === 'SeasonA');
    const winsB = wins.body.entries.find(e => e.displayName === 'SeasonB');
    assert.ok(winsB.rank < winsA.rank, 'wins board: B (more wins) leads A');
});

test('tie-break ordering is deterministic across repeated requests within the cache window', async () => {
    const x = (await register('TieX')).body;
    const y = (await register('TieY')).body;
    seedRanked(x.profile.id, { elo: 4500, games: 10, wins: 5 });
    seedRanked(y.profile.id, { elo: 4500, games: 10, wins: 5 });

    __resetLeaderboardCacheForTests();
    const first = await api('/api/leaderboard?board=ranked&limit=50');
    const second = await api('/api/leaderboard?board=ranked&limit=50');
    const order = body => body.entries.filter(e => e.displayName === 'TieX' || e.displayName === 'TieY').map(e => e.displayName);
    assert.deepEqual(order(first.body), order(second.body), 'identical elo/wins still produces a stable, repeatable order');
});

test('around=me returns the caller row and neighbours even when outside the requested top slice, and is absent for guests', async () => {
    const names = ['WinA', 'WinB', 'WinC', 'WinD', 'WinE', 'WinF'];
    const created = [];
    for (const [index, name] of names.entries()) {
        const acc = (await register(name)).body;
        // Strictly descending, tightly separated elos unique to this test.
        seedRanked(acc.profile.id, { elo: 4200 - index * 5, games: 10, wins: 5 });
        created.push(acc);
    }
    const target = created[4]; // WinE: 5th highest among this group

    __resetLeaderboardCacheForTests();
    const noAuth = await api('/api/leaderboard?board=ranked&limit=3&around=me');
    assert.equal(noAuth.body.me, null, 'unauthenticated caller gets an explicit null `me`, no row guessed');

    const withAuth = await api(`/api/leaderboard?board=ranked&limit=3&around=me`, { token: target.sessionToken });
    assert.equal(withAuth.body.entries.length, 3, 'top slice still respects `limit`');
    assert.ok(withAuth.body.me, 'me block present for an authenticated, placed caller');
    assert.equal(withAuth.body.me.entry.displayName, 'WinE');
    assert.ok(withAuth.body.me.entry.rank > withAuth.body.entries.length, 'caller sits outside the returned top slice');
    const neighbourNames = withAuth.body.me.neighbours.map(e => e.displayName);
    assert.ok(neighbourNames.includes('WinE'), 'neighbours window includes the caller themselves');
    const ranks = withAuth.body.me.neighbours.map(e => e.rank);
    for (let i = 1; i < ranks.length; i++) assert.equal(ranks[i], ranks[i - 1] + 1, 'neighbours window is contiguous by rank');
});

test('cache reuse: a mutation made after the first request is not reflected until the cache window rolls over', async () => {
    const solo = (await register('CacheSolo')).body;
    seedRanked(solo.profile.id, { elo: 3999, games: 10, wins: 5 });

    __resetLeaderboardCacheForTests();
    const first = await api('/api/leaderboard?board=ranked&limit=50');
    const before = first.body.entries.find(e => e.displayName === 'CacheSolo');
    assert.ok(before);
    const firstGeneratedAt = first.body.generatedAt;

    // Mutate straight on the in-memory store (bypassing the API) and query
    // again immediately: within the TTL window the response must be unchanged.
    profiles.getById(solo.profile.id).rankedState.elo = 1;
    const second = await api('/api/leaderboard?board=ranked&limit=50');
    assert.equal(second.body.generatedAt, firstGeneratedAt, 'cache window has not rolled over yet');
    const after = second.body.entries.find(e => e.displayName === 'CacheSolo');
    assert.equal(after.elo, before.elo, 'stale-but-cached read, not a live recomputation per request');
});

test('leaderboard entries never leak the raw profile id, token hash, or email', async () => {
    const p = (await register('PrivacyCheck')).body;
    seedRanked(p.profile.id, { elo: 3500, games: 10, wins: 5 });
    __resetLeaderboardCacheForTests();
    const board = await api('/api/leaderboard?board=ranked&limit=50');
    const entry = board.body.entries.find(e => e.displayName === 'PrivacyCheck');
    assert.ok(entry);
    assert.notEqual(entry.publicCode, p.profile.id);
    for (const key of ['id', 'profileId', 'tokenHash', 'email', 'ownedKnives', 'ownedAvatarSkins']) {
        assert.equal(Object.prototype.hasOwnProperty.call(entry, key), false, `entry must not expose "${key}"`);
    }
    assert.deepEqual(Object.keys(entry).sort(), ['avatarId', 'displayName', 'elo', 'games', 'knifeId', 'publicCode', 'rank', 'seasonDelta', 'winRate', 'wins'].sort());
});

test('the client leaderboard module no longer ships fake bots or a local roster', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'leaderboard.js'), 'utf8');
    assert.doesNotMatch(source, /generateFakes|seededRng|Math\.random\(\)/, 'no more procedurally-generated fake opponents');
    assert.doesNotMatch(source, /localStorage\.setItem\(LEADERBOARD_KEY/, 'no more writing a fake local roster');
    assert.match(source, /localStorage\?\.removeItem\(LEGACY_LEADERBOARD_KEY\)/, 'the old fake-roster key is deleted on load (clean migration)');
    assert.match(source, /`\/api\/leaderboard\?/, 'reads the real board from the server');
});
