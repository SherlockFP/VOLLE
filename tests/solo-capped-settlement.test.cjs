// Solo (bot) matches past the daily reward cap still settle, at zero payout:
// the report finalizes, the play dailies count, and nothing in the economy moves.
// Their replay receipts never share rewardedMatches with paid matches.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore, SOLO_REWARDED_MATCHES_PER_DAY, SOLO_CAPPED_RECEIPT_LIMIT } = require('../server/profile-store');
const { MatchAuthority } = require('../server/match-authority');
const { createDailyState, utcDateKey } = require('../server/daily-challenge-service');
const { weeklyEvent } = require('../server/weekly-event');

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_DAY = Date.UTC(2026, 8, 28);
const id = suffix => `solo_capped_${suffix}_0123456789`;

// 00:30 UTC on the first day at or after `from` whose dailies include `challengeId`,
// so a double count cannot hide behind a task that is already at its target.
function dayWith(challengeId, from = FIRST_DAY) {
    for (let day = from; day < from + 365 * DAY_MS; day += DAY_MS) {
        if (createDailyState(day).challenges.some(challenge => challenge.id === challengeId)) return day + 30 * 60 * 1000;
    }
    throw new Error(`no UTC day offers ${challengeId}`);
}

// The injected clock is also Date.now: ProfileStore reads it wherever no time is
// passed (MatchAuthority's profile snapshot), and a different real day would
// rebuild the dailies between matches.
function fixture(t, start = dayWith('play_6')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-solo-cap-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'p.json');
    let now = start;
    t.mock.method(Date, 'now', () => now);
    const profiles = new ProfileStore(file);
    const session = profiles.session('', 'Solo');
    const authority = new MatchAuthority(profiles, { now: () => now, minDurationMs: 100 });
    return {
        dir, file, profiles, authority,
        profile: profiles.authenticate(session.token),
        now: () => now,
        setNow: value => { now = value; },
        advance: ms => { now += ms; }
    };
}

const restart = (f, profiles = f.profiles) => new MatchAuthority(profiles, { now: f.now, minDurationMs: 0 });

function playSolo(f, matchId, { authority = f.authority, profile = f.profile, gameMode } = {}) {
    const started = authority.start(profile, { matchId, mode: 'solo', gameMode });
    f.advance(100);
    const completed = authority.complete(profile, { matchId, mode: 'solo' });
    return { started, completed };
}

function playDailies(record) {
    return record.dailyChallenges.challenges
        .filter(challenge => challenge.type === 'games')
        .map(({ id: challengeId, progress, target }) => ({ id: challengeId, progress, target }));
}

function economy(record) {
    return structuredClone({
        currency: record.currency,
        battlepass: { tier: record.battlepass?.tier, xp: record.battlepass?.xp },
        earnedCases: record.earnedCases,
        cardCollection: record.cardCollection,
        equippedCards: record.equippedCards,
        starterTrack: record.starterTrack,
        caseDropDrought: record.caseDropDrought,
        weeklyEvent: record.weeklyEvent,
        lastFirstMatchDay: record.lastFirstMatchDay,
        arenaCache: record.arenaCache,
        cardRewardReceipts: record.cardRewardReceipts,
        rewardedMatches: record.rewardedMatches
    });
}

