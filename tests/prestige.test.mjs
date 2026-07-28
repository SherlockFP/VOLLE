// Account progression contract: js/prestige.js is the single owner of the level
// curve and the prestige roll. store.js persists the triple and main.js renders
// it, so a drift here silently changes every player's pacing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MATCH_XP,
    MAX_LEVEL,
    MAX_PRESTIGE,
    accountRankLabel,
    applyAccountXp,
    isMaxed,
    levelProgress,
    matchXp,
    prestigeTitle,
    xpForLevel
} from '../js/prestige.js';

const fresh = () => ({ level: 1, xp: 0, prestige: 0 });

test('xp curve matches the shipped store curve so saves keep their pacing', () => {
    assert.equal(xpForLevel(1), 100);
    assert.equal(xpForLevel(2), 150);
    assert.equal(xpForLevel(10), 550);
    // Clamped at the cap rather than growing past it.
    assert.equal(xpForLevel(MAX_LEVEL + 50), xpForLevel(MAX_LEVEL));
});

test('xp below the threshold banks without levelling', () => {
    const next = applyAccountXp(fresh(), 60);
    assert.equal(next.level, 1);
    assert.equal(next.xp, 60);
    assert.equal(next.leveledUp, false);
    assert.equal(next.prestiged, false);
});

test('crossing the threshold levels up and carries the remainder', () => {
    const next = applyAccountXp(fresh(), 130);
    assert.equal(next.level, 2);
    assert.equal(next.xp, 30, 'leftover xp carries into the new level');
    assert.equal(next.leveledUp, true);
});

test('a single large grant rolls multiple levels', () => {
    // 100 (L1) + 150 (L2) + 200 (L3) = 450 clears three levels exactly.
    const next = applyAccountXp(fresh(), 450);
    assert.equal(next.level, 4);
    assert.equal(next.xp, 0);
    assert.equal(next.leveledUp, true);
});

test('hitting the level cap prestiges and resets to level 1', () => {
    const capped = { level: MAX_LEVEL, xp: 0, prestige: 0 };
    const next = applyAccountXp(capped, xpForLevel(MAX_LEVEL));
    assert.equal(next.prestige, 1, 'prestige advances');
    assert.equal(next.level, 1, 'level restarts');
    assert.equal(next.xp, 0, 'prestige banks no leftover xp');
    assert.equal(next.prestiged, true);
    assert.equal(next.leveledUp, true);
});

test('a fully maxed account discards further xp instead of growing forever', () => {
    const done = { level: MAX_LEVEL, xp: 0, prestige: MAX_PRESTIGE };
    assert.equal(isMaxed(done), true);
    const next = applyAccountXp(done, 999999);
    assert.equal(next.prestige, MAX_PRESTIGE);
    assert.equal(next.level, MAX_LEVEL);
    assert.equal(next.xp, 0, 'no unfillable bar');
    assert.equal(next.prestiged, false);
    assert.equal(next.leveledUp, false);
    assert.equal(levelProgress(done).need, 0, 'maxed accounts report nothing left to fill');
});

test('prestige never exceeds the cap', () => {
    let account = { level: MAX_LEVEL, xp: 0, prestige: MAX_PRESTIGE - 1 };
    account = applyAccountXp(account, xpForLevel(MAX_LEVEL));
    assert.equal(account.prestige, MAX_PRESTIGE);
    account = applyAccountXp({ ...account, level: MAX_LEVEL }, xpForLevel(MAX_LEVEL));
    assert.equal(account.prestige, MAX_PRESTIGE, 'clamped at the final prestige');
});

test('legacy saves without a prestige field read as prestige 0', () => {
    const next = applyAccountXp({ level: 3, xp: 10 }, 0);
    assert.equal(next.prestige, 0);
    assert.equal(next.level, 3);
    assert.equal(next.xp, 10);
});

test('hostile xp grants never throw and never mutate progress', () => {
    const account = { level: 4, xp: 25, prestige: 2 };
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, -500, 'lots', {}]) {
        const next = applyAccountXp(account, bad);
        assert.equal(next.level, 4, `level survived ${String(bad)}`);
        assert.equal(next.xp, 25, `xp survived ${String(bad)}`);
        assert.equal(next.prestige, 2, `prestige survived ${String(bad)}`);
        assert.equal(next.leveledUp, false);
    }
    assert.doesNotThrow(() => applyAccountXp(undefined, 100));
    assert.doesNotThrow(() => applyAccountXp(null, 100));
});

test('hostile stored progress clamps into range instead of throwing', () => {
    const next = applyAccountXp({ level: -9, xp: -40, prestige: 999 }, 0);
    assert.equal(next.level, 1);
    assert.equal(next.xp, 0);
    assert.equal(next.prestige, MAX_PRESTIGE);
});

test('a strong loss out-earns a passive win: casual play beats the scoreline', () => {
    const passiveWin = matchXp({ won: true, deflections: 0, kills: 0 });
    const strongLoss = matchXp({ won: false, deflections: 8, kills: 3 });
    assert.ok(
        strongLoss > passiveWin,
        `playing well while losing (${strongLoss}) must beat idling to a win (${passiveWin})`
    );
});

test('the win bonus stays a nudge, not the whole reward', () => {
    const gap = MATCH_XP.win - MATCH_XP.loss;
    assert.ok(gap > 0, 'winning is still worth something');
    assert.ok(
        gap < MATCH_XP.base,
        'the result must not outweigh simply showing up and playing'
    );
});

test('every scoring action increases match xp', () => {
    const flat = matchXp({ won: false });
    assert.ok(matchXp({ won: false, deflections: 1 }) > flat);
    assert.ok(matchXp({ won: false, kills: 1 }) > flat);
    assert.ok(matchXp({ won: false, rally: 1 }) > flat);
    assert.ok(matchXp({ won: false, survived: true }) > flat);
});

test('match xp survives hostile stats and never goes below the loss floor', () => {
    const floor = MATCH_XP.base + MATCH_XP.loss;
    assert.equal(matchXp({}), floor);
    assert.equal(matchXp(), floor);
    assert.equal(matchXp({ deflections: NaN, kills: -5, rally: 'x', won: 'yes' }), floor);
});

test('rank label reflects prestige once earned', () => {
    assert.equal(accountRankLabel({ level: 12, prestige: 0 }), 'Lv 12');
    assert.equal(accountRankLabel({ level: 12, prestige: 2 }), 'Deflector · Lv 12');
    assert.equal(prestigeTitle(0), '', 'no title before the first prestige');
    assert.equal(prestigeTitle(MAX_PRESTIGE), 'Master Prestige');
    assert.equal(prestigeTitle(MAX_PRESTIGE + 4), 'Master Prestige', 'clamped');
});

test('every prestige rank has a title so the reward is never blank', () => {
    for (let p = 1; p <= MAX_PRESTIGE; p += 1) {
        assert.notEqual(prestigeTitle(p), '', `prestige ${p} needs a title`);
    }
});
