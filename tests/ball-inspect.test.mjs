import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shop ball skins expose an inspectable trail preview', async () => {
    const [ui, main, css] = await Promise.all([
        readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/main.js', import.meta.url), 'utf8'),
        readFile(new URL('../css/style.css', import.meta.url), 'utf8')
    ]);

    assert.match(ui, /class="btn btn-small ball-inspect"/);
    assert.match(main, /const ballInspect = e\.target\.closest\('\.ball-inspect'\)/);
    assert.match(main, /card\?\.classList\.toggle\('inspecting'\)/);
    assert.match(css, /\.ball-skin\.inspecting \.ball-inspect-trail/);
});
