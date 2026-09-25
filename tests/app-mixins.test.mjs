import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mixinMethods } from '../js/app-mixins.js';

test('mixinMethods copies methods as class methods and refuses a name defined twice', () => {
    class Target { own() { return 'own'; } }
    class Feature {
        greet() { return `hi ${this.own()}`; }
        async later() { return 1; }
    }
    mixinMethods(Target, Feature);
    const target = new Target();
    assert.equal(target.greet(), 'hi own', '`this` is the target instance');
    assert.equal(Object.getOwnPropertyDescriptor(Target.prototype, 'greet').enumerable, false);
    assert.equal(Object.hasOwn(Target.prototype, 'constructor') && Target.prototype.constructor, Target);
    class Clash { own() { return 'other'; } }
    assert.throws(() => mixinMethods(Target, Clash), /Target\.own is defined twice/);
});

test('main mixes every js/app-*.js feature into App, and no method lives in two files', () => {
    const dir = new URL('../js/', import.meta.url);
    const main = readFileSync(new URL('main.js', dir), 'utf8');
    const methodNames = source => new Set([...source.matchAll(/^ {4}(?:async )?([_A-Za-z][\w$]*)\([^\n]*\) \{/gm)].map(match => match[1]));
    const inMain = methodNames(main);
    const mixed = main.match(/^mixinMethods\(App, ([^)]*)\);/m);
    assert.ok(mixed, 'main.js mixes the feature files into App');
    const classes = mixed[1].split(',').map(name => name.trim());
    const seen = new Map();
    for (const file of readdirSync(dir).filter(name => /^app-[a-z-]+\.js$/.test(name) && name !== 'app-mixins.js')) {
        const source = readFileSync(new URL(file, dir), 'utf8');
        const exported = source.match(/^export class (\w+) \{/m)?.[1];
        assert.ok(exported && classes.includes(exported), `${file} is mixed into App`);
        assert.match(main, new RegExp(`^import \\{ ${exported} \\} from './${file}';`, 'm'));
        for (const name of methodNames(source)) {
            assert.equal(inMain.has(name), false, `${name} is defined in main.js and ${file}`);
            assert.equal(seen.has(name), false, `${name} is defined in ${seen.get(name)} and ${file}`);
            seen.set(name, file);
        }
    }
    assert.ok(seen.size >= 25, 'the session features moved out of main.js');
});