test('solo matches 4 and 5 of a UTC day start and settle at zero payout instead of 429', t => {
    const f = fixture(t);
    assert.equal(SOLO_REWARDED_MATCHES_PER_DAY, 3);
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) {
        const { started, completed } = playSolo(f, id(`paid${n}`));
        assert.equal(started.httpStatus, 200);
        assert.equal(completed.httpStatus, 200);
        assert.equal(completed.completion.coins, 40, `paid match ${n} keeps its loss settlement`);
        assert.ok(completed.completion.battlepassXp > 0, `paid match ${n} keeps its Battle Pass XP`);
        assert.equal(completed.completion.soloCapped, undefined);
    }
    for (const n of [4, 5]) {
        const { started, completed } = playSolo(f, id(`capped${n}`));
        assert.equal(started.httpStatus, 200, `solo match ${n} must start`);
        assert.equal(completed.httpStatus, 200, `solo match ${n} must settle`);
        assert.equal(completed.status, 'finalized');
        assert.equal(completed.replayed, false);
        const completion = completed.completion;
        assert.equal(completion.soloCapped, true);
        assert.equal(completion.replayed, false);
        assert.equal(completion.coins, 0);
        assert.equal(completion.base, 0);
        assert.equal(completion.bonus, 0);
        assert.equal(completion.firstOfDay, 0);
        assert.equal(completion.battlepassXp, 0);
        assert.equal(completion.earnedCase, null);
        assert.equal(completion.earnedCaseSource, null);
        assert.equal(completion.cardReward, null);
        assert.equal(completion.bonusCard, null);
        assert.equal(completion.starterCase, null);
        assert.equal(completion.weeklyEvent, null);
        assert.ok(completion.dailyProgress && completion.dailyProgress.progressed, `solo match ${n} advances the play dailies`);
    }
    assert.equal(f.profile.soloRewards.count, SOLO_REWARDED_MATCHES_PER_DAY, 'capped settlements do not consume reward slots');
});

test('capped settlements leave currency, Battle Pass, drops, starter track and weekly event untouched', t => {
    const f = fixture(t);
    const gameMode = weeklyEvent(new Date(f.now())).modeId;
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`), { gameMode });
    assert.ok(f.profile.weeklyEvent?.matches > 0, 'paid solo matches in the featured mode still score the weekly event');
    const saved = () => new ProfileStore(f.file).getById(f.profile.id);
    const before = economy(f.profile);
    const savedBefore = economy(saved());
    const revision = f.profile.economyRevision;
    for (const n of [4, 5, 6]) assert.equal(playSolo(f, id(`capped${n}`), { gameMode }).completed.completion.soloCapped, true);
    assert.deepEqual(economy(f.profile), before);
    assert.equal(f.profile.economyRevision, revision + 3, 'each capped settlement bumps the economy revision once');
    const persisted = saved();
    assert.deepEqual(economy(persisted), savedBefore, 'the saved profile is unchanged too');
    assert.deepEqual(playDailies(persisted), playDailies(f.profile), 'the capped daily progress is saved');
});

test('60 UTC days of 6 solo matches finish every play daily each day', t => {
    const f = fixture(t, FIRST_DAY + 30 * 60 * 1000);
    const seen = new Set();
    for (let day = 0; day < 60; day += 1) {
        f.setNow(FIRST_DAY + day * DAY_MS + 30 * 60 * 1000);
        for (let n = 0; n < 6; n += 1) {
            const { started, completed } = playSolo(f, id(`d${day}m${n}`));
            assert.equal(started.httpStatus, 200, `day ${day} match ${n + 1} start`);
            assert.equal(completed.httpStatus, 200, `day ${day} match ${n + 1} complete`);
            const capped = n >= SOLO_REWARDED_MATCHES_PER_DAY;
            assert.equal(completed.completion.soloCapped === true, capped, `day ${day} match ${n + 1} capped=${capped}`);
            assert.equal(completed.completion.coins, capped ? 0 : 40, `day ${day} match ${n + 1} coins`);
        }
        assert.equal(f.profile.dailyChallenges.date, utcDateKey(f.now()));
        const dailies = playDailies(f.profile);
        assert.equal(dailies.length, 2, `day ${day} offers two play dailies`);
        for (const daily of dailies) {
            seen.add(daily.id);
            assert.equal(daily.progress, daily.target, `day ${day} ${daily.id} reaches its target`);
        }
    }
    assert.deepEqual([...seen].sort(), ['play_2', 'play_4', 'play_6'], 'the run covers every play daily');
});

test('re-completing a capped match replays without advancing the dailies twice, also after a restart', t => {
    const f = fixture(t);
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`));
    const cappedId = id('capped4');
    assert.equal(playSolo(f, cappedId).completed.completion.soloCapped, true);
    const progress = playDailies(f.profile);
    assert.equal(progress.find(daily => daily.id === 'play_6').progress, 4, 'the capped match counted once');
    const currency = f.profile.currency;

    const again = f.authority.complete(f.profile, { matchId: cappedId, mode: 'solo' });
    assert.equal(again.httpStatus, 200);
    assert.equal(again.replayed, true);
    assert.equal(again.completion.coins, 0);
    assert.deepEqual(playDailies(f.profile), progress);

    const restarted = new MatchAuthority(f.profiles, { now: f.now, minDurationMs: 0 });
    assert.equal(restarted.start(f.profile, { matchId: cappedId, mode: 'solo' }).httpStatus, 200);
    const replay = restarted.complete(f.profile, { matchId: cappedId, mode: 'solo' });
    assert.equal(replay.httpStatus, 200);
    assert.equal(replay.replayed, true);
    assert.equal(replay.completion.replayed, true);
    assert.equal(replay.completion.coins, 0);
    assert.equal(replay.completion.battlepassXp, 0);
    assert.equal(replay.completion.dailyProgress, null);
    assert.deepEqual(playDailies(f.profile), progress, 'a restart replay does not count the match again');
    assert.equal(f.profile.currency, currency);
    assert.equal(f.profile.soloRewards.count, SOLO_REWARDED_MATCHES_PER_DAY);
    assert.equal(restarted.status(f.profile, cappedId).status, 'finalized');

    const directReplay = f.profiles.settleCappedSolo(f.profile, cappedId, f.now());
    assert.equal(directReplay.replayed, true);
    assert.deepEqual(playDailies(f.profile), progress, 'settleCappedSolo is exactly-once per matchId');

    const reloaded = new ProfileStore(f.file);
    const record = reloaded.getById(f.profile.id);
    const cold = new MatchAuthority(reloaded, { now: f.now, minDurationMs: 0 });
    assert.equal(cold.start(record, { matchId: cappedId, mode: 'solo' }).httpStatus, 200);
    const coldReplay = cold.complete(record, { matchId: cappedId, mode: 'solo' });
    assert.equal(coldReplay.httpStatus, 200);
    assert.equal(coldReplay.replayed, true);
    assert.equal(coldReplay.completion.coins, 0);
    assert.deepEqual(playDailies(record), progress, 'a reloaded profile store does not count the match again');
    assert.equal(record.currency, currency);
});

