// tests/first-session-i18n.test.mjs — a Turkish player's first session stays in
// Turkish: the guided-drill HUD, the drill result rows, the solo chooser rules
// line, the match-loading mode name and the post-game Battle Pass tier label.
// English output must stay byte-identical to the pre-localisation strings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { compileMethod, extractMethod, fakeElement, readSource } from './method-source.mjs';
import { getLanguage, localizedName, setLanguage, setText, t } from '../js/i18n.js';
import en from '../js/locales/en.js';
import tr from '../js/locales/tr.js';
import { GUIDED_DRILL_PROFILES, GUIDED_DRILL_STAGES } from '../js/guided-deflect-drill.js';
import { getSoloPreset } from '../js/solo-presets.js';
import { RALLY_DUEL_MODE_ID } from '../js/rally-duel.js';
import { GOAL_RUSH_MODE_ID } from '../js/goal-mode.js';

const FIRST_RUN = GUIDED_DRILL_PROFILES.first_run.stages;
// js/gamemodes.js pulls in three.js, so read its { id, name } catalog from source.
const MODE_ID_CONSTANTS = { RALLY_DUEL_MODE_ID, GOAL_RUSH_MODE_ID };
const GAME_MODES = Object.fromEntries([...readSource('js/gamemodes.js').matchAll(/\bid: (?:'([\w-]+)'|(\w+)), name: '([^']+)'/g)]
    .map(([, literal, constant, name]) => [literal || MODE_ID_CONSTANTS[constant], { name }]));
const PHASES = ['countdown', 'stage', 'transition'];
const ENGLISH_LEAKS = /READY|STAGE|NEXT|Next:|Get ready|Read the serve|Aim the return|Contact inside/;

function withLanguage(lang, fn) {
    setLanguage(lang, { persist: false, root: null });
    try { return fn(); } finally { setLanguage('en', { persist: false, root: null }); }
}

function lookup(table, key) {
    return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), table);
}

// Same shape as GuidedDeflectDrill.snapshot() for the fields the HUD reads.
function drillSnapshot(phase, index, stages = FIRST_RUN) {
    const stage = stages[index];
    return {
        phase,
        stageIndex: index,
        stageCount: stages.length,
        stage: { ...stage },
        nextStage: phase === 'transition' && stages[index + 1] ? { ...stages[index + 1] } : null,
        phaseElapsedMs: 1000,
        phaseRemainingMs: 2400,
        speedMultiplier: stage.speedStart,
        stats: { hits: 3, directed: 2, perfect: 1 }
    };
}

const HUD_IDS = [
    'practice-lab-mode', 'drill-stage', 'drill-timer', 'drill-speed', 'drill-hits',
    'drill-directed', 'drill-perfect', 'practice-hint', 'drill-stage-progress'
];

function renderHud(snapshot) {
    const nodes = Object.fromEntries(HUD_IDS.map(id => [id, fakeElement(id)]));
    const document = { getElementById: id => nodes[id] || null };
    const update = compileMethod('js/main.js', '_updateGuidedDrillHUD', { document, t, localizedName });
    update.call({}, snapshot);
    return Object.fromEntries(Object.entries(nodes).map(([id, el]) => [id, el.textContent]));
}

// The strings the HUD wrote before localisation, kept here as the EN contract.
function legacyEnglishHud(snapshot) {
    const stage = snapshot.stage || {};
    const displayStage = snapshot.phase === 'transition' ? snapshot.nextStage || stage : stage;
    const count = snapshot.stageCount || 1;
    return {
        'practice-lab-mode': displayStage.name || 'GUIDED',
        'drill-stage': snapshot.phase === 'countdown'
            ? 'READY'
            : snapshot.phase === 'transition'
                ? `NEXT ${Math.min((snapshot.stageIndex || 0) + 2, count)}/${count}`
                : `STAGE ${Math.min((snapshot.stageIndex || 0) + 1, count)}/${count}`,
        'practice-hint': snapshot.phase === 'countdown'
            ? 'Get ready. First serve incoming.'
            : snapshot.phase === 'transition'
                ? `Next: ${displayStage.instruction || ''}`
                : stage.instruction || ''
    };
}

