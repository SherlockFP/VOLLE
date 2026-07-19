const LIMITS = Object.freeze({
    clans: 100,
    clanMembers: 50,
    messagesPerChannel: 100,
    messageLength: 280,
    privateRooms: 32,
    roomMembers: 16,
    trialsPerUser: 20,
    trialDurationMs: 7 * 24 * 60 * 60 * 1000,
    boostInventory: 99,
    boostDurationMs: 24 * 60 * 60 * 1000,
    boostMultiplier: 5,
    boostedXp: 1000000
});

const MEMBER_ROLES = new Set(['member', 'officer']);
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function assertObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${name} must be an object`);
    }
}

function assertState(state) {
    assertObject(state, 'state');
    for (const key of ['clans', 'clanChats', 'lobbyChats', 'privateRooms', 'cosmetics', 'xpBoosts']) {
        assertObject(state[key], `state.${key}`);
    }
}

function assertId(value, name) {
    if (typeof value !== 'string'
        || RESERVED_IDS.has(value.toLowerCase())
        || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value)) {
        throw new TypeError(`${name} is invalid`);
    }
    return value;
}

function assertText(value, min, max, name) {
    if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
    const text = value.trim().replace(/\s+/g, ' ');
    if (text.length < min || text.length > max) {
        throw new RangeError(`${name} length must be from ${min} to ${max}`);
    }
    return text;
}

function assertInteger(value, min, max, name) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
    }
    return value;
}

function expiryFrom(start, duration, name) {
    const expiry = start + duration;
    if (!Number.isSafeInteger(expiry)) throw new RangeError(`${name} exceeds safe time range`);
    return expiry;
}

function mapSet(map, key, value) {
    return { ...map, [key]: value };
}

function findClanByMember(clans, userId) {
    return Object.values(clans).find(clan => clan.members.some(member => member.userId === userId));
}

function getClan(state, clanId) {
    assertId(clanId, 'clanId');
    const clan = state.clans[clanId];
    if (!clan) throw new Error('clan not found');
    return clan;
}

function getMember(clan, userId) {
    return clan.members.find(member => member.userId === userId);
}

function assertClanManager(clan, actorId) {
    const actor = getMember(clan, actorId);
    if (!actor || !['owner', 'officer'].includes(actor.role)) {
        throw new Error('clan manager role required');
    }
    return actor;
}

function escapeMarkup(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function sanitizeMessage(value) {
    if (typeof value !== 'string') throw new TypeError('message must be a string');
    const clean = escapeMarkup(
        value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
    );
    if (!clean) throw new RangeError('message cannot be empty');
    if (clean.length > LIMITS.messageLength) {
        throw new RangeError(`message cannot exceed ${LIMITS.messageLength} characters`);
    }
    return clean;
}

export function createSocialState() {
    return {
        clans: {},
        clanChats: {},
        lobbyChats: {},
        privateRooms: {},
        cosmetics: {},
        xpBoosts: {}
    };
}

export function createClan(state, {
    clanId,
    name,
    tag,
    ownerId,
    createdAt
}) {
    assertState(state);
    assertId(clanId, 'clanId');
    assertId(ownerId, 'ownerId');
    assertInteger(createdAt, 0, Number.MAX_SAFE_INTEGER, 'createdAt');
    const cleanName = assertText(name, 3, 32, 'name');
    const cleanTag = assertText(tag, 2, 5, 'tag').toUpperCase();
    if (state.clans[clanId]) throw new Error('clanId already exists');
    if (Object.keys(state.clans).length >= LIMITS.clans) throw new Error('clan limit reached');
    if (findClanByMember(state.clans, ownerId)) throw new Error('user already belongs to a clan');
    if (Object.values(state.clans).some(clan => clan.name.toLowerCase() === cleanName.toLowerCase())) {
        throw new Error('clan name already exists');
    }
    if (Object.values(state.clans).some(clan => clan.tag === cleanTag)) {
        throw new Error('clan tag already exists');
    }
    const clan = {
        id: clanId,
        name: cleanName,
        tag: cleanTag,
        ownerId,
        createdAt,
        members: [{ userId: ownerId, role: 'owner', joinedAt: createdAt }]
    };
    return { ...state, clans: mapSet(state.clans, clanId, clan) };
}

export function joinClan(state, { clanId, userId, joinedAt }) {
    assertState(state);
    assertId(userId, 'userId');
    assertInteger(joinedAt, 0, Number.MAX_SAFE_INTEGER, 'joinedAt');
    const clan = getClan(state, clanId);
    if (findClanByMember(state.clans, userId)) throw new Error('user already belongs to a clan');
    if (clan.members.length >= LIMITS.clanMembers) throw new Error('clan is full');
    return {
        ...state,
        clans: mapSet(state.clans, clanId, {
            ...clan,
            members: [...clan.members, { userId, role: 'member', joinedAt }]
        })
    };
}

export function leaveClan(state, { clanId, userId }) {
    assertState(state);
    assertId(userId, 'userId');
    const clan = getClan(state, clanId);
    const member = getMember(clan, userId);
    if (!member) throw new Error('user is not a clan member');
    if (member.role === 'owner' && clan.members.length > 1) {
        throw new Error('owner must transfer ownership before leaving');
    }
    if (clan.members.length === 1) {
        const { [clanId]: unusedClan, ...clans } = state.clans;
        const { [clanId]: unusedChat, ...clanChats } = state.clanChats;
        return { ...state, clans, clanChats };
    }
    return {
        ...state,
        clans: mapSet(state.clans, clanId, {
            ...clan,
            members: clan.members.filter(item => item.userId !== userId)
        })
    };
}

export function setClanMemberRole(state, {
    clanId,
    actorId,
    userId,
    role
}) {
    assertState(state);
    assertId(actorId, 'actorId');
    assertId(userId, 'userId');
    const clan = getClan(state, clanId);
    const actor = assertClanManager(clan, actorId);
    const target = getMember(clan, userId);
    if (!target) throw new Error('user is not a clan member');

    if (role === 'owner') {
        if (actor.role !== 'owner') throw new Error('only owner can transfer ownership');
        if (target.role === 'owner') return state;
        return {
            ...state,
            clans: mapSet(state.clans, clanId, {
                ...clan,
                ownerId: userId,
                members: clan.members.map(member => {
                    if (member.userId === actorId) return { ...member, role: 'officer' };
                    if (member.userId === userId) return { ...member, role: 'owner' };
                    return member;
                })
            })
        };
    }

    if (!MEMBER_ROLES.has(role)) throw new TypeError('role must be owner, officer, or member');
    if (target.role === 'owner') throw new Error('owner role must be transferred');
    if (actor.role !== 'owner' && (target.role === 'officer' || role === 'officer')) {
        throw new Error('only owner can manage officers');
    }
    return {
        ...state,
        clans: mapSet(state.clans, clanId, {
            ...clan,
            members: clan.members.map(member => (
                member.userId === userId ? { ...member, role } : member
            ))
        })
    };
}

export function listClans(state) {
    assertState(state);
    return Object.values(state.clans)
        .map(clan => ({ ...clan, members: clan.members.map(member => ({ ...member })) }))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function appendMessage(messages, input) {
    assertId(input.messageId, 'messageId');
    assertId(input.senderId, 'senderId');
    assertInteger(input.sentAt, 0, Number.MAX_SAFE_INTEGER, 'sentAt');
    if (messages.some(message => message.id === input.messageId)) {
        throw new Error('messageId already exists');
    }
    const message = {
        id: input.messageId,
        senderId: input.senderId,
        text: sanitizeMessage(input.text),
        sentAt: input.sentAt
    };
    return [...messages, message].slice(-LIMITS.messagesPerChannel);
}

export function appendClanMessage(state, { clanId, ...input }) {
    assertState(state);
    const clan = getClan(state, clanId);
    if (!getMember(clan, input.senderId)) throw new Error('sender is not a clan member');
    const messages = appendMessage(state.clanChats[clanId] || [], input);
    return { ...state, clanChats: mapSet(state.clanChats, clanId, messages) };
}

export function appendLobbyMessage(state, { lobbyId, ...input }) {
    assertState(state);
    assertId(lobbyId, 'lobbyId');
    const messages = appendMessage(state.lobbyChats[lobbyId] || [], input);
    return { ...state, lobbyChats: mapSet(state.lobbyChats, lobbyId, messages) };
}

export function createPrivateRoom(state, {
    roomId,
    ownerId,
    name,
    code,
    maxPlayers = 8,
    createdAt
}) {
    assertState(state);
    assertId(roomId, 'roomId');
    assertId(ownerId, 'ownerId');
    assertInteger(createdAt, 0, Number.MAX_SAFE_INTEGER, 'createdAt');
    assertInteger(maxPlayers, 2, LIMITS.roomMembers, 'maxPlayers');
    if (state.privateRooms[roomId]) throw new Error('roomId already exists');
    if (Object.keys(state.privateRooms).length >= LIMITS.privateRooms) {
        throw new Error('private room limit reached');
    }
    const room = {
        id: roomId,
        ownerId,
        name: assertText(name, 1, 40, 'name'),
        code: assertText(code, 4, 32, 'code'),
        maxPlayers,
        createdAt,
        updatedAt: createdAt,
        members: [ownerId]
    };
    return { ...state, privateRooms: mapSet(state.privateRooms, roomId, room) };
}

export function joinPrivateRoom(state, {
    roomId,
    userId,
    code,
    joinedAt
}) {
    assertState(state);
    assertId(userId, 'userId');
    assertInteger(joinedAt, 0, Number.MAX_SAFE_INTEGER, 'joinedAt');
    const room = state.privateRooms[assertId(roomId, 'roomId')];
    if (!room) throw new Error('private room not found');
    if (room.code !== code) throw new Error('private room code is invalid');
    if (room.members.includes(userId)) return state;
    if (room.members.length >= room.maxPlayers) throw new Error('private room is full');
    return {
        ...state,
        privateRooms: mapSet(state.privateRooms, roomId, {
            ...room,
            updatedAt: joinedAt,
            members: [...room.members, userId]
        })
    };
}

export function leavePrivateRoom(state, { roomId, userId, leftAt }) {
    assertState(state);
    assertId(userId, 'userId');
    assertInteger(leftAt, 0, Number.MAX_SAFE_INTEGER, 'leftAt');
    const room = state.privateRooms[assertId(roomId, 'roomId')];
    if (!room) throw new Error('private room not found');
    if (!room.members.includes(userId)) throw new Error('user is not in private room');
    if (userId === room.ownerId) {
        const { [roomId]: unusedRoom, ...privateRooms } = state.privateRooms;
        return { ...state, privateRooms };
    }
    return {
        ...state,
        privateRooms: mapSet(state.privateRooms, roomId, {
            ...room,
            updatedAt: leftAt,
            members: room.members.filter(id => id !== userId)
        })
    };
}

export function listPrivateRooms(state) {
    assertState(state);
    return Object.values(state.privateRooms)
        .map(({ code, ...room }) => ({ ...room, members: [...room.members] }))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function getCosmeticUser(state, userId) {
    return state.cosmetics[userId] || { trials: [] };
}

export function startCosmeticTrial(state, {
    userId,
    cosmeticId,
    startedAt,
    durationMs
}) {
    assertState(state);
    assertId(userId, 'userId');
    assertId(cosmeticId, 'cosmeticId');
    assertInteger(startedAt, 0, Number.MAX_SAFE_INTEGER, 'startedAt');
    assertInteger(durationMs, 1, LIMITS.trialDurationMs, 'durationMs');
    const user = getCosmeticUser(state, userId);
    const active = user.trials.filter(trial => trial.expiresAt > startedAt);
    if (active.some(trial => trial.cosmeticId === cosmeticId)) {
        throw new Error('cosmetic trial is already active');
    }
    if (active.length >= LIMITS.trialsPerUser) throw new Error('cosmetic trial limit reached');
    const trial = {
        cosmeticId,
        startedAt,
        expiresAt: expiryFrom(startedAt, durationMs, 'cosmetic trial')
    };
    return {
        ...state,
        cosmetics: mapSet(state.cosmetics, userId, { trials: [...active, trial] })
    };
}

export function getActiveCosmeticTrials(state, userId, now) {
    assertState(state);
    assertId(userId, 'userId');
    assertInteger(now, 0, Number.MAX_SAFE_INTEGER, 'now');
    return getCosmeticUser(state, userId).trials
        .filter(trial => trial.expiresAt > now)
        .map(trial => ({ ...trial }));
}

export function pruneExpiredCosmeticTrials(state, now) {
    assertState(state);
    assertInteger(now, 0, Number.MAX_SAFE_INTEGER, 'now');
    const cosmetics = {};
    for (const [userId, user] of Object.entries(state.cosmetics)) {
        const trials = user.trials.filter(trial => trial.expiresAt > now);
        if (trials.length) cosmetics[userId] = { trials };
    }
    return { ...state, cosmetics };
}

function getBoostUser(state, userId) {
    return state.xpBoosts[userId] || { inventory: {}, active: null };
}

export function grantXpBoost(state, {
    userId,
    boostId,
    quantity = 1,
    multiplier,
    durationMs
}) {
    assertState(state);
    assertId(userId, 'userId');
    assertId(boostId, 'boostId');
    assertInteger(quantity, 1, LIMITS.boostInventory, 'quantity');
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)
        || multiplier <= 1 || multiplier > LIMITS.boostMultiplier) {
        throw new RangeError(`multiplier must be greater than 1 and at most ${LIMITS.boostMultiplier}`);
    }
    assertInteger(durationMs, 1, LIMITS.boostDurationMs, 'durationMs');
    const user = getBoostUser(state, userId);
    const existing = user.inventory[boostId];
    if (existing
        && (existing.multiplier !== multiplier || existing.durationMs !== durationMs)) {
        throw new Error('boostId definition does not match inventory');
    }
    const current = existing?.quantity || 0;
    if (current + quantity > LIMITS.boostInventory) throw new Error('boost inventory limit reached');
    const boost = { boostId, quantity: current + quantity, multiplier, durationMs };
    return {
        ...state,
        xpBoosts: mapSet(state.xpBoosts, userId, {
            active: user.active ? { ...user.active } : null,
            inventory: mapSet(user.inventory, boostId, boost)
        })
    };
}

export function activateXpBoost(state, { userId, boostId, activatedAt }) {
    assertState(state);
    assertId(userId, 'userId');
    assertId(boostId, 'boostId');
    assertInteger(activatedAt, 0, Number.MAX_SAFE_INTEGER, 'activatedAt');
    const user = getBoostUser(state, userId);
    if (user.active && user.active.expiresAt > activatedAt) {
        throw new Error('an XP boost is already active');
    }
    const boost = user.inventory[boostId];
    if (!boost?.quantity) throw new Error('XP boost is not in inventory');
    const inventory = { ...user.inventory };
    if (boost.quantity === 1) delete inventory[boostId];
    else inventory[boostId] = { ...boost, quantity: boost.quantity - 1 };
    const active = {
        boostId,
        multiplier: boost.multiplier,
        activatedAt,
        expiresAt: expiryFrom(activatedAt, boost.durationMs, 'XP boost')
    };
    return {
        ...state,
        xpBoosts: mapSet(state.xpBoosts, userId, { inventory, active })
    };
}

export function getActiveXpBoost(state, userId, now) {
    assertState(state);
    assertId(userId, 'userId');
    assertInteger(now, 0, Number.MAX_SAFE_INTEGER, 'now');
    const active = getBoostUser(state, userId).active;
    return active && active.expiresAt > now ? { ...active } : null;
}

export function applyXpBoost(state, { userId, baseXp, at }) {
    assertInteger(baseXp, 0, LIMITS.boostedXp, 'baseXp');
    const active = getActiveXpBoost(state, userId, at);
    return active ? Math.min(LIMITS.boostedXp, Math.floor(baseXp * active.multiplier)) : baseXp;
}

export const SOCIAL_LIMITS = LIMITS;