test('a later capped match still counts after a replay', t => {
    const f = fixture(t);
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`));
    const cappedId = id('capped4');
    playSolo(f, cappedId);
    f.authority.complete(f.profile, { matchId: cappedId, mode: 'solo' });
    assert.equal(playSolo(f, id('capped5')).completed.completion.soloCapped, true);
    assert.equal(playDailies(f.profile).find(daily => daily.id === 'play_6').progress, 5);
});

test('a capped solo match reads as finalized with its zero-payout completion', t => {
    const f = fixture(t);
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`));
    const cappedId = id('capped4');
    playSolo(f, cappedId);
    const status = f.authority.status(f.profile, cappedId);
    assert.equal(status.httpStatus, 200);
    assert.equal(status.status, 'finalized');
    assert.equal(status.completion.soloCapped, true);
    assert.equal(status.completion.coins, 0);
});

// QA: capped settlements used to share rewardedMatches (last 50 ids), so bot
// spam evicted the day's paid ids and a paid id replayed after a restart paid again.
test('capped settlements never evict paid matchIds: a paid id replayed after 60 capped matches and a restart pays nothing', t => {
    const f = fixture(t);
    const paid = [1, 2, 3].map(n => id(`paid${n}`));
    for (const matchId of paid) assert.equal(playSolo(f, matchId).completed.completion.coins, 40);
    const rewarded = [...f.profile.rewardedMatches];
    const before = economy(f.profile);
    for (let n = 0; n < 60; n += 1) {
        const { completed } = playSolo(f, id(`spam${n}`));
        assert.equal(completed.completion.soloCapped, true, `capped match ${n} settles capped`);
        assert.equal(completed.completion.profile.soloCappedMatches, undefined, 'capped receipts stay private');
    }
    assert.deepEqual(f.profile.rewardedMatches, rewarded, 'capped settlements leave rewardedMatches alone');
    assert.equal(f.profile.soloCappedMatches.length, 60);
    assert.equal(f.profiles._public(f.profile).soloCappedMatches, undefined);

    const restarted = restart(f);
    assert.equal(restarted.start(f.profile, { matchId: paid[0], mode: 'solo' }).httpStatus, 200);
    const replay = restarted.complete(f.profile, { matchId: paid[0], mode: 'solo' });
    assert.equal(replay.httpStatus, 200);
    assert.equal(replay.replayed, true, 'a paid id replays after a restart');
    assert.equal(replay.completion.replayed, true);
    assert.equal(replay.completion.coins, 0);
    assert.equal(replay.completion.battlepassXp, 0);
    assert.equal(replay.completion.dailyProgress, null);
    assert.deepEqual(economy(f.profile), before, 'the paid replay moves nothing');
    assert.equal(f.profile.soloRewards.count, SOLO_REWARDED_MATCHES_PER_DAY);

    const reloaded = new ProfileStore(f.file);
    const record = reloaded.getById(f.profile.id);
    const cold = restart(f, reloaded);
    assert.equal(cold.start(record, { matchId: paid[1], mode: 'solo' }).httpStatus, 200);
    const coldReplay = cold.complete(record, { matchId: paid[1], mode: 'solo' });
    assert.equal(coldReplay.replayed, true, 'a paid id replays after a profile store reload');
    assert.equal(coldReplay.completion.coins, 0);
    assert.equal(record.currency, before.currency);
});

