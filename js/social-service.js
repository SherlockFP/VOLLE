const MAX_RECENT = 30;
const MAX_REPORTS = 20;

function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

export function createSocialProfile(data = {}) {
    return {
        friends: [...new Set((data.friends || []).map(cleanName).filter(Boolean))],
        incoming: [...new Set((data.incoming || []).map(cleanName).filter(Boolean))],
        outgoing: [...new Set((data.outgoing || []).map(cleanName).filter(Boolean))],
        muted: [...new Set((data.muted || []).map(cleanName).filter(Boolean))],
        recent: Array.isArray(data.recent) ? data.recent.slice(0, MAX_RECENT) : [],
        reports: Array.isArray(data.reports) ? data.reports.slice(-MAX_REPORTS) : [],
        party: data.party || null,
        showcase: {
            emote: cleanName(data.showcase?.emote) || 'wave',
            skin: cleanName(data.showcase?.skin) || 'default',
            pose: cleanName(data.showcase?.pose) || 'hero'
        }
    };
}

export function requestFriend(state, name) {
    const target = cleanName(name);
    if (!target || state.friends.includes(target) || state.outgoing.includes(target)) return state;
    return { ...state, outgoing: [...state.outgoing, target] };
}

export function acceptFriend(state, name) {
    const target = cleanName(name);
    if (!target || !state.incoming.includes(target)) return state;
    return {
        ...state,
        incoming: state.incoming.filter(item => item !== target),
        friends: [...new Set([...state.friends, target])]
    };
}

export function rememberPlayer(state, player, now = Date.now()) {
    const name = cleanName(player?.name);
    if (!name) return state;
    const recent = [{ name, at: now, elo: Number(player.elo) || 1000 },
        ...state.recent.filter(item => item.name !== name)].slice(0, MAX_RECENT);
    return { ...state, recent };
}

export function setMuted(state, name, muted = true) {
    const target = cleanName(name);
    if (!target) return state;
    return {
        ...state,
        muted: muted
            ? [...new Set([...state.muted, target])]
            : state.muted.filter(item => item !== target)
    };
}

export function reportPlayer(state, { name, reason = 'other', note = '' }, now = Date.now()) {
    const target = cleanName(name);
    if (!target) return state;
    const report = {
        name: target,
        reason: cleanName(reason).toLowerCase() || 'other',
        note: String(note || '').trim().slice(0, 180),
        at: now
    };
    return { ...state, reports: [...state.reports, report].slice(-MAX_REPORTS) };
}

export function createParty(owner, members = []) {
    const names = [...new Set([cleanName(owner), ...members.map(cleanName)].filter(Boolean))].slice(0, 8);
    return {
        id: `party-${Date.now().toString(36)}`,
        owner: names[0] || 'Player',
        members: names.map(name => ({ name, ready: false })),
        readyCheck: false
    };
}

export function setPartyReady(party, name, ready) {
    if (!party) return null;
    const target = cleanName(name);
    const members = party.members.some(member => member.name === target)
        ? party.members
        : [...party.members, { name: target, ready: false }].slice(0, 8);
    return {
        ...party,
        readyCheck: true,
        members: members.map(member =>
            member.name === target ? { ...member, ready: Boolean(ready) } : member)
    };
}

export function inviteToParty(party, name) {
    if (!party) return null;
    const target = cleanName(name);
    if (!target || party.members.some(member => member.name === target)) return party;
    return { ...party, members: [...party.members, { name: target, ready: false }].slice(0, 8) };
}

export function isPartyReady(party) {
    return Boolean(party?.members?.length && party.members.every(member => member.ready));
}
