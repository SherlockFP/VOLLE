// Server-owned, UTC-day Daily Challenges.  Only match facts settled by
// MatchAuthority may advance these tasks; browser performance telemetry never
// enters this catalog.
const DAILY_CHALLENGE_XP = 50;
const DAILY_ALL_COMPLETE_BONUS_XP = 100;
const MAX_RECEIPTS = 24;

const GAME_CHALLENGE_POOL = Object.freeze([
    { id: 'play_2', type: 'games', target: 2, reward: 50, name: 'Play 2 Matches' },
    { id: 'play_4', type: 'games', target: 4, reward: 75, name: 'Play 4 Matches' },
    { id: 'play_6', type: 'games', target: 6, reward: 110, name: 'Play 6 Matches' }
]);
const MULTIPLAYER_WIN_CHALLENGE_POOL = Object.freeze([
    { id: 'win_mp_1', type: 'wins', target: 1, reward: 70, name: 'Win 1 Multiplayer Match' },
    { id: 'win_mp_2', type: 'wins', target: 2, reward: 120, name: 'Win 2 Multiplayer Matches' }
]);

function utcDateKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

function pickChallenges(date) {
    let seed = 0;
    for (let index = 0; index < date.length; index += 1) seed = (seed * 31 + date.charCodeAt(index)) | 0;
    const pickFrom = (pool, count) => {
        const choices = [...pool];
        const picked = [];
        for (let index = 0; index < count; index += 1) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            picked.push(choices.splice(seed % choices.length, 1)[0]);
        }
        return picked;
    };
    // Every account can complete two play tasks in solo or multiplayer. The
    // third is explicitly multiplayer-win: solo settlements are intentionally
    // loss-only and must never surface an unreachable solo win task.
    const picked = [...pickFrom(GAME_CHALLENGE_POOL, 2), ...pickFrom(MULTIPLAYER_WIN_CHALLENGE_POOL, 1)];
    return picked.map(challenge => ({ ...challenge, progress: 0, claimed: false }));
}

function createDailyState(now = Date.now()) {
    const date = utcDateKey(now);
    return { date, challenges: pickChallenges(date), bonusGranted: false, claimReceipts: [] };
}

function isChallenge(value) {
    return value && typeof value === 'object'
        && (value.type === 'games' || value.type === 'wins')
        && typeof value.id === 'string' && Number.isInteger(value.target) && value.target > 0
        && Number.isInteger(value.reward) && value.reward > 0;
}

function normalizeDailyState(raw, now = Date.now()) {
    const fresh = createDailyState(now);
    if (!raw || typeof raw !== 'object' || raw.date !== fresh.date || !Array.isArray(raw.challenges)) return fresh;
    const saved = new Map(raw.challenges.filter(isChallenge).map(challenge => [challenge.id, challenge]));
    const challenges = fresh.challenges.map(challenge => {
        const old = saved.get(challenge.id);
        return old ? {
            ...challenge,
            progress: Math.min(challenge.target, Math.max(0, Math.floor(Number(old.progress) || 0))),
            claimed: old.claimed === true
        } : challenge;
    });
    const allowedIds = new Set(challenges.map(challenge => challenge.id));
    const claimReceipts = Array.isArray(raw.claimReceipts) ? raw.claimReceipts
        .filter(receipt => receipt && typeof receipt === 'object'
            && typeof receipt.requestId === 'string' && allowedIds.has(receipt.challengeId))
        .slice(-MAX_RECEIPTS) : [];
    return {
        date: fresh.date,
        challenges,
        bonusGranted: raw.bonusGranted === true && challenges.length > 0 && challenges.every(challenge => challenge.claimed),
        claimReceipts
    };
}

function advanceDailyState(state, { won = false } = {}) {
    const before = state.challenges.map(challenge => ({ id: challenge.id, progress: challenge.progress, complete: challenge.progress >= challenge.target }));
    const challenges = state.challenges.map(challenge => {
        const increment = challenge.type === 'games' ? 1 : (challenge.type === 'wins' && won === true ? 1 : 0);
        return { ...challenge, progress: Math.min(challenge.target, challenge.progress + increment) };
    });
    const completed = challenges.filter(challenge => {
        const prior = before.find(item => item.id === challenge.id);
        return challenge.progress >= challenge.target && !prior?.complete;
    }).map(challenge => challenge.id);
    return { state: { ...state, challenges }, progressed: challenges.some((challenge, index) => challenge.progress !== state.challenges[index].progress), completed };
}

function publicDailyState(state) {
    return {
        date: state.date,
        challenges: state.challenges.map(({ id, type, target, reward, name, progress, claimed }) => ({ id, type, target, reward, name, progress, claimed })),
        bonusGranted: state.bonusGranted === true
    };
}

module.exports = {
    DAILY_CHALLENGE_XP,
    DAILY_ALL_COMPLETE_BONUS_XP,
    advanceDailyState,
    createDailyState,
    normalizeDailyState,
    publicDailyState,
    utcDateKey
};
