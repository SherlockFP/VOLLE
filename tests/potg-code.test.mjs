// Play of the Game share codes: a clip round-trips through a pasteable VP1 code,
// damaged or hostile codes are refused, and the report / Replays screen wire it up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { POTG_CODE_PREFIX, POTG_CODE_MAX_LENGTH, canEncodePotgCode, decodePotgCode, encodePotgCode } from '../js/potg-code.js';
import { readAppSource } from './app-source.mjs';

function clip(frames = 48, bots = 5) {
    const events = [];
    for (let f = 0; f < frames; f++) {
        const t = f * 125;
        events.push({ t, type: 'snapshot', data: {
            ball: { x: f * 0.37, y: 1.25, z: -f * 0.5 },
            // Shaped like a recorded (normalized) snapshot: `player` is a bare point,
            // the local player sits in `players` with its name.
            player: { x: 1 + f * 0.1, y: 0, z: 30 },
            players: [{ id: 'local', name: 'Kaan', team: 'red', alive: true, x: 1 + f * 0.1, y: 0, z: 30, yaw: 0.5 },
                ...Array.from({ length: bots }, (_, i) => ({ id: `Bot-${i}`, name: `Bot-${i}`, team: i % 2 ? 'blue' : 'red', alive: f < 30 || i !== 1, x: i * 4.04, y: 0, z: -30 + f * 0.2, yaw: -1.2345 }))]
        } });
    }
    events.push({ t: 2000, type: 'kill', data: { attacker: 'Kaan', victim: 'Bot-1', rally: 7, perfect: true, headshot: false } });
    events.push({ t: 2200, type: 'deflect', data: { rally: 8 } });
    return { meta: { map: 'beach', mode: 'classic' }, events, duration: frames * 125 };
}

test('a clip survives the code: positions to 0.1, yaw to 0.01, kills and the play intact', async () => {
    assert.equal(canEncodePotgCode(), true);
    const source = clip();
    const code = await encodePotgCode(source, { player: 'Kaan', kind: 'kill', streak: 2, rally: 7, perfect: true });
    assert.ok(code.startsWith(POTG_CODE_PREFIX));
    assert.ok(code.length < 12000, `a 6 s clip stays pasteable (${code.length} chars)`);
    const back = await decodePotgCode(`  ${code.replace(/(.{60})/g, '$1\n')} `);
    assert.equal(back.ok, true, back.error);
    assert.deepEqual(back.play, { player: 'Kaan', kind: 'kill', streak: 2, rally: 7, perfect: true, headshot: false });
    assert.equal(back.clip.meta.map, 'beach');
    const snaps = back.clip.events.filter(e => e.type === 'snapshot');
    assert.equal(snaps.length, 48);
    const kaan = snaps[10].data.players.find(p => p.name === 'Kaan');
    assert.equal(kaan.x, 2);
    assert.ok(!snaps[10].data.players.some(p => p.name === 'local'), 'the local player keeps its real name');
    assert.equal(snaps[40].data.players.find(p => p.name === 'Bot-1').alive, false);
    assert.equal(snaps[3].data.players.find(p => p.name === 'Bot-2').yaw, -1.23);
    assert.deepEqual(back.clip.events.find(e => e.type === 'kill').data, { attacker: 'Kaan', victim: 'Bot-1', rally: 7, perfect: true, headshot: false });
});

test('damaged, oversized or hostile codes are refused with a reason', async () => {
    const good = await encodePotgCode(clip(4, 1), { player: 'Kaan' });
    const cases = {
        'no prefix': 'hello',
        'bad characters': 'VP1.abc$def',
        'not deflate': `VP1.${Buffer.from('plain text').toString('base64url')}`,
        'too long': `VP1.${'A'.repeat(POTG_CODE_MAX_LENGTH)}`,
        'truncated': good.slice(0, Math.floor(good.length / 2))
    };
    for (const [label, code] of Object.entries(cases)) {
        const result = await decodePotgCode(code);
        assert.equal(result.ok, false, label);
        assert.equal(typeof result.error, 'string', label);
    }
    // A well-formed code with out-of-range data is refused too.
    const deflate = async value => {
        const stream = new Blob([new TextEncoder().encode(JSON.stringify(value))]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return `VP1.${Buffer.from(await new Response(stream).arrayBuffer()).toString('base64url')}`;
    };
    const far = await deflate([1, {}, {}, [['X', 0]], [[0, 0, [0, 1, 999999999, 0, 0, 0]]], [], 100]);
    assert.equal((await decodePotgCode(far)).ok, false, 'coordinates out of range');
    const badIndex = await deflate([1, {}, {}, [['X', 0]], [[0, 0, [5, 1, 0, 0, 0, 0]]], [], 100]);
    assert.equal((await decodePotgCode(badIndex)).ok, false, 'player index out of the roster');
    const markup = await decodePotgCode(await deflate([1, {}, { player: '<img src=x onerror=1>' }, [['<b>Bot</b>', 1]], [[0, 0, [0, 1, 0, 0, 0, 0]]], [], 100]));
    assert.equal(markup.ok, true);
    assert.doesNotMatch(markup.play.player + markup.clip.events[0].data.players[0].name, /[<>]/, 'names lose markup');
});

test('wiring: Copy code on the report, paste-and-watch on the Replays screen', () => {
    const main = readAppSource();
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<button id="btn-pg-potg-share"[^>]*hidden/);
    assert.match(html, /<form id="replay-code-form" class="replay-code-form"/);
    assert.match(main, /bind\('btn-pg-potg-share', \(\) => this\._sharePlayOfTheGame\(\)\);/);
    assert.match(main, /if \(!Object\.hasOwn\(Arena\.MAPS, clip\.meta\.map\)\) clip\.meta\.map = this\.arena\?\.mapId;/);
    assert.match(main, /canShare: !!play && canEncodePotgCode\(\)/);
});