test('EN guided-drill HUD writes exactly the pre-localisation strings for every first_run phase', () => {
    withLanguage('en', () => {
        for (const phase of PHASES) {
            FIRST_RUN.forEach((stage, index) => {
                const snapshot = drillSnapshot(phase, index);
                const out = renderHud(snapshot);
                for (const [id, expected] of Object.entries(legacyEnglishHud(snapshot))) {
                    assert.equal(out[id], expected, `${phase} ${stage.id} ${id}`);
                }
                assert.equal(out['drill-timer'], '00:03');
                assert.equal(out['drill-hits'], 3);
            });
        }
        assert.equal(renderHud(drillSnapshot('countdown', 0))['drill-stage'], 'READY');
        assert.equal(renderHud(drillSnapshot('countdown', 0))['practice-hint'], 'Get ready. First serve incoming.');
        assert.equal(renderHud(drillSnapshot('stage', 1))['drill-stage'], 'STAGE 2/3');
        assert.equal(renderHud(drillSnapshot('stage', 1))['practice-hint'], 'Aim the return through the marked gate.');
        assert.equal(renderHud(drillSnapshot('transition', 0))['drill-stage'], 'NEXT 2/3');
        assert.equal(renderHud(drillSnapshot('transition', 0))['practice-lab-mode'], 'DIRECTION');
        assert.equal(renderHud(drillSnapshot('transition', 1))['practice-hint'], 'Next: Contact inside the perfect timing window.');
    });
});

test('TR guided-drill HUD has no English copy and reads stage text from drill.stages.<id>', () => {
    withLanguage('tr', () => {
        for (const phase of PHASES) {
            FIRST_RUN.forEach((stage, index) => {
                const snapshot = drillSnapshot(phase, index);
                const out = renderHud(snapshot);
                for (const [id, value] of Object.entries(out)) {
                    assert.doesNotMatch(String(value), ENGLISH_LEAKS, `${phase} ${stage.id} #${id}: ${value}`);
                }
                const shown = phase === 'transition' ? snapshot.nextStage || snapshot.stage : snapshot.stage;
                assert.equal(out['practice-lab-mode'], t(`drill.stages.${shown.id}.name`));
                if (phase === 'countdown') {
                    assert.equal(out['drill-stage'], t('drill.ready'));
                    assert.equal(out['practice-hint'], t('drill.getReady'));
                } else if (phase === 'stage') {
                    assert.equal(out['drill-stage'], t('drill.stageOf', { n: index + 1, total: 3 }));
                    assert.equal(out['practice-hint'], t(`drill.stages.${stage.id}.instruction`));
                } else {
                    assert.equal(out['drill-stage'], t('drill.nextOf', { n: Math.min(index + 2, 3), total: 3 }));
                    assert.equal(out['practice-hint'], t('drill.nextHint', {
                        instruction: t(`drill.stages.${shown.id}.instruction`)
                    }));
                }
            });
        }
        assert.equal(renderHud(drillSnapshot('stage', 0))['practice-hint'], tr.drill.stages.control.instruction);
        assert.equal(renderHud(drillSnapshot('countdown', 0))['drill-stage'], 'HAZIR');
        assert.equal(renderHud(drillSnapshot('stage', 2))['drill-stage'], 'AŞAMA 3/3');
    });
});

test('an unknown drill stage id falls back to the stage object\'s own English fields', () => {
    const custom = [{ id: 'mystery', name: 'MYSTERY', instruction: 'Do the thing.', durationMs: 1000, speedStart: 1 }];
    withLanguage('tr', () => {
        const out = renderHud(drillSnapshot('stage', 0, custom));
        assert.equal(out['practice-lab-mode'], 'MYSTERY');
        assert.equal(out['practice-hint'], 'Do the thing.');
    });
});

function renderResult(result, firstRun) {
    const makeNode = tag => {
        const el = fakeElement();
        el.tagName = String(tag).toUpperCase();
        el.append = (...children) => el.children.push(...children);
        return el;
    };
    const list = fakeElement('drill-result-stages');
    list.replaceChildren = () => { list.children = []; };
    list.append = (...children) => list.children.push(...children);
    const nodes = {
        'guided-drill-result': fakeElement('guided-drill-result', { classes: ['hidden'] }),
        'drill-result-kicker': fakeElement(),
        'drill-result-headline': fakeElement(),
        'drill-result-grade': fakeElement(),
        'drill-result-score': fakeElement(),
        'drill-result-stages': list,
        'btn-drill-retry': fakeElement(),
        'btn-drill-free-lab': fakeElement()
    };
    const document = { getElementById: id => nodes[id] || null, createElement: makeNode };
    const show = compileMethod('js/main.js', '_showGuidedDrillResult', { document, t, setText, localizedName });
    const app = { game: {}, player: { unlock() {} } };
    show.call(app, result, { firstRun });
    assert.equal(nodes['guided-drill-result'].classList.contains('hidden'), false);
    return list.children.map(row => ({
        name: row.children[0].textContent,
        value: row.children[1].textContent,
        passed: row.dataset.passed
    }));
}

