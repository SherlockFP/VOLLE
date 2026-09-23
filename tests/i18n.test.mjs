// TR/EN localisation: table parity, interpolation/plurals, fallback, DOM
// application, language detection and index.html key coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY, LOCALES, applyI18n, detectLanguage, getLanguage,
    initI18n, localizedName, setLanguage, setText, t
} from '../js/i18n.js';

const { en, tr } = LOCALES;
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

// A leaf is a string or a { one, other } plural form.
const isPluralLeaf = value => value && typeof value === 'object'
    && Object.keys(value).length > 0 && Object.keys(value).every(key => key === 'one' || key === 'other');
function leaves(table, prefix = '', out = new Map()) {
    for (const [key, value] of Object.entries(table)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string' || isPluralLeaf(value)) out.set(path, value);
        else if (value && typeof value === 'object') leaves(value, path, out);
        else out.set(path, value);
    }
    return out;
}
const forms = value => typeof value === 'string' ? [value] : Object.values(value || {});
const params = text => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]));
const withLanguage = (lang, fn) => {
    setLanguage(lang, { persist: false, root: null });
    try { return fn(); } finally { setLanguage('en', { persist: false, root: null }); }
};

// ---- minimal DOM double: enough for querySelectorAll('[attr]'), text nodes and attributes.
class FakeText {
    constructor(data) { this.nodeType = 3; this.data = data; }
    get textContent() { return this.data; }
}
class FakeElement {
    constructor(tag, doc) {
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.ownerDocument = doc;
        this.attributes = new Map();
        this.childNodes = [];
        this._html = null;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new FakeText(node) : node); }
    appendChild(node) { this.childNodes.push(node); return node; }
    get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) { this.childNodes = [new FakeText(String(value))]; this._html = null; }
    get innerHTML() { return this._html ?? this.textContent; }
    set innerHTML(value) { this._html = String(value); this.childNodes = [new FakeText(String(value).replace(/<[^>]*>/g, ''))]; }
    *walk() {
        for (const node of this.childNodes) {
            if (node.nodeType !== 1) continue;
            yield node;
            yield* node.walk();
        }
    }
    querySelectorAll(selector) {
        const attr = selector.match(/^\[([\w-]+)\]$/)?.[1];
        assert.ok(attr, `fake DOM only supports [attr] selectors, got ${selector}`);
        return [...this.walk()].filter(node => node.hasAttribute(attr));
    }
}
function fakeDocument() {
    const events = [];
    const doc = {
        documentElement: { lang: 'en' },
        createTextNode: data => new FakeText(data),
        createElement: tag => new FakeElement(tag, doc),
        dispatchEvent: event => { events.push(event); return true; },
        events
    };
    doc.body = new FakeElement('body', doc);
    doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
    return doc;
}

test('en and tr expose exactly the same keys', () => {
    const enKeys = [...leaves(en).keys()].sort();
    const trKeys = [...leaves(tr).keys()].sort();
    assert.deepEqual(enKeys.filter(key => !trKeys.includes(key)), [], 'keys missing from tr.js');
    assert.deepEqual(trKeys.filter(key => !enKeys.includes(key)), [], 'keys missing from en.js');
    assert.ok(enKeys.length > 500, `expected a real table, got ${enKeys.length} keys`);
});

test('no locale value is empty and every value is a string or a {one, other} plural', () => {
    for (const [lang, table] of Object.entries({ en, tr })) {
        for (const [key, value] of leaves(table)) {
            assert.ok(typeof value === 'string' || isPluralLeaf(value), `${lang}:${key} has invalid shape`);
            for (const form of forms(value)) {
                assert.equal(typeof form, 'string', `${lang}:${key}`);
                assert.ok(form.trim().length > 0, `${lang}:${key} is empty`);
            }
        }
    }
});

test('Turkish strings keep every {placeholder} the English string uses', () => {
    const trLeaves = leaves(tr);
    for (const [key, value] of leaves(en)) {
        const needed = new Set(forms(value).flatMap(form => [...params(form)]));
        for (const form of forms(trLeaves.get(key))) {
            for (const name of needed) assert.ok(params(form).has(name), `tr:${key} lost {${name}}`);
        }
    }
});

test('t() interpolates {params} and picks plural forms by count', () => {
    assert.equal(t('toast.lobbyCreated', { code: 'AB12' }), '🏠 Lobby created! Code: AB12');
    assert.equal(t('team.players', { count: 1 }), '1 player');
    assert.equal(t('team.players', { count: 3 }), '3 players');
    assert.equal(t('shop.itemCount', { count: 0 }), '0 items');
    assert.equal(t('toast.kicked', {}), 'Kicked {name}', 'unknown params stay visible instead of printing undefined');
    withLanguage('tr', () => {
        assert.equal(t('team.players', { count: 1 }), '1 oyuncu');
        assert.equal(t('team.players', { count: 5 }), '5 oyuncu');
        assert.equal(t('hud.roundN', { round: 3 }), 'RAUNT 3');
    });
});

