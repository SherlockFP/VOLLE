// CS:GO-style match drops: "Kaan has received: Glacier Lock". Each player's drops
// are announced to the whole lobby. Your own slide in on the right, everyone
// else's on the left, and the post-game report lists who got what. Items are
// resolved from the local catalogs by id, so a peer can only name real items,
// never send free text; names only ever reach the DOM through textContent.
import { ARENA_CARDS } from './cards.js';
import { CASES } from './cosmetics.js';

export const DROP_TOAST_MS = 6500;
export const MAX_DROPS_PER_PLAYER = 4;
const MAX_TOASTS_PER_SIDE = 4;
const MAX_LOGGED_MATCHES = 4;

export function resolveDrop(drop) {
    if (!drop || typeof drop.id !== 'string') return null;
    if (drop.type === 'card' && Object.hasOwn(ARENA_CARDS, drop.id)) {
        const card = ARENA_CARDS[drop.id];
        return { type: 'card', id: card.id, name: card.name, rarity: card.rarity, bonus: drop.bonus === true };
    }
    if (drop.type === 'case' && Object.hasOwn(CASES, drop.id)) {
        const box = CASES[drop.id];
        return { type: 'case', id: box.id, name: box.name, rarity: 'case', bonus: false };
    }
    return null;
}

export function sanitizeDrops(list) {
    return (Array.isArray(list) ? list : []).map(resolveDrop).filter(Boolean).slice(0, MAX_DROPS_PER_PLAYER);
}

// Network form: ids only.
export function packDrops(list) {
    return sanitizeDrops(list).map(drop => (drop.bonus ? { type: drop.type, id: drop.id, bonus: true } : { type: drop.type, id: drop.id }));
}

const fallbackT = (key, params = {}) => ({
    'drops.received': `${params.name} has received:`,
    'drops.youReceived': 'You received:',
    'drops.card': 'Arena card',
    'drops.case': 'Case',
    'drops.extra': 'Extra drop'
}[key] ?? key);

export class DropFeed {
    constructor(doc = globalThis.document, { t = fallbackT, onDrop = null } = {}) {
        this.doc = doc;
        this.t = t;
        this.onDrop = onDrop;
        this.logs = new Map(); // matchId -> Map(playerKey -> { name, self, drops })
        this.logMatchId = null;
    }

    _rarityLabel(drop) {
        if (drop.type === 'case') return this.t('drops.case');
        const label = this.t(`rarity.${drop.rarity}`);
        return `${label === `rarity.${drop.rarity}` ? drop.rarity : label} · ${this.t('drops.card')}`;
    }

    // { matchId, playerKey, name, self, drops } -> number of drops shown (0 for a repeat).
    announce({ matchId, playerKey, name, self = false, drops } = {}) {
        if (typeof matchId !== 'string' || !matchId || !playerKey) return 0;
        const items = sanitizeDrops(drops);
        if (!items.length) return 0;
        let log = this.logs.get(matchId);
        if (!log) {
            log = new Map();
            this.logs.set(matchId, log);
            while (this.logs.size > MAX_LOGGED_MATCHES) this.logs.delete(this.logs.keys().next().value);
        }
        if (log.has(playerKey)) return 0; // retries and relay echoes
        const entry = { name: String(name || 'Player').slice(0, 24), self: self === true, drops: items };
        log.set(playerKey, entry);
        for (const drop of items) this._toast(entry, drop);
        if (this.logMatchId === matchId) this.renderLog();
        this.onDrop?.(entry);
        return items.length;
    }

    entries(matchId) {
        return [...(this.logs.get(matchId)?.values() || [])];
    }

    _side(self) {
        const doc = this.doc;
        if (!doc?.createElement) return null;
        const id = self ? 'drop-feed-self' : 'drop-feed-others';
        let side = doc.getElementById(id);
        if (!side) {
            side = doc.createElement('div');
            side.id = id;
            side.className = `drop-feed ${self ? 'drop-feed-right' : 'drop-feed-left'}`;
            side.setAttribute('aria-live', 'polite');
            doc.body?.appendChild(side);
        }
        return side;
    }

    _itemNode(drop, tag = 'span') {
        const doc = this.doc;
        const item = doc.createElement(tag);
        item.className = `drop-item rarity-${drop.rarity}`;
        const name = doc.createElement('strong');
        name.textContent = drop.name;
        const meta = doc.createElement('small');
        meta.textContent = drop.bonus ? `${this._rarityLabel(drop)} · ${this.t('drops.extra')}` : this._rarityLabel(drop);
        item.append(name, meta);
        return item;
    }

    _toast(entry, drop) {
        const side = this._side(entry.self);
        if (!side) return;
        const doc = this.doc;
        const toast = doc.createElement('div');
        toast.className = `drop-toast rarity-${drop.rarity}${entry.self ? ' is-self' : ''}`;
        const who = doc.createElement('span');
        who.className = 'drop-toast-who';
        who.textContent = entry.self ? this.t('drops.youReceived') : this.t('drops.received', { name: entry.name });
        toast.append(who, this._itemNode(drop));
        side.appendChild(toast);
        while (side.children.length > MAX_TOASTS_PER_SIDE) side.firstElementChild.remove();
        setTimeout(() => toast.classList.add('is-leaving'), DROP_TOAST_MS - 400);
        setTimeout(() => toast.remove(), DROP_TOAST_MS);
    }

    // The post-game "who got what" list follows one match at a time.
    bindLog(matchId) {
        this.logMatchId = typeof matchId === 'string' ? matchId : null;
        this.renderLog();
    }

    renderLog() {
        const doc = this.doc;
        const wrap = doc?.getElementById?.('pg-drop-log');
        const list = doc?.getElementById?.('pg-drop-log-list');
        if (!wrap || !list) return 0;
        const entries = this.logMatchId ? this.entries(this.logMatchId) : [];
        list.replaceChildren();
        for (const entry of entries) {
            const row = doc.createElement('li');
            row.className = `pg-drop-row${entry.self ? ' is-self' : ''}`;
            const name = doc.createElement('span');
            name.className = 'pg-drop-name';
            name.textContent = entry.name;
            const items = doc.createElement('span');
            items.className = 'pg-drop-items';
            for (const drop of entry.drops) items.append(this._itemNode(drop));
            row.append(name, items);
            list.append(row);
        }
        wrap.hidden = entries.length === 0;
        return entries.length;
    }
}
