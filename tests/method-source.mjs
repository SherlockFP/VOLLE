// Compiles one class method out of any browser-only source file (js/main.js,
// js/ui.js, js/game.js) into an isolated vm context, so a test can run the
// shipped method body against stub globals. Same scanner as tests/game-source.mjs
// (skips strings, template literals and comments), generalised to any file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const cache = new Map();

export function readSource(path) {
    if (!cache.has(path)) cache.set(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
    return cache.get(path);
}

export function extractMethod(path, name) {
    const source = readSource(path);
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {4}(?:async )?${escapedName}\\([^\\n]*\\) \\{`, 'm').exec(source);
    assert.ok(match, `${path}: ${name} method not found`);
    const start = match.index;
    const bodyStart = start + match[0].lastIndexOf('{');
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = bodyStart; index < source.length; index++) {
        const character = source[index];
        const next = source[index + 1];
        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') { blockComment = false; index++; }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === '/' && next === '/') { lineComment = true; index++; continue; }
        if (character === '/' && next === '*') { blockComment = true; index++; continue; }
        if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
        if (character === '{') depth++;
        if (character === '}' && --depth === 0) return source.slice(start, index + 1).trimStart();
    }
    assert.fail(`${path}: ${name} method body is incomplete`);
}

export function compileMethod(path, name, globals = {}) {
    const method = extractMethod(path, name);
    return runInNewContext(`({ ${method} })[${JSON.stringify(name)}]`, globals);
}

// Minimal element double: classList, dataset, hidden, textContent, style,
// attribute + child lookups by selector callbacks the test wires up.
export function fakeElement(id = '', { classes = [] } = {}) {
    const set = new Set(classes);
    const listeners = new Map();
    const el = {
        id,
        hidden: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        value: '',
        dataset: {},
        style: {},
        children: [],
        offsetWidth: 10,
        clicks: 0,
        focused: 0,
        classList: {
            add: (...names) => names.forEach(name => set.add(name)),
            remove: (...names) => names.forEach(name => set.delete(name)),
            contains: name => set.has(name),
            toggle: (name, force) => {
                const on = force === undefined ? !set.has(name) : !!force;
                if (on) set.add(name); else set.delete(name);
                return on;
            }
        },
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: type => listeners.delete(type),
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        contains: node => node === el,
        matches: () => false,
        focus() { el.focused++; },
        click() { el.clicks++; el.onclick?.(); },
        setAttribute(name, value) { el[`attr:${name}`] = String(value); },
        getAttribute(name) { return el[`attr:${name}`] ?? null; },
        toggleAttribute(name, force) { el[`attr:${name}`] = force ? '' : null; }
    };
    return el;
}