test('missing keys fall back to English, then to the key itself with a single warning', () => {
    const saved = tr.menu.play;
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);
    try {
        delete tr.menu.play;
        withLanguage('tr', () => assert.equal(t('menu.play'), 'Play'));
        assert.equal(t('no.such.key'), 'no.such.key');
        assert.equal(t('no.such.key'), 'no.such.key');
        assert.equal(warnings.filter(message => message.includes('no.such.key')).length, 1);
        assert.equal(localizedName('modeNames', 'not-a-mode', 'Fallback Mode'), 'Fallback Mode');
    } finally {
        tr.menu.play = saved;
        console.warn = originalWarn;
    }
});

test('language detection: saved choice wins, then a tr* browser language, else English', () => {
    assert.equal(detectLanguage({ saved: 'en', navigatorLanguages: ['tr-TR'] }), 'en');
    assert.equal(detectLanguage({ saved: 'tr', navigatorLanguages: ['en-US'] }), 'tr');
    assert.equal(detectLanguage({ saved: null, navigatorLanguages: ['tr-TR', 'en'] }), 'tr');
    assert.equal(detectLanguage({ saved: null, navigatorLanguages: ['TR'] }), 'tr');
    assert.equal(detectLanguage({ saved: 'de', navigatorLanguages: ['en-GB'] }), 'en');
    assert.equal(detectLanguage({ saved: undefined, navigatorLanguages: 'de-DE' }), 'en');
    assert.equal(detectLanguage(), 'en');

    const doc = fakeDocument();
    const store = new Map();
    const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
    assert.equal(initI18n({ storage, navigatorRef: { languages: ['tr-TR'], language: 'tr-TR' }, root: doc }), 'tr');
    assert.equal(doc.documentElement.lang, 'tr');
    assert.equal(store.has(LANGUAGE_STORAGE_KEY), false, 'a detected guess is not persisted');
    store.set(LANGUAGE_STORAGE_KEY, 'en');
    assert.equal(initI18n({ storage, navigatorRef: { languages: ['tr-TR'] }, root: doc }), 'en');
    setLanguage('en', { persist: false, root: null });
});

test('applyI18n fills text, attributes and trusted hint markup without dropping icons', () => {
    const doc = fakeDocument();
    const title = doc.createElement('h2');
    title.setAttribute('data-i18n', 'auth.title');
    title.textContent = 'Enter the arena';
    const back = doc.createElement('button');
    back.setAttribute('data-i18n', 'common.backToMenu');
    const icon = doc.createElement('svg');
    back.append(icon, 'Back to menu');
    const input = doc.createElement('input');
    input.setAttribute('data-i18n-attr', 'placeholder:auth.password;aria-label:settings.close');
    const count = doc.createElement('span');
    count.setAttribute('data-i18n', 'team.players');
    count.setAttribute('data-i18n-params', '{"count":4}');
    const hint = doc.createElement('p');
    hint.setAttribute('data-i18n-html', 'team.hint');
    doc.body.append(title, back, input, count, hint);

    setLanguage('tr', { persist: false, root: doc });
    try {
        assert.equal(title.textContent, 'Arenaya gir');
        assert.equal(back.childNodes[0], icon, 'child icon survives');
        assert.equal(back.textContent, 'Menüye dön');
        assert.equal(input.getAttribute('placeholder'), 'Şifre');
        assert.equal(input.getAttribute('aria-label'), 'Ayarları kapat');
        assert.equal(count.textContent, '4 oyuncu');
        assert.match(hint.innerHTML, /<kbd>1<\/kbd> Kırmızı/);
        assert.equal(doc.documentElement.lang, 'tr');
        const event = doc.events.at(-1);
        assert.equal(event.type, LANGUAGE_EVENT);
        assert.equal(event.detail.lang, 'tr');
        assert.equal(getLanguage(), 'tr');

        const status = doc.createElement('p');
        doc.body.append(status);
        setText(status, 'auth.syncing');
        assert.equal(status.textContent, 'Profilin eşitleniyor…');
        setText(status, null, 'Server said no');
        assert.equal(status.getAttribute('data-i18n'), null, 'plain text drops the localisation tag');
    } finally {
        setLanguage('en', { persist: false, root: doc });
    }
    assert.equal(title.textContent, 'Enter the arena');
    assert.equal(back.textContent, 'Back to menu');
    assert.equal(count.textContent, '4 players');
});

test('setLanguage persists the explicit choice and normalises unknown languages to English', () => {
    const store = new Map();
    const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
    assert.equal(setLanguage('tr', { storage, root: null }), 'tr');
    assert.equal(store.get(LANGUAGE_STORAGE_KEY), 'tr');
    assert.equal(setLanguage('xx', { storage, root: null }), 'en');
    assert.equal(store.get(LANGUAGE_STORAGE_KEY), 'en');
});

