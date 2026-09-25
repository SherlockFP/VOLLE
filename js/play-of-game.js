// Play of the Game: the match's single best moment, picked from the replay's
// 'kill' events (every elimination, any player) and, when nobody scored a kill,
// its longest rally. Multi-kills chain when the same attacker kills again within
// POTG_CHAIN_MS; long rallies, perfect deflects and headshots add on top. Pure:
// main.js feeds it the recorded events and plays the window it returns.
export const POTG_CHAIN_MS = 4000;
export const POTG_LEAD_MS = 2500;
export const POTG_TAIL_MS = 2000;
const IGNORED_ATTACKERS = new Set(['', 'environment', 'unknown']);

const finite = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function scorePlay({ streak = 1, rally = 0, perfect = false, headshot = false } = {}) {
    return 100
        + Math.max(0, finite(streak) - 1) * 90
        + Math.min(30, Math.max(0, finite(rally))) * 8
        + (perfect ? 60 : 0)
        + (headshot ? 40 : 0);
}

// Returns { player, kind, at, start, end, score, streak, rally, perfect, headshot }
// or null when the match had nothing worth showing.
export function pickPlayOfTheGame(replay) {
    const events = Array.isArray(replay?.events) ? replay.events : [];
    const duration = Math.max(finite(replay?.duration), finite(events.at(-1)?.t));
    const kills = events
        .filter(event => event?.type === 'kill' && event.data)
        .map(event => ({
            t: finite(event.t),
            attacker: String(event.data.attacker || '').slice(0, 32),
            victim: String(event.data.victim || '').slice(0, 32),
            rally: finite(event.data.rally),
            perfect: event.data.perfect === true,
            headshot: event.data.headshot === true
        }))
        .filter(kill => !IGNORED_ATTACKERS.has(kill.attacker.toLowerCase()) && kill.attacker !== kill.victim)
        .sort((a, b) => a.t - b.t);
    let best = null;
    const chains = new Map(); // attacker -> { firstAt, lastAt, streak }
    for (const kill of kills) {
        const previous = chains.get(kill.attacker);
        const chain = previous && kill.t - previous.lastAt <= POTG_CHAIN_MS
            ? { firstAt: previous.firstAt, lastAt: kill.t, streak: previous.streak + 1, perfect: previous.perfect || kill.perfect, headshot: previous.headshot || kill.headshot, rally: Math.max(previous.rally, kill.rally) }
            : { firstAt: kill.t, lastAt: kill.t, streak: 1, perfect: kill.perfect, headshot: kill.headshot, rally: kill.rally };
        chains.set(kill.attacker, chain);
        const score = scorePlay(chain);
        if (!best || score > best.score) {
            best = { player: kill.attacker, kind: 'kill', at: kill.t, firstAt: chain.firstAt, score, streak: chain.streak, rally: chain.rally, perfect: chain.perfect, headshot: chain.headshot };
        }
    }
    if (!best) {
        const rally = events
            .filter(event => event?.type === 'deflect' && finite(event.data?.rally) >= 5)
            .sort((a, b) => finite(b.data.rally) - finite(a.data.rally) || finite(a.t) - finite(b.t))[0];
        if (!rally) return null;
        const count = finite(rally.data.rally);
        best = { player: '', kind: 'rally', at: finite(rally.t), firstAt: finite(rally.t), score: count * 10, streak: 0, rally: count, perfect: false, headshot: false };
    }
    const start = Math.max(0, best.firstAt - POTG_LEAD_MS);
    const end = Math.min(Math.max(duration, best.at), best.at + POTG_TAIL_MS);
    const { firstAt, ...play } = best;
    return { ...play, start, end };
}

// Localized tag list for the card: "Triple kill", "12 rally", "Perfect", "Headshot".
export function playTags(play, t = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`) {
    if (!play) return [];
    const tags = [];
    if (play.streak >= 3) tags.push(play.streak === 3 ? t('potg.triple') : t('potg.multi', { count: play.streak }));
    else if (play.streak === 2) tags.push(t('potg.double'));
    else if (play.kind === 'kill') tags.push(t('potg.kill'));
    if (play.rally >= 3) tags.push(t('potg.rally', { count: play.rally }));
    if (play.perfect) tags.push(t('potg.perfect'));
    if (play.headshot) tags.push(t('potg.headshot'));
    return tags;
}
