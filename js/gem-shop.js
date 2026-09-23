// gem-shop.js — Shop > Gems tab: real-money gem packs (Stripe Checkout) and the
// gem-priced Premium Battle Pass. Prices, bonus % and availability all come from
// the server (/api/payments/catalog); nothing here is a price authority.
// Setup/legal notes: docs/PAYMENTS.md.

import en from './locales/en.js';
import { t } from './i18n.js';

// English reference copy (single source: js/locales/en.js gems.legal); the
// rendered tab uses t('gems.legal.*') so Turkish players read it in Turkish.
export const GEM_LEGAL_COPY = Object.freeze({ ...en.gems.legal });

const PURCHASE_PARAM = 'purchase';
const GEMS_BEFORE_KEY = 'volle:gemsBeforeCheckout';

export function formatPackPrice(amountMinor, currency = 'USD') {
    const code = /^[A-Z]{3}$/.test(String(currency)) ? String(currency) : 'USD';
    const amount = Math.max(0, Number(amountMinor) || 0) / 100;
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'code' }).format(amount);
    } catch {
        return `${code} ${amount.toFixed(2)}`;
    }
}

// Pure view model. `catalog === null` means the fetch has not answered yet.
export function gemShopView(catalog, { gems = 0, battlepassPremium = false } = {}) {
    const balance = Math.max(0, Math.floor(Number(gems) || 0));
    if (!catalog) return { loading: true, enabled: false, packs: [], battlepass: null, gems: balance };
    const enabled = catalog.enabled === true;
    const packs = (Array.isArray(catalog.packs) ? catalog.packs : [])
        .filter(pack => pack && typeof pack.id === 'string' && Number.isInteger(pack.gems) && pack.gems > 0
            && Number.isInteger(pack.amountMinor) && pack.amountMinor > 0)
        .map(pack => ({
            id: pack.id,
            gems: pack.gems,
            label: typeof pack.label === 'string' && pack.label ? pack.label : `${pack.gems} Gems`,
            priceLabel: formatPackPrice(pack.amountMinor, pack.currency),
            bonusLabel: Number(pack.bonusPct) > 0 ? `+${Math.round(Number(pack.bonusPct))}% bonus` : '',
            bestValue: pack.bestValue === true,
            buyable: enabled
        }));
    const bpPrice = Math.floor(Number(catalog.gemPrices?.battlepass_premium) || 0);
    return {
        loading: false,
        enabled,
        packs,
        gems: balance,
        battlepass: bpPrice > 0
            ? { price: bpPrice, owned: battlepassPremium === true, shortfall: Math.max(0, bpPrice - balance) }
            : null
    };
}

// Checkout must only ever send the browser to Stripe's hosted page.
export function isTrustedCheckoutUrl(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === 'https:' && (url.hostname === 'checkout.stripe.com' || url.hostname.endsWith('.stripe.com'));
    } catch {
        return false;
    }
}

export function readPurchaseReturn(search = '') {
    const value = new URLSearchParams(search).get(PURCHASE_PARAM);
    return value === 'success' || value === 'cancel' ? value : '';
}

export function stripPurchaseParams(href) {
    const url = new URL(href);
    // Filter the raw pairs so unrelated flags like `?debug` keep their exact form.
    const kept = url.search.slice(1).split('&').filter(pair => {
        let key = pair.split('=')[0] || '';
        try { key = decodeURIComponent(key); } catch {}
        return pair && key !== PURCHASE_PARAM && key !== 'session_id';
    });
    return url.pathname + (kept.length ? `?${kept.join('&')}` : '') + url.hash;
}

export function rememberGemsBeforeCheckout(gems, storage = globalThis.sessionStorage) {
    try { storage?.setItem(GEMS_BEFORE_KEY, String(Math.max(0, Math.floor(Number(gems) || 0)))); } catch {}
}

