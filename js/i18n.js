// i18n.js — tiny TR/EN localisation. No dependencies.
//
//   t('menu.play')                       -> "Play" / "Oyna"
//   t('lobby.bots', { count: 3 })        -> "{count}" interpolation; a locale value may be
//                                           { one, other } and is picked by params.count.
//   setLanguage('tr')                    -> persists, sets <html lang>, re-runs applyI18n and
//                                           dispatches `volle:language` on document.
//   applyI18n(root)                      -> fills [data-i18n] text and
//                                           [data-i18n-attr="placeholder:key;title:key"].
//
// Missing key: English value, else the key itself (one console.warn per key).
// Dynamic UI can call setText(el, key, params): it writes the text *and* tags the
// element so a later language switch re-renders it without the caller's help.
import en from './locales/en.js';
import tr from './locales/tr.js';

export const LANGUAGES = Object.freeze([
    { id: 'en', label: 'English' },
    { id: 'tr', label: 'Türkçe' }
]);
export const LANGUAGE_STORAGE_KEY = 'volle_language';
export const LANGUAGE_EVENT = 'volle:language';

const TABLES = { en, tr };
let current = 'en';
const warned = new Set();

export function isSupportedLanguage(lang) {
    return Object.prototype.hasOwnProperty.call(TABLES, lang);
}

function readSaved(storage) {
    try { return storage?.getItem?.(LANGUAGE_STORAGE_KEY) || null; } catch { return null; }
}

// Saved choice wins; otherwise a browser language starting with "tr" picks Turkish.
export function detectLanguage({ saved, navigatorLanguages } = {}) {
    if (isSupportedLanguage(saved)) return saved;
    const list = Array.isArray(navigatorLanguages) ? navigatorLanguages : [navigatorLanguages];
    const first = list.find(lang => typeof lang === 'string' && lang);
    return first && first.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

function lookup(table, key) {
    let node = table;
    for (const part of String(key).split('.')) {
        if (node == null || typeof node !== 'object') return undefined;
        node = node[part];
    }
    return node;
}

function pickPlural(value, count) {
    if (value && typeof value === 'object') {
        const n = Number(count);
        return (n === 1 && value.one !== undefined) ? value.one : (value.other ?? value.one);
    }
    return value;
}

function interpolate(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(params, name) && params[name] != null ? String(params[name]) : match
    ));
}

function resolve(lang, key, count) {
    const value = pickPlural(lookup(TABLES[lang], key), count);
    return typeof value === 'string' ? value : undefined;
}

export function t(key, params) {
    const count = params?.count;
    let text = resolve(current, key, count);
    if (text === undefined && current !== 'en') text = resolve('en', key, count);
    if (text === undefined) {
        if (!warned.has(key)) {
            warned.add(key);
            try { console.warn(`[i18n] missing key: ${key}`); } catch { /* no console */ }
        }
        return String(key);
    }
    return interpolate(text, params);
}

// True when the key exists in the active language or the English fallback.
export function hasKey(key) {
    return resolve(current, key, 2) !== undefined || resolve('en', key, 2) !== undefined;
}

// Localised display name for a catalog id (modes, sports, characters…), falling
// back to the catalog's own English name when the table has no entry.
export function localizedName(group, id, fallback) {
    const key = `${group}.${id}`;
    return id != null && hasKey(key) ? t(key) : (fallback ?? String(id ?? ''));
}

export function plural(count, one, other) {
    return Number(count) === 1 ? one : other;
}

export function getLanguage() {
    return current;
}

// Replace only the element's own text; keep child icons/markup (e.g. <svg> + label).
function writeText(el, text) {
    const nodes = el.childNodes ? [...el.childNodes] : [];
    const hasElements = nodes.some(node => node.nodeType === 1);
    if (!hasElements) {
        if (el.textContent !== text) el.textContent = text;
        return;
    }
    const target = nodes.filter(node => node.nodeType === 3 && node.data.trim()).pop();
    if (!target) {
        el.appendChild(el.ownerDocument.createTextNode(text));
        return;
    }
    const lead = target.data.match(/^\s*/)[0];
    const tail = target.data.match(/\s*$/)[0];
    const next = lead + text + tail;
    if (target.data !== next) target.data = next;
}

function readParams(el) {
    const raw = el.getAttribute?.('data-i18n-params');
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
}

export function applyI18n(root = globalThis.document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) writeText(el, t(key, readParams(el)));
    });
    // Only for static hint lines whose locale value carries <kbd> markup. Locale
    // tables are trusted source files; never point this at user or server text.
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        const html = key ? t(key) : '';
        if (html && el.innerHTML !== html) el.innerHTML = html;
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => {
        for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
            const at = pair.indexOf(':');
            if (at < 1) continue;
            const attr = pair.slice(0, at).trim();
            const key = pair.slice(at + 1).trim();
            if (attr && key) el.setAttribute(attr, t(key));
        }
    });
}

// Dynamic text that follows language switches. Pass key=null to write plain text
// (e.g. a server error) and drop any previous localisation tag.
export function setText(el, key, params) {
    if (!el) return;
    if (!key) {
        el.removeAttribute?.('data-i18n');
        el.removeAttribute?.('data-i18n-params');
        el.textContent = params == null ? '' : String(params);
        return;
    }
    el.setAttribute('data-i18n', key);
    if (params && Object.keys(params).length) el.setAttribute('data-i18n-params', JSON.stringify(params));
    else el.removeAttribute?.('data-i18n-params');
    writeText(el, t(key, params));
}

export function setLanguage(lang, { persist = true, storage = globalThis.localStorage, root = globalThis.document } = {}) {
    const next = isSupportedLanguage(lang) ? lang : 'en';
    const changed = next !== current;
    current = next;
    if (persist) {
        try { storage?.setItem?.(LANGUAGE_STORAGE_KEY, next); } catch { /* private mode */ }
    }
    if (root?.documentElement) root.documentElement.lang = next;
    applyI18n(root);
    if (root?.dispatchEvent && typeof CustomEvent === 'function') {
        root.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { lang: next, changed } }));
    }
    return next;
}

// Boot: pick saved/browser language without persisting a guess.
export function initI18n({ storage = globalThis.localStorage, navigatorRef = globalThis.navigator, root = globalThis.document } = {}) {
    const lang = detectLanguage({
        saved: readSaved(storage),
        navigatorLanguages: navigatorRef ? (navigatorRef.languages?.length ? navigatorRef.languages : [navigatorRef.language]) : []
    });
    return setLanguage(lang, { persist: false, storage, root });
}

export function onLanguageChange(handler, root = globalThis.document) {
    if (!root?.addEventListener) return () => {};
    const listener = event => handler(event.detail?.lang || current);
    root.addEventListener(LANGUAGE_EVENT, listener);
    return () => root.removeEventListener(LANGUAGE_EVENT, listener);
}

// Test hook: English/Turkish tables for parity checks.
export const LOCALES = Object.freeze({ en, tr });