test('a paid id replayed after the finalized cache rolls over still pays nothing, without a restart', t => {
    const f = fixture(t);
    const authority = new MatchAuthority(f.profiles, { now: f.now, minDurationMs: 100, maxFinalized: 5 });
    const paid = id('paid1');
    playSolo(f, paid, { authority });
    for (let n = 2; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`), { authority });
    for (let n = 0; n < 60; n += 1) playSolo(f, id(`spam${n}`), { authority });
    const before = economy(f.profile);
    const { started, completed } = playSolo(f, paid, { authority });
    assert.equal(started.httpStatus, 200);
    assert.equal(completed.httpStatus, 200);
    assert.equal(completed.replayed, true);
    assert.equal(completed.completion.coins, 0);
    assert.equal(completed.completion.battlepassXp, 0);
    assert.deepEqual(economy(f.profile), before);
});

test('a capped id replays exactly once even after 60 later capped matches and a restart', t => {
    const f = fixture(t);
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`));
    const first = id('cappedA');
    assert.equal(playSolo(f, first).completed.completion.soloCapped, true);
    for (let n = 0; n < 60; n += 1) playSolo(f, id(`spam${n}`));
    const revision = f.profile.economyRevision;
    const progress = playDailies(f.profile);
    const restarted = restart(f);
    assert.equal(restarted.start(f.profile, { matchId: first, mode: 'solo' }).httpStatus, 200);
    const replay = restarted.complete(f.profile, { matchId: first, mode: 'solo' });
    assert.equal(replay.httpStatus, 200);
    assert.equal(replay.replayed, true);
    assert.equal(replay.completion.replayed, true);
    assert.equal(replay.completion.soloCapped, true);
    assert.equal(replay.completion.coins, 0);
    assert.equal(replay.completion.dailyProgress, null, 'the replay does not count the match again');
    assert.equal(f.profile.economyRevision, revision, 'the replay writes nothing');
    assert.deepEqual(playDailies(f.profile), progress);
    assert.equal(restarted.status(f.profile, first).status, 'finalized');
});