const drillResult = stages => ({
    score: 72,
    grade: 'B',
    stages: stages.map((stage, index) => ({
        id: stage.id,
        name: stage.name,
        hits: 4 + index,
        directed: 2 + index,
        perfect: 1 + index,
        score: 60 + index * 10,
        passed: index !== 1
    }))
});

test('drill result rows use the drill.stages label (first run) and name (full drill) keys in TR', () => {
    withLanguage('tr', () => {
        const firstRows = renderResult(drillResult(FIRST_RUN), true);
        assert.deepEqual(firstRows.map(row => row.name), FIRST_RUN.map(stage => t(`drill.stages.${stage.id}.label`)));
        assert.deepEqual(firstRows.map(row => row.name), ['Kontrol', 'Yön', 'Zamanlama']);
        assert.deepEqual(firstRows.map(row => row.value), ['4 temas', '3 isabetli yön', '3 kusursuz']);
        const fullRows = renderResult(drillResult(GUIDED_DRILL_STAGES), false);
        assert.deepEqual(fullRows.map(row => row.name), GUIDED_DRILL_STAGES.map(stage => t(`drill.stages.${stage.id}.name`)));
        assert.deepEqual(fullRows.map(row => row.value), ['60 GEÇTİ', '70 TEKRAR', '80 GEÇTİ']);
        for (const row of [...firstRows, ...fullRows]) assert.doesNotMatch(row.name, /CONTROL|DIRECTION|TIMING|Control|Direction|Timing/);
    });
});

test('drill result rows keep the pre-localisation English names', () => {
    withLanguage('en', () => {
        const firstRows = renderResult(drillResult(FIRST_RUN), true);
        // The old code title-cased stage.name at runtime; the label keys must match it.
        assert.deepEqual(firstRows.map(row => row.name), FIRST_RUN.map(stage => stage.name[0] + stage.name.slice(1).toLowerCase()));
        assert.deepEqual(firstRows.map(row => row.value), ['4 contacts', '3 on target', '3 perfect']);
        const fullRows = renderResult(drillResult(GUIDED_DRILL_STAGES), false);
        assert.deepEqual(fullRows.map(row => row.name), ['CONTROL', 'DIRECTION', 'TIMING']);
        assert.deepEqual(fullRows.map(row => row.value), ['60 PASS', '70 RETRY', '80 PASS']);
    });
});

// selectSoloPreset is a closure inside setupMenuHandlers: lift its shipped
// source into a function so the rules line can run against stub elements.
function soloChooser(app) {
    const main = readSource('js/main.js');
    const start = main.indexOf('const selectSoloPreset = id => {');
    const end = main.indexOf('\n        };', start) + '\n        };'.length;
    assert.ok(start > 0 && end > start, 'selectSoloPreset closure not found');
    const detail = fakeElement('solo-paths-detail');
    const document = { getElementById: id => (id === 'solo-paths-detail' ? detail : null) };
    const factory = runInNewContext(
        `(function () { let soloPresetId = 'warmup'; const soloDialog = null; ${main.slice(start, end)} return selectSoloPreset; })`,
        { document, getSoloPreset, t, setText, String }
    );
    return { select: factory.call(app), detail };
}

