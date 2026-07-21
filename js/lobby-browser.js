const text = value => String(value || '').trim();
const count = (value, fallback) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : fallback);

export function filterLobbies(lobbies, filters = {}) {
    const mode = text(filters.mode || 'all');
    const map = text(filters.map).toLowerCase();
    const queue = text(filters.queue || 'all');
    const openOnly = filters.openOnly !== false;
    return (Array.isArray(lobbies) ? lobbies : []).filter(lobby => {
        const players = count(lobby?.players, 1);
        const maxPlayers = Math.max(2, count(lobby?.maxPlayers, 8));
        if (openOnly && players >= maxPlayers) return false;
        if (mode !== 'all' && text(lobby?.mode) !== mode) return false;
        if (map && !text(lobby?.map).toLowerCase().includes(map)) return false;
        if (queue === 'ranked' && lobby?.ranked !== true) return false;
        if (queue === 'casual' && lobby?.ranked === true) return false;
        return true;
    });
}

export function pickQuickLobby(lobbies, filters = {}) {
    return [...filterLobbies(lobbies, { ...filters, openOnly: true })]
        .sort((a, b) => count(b.players, 1) - count(a.players, 1)
            || count(b.updatedAt, 0) - count(a.updatedAt, 0))[0] || null;
}
