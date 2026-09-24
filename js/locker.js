// locker.js — pure data helpers for the Locker (js/ui.js renders, js/main.js wires).
// No DOM and no Three.js: catalogs and player state are passed in, so tests can use
// it directly. Ownership, prices and equip rules stay in Store / the server; this
// module only decides what the Locker shows and in which order.
import { tierForRarity, tierRank } from './tiers.js';

// Inventory filter chips, in display order. `gloves` and `wearable` split the
// wearable catalog (gloves are their own loadout slot).
export const LOCKER_FILTERS = Object.freeze(['all', 'knife', 'gloves', 'ball', 'avatar', 'wearable']);
export const LOCKER_SORTS = Object.freeze(['rarity', 'newest', 'name']);
export const LOCKER_SEEN_KEY = 'volle.locker.seen.v1';
export const LOCKER_FAVORITES_KEY = 'volle.locker.favorites.v1';

// Where a locked item can be obtained. Knives only drop from cases; everything else
// has a Shop tab. The Locker only links there — it never sells anything itself.
export const LOCKER_SOURCE_TAB = Object.freeze({
    knife: 'cases',
    gloves: 'wearables',
    wearable: 'wearables',
    ball: 'balls',
    avatar: 'avatars'
});

export const entryKey = (group, id) => `${group}:${id}`;

export function lockerSlotFor(group, item = {}) {
    if (group === 'cosmetic') return item.type === 'gloves' ? 'gloves' : 'wearable';
    if (group === 'knife' || group === 'ball' || group === 'avatar') return group;
    return 'wearable';
}

const list = value => (Array.isArray(value) ? value : []);
const asSet = value => (value instanceof Set ? value : new Set(list(value)));

// Catalogs: { knives, cosmetics, balls, avatars } as id -> item maps.
// State: owned id arrays (acquisition order), equipped ids, seen/favorite key sets.
export function buildLockerEntries(catalogs = {}, state = {}) {
    const seen = asSet(state.seen);
    const favorites = asSet(state.favorites);
    const equippedKnives = state.equippedKnives || {};
    const equippedWearables = state.equippedWearables || {};
    const sources = [
        ['knife', catalogs.knives, list(state.ownedKnives), item => Object.values(equippedKnives).includes(item.id)],
        ['cosmetic', catalogs.cosmetics, list(state.ownedCosmetics), item => equippedWearables[item.type] === item.id],
        ['ball', catalogs.balls, list(state.ownedBalls), item => (state.equippedBall || 'classic') === item.id],
        ['avatar', catalogs.avatars, list(state.ownedAvatarSkins), item => (state.equippedAvatar || 'default') === item.id]
    ];
    const entries = [];
    for (const [group, catalog, owned, isEquipped] of sources) {
        let catalogIndex = 0;
        for (const [id, raw] of Object.entries(catalog || {})) {
            const item = { ...raw, id: raw?.id || id };
            const acquired = owned.indexOf(item.id);
            const key = entryKey(group, item.id);
            const isOwned = acquired !== -1;
            const rarity = item.rarity || 'common';
            entries.push(Object.freeze({
                key,
                id: item.id,
                group,
                slot: lockerSlotFor(group, item),
                item,
                name: String(item.name || item.id),
                rarity,
                tier: tierForRarity(rarity),
                tierRank: tierRank(rarity),
                owned: isOwned,
                equipped: isOwned && Boolean(isEquipped(item)),
                acquired,
                catalogIndex: catalogIndex++,
                isNew: isOwned && !seen.has(key),
                favorite: favorites.has(key)
            }));
        }
    }
    return entries;
}

