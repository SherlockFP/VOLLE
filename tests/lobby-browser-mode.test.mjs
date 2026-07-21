import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('lobby browser labels mode and hosts refresh it on selection', async () => {
    const [main, css] = await Promise.all([
        readFile(new URL('../js/main.js', import.meta.url), 'utf8'),
        readFile(new URL('../css/style.css', import.meta.url), 'utf8')
    ]);

    assert.match(main, /class="lobby-mode-badge">MODE: \$\{this\._esc\(l\.mode \|\| 'Classic'\)\}/);
    assert.match(main, /if \(host && this\._lobbyCode\) \{\s*this\._registerLobby\(/);
    assert.match(css, /\.mp-lobby-card \.lobby-mode-badge/);
});