test('solo chooser rules line is localised and EN stays byte-identical', () => {
    const app = { _adaptiveSkillPercent: () => 42 };
    withLanguage('en', () => {
        const { select, detail } = soloChooser(app);
        select('warmup');
        assert.equal(detail.textContent, '3 rounds · 3 minute match limit · easy opponent. Review your court in the lobby.');
        assert.equal(detail.getAttribute('data-i18n'), 'solo.detail');
        select('rally_duel');
        assert.equal(detail.textContent, '3 rounds · 3 minute match limit · medium opponent. Review your court in the lobby.');
        select('pressure');
        assert.equal(detail.textContent, '5 rounds · 3 minute match limit · hard opponent. Review your court in the lobby.');
        select('matched');
        assert.equal(detail.textContent, '5 rounds · 3 minute match limit · adaptive opponent (level 42%). Review your court in the lobby.');
    });
    withLanguage('tr', () => {
        const { select, detail } = soloChooser(app);
        for (const id of ['warmup', 'rally_duel', 'pressure', 'matched']) {
            select(id);
            assert.doesNotMatch(detail.textContent, /rounds|minute|opponent|Review|adaptive|level/, `${id}: ${detail.textContent}`);
        }
        select('warmup');
        assert.equal(detail.textContent, t('solo.detail', { rounds: 3, minutes: 3, opponent: tr.solo.opponent.easy }));
        select('matched');
        assert.match(detail.textContent, /%42/);
    });
    const selection = readSource('js/main.js').slice(
        readSource('js/main.js').indexOf('const selectSoloPreset ='),
        readSource('js/main.js').indexOf("bind('btn-menu-bots'")
    );
    assert.doesNotMatch(selection, /minute match limit|Review your court|adaptive opponent/);
});

function renderMatchLoading(app, match) {
    const nodes = Object.fromEntries(['match-loading', 'match-loading-map', 'match-loading-mode', 'match-loading-tip',
        'match-loading-progress', 'match-loading-percent'].map(id => [id, fakeElement(id)]));
    const show = compileMethod('js/main.js', '_showMatchLoading', {
        document: { getElementById: id => nodes[id] || null },
        Arena: { MAPS: {} },
        GAME_MODES,
        t,
        localizedName,
        getLanguage,
        performance: { now: () => 0 },
        requestAnimationFrame: () => {},
        window: { setTimeout: () => {} }
    });
    show.call(app, 900, match);
    return nodes['match-loading-mode'].textContent;
}

