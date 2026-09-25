// Chat filter: EN/TR slurs and profanity masked on every chat surface, on by
// default, with a Settings toggle. Clean words that contain a blocked stem stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { filterChatText, isBlockedWord } from '../js/chat-filter.js';
import { readAppSource } from './app-source.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('slurs and swears are masked, including obfuscated spellings', () => {
    const cases = {
        'you are a nigger': 'you are a ******',
        'N1GG3R': '******',
        'niiiigger': '*********',
        'n i g g e r lol': '* * * * * * lol',
        'f.u.c.k this': '*.*.*.* this',
        'what the fuck': 'what the ****',
        'shitty play': '****** play',
        'faggot': '******',
        'amk ne oldu': '*** ne oldu',
        'siktir git': '****** git',
        'orospu çocuğu': '****** çocuğu',
        'göt': '***',
        'aq': '**'
    };
    for (const [input, expected] of Object.entries(cases)) assert.equal(filterChatText(input), expected, input);
});

test('clean words that contain a blocked stem are left alone', () => {
    for (const clean of ['I got it', 'şikayet ettim', 'sikke topladım', 'classic assassin', 'cockpit view', 'peacock',
        'Niger is a country', 'hancock', 'Amsterdam', 'ananın yemekleri', 'mükemmel', 'gg wp', 'scunthorpe', 'Dickens']) {
        assert.equal(filterChatText(clean), clean, clean);
    }
    assert.equal(isBlockedWord(''), false);
});

test('the filter can be switched off, and keeps the message length', () => {
    assert.equal(filterChatText('what the fuck', { enabled: false }), 'what the fuck');
    assert.equal(filterChatText('fuck').length, 4);
    assert.equal(filterChatText(null), '');
});

test('settings toggle defaults on and every chat surface reads it', () => {
    const html = read('index.html');
    assert.match(html, /<input type="checkbox" id="setting-chat-filter" checked>/);
    const main = readAppSource();
    assert.match(main, /'setting-chat-filter': settings\.chatFilter !== false,/);
    assert.match(main, /s\.chatFilter = e\.target\.checked;/);
    assert.match(main, /_chatClean\(text\) \{\s+return filterChatText\(text, \{ enabled: this\.store\.get\('settings'\)\?\.chatFilter !== false \}\);/);
    assert.equal((main.match(/this\._chatClean\(/g) || []).length >= 4, true, 'social lobby name+text, clan chat, friend DMs');
    const ui = read('js/ui.js');
    assert.match(ui, /const filterOn = Store\.get\('settings'\)\?\.chatFilter !== false;/);
});

test('chat sender names are HTML-escaped in every log (peer-supplied)', () => {
    const ui = read('js/ui.js');
    const start = ui.indexOf('    addChatMessage(rawName, rawText) {');
    const body = ui.slice(start, ui.indexOf('\n    escapeHTML(', start));
    assert.match(body, /const name = this\.escapeHTML\(filterChatText\(rawName, \{ enabled: filterOn \}\)\);/);
    assert.equal((body.match(/<span class="chat-name">\$\{name\}:<\/span> \$\{this\.escapeHTML\(text\)\}/g) || []).length, 3);
    assert.doesNotMatch(body, /\$\{rawName\}/);
});
