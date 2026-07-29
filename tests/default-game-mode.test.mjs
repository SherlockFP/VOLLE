// Default game mode contract: the app must open into instagib ("one shot") by
// default, and that must survive every place Player.applyLoadout() resets HP
// from character base stats.
//
// This bit us for real: Game's constructor applied instagib's maxHp:1 mutator
// via applyMode(), but App.applyLoadout() runs right after construction and
// unconditionally resets player.maxHp/hp from the selected character's base
// stats (player.js), silently clobbering it back to 100. The fix moved the
// default-mode selection to run AFTER applyLoadout(), and added the same
// re-sync after the other two applyLoadout() call sites (the async
// connectRemote() callback and Save Loadout) so neither can quietly downgrade
// an active one-shot match back to normal HP.
//
// Source-pattern tests (matching the established style in ffa-mode.test.mjs)
// rather than a full Game/App mock, since applyMode()'s dependency surface
// (ball, player, bots, scoreboard, arena) is large enough that mocking it
// faithfully would test the mock more than the real wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('instagib is a real one-shot mode: no HP, single hit kills', async () => {
    const modes = await readFile(new URL('../js/gamemodes.js', import.meta.url), 'utf8');
    assert.match(
        modes,
        /instagib:\s*\{[^}]*mutators:\s*\{\s*oneHitKill:\s*true,\s*maxHp:\s*1\s*\}/s,
        'instagib must set oneHitKill:true and maxHp:1'
    );
});

test('applyMode is the only thing allowed to set game.mode - no bare assignment', async () => {
    const modes = await readFile(new URL('../js/gamemodes.js', import.meta.url), 'utf8');
    assert.match(
        modes,
        /game\.mode = mode;/,
        'applyMode() must assign game.mode itself so callers never have to do it separately'
    );
});

test('main.js selects the default mode AFTER the first applyLoadout(), not before', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const loadoutIdx = main.indexOf('this.applyLoadout();');
    const selectIdx = main.indexOf("this.game.selectMode('instagib')");
    assert.notEqual(loadoutIdx, -1, 'App construction must call applyLoadout()');
    assert.notEqual(selectIdx, -1, 'App construction must select the default mode');
    assert.ok(
        selectIdx > loadoutIdx,
        'selectMode(instagib) must run after applyLoadout() - applyLoadout() resets ' +
        'player.maxHp from character base stats and would clobber an earlier maxHp mutator'
    );
});

test('every other applyLoadout() call site re-syncs the active mode afterward', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    // Each applyLoadout() call must be followed (within a short window) by a
    // selectMode() call that re-applies whatever mode is currently active, so a
    // loadout change never silently reverts a one-shot match to normal HP.
    const calls = [...main.matchAll(/this\.applyLoadout\(\);/g)];
    assert.ok(calls.length >= 3, `expected at least 3 applyLoadout() call sites, found ${calls.length}`);
    for (const call of calls) {
        const after = main.slice(call.index, call.index + 700);
        assert.match(
            after,
            /this\.game\.selectMode\(('instagib'|this\.game\.mode\.id)\)/,
            `applyLoadout() at offset ${call.index} has no mode re-sync within the next 700 chars`
        );
    }
});

test('the default lobby mode chip matches the real default (instagib), not classic', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const modeRow = html.slice(html.indexOf('id="mode-select"'), html.indexOf('id="mode-select"') + 1200);
    assert.match(
        modeRow,
        /data-mode="instagib" aria-pressed="true"/,
        'the Insta chip must be the one marked selected/aria-pressed in markup'
    );
    assert.doesNotMatch(
        modeRow,
        /data-mode="classic"[^>]*selected/,
        'Classic must not carry the selected class - it is no longer the default'
    );
});