test('match-loading mode name comes from modeNames, so TR shows the Turkish mode', () => {
    assert.equal(GAME_MODES.classic?.name, 'Classic');
    assert.equal(GAME_MODES.rally_duel?.name, 'Rally Duel');
    assert.equal(GAME_MODES.goal_rush?.name, 'Goal Rush');
    assert.equal(GAME_MODES.undefined, undefined, 'every catalog id resolved');
    assert.match(extractMethod('js/main.js', '_showMatchLoading'), /localizedName\('modeNames', mode,/);
    const app = { arena: null, game: { mode: { id: 'classic', name: 'Classic' } } };
    withLanguage('en', () => {
        assert.equal(renderMatchLoading(app, {}), 'CLASSIC');
        assert.equal(renderMatchLoading(app, { mode: 'rally_duel' }), 'RALLY DUEL');
        assert.equal(renderMatchLoading(app, { modeName: 'Social Hub' }), 'SOCIAL HUB');
    });
    withLanguage('tr', () => {
        assert.equal(renderMatchLoading(app, {}), 'KLASİK', 'Turkish upper-casing keeps the dotted İ');
        assert.equal(renderMatchLoading(app, { mode: 'rally_duel' }), 'RALLİ DÜELLOSU');
        assert.equal(renderMatchLoading(app, { mode: 'goal_rush' }), GAME_MODES.goal_rush.name.toLocaleUpperCase('tr'),
            'a mode without a modeNames entry keeps its catalog name');
    });
    // English stays byte-identical: every localised catalog mode keeps its catalog name in en.js.
    for (const [id, name] of Object.entries(en.modeNames)) {
        if (GAME_MODES[id]) assert.equal(name, GAME_MODES[id].name, `en.modeNames.${id}`);
    }
});

const NEW_KEYS = {
    'drill.ready': 'READY',
    'drill.stageOf': 'STAGE {n}/{total}',
    'drill.nextOf': 'NEXT {n}/{total}',
    'drill.getReady': 'Get ready. First serve incoming.',
    'drill.nextHint': 'Next: {instruction}',
    'practice.labTitle': 'PRACTICE LAB',
    'practice.accuracy': 'Accuracy',
    'practice.perfectLabel': 'Perfect',
    'practice.bestTiming': 'Best Timing',
    'practice.hits': 'Hits',
    'practice.directed': 'Directed',
    'solo.detail': '{rounds} rounds · {minutes} minute match limit · {opponent}. Review your court in the lobby.',
    'solo.detailDefault': 'Your selected rules will appear in the lobby before you start.',
    'solo.adaptiveOpponent': 'adaptive opponent (level {level}%)',
    'solo.opponent.easy': 'easy opponent',
    'solo.opponent.medium': 'medium opponent',
    'solo.opponent.hard': 'hard opponent',
    'solo.prepare': 'Prepare match ↗',
    'pg.bpTier': 'Battlepass · Tier'
};
for (const stage of GUIDED_DRILL_STAGES) {
    NEW_KEYS[`drill.stages.${stage.id}.name`] = stage.name;
    NEW_KEYS[`drill.stages.${stage.id}.label`] = stage.name[0] + stage.name.slice(1).toLowerCase();
    NEW_KEYS[`drill.stages.${stage.id}.instruction`] = stage.instruction;
}

test('every new first-session key exists in en and tr with matching params, and en keeps today\'s copy', () => {
    const params = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.equal(Object.keys(NEW_KEYS).length, 28);
    for (const [key, english] of Object.entries(NEW_KEYS)) {
        const enValue = lookup(en, key);
        const trValue = lookup(tr, key);
        assert.equal(enValue, english, `en.${key}`);
        assert.equal(typeof trValue, 'string', `tr.${key} missing`);
        assert.ok(trValue.trim(), `tr.${key} empty`);
        assert.deepEqual(params(trValue), params(enValue), `tr.${key} params`);
        assert.notEqual(trValue, enValue, `tr.${key} is still English`);
    }
    // drill.perfect is the "{count} perfect" metric; the static label is its own key.
    assert.equal(en.drill.perfect, '{count} perfect');
    assert.deepEqual(Object.keys(tr.drill.stages).sort(), Object.keys(en.drill.stages).sort());
    assert.deepEqual(Object.keys(tr.solo.opponent).sort(), Object.keys(en.solo.opponent).sort());
});

test('index.html tags the drill, chooser and report labels without touching their live values', () => {
    const html = readSource('index.html');
    const lab = html.slice(html.indexOf('<aside id="practice-lab-hud"'), html.indexOf('</aside>', html.indexOf('<aside id="practice-lab-hud"')));
    assert.match(lab, /<header><span data-i18n="practice\.labTitle">PRACTICE LAB<\/span><b id="practice-lab-mode">/);
    assert.match(lab, /<span><span data-i18n="practice\.accuracy">Accuracy<\/span> <b id="practice-accuracy">0%<\/b><\/span>/);
    assert.match(lab, /<span><span data-i18n="practice\.perfectLabel">Perfect<\/span> <b id="practice-perfects">0<\/b><\/span>/);
    assert.match(lab, /<span><span data-i18n="practice\.bestTiming">Best Timing<\/span> <b id="practice-best">--<\/b><\/span>/);
    assert.match(lab, /<span><span data-i18n="practice\.hits">Hits<\/span> <b id="drill-hits">0<\/b><\/span>/);
    assert.match(lab, /<span><span data-i18n="practice\.directed">Directed<\/span> <b id="drill-directed">0<\/b><\/span>/);
    assert.match(lab, /<span><span data-i18n="practice\.perfectLabel">Perfect<\/span> <b id="drill-perfect">0<\/b><\/span>/);
    assert.match(html, /<p id="solo-paths-detail" role="status" data-i18n="solo\.detailDefault">Your selected rules will appear in the lobby before you start\.<\/p>/);
    assert.match(html, /<button type="button" id="solo-paths-start" class="solo-start" data-i18n="solo\.prepare">Prepare match ↗<\/button>/);
    assert.match(html, /<span class="pg-bp-tier-label"><span data-i18n="pg\.bpTier">Battlepass &middot; Tier<\/span> <b id="pg-bp-tier">0<\/b>\/50<\/span>/);
    // applyI18n rewrites text: no data-i18n may sit on a span that owns a live <b id> value.
    const tierStart = html.indexOf('<span class="pg-bp-tier-label">');
    const tier = html.slice(tierStart, html.indexOf('\n', tierStart));
    for (const region of [lab, tier]) {
        assert.doesNotMatch(region, /<span[^>\n]*data-i18n="[^"]*"[^>\n]*>[^<\n]*<b id=/);
    }
});