export function takeGemsBeforeCheckout(storage = globalThis.sessionStorage) {
    try {
        const raw = storage?.getItem(GEMS_BEFORE_KEY);
        storage?.removeItem(GEMS_BEFORE_KEY);
        const value = Number(raw);
        return raw !== null && raw !== undefined && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

// The webhook can land a moment after Stripe redirects back, so poll the
// server profile a few times. Resolves to the credited amount, or 0.
export async function awaitGemCredit({ before, refresh, readGems, delays = [0, 2000, 4000, 8000, 15000], sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    for (const delay of delays) {
        if (delay) await sleep(delay);
        try { await refresh(); } catch {}
        const now = Math.max(0, Number(readGems()) || 0);
        if (now > before) return now - before;
    }
    return 0;
}

function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// DOM for the Gems tab. Text only via textContent; buttons carry data-* for ui.js.
export function buildGemShop(doc, view) {
    const root = el(doc, 'div', 'gem-shop');
    const head = el(doc, 'div', 'gem-shop-head');
    const title = el(doc, 'div', 'gem-shop-title');
    title.append(el(doc, 'strong', '', t('shop.gems')), el(doc, 'p', '', t('gems.intro')));
    const balance = el(doc, 'span', 'gem-balance', t('gems.balance', { count: view.gems }));
    balance.setAttribute('aria-label', t('gems.balanceAria', { count: view.gems }));
    head.append(title, balance);
    root.appendChild(head);

    if (view.loading) {
        root.appendChild(el(doc, 'p', 'gem-shop-status', t('gems.loadingPacks')));
        return root;
    }
    if (!view.enabled) root.appendChild(el(doc, 'p', 'gem-shop-status is-soon', t('gems.soonNotice')));

    const list = el(doc, 'div', 'gem-pack-list');
    for (const pack of view.packs) {
        const card = el(doc, 'article', `shop-card gem-pack-card${pack.bestValue ? ' is-best-value' : ''}`);
        card.dataset.packId = pack.id;
        if (pack.bestValue) card.appendChild(el(doc, 'span', 'gem-pack-tag', t('gems.bestValue')));
        card.appendChild(el(doc, 'div', 'gem-pack-art', '◆'));
        card.lastChild.setAttribute('aria-hidden', 'true');
        card.appendChild(el(doc, 'div', 'char-name', pack.label));
        card.appendChild(el(doc, 'div', 'gem-pack-bonus', pack.bonusLabel || t('gems.baseRate')));
        card.appendChild(el(doc, 'div', 'gem-pack-price', pack.priceLabel));
        if (pack.buyable) {
            const buy = el(doc, 'button', 'btn btn-primary btn-small gem-pack-buy', t('shop.buyPrice', { price: pack.priceLabel }));
            buy.type = 'button';
            buy.dataset.packId = pack.id;
            buy.dataset.guestReason = 'Create a free account to buy gems. Your gems stay on your account.';
            card.appendChild(buy);
        } else {
            card.appendChild(el(doc, 'span', 'gem-pack-soon', t('gems.comingSoon')));
        }
        list.appendChild(card);
    }
    root.appendChild(list);

    if (view.battlepass) {
        const bp = view.battlepass;
        const card = el(doc, 'article', 'shop-card gem-spend-card');
        card.append(
            el(doc, 'div', 'char-name', t('gems.premiumPass')),
            el(doc, 'div', 'char-desc', t('gems.premiumPassCopy'))
        );
        const button = el(doc, 'button', 'btn btn-secondary btn-small gem-bp-buy',
            bp.owned ? t('gems.premiumUnlockedShort') : t('gems.unlockPrice', { price: bp.price }));
        button.type = 'button';
        button.disabled = bp.owned || bp.shortfall > 0;
        button.dataset.guestReason = 'Create a free account to unlock the Premium Battle Pass.';
        card.appendChild(button);
        if (!bp.owned && bp.shortfall > 0) card.appendChild(el(doc, 'div', 'gem-shortfall', t('gems.needMore', { count: bp.shortfall })));
        root.appendChild(card);
    }

    const legal = el(doc, 'div', 'gem-legal');
    legal.setAttribute('role', 'note');
    legal.append(
        el(doc, 'p', 'gem-legal-final', t('gems.legal.final')),
        el(doc, 'p', '', t('gems.legal.age')),
        el(doc, 'p', '', t('gems.legal.taxes'))
    );
    const links = el(doc, 'p', 'gem-legal-links');
    links.append(el(doc, 'span', '', t('gems.legal.terms')), doc.createTextNode(' · '), el(doc, 'span', '', t('gems.legal.privacy')));
    legal.appendChild(links);
    root.appendChild(legal);
    return root;
}
