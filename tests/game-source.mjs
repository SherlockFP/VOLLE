// Compiles a single Game method out of js/game.js source into an isolated vm context.
// js/game.js imports Three.js and touches the DOM at module scope, so it cannot be
// imported under `node --test`. Extracting one method and running it against stub
// globals tests the real shipped source without a browser.
// Moved here from tests/host-migration.test.mjs once a second suite needed it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');

/**
 * Slices `    name(args) {` … matching `}` out of js/game.js. The scanner skips
 * strings, template literals and comments, so method bodies containing `{` inside
 * text (e.g. `${team}` in an announce string) are extracted intact.
 */
export function extractGameMethod(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {4}${escapedName}\\([^\\n]*\\) \\{`, 'm').exec(gameSource);
    assert.ok(match, `Game.${name} method not found`);

    const start = match.index;
    // Use the final brace captured by the signature (`) {`). Default parameters can
    // contain earlier braces, e.g. `remoteAttack(playerId, data = {}) {`.
    const bodyStart = start + match[0].lastIndexOf('{');
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = bodyStart; index < gameSource.length; index++) {
        const character = gameSource[index];
        const next = gameSource[index + 1];

        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                blockComment = false;
                index++;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            continue;
        }
        if (character === '/' && next === '/') {
            lineComment = true;
            index++;
            continue;
        }
        if (character === '/' && next === '*') {
            blockComment = true;
            index++;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            continue;
        }
        if (character === '{') depth++;
        if (character === '}' && --depth === 0) {
            return gameSource.slice(start, index + 1);
        }
    }

    assert.fail(`Game.${name} method body is incomplete`);
}

/** Compiles Game.<name> as a standalone function; `globals` supplies its free variables. */
export function compileGameMethod(name, globals = {}) {
    const method = extractGameMethod(name);
    return runInNewContext(`({ ${method} }).${name}`, globals);
}
