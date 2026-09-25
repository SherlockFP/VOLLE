// three.js is ~40% of the first-load JS. esbuild drops the parts the game never
// uses only while every module reads THREE.<name> statically. Passing the namespace
// as a value, re-exporting it, or import('three') forces all of it into the bundle
// (+120 KB minified when this was fixed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../js/', import.meta.url).pathname;
function jsFiles(dir) {
    return readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? jsFiles(full) : name.endsWith('.js') ? [full] : [];
    });
}
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no module keeps the whole three.js namespace alive', () => {
    const offenders = [];
    for (const file of jsFiles(root)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        const rel = path.relative(root, file);
        if (/import\(\s*['"]three['"]\s*\)/.test(code)) offenders.push(`${rel}: import('three')`);
        if (/export\s*\{[^}]*\bTHREE\b[^}]*\}/.test(code)) offenders.push(`${rel}: re-exports THREE`);
        // THREE used as a value: an argument, array/object member or assignment source.
        for (const match of code.matchAll(/[(,[{=:]\s*THREE\s*[,)\]};]/g)) {
            offenders.push(`${rel}: THREE as a value near "${match[0].trim()}"`);
        }
    }
    assert.deepEqual(offenders, []);
});
