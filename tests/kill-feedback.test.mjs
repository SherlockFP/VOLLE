// Kill effects that read at any range: the killer's centre medal (streak aware) and
// a pooled light pillar at the elimination spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});
const THREE = await import(THREE_URL);
const { KillMedal, KillStreakTracker, killStreakTier, KILL_MEDAL_MS } = await import('../js/kill-medal.js');
const { KillPillars } = await import('../js/kill-pillars.js');

test('streak tiers: single, double, triple, quad, rampage', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(killStreakTier), ['', '', 'doubleKill', 'tripleKill', 'quadKill', 'rampage', 'rampage']);
    const tracker = new KillStreakTracker(4000);
    assert.equal(tracker.note(1000), 1);
    assert.equal(tracker.note(3000), 2);
    assert.equal(tracker.note(6900), 3, 'window restarts from the previous kill');
    assert.equal(tracker.note(20000), 1);
});

function fakeDoc() {
    const make = () => ({ textContent: '', children: [], dataset: {}, hidden: true, classList: new Set(), append(c) { this.children.push(c); }, replaceChildren() { this.children = []; } });
    const el = make(); const title = make(); const victim = make(); const tags = make();
    el.classList = { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } };
    el.offsetWidth = 1;
    el.ownerDocument = { createElement: () => make() };
    el.querySelector = sel => ({ '[data-kill-title]': title, '[data-kill-victim]': victim, '[data-kill-tags]': tags })[sel];
    return { doc: { getElementById: id => (id === 'kill-medal' ? el : null) }, el, title, victim, tags };
}

test('the medal names the victim, the streak and the shot', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { doc, el, title, victim, tags } = fakeDoc();
    const medal = new KillMedal(doc);
    assert.equal(medal.show({ victimName: 'Bot Ada', streak: 2, headshot: true, perfect: true }), true);
    assert.equal(title.textContent, 'DOUBLE KILL');
    assert.equal(victim.textContent, 'Bot Ada');
    assert.deepEqual(tags.children.map(c => c.textContent), ['HEADSHOT', 'PERFECT']);
    assert.equal(el.dataset.tier, 'doubleKill');
    assert.equal(el.hidden, false);
    assert.ok(el.classList.contains('is-live'));
    medal.show({ victimName: 'Bot Ben' });
    assert.equal(title.textContent, 'ELIMINATED');
    assert.equal(tags.children.length, 0);
    t.mock.timers.tick(KILL_MEDAL_MS);
    assert.equal(el.hidden, true);
    assert.equal(new KillMedal({ getElementById: () => null }).show({}), false, 'no HUD element: no-op');
});

test('pillars: four pooled slots, rise then vanish, oldest recycled', () => {
    const scene = new THREE.Scene();
    const pillars = new KillPillars(scene);
    for (let i = 0; i < 6; i++) assert.equal(pillars.spawn(new THREE.Vector3(i, 1, 0), 0xc0392b), true);
    assert.equal(pillars.slots.length, 4);
    assert.equal(scene.children.filter(c => c.name === 'kill-pillar').length, 4);
    const first = pillars.slots[0];
    pillars.update(0.2);
    assert.ok(first.beam.scale.y > 10, 'beam is tall within 0.2 s');
    assert.equal(first.group.position.y, 0);
    pillars.update(2);
    assert.ok(pillars.slots.every(s => s.life === 0 && s.group.visible === false));
    scene.remove(first.group);
    pillars.spawn(new THREE.Vector3(0, 0, 0));
    assert.equal(first.group.parent, scene, 're-attached after a scene rebuild');
    pillars.dispose();
    assert.equal(scene.children.length, 0);
});

test('game presents both layers: pillar for everyone, medal only for the local killer', () => {
    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(game, /this\.killPillars\?\.spawn\(hitPos, TEAM_COLORS\[victimTeam\] \?\? 0xffe08a\);/);
    assert.match(game, /const medalShown = isLocalKiller && this\.killMedal\?\.show\(\{/);
    assert.match(game, /`KO CONFIRMED - \$\{victimName \|\| 'Opponent'\}`, duration, medalShown \? \{ tone: 'kill-confirm' \} : undefined\);/);
    assert.match(game, /this\._updateKnockouts\(dt\);\s+this\.killPillars\?\.update\(dt\);/);
    assert.match(game, /\{ headshot: data\.hitZoneId === 'head', perfect: !!data\.perfectTag \}/);
});