// Case- and accent-insensitive search that also folds Turkish dotted/dotless i.
export function normalizeLockerQuery(value) {
    return String(value ?? '')
        .replace(/[İIı]/g, 'i')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function filterLockerEntries(entries, { filter = 'all', query = '', showLocked = true } = {}) {
    const slot = LOCKER_FILTERS.includes(filter) ? filter : 'all';
    const needle = normalizeLockerQuery(query);
    return list(entries).filter(entry => (slot === 'all' || entry.slot === slot)
        && (showLocked || entry.owned)
        && (!needle || normalizeLockerQuery(entry.name).includes(needle)));
}

// Favourites first, then owned before locked, then the chosen order. Stable: ties
// keep catalog order so the grid never shuffles between renders.
export function sortLockerEntries(entries, sort = 'rarity') {
    const mode = LOCKER_SORTS.includes(sort) ? sort : 'rarity';
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const byMode = {
        rarity: (a, b) => a.tierRank - b.tierRank || byName(a, b),
        newest: (a, b) => b.acquired - a.acquired || a.tierRank - b.tierRank || byName(a, b),
        name: (a, b) => byName(a, b) || a.tierRank - b.tierRank
    }[mode];
    return list(entries)
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => (Number(b.entry.favorite) - Number(a.entry.favorite))
            || (Number(b.entry.owned) - Number(a.entry.owned))
            || byMode(a.entry, b.entry)
            || a.index - b.index)
        .map(({ entry }) => entry);
}

// "12 / 58" per filter chip; `fresh` is the unseen (NEW) count.
export function lockerCounts(entries) {
    const counts = Object.fromEntries(LOCKER_FILTERS.map(filter => [filter, { owned: 0, total: 0, fresh: 0 }]));
    for (const entry of list(entries)) {
        for (const bucket of [counts.all, counts[entry.slot]]) {
            if (!bucket) continue;
            bucket.total++;
            if (entry.owned) bucket.owned++;
            if (entry.isNew) bucket.fresh++;
        }
    }
    return counts;
}

// localStorage-backed id sets (seen items, favourites). Private windows and blocked
// storage fall back to an in-memory set: the Locker still works, it just forgets.
export function readKeySet(storage, key) {
    try {
        const raw = storage?.getItem?.(key);
        if (raw == null) return null;
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []);
    } catch {
        return null;
    }
}

export function writeKeySet(storage, key, set) {
    try {
        storage?.setItem?.(key, JSON.stringify([...set].slice(-2000)));
        return true;
    } catch {
        return false;
    }
}

// First Locker visit: everything already owned counts as seen, so NEW only marks
// drops that arrive afterwards instead of the whole starting collection.
export function seedSeenKeys(seen, entries) {
    if (seen) return seen;
    return new Set(list(entries).filter(entry => entry.owned).map(entry => entry.key));
}

// Knife inspect in the Locker preview: the rig plays the same keyframed tracks as
// the first-person viewmodel (js/knife-animation.js), inspect then twirl.
export const LOCKER_INSPECT_DURATIONS = Object.freeze({ inspect: 1.65, rareInspect: 2.35, twirl: .62, spin: 1.2 });

export function lockerInspectPlan({ knifeId = 'training', rarity = 'common' } = {}) {
    if (!knifeId || knifeId === 'training') {
        return Object.freeze([Object.freeze({ action: 'spin', duration: LOCKER_INSPECT_DURATIONS.spin })]);
    }
    const rare = ['legendary', 'exotic'].includes(String(rarity).toLowerCase());
    return Object.freeze([
        Object.freeze({ action: 'inspect', variant: rare ? 'rare' : 'default', duration: rare ? LOCKER_INSPECT_DURATIONS.rareInspect : LOCKER_INSPECT_DURATIONS.inspect }),
        Object.freeze({ action: 'twirl', variant: 'default', duration: LOCKER_INSPECT_DURATIONS.twirl })
    ]);
}

// Where `elapsed` seconds into a plan the preview is: the step and its 0..1
// progress, or null once the whole plan has finished.
export function sampleLockerInspect(plan, elapsed) {
    let time = Math.max(0, Number(elapsed) || 0);
    for (let index = 0; index < list(plan).length; index++) {
        const step = plan[index];
        if (time < step.duration) return { index, step, progress: step.duration > 0 ? time / step.duration : 1 };
        time -= step.duration;
    }
    return null;
}
