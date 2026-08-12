// Normal-match mobile HUD lanes: source contract for the 375px collision fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function hudLanesBlock() {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const marker = '/* Normal-match HUD lanes:';
    const start = css.indexOf(marker);
    assert.ok(start >= 0, 'normal-match HUD lane block must exist');
    const end = css.indexOf('/* Reference-directed lobby:', start);
    return { css, block: css.slice(start, end >= 0 ? end : undefined), start };
}

test('normal-match HUD lanes are late, scoped away from practice, and avoid important overrides', async () => {
    const { css, block, start } = await hudLanesBlock();
    const practice = css.indexOf('body.practice-lab-active :is(#network-diagnostics, #minimap-wrap, #ball-speed)');
    assert.ok(practice >= 0 && practice < start, 'practice layout must remain earlier and independently owned');
    assert.match(css, /body\.practice-lab-active :is\(#network-diagnostics, #minimap-wrap, #ball-speed\)\s*\{\s*display:\s*none/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?body\.practice-lab-active #ultimate-hud\s*\{[\s\S]*?left:\s*auto;[\s\S]*?right:\s*16px;[\s\S]*?bottom:\s*16px;[\s\S]*?width:\s*64px;[\s\S]*?transform:\s*none;/);
    assert.match(block, /body:not\(\.practice-lab-active\) #vitals/);
    assert.doesNotMatch(block, /body\.practice-lab-active\s*#/);
    assert.doesNotMatch(block, /!important/);
});

test('375px and exact 720px normal matches reserve the scoped adjacent HUD lanes', async () => {
    const { css, block } = await hudLanesBlock();
    assert.match(block, /@media \(max-width: 720px\)[\s\S]*?body:not\(\.practice-lab-active\) #vitals\s*\{[\s\S]*?left:\s*12px;[\s\S]*?bottom:\s*12px;[\s\S]*?width:\s*176px;/);
    assert.match(block, /body:not\(\.practice-lab-active\) #ultimate-hud\s*\{[\s\S]*?left:\s*196px;[\s\S]*?bottom:\s*12px;[\s\S]*?width:\s*64px;[\s\S]*?transform:\s*none;/);
    assert.match(block, /body:not\(\.practice-lab-active\) #minimap-wrap\s*\{[\s\S]*?right:\s*12px;[\s\S]*?bottom:\s*12px;[\s\S]*?width:\s*95px;[\s\S]*?height:\s*84px;/);
    assert.match(block, /body:not\(\.practice-lab-active\) #minimap-canvas\s*\{[\s\S]*?width:\s*95px;[\s\S]*?height:\s*84px;/);
    assert.match(block, /body:not\(\.practice-lab-active\) #ball-speed\s*\{[\s\S]*?right:\s*12px;[\s\S]*?bottom:\s*104px;[\s\S]*?width:\s*95px;[\s\S]*?text-align:\s*center;/);
    assert.match(css, /body:not\(\.practice-lab-active\) \.network-diagnostics\s*\{[\s\S]*?right:\s*12px;[\s\S]*?bottom:\s*156px;[\s\S]*?width:\s*auto;[\s\S]*?justify-content:\s*flex-end;[\s\S]*?font-size:\s*\.68rem;/);
    assert.match(css, /body:not\(\.practice-lab-active\) \.network-diagnostics > span\s*\{\s*display:\s*none;/);
});

test('normal-match controls wrap inside the 375px safe width while desktop stacks speed and diagnostics above the minimap', async () => {
    const { css, block } = await hudLanesBlock();
    assert.match(block, /body:not\(\.practice-lab-active\) #controls-hint\s*\{[\s\S]*?top:\s*84px;/);
    assert.match(block, /@media \(max-width: 720px\)[\s\S]*?body:not\(\.practice-lab-active\) #controls-hint\s*\{[\s\S]*?left:\s*12px;[\s\S]*?width:\s*calc\(100vw - 24px\);[\s\S]*?max-width:\s*351px;[\s\S]*?max-height:\s*2\.5em;[\s\S]*?overflow:\s*hidden;[\s\S]*?transform:\s*none;[\s\S]*?white-space:\s*normal;[\s\S]*?text-align:\s*center;[\s\S]*?line-height:\s*1\.25;/);
    assert.match(block, /body:not\(\.practice-lab-active\) #ball-speed\s*\{[\s\S]*?right:\s*16px;[\s\S]*?bottom:\s*144px;[\s\S]*?width:\s*160px;[\s\S]*?text-align:\s*center;/);
    assert.match(css, /\.network-diagnostics,[\s\S]*?body:not\(\.practice-lab-active\) \.network-diagnostics\s*\{[\s\S]*?width:\s*auto;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
});

test('mobile game messages stay contained and use a vertical-only animation', async () => {
    const { css, block } = await hudLanesBlock();
    const mobileMessage = block.slice(block.indexOf('    #game-message {'));
    assert.match(block, /@media \(max-width: 720px\)[\s\S]*?#game-message\s*\{[\s\S]*?top:\s*18%;[\s\S]*?left:\s*16px;[\s\S]*?width:\s*calc\(100vw - 32px\);[\s\S]*?max-width:\s*none;[\s\S]*?box-sizing:\s*border-box;[\s\S]*?padding:\s*8px 10px;[\s\S]*?border:\s*1px solid rgba\(255,255,255,\.16\);[\s\S]*?border-radius:\s*10px;[\s\S]*?background:\s*rgba\(3,18,27,\.78\);[\s\S]*?transform:\s*none;[\s\S]*?font-size:\s*1rem;[\s\S]*?line-height:\s*1\.3;[\s\S]*?text-align:\s*center;[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/);
    assert.match(block, /#game-message\.message-anim\s*\{\s*animation-name:\s*msgSlideMobile;/);
    assert.match(css, /@keyframes msgSlideMobile\s*\{\s*0%\s*\{\s*transform:\s*translateY\(12px\);\s*opacity:\s*0;\s*\}\s*15%\s*\{\s*transform:\s*translateY\(0\);\s*opacity:\s*1;\s*\}\s*70%\s*\{\s*opacity:\s*1;\s*\}\s*100%\s*\{\s*opacity:\s*0;/);
    assert.match(css, /@media \(max-width: 720px\) and \(prefers-reduced-motion: reduce\)\s*\{\s*#game-message\.message-anim\s*\{\s*animation:\s*none;\s*transform:\s*none;\s*opacity:\s*1;/);
    assert.doesNotMatch(mobileMessage.slice(0, mobileMessage.indexOf('@keyframes msgSlideMobile')), /!important/);
});