test('capped receipts are bounded and kept apart from rewardedMatches, also across a reload', t => {
    const f = fixture(t);
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`));
    const rewarded = [...f.profile.rewardedMatches];
    const extra = 20;
    for (let n = 0; n < SOLO_CAPPED_RECEIPT_LIMIT + extra; n += 1) {
        assert.equal(f.profiles.settleCappedSolo(f.profile, id(`bulk${n}`), f.now()).soloCapped, true);
    }
    assert.equal(f.profile.soloCappedMatches.length, SOLO_CAPPED_RECEIPT_LIMIT);
    assert.equal(f.profile.soloCappedMatches[0], id(`bulk${extra}`), 'the oldest capped receipts roll off first');
    assert.deepEqual(f.profile.rewardedMatches, rewarded);
    const record = new ProfileStore(f.file).getById(f.profile.id);
    assert.deepEqual(record.soloCappedMatches, f.profile.soloCappedMatches, 'capped receipts survive a reload');
    assert.deepEqual(record.rewardedMatches, rewarded);
});

test('a capped id, even one past 64 chars, replayed on the next UTC day never takes a paid slot', t => {
    const f = fixture(t);
    const longId = n => `${id(`long${n}`)}_${'x'.repeat(90)}`;
    const paidLong = longId('paid');
    const cappedLong = longId('capped');
    assert.ok(paidLong.length > 64 && paidLong.length <= 128 && cappedLong.length > 64 && cappedLong.length <= 128);
    assert.equal(playSolo(f, paidLong).completed.completion.coins, 40);
    for (let n = 2; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) playSolo(f, id(`paid${n}`));
    assert.equal(playSolo(f, cappedLong).completed.completion.soloCapped, true);

    const nextDay = Date.UTC(new Date(f.now()).getUTCFullYear(), new Date(f.now()).getUTCMonth(), new Date(f.now()).getUTCDate() + 1, 0, 30);
    f.setNow(nextDay);
    const restarted = restart(f);
    for (const matchId of [cappedLong, paidLong]) {
        assert.equal(restarted.start(f.profile, { matchId, mode: 'solo' }).httpStatus, 200);
        const replay = restarted.complete(f.profile, { matchId, mode: 'solo' });
        assert.equal(replay.httpStatus, 200);
        assert.equal(replay.replayed, true, 'yesterday\'s match replays');
        assert.equal(replay.completion.coins, 0);
        assert.equal(replay.completion.dailyProgress, null);
    }
    assert.ok(f.profile.soloRewards.day !== utcDateKey(nextDay) || f.profile.soloRewards.count === 0, 'no paid slot used by a replay');
    for (let n = 1; n <= SOLO_REWARDED_MATCHES_PER_DAY; n += 1) {
        assert.equal(playSolo(f, id(`next${n}`), { authority: restarted }).completed.completion.coins, 40, `new day paid match ${n}`);
    }
    assert.equal(playSolo(f, id('next4'), { authority: restarted }).completed.completion.soloCapped, true);
});

test('the solo reward code uses SOLO_REWARDED_MATCHES_PER_DAY, not a bare 3', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server/profile-store.js'), 'utf8');
    const start = source.indexOf('    canRewardSolo(');
    const end = source.indexOf('    canStartRankedPair(');
    assert.ok(start > 0 && end > start, 'solo reward methods found');
    const normalisation = source.split('\n').find(line => line.includes('Number(record.soloRewards.count)'));
    assert.ok(normalisation, 'soloRewards normalisation found');
    const soloCode = `${source.slice(start, end)}\n${normalisation}`;
    assert.ok(soloCode.includes('settleCappedSolo('), 'settleCappedSolo sits with the solo reward methods');
    assert.doesNotMatch(soloCode, /<\s*3\b/);
    assert.doesNotMatch(soloCode, />=\s*3\b/);
    assert.doesNotMatch(soloCode, /slice\(-3\)/);
    assert.doesNotMatch(soloCode, /Math\.min\(3\b/);
    assert.match(source, /module\.exports = \{[^}]*SOLO_REWARDED_MATCHES_PER_DAY[^}]*\}/);
});
