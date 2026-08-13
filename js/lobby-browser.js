const text = value => String(value || '').trim();
const count = (value, fallback) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : fallback);

export function filterLobbies(lobbies, filters = {}) {
    const mode = text(filters.mode || 'all');
    const map = text(filters.map).toLowerCase();
    const queue = text(filters.queue || 'all');
    const openOnly = filters.openOnly !== false;
    const minOpenSlots = Math.max(1, Math.floor(Number(filters.minOpenSlots) || 1));
    return (Array.isArray(lobbies) ? lobbies : []).filter(lobby => {
        const players = count(lobby?.players, 1);
        const maxPlayers = Math.max(2, count(lobby?.maxPlayers, 8));
        if (openOnly && maxPlayers - players < minOpenSlots) return false;
        if (mode !== 'all' && text(lobby?.mode) !== mode) return false;
        if (map && !text(lobby?.map).toLowerCase().includes(map)) return false;
        if (queue === 'ranked' && lobby?.ranked !== true) return false;
        if (queue === 'casual' && lobby?.ranked === true) return false;
        return true;
    });
}

// ponytail: shared player/maxPlayers bounding so the card UI and the "open slots"
// filter above never disagree on what counts as full (P2P_HOST_FIXES #4).
export function lobbyCapacity(lobby) {
    return {
        players: count(lobby?.players, 1),
        maxPlayers: Math.max(2, count(lobby?.maxPlayers, 8))
    };
}

export function lobbyOpenSlots(lobby) {
    const { players, maxPlayers } = lobbyCapacity(lobby);
    return Math.max(0, maxPlayers - players);
}

// Formats a lobby's last-seen timestamp as a short relative age for the browser list.
export function formatLobbyAge(timestamp, now = Date.now()) {
    const seen = count(timestamp, now);
    const seconds = Math.max(0, Math.floor((now - seen) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
}

export function pickQuickLobby(lobbies, filters = {}) {
    return [...filterLobbies(lobbies, { ...filters, openOnly: true })]
        .sort((a, b) => count(b.players, 1) - count(a.players, 1)
            || count(b.updatedAt, 0) - count(a.updatedAt, 0))[0] || null;
}
