// scripts/build.mjs — production bundle for the game client.
//
// Dev mode stays zero-build: index.html + native ES modules + import map.
// `npm run build` writes dist/: one minified, hashed, code-split ESM bundle plus a
// dist/index.html that points at it (no import map, no 100+ module requests).
// server.js serves dist/index.html when it exists; delete dist/ to go back to dev.
// esbuild is a devDependency only — nothing from it ships to players.
import { mkdir, readFile, rename, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const finalDir = path.join(root, 'dist');
// Built into a staging dir and swapped in at the end, so the server never sees a
// missing or half-written dist/ (it would silently fall back to the dev page).
const outdir = path.join(root, 'dist.next');

// Mirrors the import map in index.html.
const importMapPlugin = {
    name: 'volle-import-map',
    setup(b) {
        b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(root, 'vendor/three/three.module.js') }));
        b.onResolve({ filter: /^three\/addons\// }, args => ({
            path: path.join(root, 'vendor/three/addons', args.path.slice('three/addons/'.length))
        }));
    }
};

// index.html also runs a tiny inline module that publishes shaderFinishers on window
// before gameplay; the bundle entry does the same so there is one module instance.
const entrySource = `
import { shaderFinishers } from './js/shader-finishers.js';
window.shaderFinishers = shaderFinishers;
import './js/main.js';
`;

export async function buildClient({ log = console.log } = {}) {
    const started = Date.now();
    // Loaded lazily: production images prune devDependencies after building, and
    // `npm start` (prestart --if-stale) must still boot when esbuild is gone.
    const { build } = await import('esbuild');
    await rm(outdir, { recursive: true, force: true });
    await mkdir(outdir, { recursive: true });
    const result = await build({
        stdin: { contents: entrySource, resolveDir: root, sourcefile: 'volle-entry.js', loader: 'js' },
        bundle: true,
        splitting: true,
        format: 'esm',
        target: ['es2022'],
        minify: true,
        sourcemap: 'linked',
        legalComments: 'none',
        outdir: path.join(outdir, 'app'),
        entryNames: 'volle-[hash]',
        chunkNames: 'chunk-[hash]',
        metafile: true,
        plugins: [importMapPlugin],
        logLevel: 'warning'
    });
    const entry = Object.entries(result.metafile.outputs).find(([, meta]) => meta.entryPoint);
    if (!entry) throw new Error('bundle entry missing from metafile');
    const entryFile = path.relative(root, path.join(root, entry[0])).split(path.sep).join('/').replace(/^dist\.next\//, 'dist/');

    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    const bundled = rewriteIndexHtml(html, entryFile);
    await writeFile(path.join(outdir, 'index.html'), bundled);

    const files = await listFiles(path.join(outdir, 'app'));
    const bytes = (await Promise.all(files.filter(f => f.endsWith('.js')).map(f => stat(f)))).reduce((sum, s) => sum + s.size, 0);
    const buildId = createHash('sha256').update(bundled).digest('hex').slice(0, 10);
    await writeFile(path.join(outdir, 'build.json'), JSON.stringify({ buildId, entry: entryFile, jsBytes: bytes, builtAt: new Date().toISOString() }, null, 2));
    const previous = path.join(root, 'dist.prev');
    await rm(previous, { recursive: true, force: true });
    await rename(finalDir, previous).catch(() => {});
    await rename(outdir, finalDir);
    await rm(previous, { recursive: true, force: true });
    log(`[build] ${files.filter(f => f.endsWith('.js')).length} JS files, ${(bytes / 1024).toFixed(0)} KiB minified, entry ${entryFile} (${Date.now() - started} ms)`);
    return { entryFile, bytes };
}

// Pure: swap the dev module graph for the bundle. Exported for tests.
export function rewriteIndexHtml(html, entryFile) {
    let out = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
    out = out.replace(/\s*<script type="module">\s*import \{ shaderFinishers \}[\s\S]*?<\/script>/, '');
    const devEntry = /<script type="module" src="js\/main\.js(?:\?[^"]*)?"><\/script>/;
    if (!devEntry.test(out)) throw new Error('index.html: dev entry <script src="js/main.js"> not found');
    out = out.replace(devEntry, `<script type="module" src="${entryFile}"></script>`);
    return out;
}

async function listFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(e => e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    return nested.flat();
}

// True when dist/ is missing or any client source/vendor file or index.html is newer.
export async function isBuildStale() {
    const built = await stat(path.join(finalDir, 'build.json')).catch(() => null);
    if (!built) return true;
    const sources = [path.join(root, 'index.html'), ...await listFiles(path.join(root, 'js'))];
    for (const file of sources) {
        const info = await stat(file).catch(() => null);
        if (info && info.mtimeMs > built.mtimeMs) return true;
    }
    return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const onlyIfStale = process.argv.includes('--if-stale');
    (onlyIfStale ? isBuildStale() : Promise.resolve(true)).then(stale => {
        if (!stale) return console.log('[build] dist/ is up to date');
        return buildClient();
    }).catch(error => {
        // --if-stale is best-effort (prestart): never block the server from starting.
        if (onlyIfStale) {
            console.warn(`[build] skipped (${error.code || error.message}); serving ${'existing dist/ or dev page'}`);
            return;
        }
        console.error(error);
        process.exit(1);
    });
}
