import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'css', 'style.css'), 'utf8');
const staticToast = /animation:\s*none\s*!important;[\s\S]*?transform:\s*translateX\(-50%\)\s*translateY\(0\);[\s\S]*?opacity:\s*1;/;

test('reduced-motion body class keeps timed game messages visibly static', () => {
    const bodyClassRule = css.match(/body\.reduced-motion #game-message\.message-anim\s*\{([\s\S]*?)\}/);
    assert.ok(bodyClassRule, 'body reduced-motion must override msgSlide on game messages');
    assert.match(bodyClassRule[1], staticToast);
});

test('OS reduced-motion preference keeps timed game messages visibly static', () => {
    const osPreferenceRule = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?#game-message\.message-anim\s*\{([\s\S]*?)\}\s*\}/);
    assert.ok(osPreferenceRule, 'OS reduced-motion must override msgSlide on game messages');
    assert.match(osPreferenceRule[1], staticToast);
});