test('every data-i18n key used in index.html exists in en.js and tr.js', async () => {
    const html = await read('index.html');
    const enLeaves = leaves(en);
    const trLeaves = leaves(tr);
    const keys = new Set();
    for (const match of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(match[1]);
    for (const match of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        for (const pair of match[1].split(';')) keys.add(pair.slice(pair.indexOf(':') + 1));
    }
    assert.ok(keys.size > 400, `expected broad index.html coverage, got ${keys.size} keys`);
    for (const key of keys) {
        assert.ok(enLeaves.has(key), `index.html uses ${key}, missing from en.js`);
        assert.ok(trLeaves.has(key), `index.html uses ${key}, missing from tr.js`);
    }
    // Static English copy in the page must equal the English table, so a page
    // rendered before the bundle loads never disagrees with the localised one.
    for (const match of html.matchAll(/<(\w+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
        const text = match[3].trim();
        if (!text) continue;
        const decoded = text.replace(/&amp;/g, '&').replace(/&middot;/g, '·');
        assert.equal(decoded, enLeaves.get(match[2]), `index.html text for ${match[2]}`);
    }
});

test('HUD score markup keeps its pinned contract; labels are translated from JS instead', async () => {
    const html = await read('index.html');
    assert.match(html, /id="hud-score-red"><span>RED<\/span><b data-score-value>0<\/b>/);
    assert.match(html, /id="hud-score-blue"><span>BLUE<\/span><b data-score-value>0<\/b>/);
    const ui = await read('js/ui.js');
    assert.match(ui, /setSpan\('#hud-score-red > span', 'hud\.redCaps'\)/);
    assert.match(ui, /setSpan\('#hud-round-timer > span', 'hud\.matchCaps'\)/);
});

test('every literal t()/setText() key in the localised JS files exists in both tables', async () => {
    const enLeaves = leaves(en);
    const trLeaves = leaves(tr);
    for (const file of ['js/main.js', 'js/ui.js', 'js/gem-shop.js']) {
        const source = await read(file);
        const keys = new Set();
        for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z]+\.[\w.]+)'/g)) keys.add(match[1]);
        for (const match of source.matchAll(/setText\([^,()]+,\s*'([a-zA-Z]+\.[\w.]+)'/g)) keys.add(match[1]);
        assert.ok(keys.size > 5, `${file} should use the locale tables`);
        for (const key of keys) {
            assert.ok(enLeaves.has(key), `${file}: ${key} missing from en.js`);
            assert.ok(trLeaves.has(key), `${file}: ${key} missing from tr.js`);
        }
    }
});

test('the pre-bundle loading-screen tips mirror the locale tables in both languages', async () => {
    const html = await read('index.html');
    const tips = JSON.parse(html.match(/var TIPS = (\{[\s\S]*?\});/)[1]);
    const status = JSON.parse(html.match(/var STATUS = (\{[^\n]*\});/)[1]);
    for (const [lang, table] of Object.entries({ en, tr })) {
        assert.deepEqual(tips[lang], [1, 2, 3, 4, 5, 6].map(i => table.loading[`tip${i}`]), `${lang} tips`);
        assert.equal(status[lang], table.loading.status);
    }
    assert.match(html, /localStorage\.getItem\('volle_language'\)/);
    assert.equal(LANGUAGE_STORAGE_KEY, 'volle_language');
});

test('Settings > Game exposes the language picker and main.js wires it to setLanguage', async () => {
    const html = await read('index.html');
    const game = html.slice(html.indexOf('data-settings-section="game"'), html.indexOf('data-settings-section="access"'));
    assert.match(game, /<div class="settings-row">\s*<label for="setting-language" data-i18n="settings\.language">Language<\/label>\s*<select id="setting-language">/);
    assert.match(game, /<option value="en" lang="en">English<\/option>/);
    assert.match(game, /<option value="tr" lang="tr">Türkçe<\/option>/);
    const main = await read('js/main.js');
    assert.match(main, /languageSelect\.addEventListener\('change', event => setLanguage\(event\.target\.value\)\)/);
    // The auth-card EN/TR switch also listens, so the callback does two things now.
    assert.match(main, /onLanguageChange\(\(\) => \{ syncAuthLang\(\); this\._onLanguageChanged\(\); \}\)/);
    assert.match(html, /class="auth-lang-switch"[\s\S]*?data-lang="en"[\s\S]*?data-lang="tr"/);
    assert.match(main, /initI18n\(\);\s*new App\(\);/);
});

test('Locker character blurbs come from the locale tables, not mixed-language source', async () => {
    const { CHARACTERS } = await import('../js/characters.js');
    const trLeaves = leaves(tr);
    for (const character of Object.values(CHARACTERS)) {
        assert.doesNotMatch(character.desc, /[çğışöüİ]|Dengeli|yenileme|hasar/, `${character.id} fallback should be English`);
        assert.equal(en.characters[character.id], character.desc, `${character.id} en table matches fallback`);
        assert.ok(trLeaves.has(`characters.${character.id}`), `${character.id} has Turkish copy`);
    }
    withLanguage('tr', () => {
        assert.equal(localizedName('characters', 'rally', 'x'), tr.characters.rally);
    });
});
