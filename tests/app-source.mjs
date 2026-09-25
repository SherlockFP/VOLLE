// js/main.js plus the feature files it mixes into App (js/app-*.js, see
// js/app-mixins.js) as one string, so source-shape tests pin App wiring
// wherever a method lives.
import { readFileSync, readdirSync } from 'node:fs';

export function readAppSource() {
    const dir = new URL('../js/', import.meta.url);
    const files = ['main.js', ...readdirSync(dir).filter(name => /^app-[a-z-]+\.js$/.test(name)).sort()];
    return files.map(name => readFileSync(new URL(name, dir), 'utf8')).join('\n');
}
