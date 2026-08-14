import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function extractMethod(name) {
    const match = new RegExp(`^ {4}${name}\\([^\\n]*\\) \\{`, 'm').exec(source);
    assert.ok(match, `App.${name} not found`);
    const start = match.index;
    const bodyStart = start + match[0].length - 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = bodyStart; index < source.length; index++) {
        const character = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
        if (character === '{') depth++;
        if (character === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`App.${name} incomplete`);
}

function keyboardFixture() {
    const clicks = [];
    const document = { body: { dataset: { screen: 'multiplayerMenu' } }, activeElement: null };
    const control = id => ({
        id,
        disabled: false,
        focus() { document.activeElement = this; },
        click() { clicks.push(id); }
    });
    const dodgeball = control('dodgeball');
    const volleyball = control('volleyball');
    const back = control('btn-sport-back');
    const stage = {
        inert: false,
        classList: { contains: () => false },
        querySelectorAll: () => [dodgeball, volleyball]
    };
    document.getElementById = id => id === 'sport-select-stage' ? stage : id === 'btn-sport-back' ? back : null;
    const method = runInNewContext(`({ ${extractMethod('_handleSportSelectKeydown')} })._handleSportSelectKeydown`, { document });
    const event = (code, shiftKey = false) => ({
        code, shiftKey, prevented: 0, stopped: 0,
        preventDefault() { this.prevented++; },
        stopPropagation() { this.stopped++; }
    });
    return { method, document, stage, dodgeball, volleyball, back, clicks, event };
}

test('Sport Select owns deterministic Tab order from its focused stage', () => {
    const fixture = keyboardFixture();
    fixture.document.activeElement = fixture.stage;
    for (const expected of [fixture.dodgeball, fixture.volleyball, fixture.back]) {
        const event = fixture.event('Tab');
        assert.equal(fixture.method.call({}, event), true);
        assert.equal(fixture.document.activeElement, expected);
        assert.equal(event.prevented, 1);
        assert.equal(event.stopped, 1);
    }
});

test('Enter and Space activate the focused native sport card exactly once', () => {
    const fixture = keyboardFixture();
    fixture.document.activeElement = fixture.dodgeball;
    assert.equal(fixture.method.call({}, fixture.event('Enter')), true);
    fixture.document.activeElement = fixture.volleyball;
    assert.equal(fixture.method.call({}, fixture.event('Space')), true);
    assert.deepEqual(fixture.clicks, ['dodgeball', 'volleyball']);
});

test('hidden or inert Sport Select never steals global keyboard input', () => {
    const fixture = keyboardFixture();
    fixture.stage.inert = true;
    assert.equal(fixture.method.call({}, fixture.event('Tab')), false);
    assert.equal(fixture.document.activeElement, null);
});

test('Volleyball disables and inerts party follow while Dodgeball restores it', () => {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            id,
            dataset: {},
            classList: { toggle() {} },
            disabled: false,
            inert: false,
            textContent: '',
            value: '',
            setAttribute(name, value) { this[name] = value; }
        });
        return elements.get(id);
    };
    const directory = element('directory');
    const status = element('status');
    const document = {
        getElementById: id => element(id),
        querySelector: selector => selector === '#multiplayer-menu .mp-right' ? directory : status
    };
    const sports = {
        volleyball: { id: 'volleyball', name: 'Volleyball', status: 'IN DEVELOPMENT' },
        dodgeball: { id: 'dodgeball', name: 'Dodgeball', status: 'LIVE' }
    };
    const method = runInNewContext(`({ ${extractMethod('_applySportPresentation')} })._applySportPresentation`, {
        document,
        sportDefinition: id => sports[id],
        canHostSport: id => id === 'dodgeball',
        canPlayLocalSport: id => id === 'volleyball',
        SPORT_IDS: { VOLLEYBALL: 'volleyball' }
    });
    const app = { _selectedSportId: 'volleyball' };

    method.call(app);
    assert.equal(element('btn-mp-party-follow').disabled, true);
    assert.equal(element('btn-mp-party-follow').inert, true);
    assert.equal(directory.inert, true);

    app._selectedSportId = 'dodgeball';
    method.call(app);
    assert.equal(element('btn-mp-party-follow').disabled, false);
    assert.equal(element('btn-mp-party-follow').inert, false);
    assert.equal(directory.inert, false);
});
