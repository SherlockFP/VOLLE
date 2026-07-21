import { AVATAR_SKINS } from './avatar.js';

export const COSMETIC_PRACTICE_MAP_ID = 'cosmetic_studio';
export const COSMETIC_PRACTICE_CATALOG_ORDER = Object.freeze(Object.keys(AVATAR_SKINS));

const DEFAULT_SKIN_ID = 'default';
const DEFAULT_RETURN_SCREEN = 'shop';
const SCREEN_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function isCosmeticPracticeSkinId(skinId) {
    return typeof skinId === 'string' && Object.hasOwn(AVATAR_SKINS, skinId);
}

function requireSkinId(skinId) {
    if (!isCosmeticPracticeSkinId(skinId)) throw new RangeError(`Unknown avatar skin: ${String(skinId)}`);
    return skinId;
}

function requireReturnScreen(returnScreen) {
    if (typeof returnScreen !== 'string' || !SCREEN_ID_PATTERN.test(returnScreen)) {
        throw new TypeError('returnScreen must be a safe screen id');
    }
    return returnScreen;
}

function normalizeCurrency(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeOwnedSkinIds(value) {
    const source = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
    return new Set(source.filter(isCosmeticPracticeSkinId));
}

export function getCosmeticPracticeSkin(skinId) {
    return isCosmeticPracticeSkinId(skinId) ? AVATAR_SKINS[skinId] : null;
}

export function getCosmeticPracticeCatalog() {
    return Object.freeze(COSMETIC_PRACTICE_CATALOG_ORDER.map(skinId => AVATAR_SKINS[skinId]));
}

export function getCosmeticPracticeEligibility(skinId, {
    currency = 0,
    ownedSkinIds = [],
    equippedSkinId = DEFAULT_SKIN_ID
} = {}) {
    const selectedId = requireSkinId(skinId);
    const equippedId = isCosmeticPracticeSkinId(equippedSkinId) ? equippedSkinId : DEFAULT_SKIN_ID;
    const owned = normalizeOwnedSkinIds(ownedSkinIds).has(selectedId);
    const price = AVATAR_SKINS[selectedId].price;
    const balance = normalizeCurrency(currency);
    const equipped = selectedId === equippedId;
    return Object.freeze({
        skinId: selectedId,
        price,
        balance,
        owned,
        equipped,
        canPurchase: !owned && balance >= price,
        canEquip: owned && !equipped
    });
}

export class CosmeticPracticeSession {
    constructor({
        currency = 0,
        ownedSkinIds = [DEFAULT_SKIN_ID],
        equippedSkinId = DEFAULT_SKIN_ID
    } = {}) {
        this.active = false;
        this.currency = normalizeCurrency(currency);
        this.ownedSkinIds = normalizeOwnedSkinIds(ownedSkinIds);
        this.equippedSkinId = isCosmeticPracticeSkinId(equippedSkinId) ? equippedSkinId : DEFAULT_SKIN_ID;
        this.selectedSkinId = this.equippedSkinId;
        this.restoreSkinId = this.equippedSkinId;
        this.returnScreen = DEFAULT_RETURN_SCREEN;
    }

    open(skinId = this.equippedSkinId, returnScreen = DEFAULT_RETURN_SCREEN) {
        this.selectedSkinId = requireSkinId(skinId);
        this.returnScreen = requireReturnScreen(returnScreen);
        this.restoreSkinId = this.equippedSkinId;
        this.active = true;
        return this.snapshot();
    }

    selectSkin(skinId) {
        this.selectedSkinId = requireSkinId(skinId);
        return this.snapshot();
    }

    next() {
        return this._selectOffset(1);
    }

    previous() {
        return this._selectOffset(-1);
    }

    syncCommerce({ currency, ownedSkinIds, equippedSkinId } = {}) {
        if (currency !== undefined) this.currency = normalizeCurrency(currency);
        if (ownedSkinIds !== undefined) this.ownedSkinIds = normalizeOwnedSkinIds(ownedSkinIds);
        if (equippedSkinId !== undefined) {
            this.equippedSkinId = requireSkinId(equippedSkinId);
            this.restoreSkinId = this.equippedSkinId;
        }
        return this.snapshot();
    }

    restore() {
        this.selectedSkinId = this.restoreSkinId;
        return this.snapshot();
    }

    close() {
        this.restore();
        this.active = false;
        return this.snapshot();
    }

    snapshot() {
        const eligibility = getCosmeticPracticeEligibility(this.selectedSkinId, {
            currency: this.currency,
            ownedSkinIds: this.ownedSkinIds,
            equippedSkinId: this.equippedSkinId
        });
        return Object.freeze({
            active: this.active,
            mapId: COSMETIC_PRACTICE_MAP_ID,
            returnScreen: this.returnScreen,
            selectedSkinId: this.selectedSkinId,
            restoreSkinId: this.restoreSkinId,
            catalogIndex: COSMETIC_PRACTICE_CATALOG_ORDER.indexOf(this.selectedSkinId),
            catalogSize: COSMETIC_PRACTICE_CATALOG_ORDER.length,
            skin: AVATAR_SKINS[this.selectedSkinId],
            eligibility
        });
    }

    _selectOffset(offset) {
        const current = COSMETIC_PRACTICE_CATALOG_ORDER.indexOf(this.selectedSkinId);
        const next = (current + offset + COSMETIC_PRACTICE_CATALOG_ORDER.length)
            % COSMETIC_PRACTICE_CATALOG_ORDER.length;
        return this.selectSkin(COSMETIC_PRACTICE_CATALOG_ORDER[next]);
    }
}
