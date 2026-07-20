const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createHotPotatoState(duration = 5) {
    return {
        enabled: false,
        active: false,
        holder: null,
        holderId: '',
        holderName: '',
        holderTeam: '',
        remaining: 0,
        duration: clamp(Number(duration) || 5, 1, 30),
        revision: 0,
        receivedAt: 0
    };
}

export function resetHotPotatoState(state, duration = 5, enabled = false) {
    const target = state || createHotPotatoState(duration);
    target.enabled = enabled;
    target.active = false;
    target.holder = null;
    target.holderId = '';
    target.holderName = '';
    target.holderTeam = '';
    target.remaining = 0;
    target.duration = clamp(Number(duration) || 5, 1, 30);
    target.revision = Math.max(0, Number(target.revision) || 0) + 1;
    target.receivedAt = 0;
    return target;
}

export function transferHotPotato(state, carrier, duration = state?.duration || 5) {
    if (!state || !carrier?.id || !['red', 'blue'].includes(carrier.team)) return false;
    if (state.active && state.holderId === carrier.id) return false;
    state.enabled = true;
    state.active = true;
    state.holder = carrier.entity || null;
    state.holderId = String(carrier.id).slice(0, 128);
    state.holderName = String(carrier.name || 'Player').slice(0, 32);
    state.holderTeam = carrier.team;
    state.duration = clamp(Number(duration) || 5, 1, 30);
    state.remaining = state.duration;
    state.revision++;
    state.receivedAt = 0;
    return true;
}

export function tickHotPotato(state, dt) {
    if (!state?.enabled || !state.active) return false;
    const safeDt = clamp(Number(dt) || 0, 0, 0.1);
    state.remaining = Math.max(0, state.remaining - safeDt);
    if (state.remaining > 1e-6) return false;
    state.remaining = 0;
    state.active = false;
    state.revision++;
    return true;
}

export function snapshotHotPotato(state) {
    const source = state || createHotPotatoState();
    return {
        enabled: source.enabled === true,
        active: source.active === true,
        holderId: String(source.holderId || '').slice(0, 128),
        holderName: String(source.holderName || '').slice(0, 32),
        holderTeam: ['red', 'blue'].includes(source.holderTeam) ? source.holderTeam : '',
        remaining: clamp(Number(source.remaining) || 0, 0, 30),
        duration: clamp(Number(source.duration) || 5, 1, 30),
        revision: Math.max(0, Math.floor(Number(source.revision) || 0))
    };
}

export function applyHotPotatoSnapshot(state, input, receivedAt = 0) {
    if (!input || typeof input !== 'object') return state;
    const revision = Math.max(0, Math.floor(Number(input.revision) || 0));
    if (state && revision < state.revision) return state;
    const next = state || createHotPotatoState(input.duration);
    next.enabled = input.enabled === true;
    next.active = input.active === true;
    next.holder = null;
    next.holderId = String(input.holderId || '').slice(0, 128);
    next.holderName = String(input.holderName || '').slice(0, 32);
    next.holderTeam = ['red', 'blue'].includes(input.holderTeam) ? input.holderTeam : '';
    next.remaining = clamp(Number(input.remaining) || 0, 0, 30);
    next.duration = clamp(Number(input.duration) || 5, 1, 30);
    next.revision = revision;
    next.receivedAt = Number(receivedAt) || 0;
    return next;
}
