import test from 'node:test';
import assert from 'node:assert/strict';
import { initSettingsTabs, selectSettingsTab } from '../js/settings-controller.js';

// Real EventTarget dispatch with a small parent chain: panel key events bubble
// to the root, so a document-wide shortcut would fail the native-control tests.
class Element extends EventTarget {
  constructor(doc, { tagName = 'DIV', dataset = {} } = {}) {
    super();
    this.ownerDocument = doc;
    this.tagName = tagName;
    this.dataset = dataset;
    this.attributes = new Map();
    this.parentNode = null;
    this.hidden = false;
    this.scrollTop = 0;
    const classes = new Set();
    this.classList = {
      contains: name => classes.has(name),
      toggle(name, active) { active ? classes.add(name) : classes.delete(name); }
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get tabIndex() { return Number(this.getAttribute('tabindex') ?? (this.tagName === 'BUTTON' ? 0 : -1)); }
  set tabIndex(value) { this.setAttribute('tabindex', value); }
  focus() { this.ownerDocument.activeElement = this; }
  dispatchEvent(event) {
    if (!event.target) Object.defineProperty(event, 'target', { value: this });
    super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble) this.parentNode?.dispatchEvent(event);
    return !event.defaultPrevented;
  }
}

function fixture(keys = ['controls', 'video', 'game', 'access']) {
  const doc = { activeElement: null };
  const root = new Element(doc);
  const tablist = new Element(doc);
  const scroll = new Element(doc);
  tablist.parentNode = scroll.parentNode = root;
  const tabs = keys.map(key => {
    const tab = new Element(doc, { tagName: 'BUTTON', dataset: { tab: key } });
    tab.parentNode = tablist;
    return tab;
  });
  const sections = keys.map(key => {
    const section = new Element(doc, { dataset: { settingsSection: key } });
    section.parentNode = scroll;
    return section;
  });
  root.querySelectorAll = selector => selector === '.settings-tab' ? tabs
    : selector === '[data-settings-section]' ? sections : [];
  root.querySelector = selector => selector === '.settings-tabs' ? tablist
    : selector === '.settings-scroll' ? scroll : null;
  return { doc, root, tablist, scroll, tabs, sections };
}

function init(t, f = fixture()) {
  const controller = initSettingsTabs(f.root);
  t.after(() => controller.destroy());
  return { ...f, controller };
}

function press(target, key, options = {}) {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(event, { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...options });
  target.dispatchEvent(event);
  return event;
}

function assertSelected(f, key) {
  assert.deepEqual(f.tabs.filter(tab => tab.tabIndex === 0).map(tab => tab.dataset.tab), [key]);
  for (const tab of f.tabs) {
    const active = tab.dataset.tab === key;
    assert.equal(tab.classList.contains('selected'), active);
    assert.equal(tab.getAttribute('aria-selected'), String(active));
    assert.equal(tab.tabIndex, active ? 0 : -1);
  }
  assert.deepEqual(f.sections.filter(section => !section.hidden).map(section => section.dataset.settingsSection), [key]);
}

test('initialization links every tab to its panel and exposes one tab stop without moving focus', t => {
  const f = init(t);
  assertSelected(f, 'controls');
  assert.equal(f.doc.activeElement, null);
  assert.equal(f.tablist.getAttribute('role'), 'tablist');
  assert.equal(f.tablist.getAttribute('aria-label'), 'Settings categories');
  for (const [index, tab] of f.tabs.entries()) {
    const section = f.sections[index];
    assert.equal(tab.id, `settings-tab-${tab.dataset.tab}`);
    assert.equal(section.id, `settings-panel-${tab.dataset.tab}`);
    assert.equal(tab.getAttribute('role'), 'tab');
    assert.equal(section.getAttribute('role'), 'tabpanel');
    assert.equal(tab.getAttribute('aria-controls'), section.id);
    assert.equal(section.getAttribute('aria-labelledby'), tab.id);
  }
});

test('authored IDs and tablist labels survive initialization and panel order does not affect their links', t => {
  const f = fixture();
  f.tabs[1].id = 'authored-video-tab';
  f.sections[1].id = 'authored-video-panel';
  f.tablist.setAttribute('aria-labelledby', 'settings-category-title');
  f.sections.reverse();
  const { controller } = init(t, f);
  assert.equal(f.tablist.getAttribute('aria-label'), null);
  assert.equal(f.tablist.getAttribute('aria-labelledby'), 'settings-category-title');
  assert.equal(f.tabs[1].id, 'authored-video-tab');
  assert.equal(f.tabs[1].getAttribute('aria-controls'), 'authored-video-panel');
  const panel = f.sections.find(section => section.id === 'authored-video-panel');
  assert.equal(panel.getAttribute('aria-labelledby'), 'authored-video-tab');
  assert.equal(controller.select('video'), 'video');
  assertSelected(f, 'video');
  const ids = [...f.tabs, ...f.sections].map(element => element.id);
  controller.destroy();
  init(t, f);
  assert.deepEqual([...f.tabs, ...f.sections].map(element => element.id), ids);
});

test('Left and Right activate and focus adjacent tabs with wraparound in both directions', t => {
  const f = init(t);
  f.tabs[0].focus();
  for (const [key, expected] of [['ArrowRight', 1], ['ArrowLeft', 0], ['ArrowLeft', 3], ['ArrowRight', 0]]) {
    f.scroll.scrollTop = 280;
    const event = press(f.doc.activeElement, key);
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.doc.activeElement, f.tabs[expected]);
    assertSelected(f, f.tabs[expected].dataset.tab);
    assert.equal(f.scroll.scrollTop, 0);
  }
});

test('Home and End jump to the first and last tab without trapping Tab or repeating a scroll reset', t => {
  const f = init(t);
  f.controller.select('video');
  f.tabs[1].focus();
  assert.equal(press(f.tabs[1], 'End').defaultPrevented, true);
  assertSelected(f, 'access');
  assert.equal(f.doc.activeElement, f.tabs[3]);
  f.scroll.scrollTop = 320;
  press(f.tabs[3], 'End');
  assert.equal(f.scroll.scrollTop, 320, 'same category keeps its reading position');
  assert.equal(press(f.tabs[3], 'Home').defaultPrevented, true);
  assertSelected(f, 'controls');
  assert.equal(f.doc.activeElement, f.tabs[0]);
  assert.equal(f.scroll.scrollTop, 0);
  assert.equal(press(f.tabs[0], 'Tab').defaultPrevented, false);
});

test('click navigation updates the tab stop and only category changes reset content scroll', t => {
  const f = init(t);
  f.scroll.scrollTop = 440;
  f.tabs[0].dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(f.scroll.scrollTop, 440);
  f.tabs[2].dispatchEvent(new Event('click', { bubbles: true }));
  assertSelected(f, 'game');
  assert.equal(f.scroll.scrollTop, 0);
  f.scroll.scrollTop = 90;
  f.tabs[2].dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(f.scroll.scrollTop, 90);
});

test('.select returns the selected key, retains unknown-key fallback, and does not steal field focus', t => {
  const f = init(t);
  const field = new Element(f.doc, { tagName: 'INPUT' });
  field.parentNode = f.sections[0];
  field.focus();
  assert.equal(f.controller.select('video'), 'video');
  assertSelected(f, 'video');
  assert.equal(f.doc.activeElement, field);
  f.scroll.scrollTop = 130;
  assert.equal(f.controller.select('video'), 'video');
  assert.equal(f.scroll.scrollTop, 130);
  assert.equal(f.controller.select('unknown-category'), 'controls');
  assertSelected(f, 'controls');
  assert.equal(f.scroll.scrollTop, 0);
  assert.equal(f.doc.activeElement, field);
});

test('range, select and text-field navigation bubbles normally without changing category or values', t => {
  const f = init(t);
  let rootEvents = 0;
  f.root.addEventListener('keydown', () => rootEvents++);
  for (const [tagName, type] of [['INPUT', 'range'], ['SELECT', 'select-one'], ['INPUT', 'text'], ['TEXTAREA', 'textarea']]) {
    const field = new Element(f.doc, { tagName });
    Object.assign(field, { type, value: '75', defaultValue: '50', parentNode: f.sections[0] });
    field.focus();
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      f.scroll.scrollTop = 220;
      assert.equal(press(field, key).defaultPrevented, false);
      assertSelected(f, 'controls');
      assert.equal(f.scroll.scrollTop, 220);
      assert.equal(f.doc.activeElement, field);
      assert.equal(field.value, '75');
      assert.equal(field.defaultValue, '50');
    }
  }
  assert.equal(rootEvents, 16, 'panel events reach the root without being swallowed');
});

test('unhandled keys, modified shortcuts and composition retain their normal behavior', t => {
  const f = init(t);
  const tab = f.tabs[0];
  tab.focus();
  for (const key of ['Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'Tab']) {
    assert.equal(press(tab, key).defaultPrevented, false);
  }
  for (const flag of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing']) {
    assert.equal(press(tab, 'ArrowRight', { [flag]: true }).defaultPrevented, false);
  }
  assertSelected(f, 'controls');
  assert.equal(f.doc.activeElement, tab);
});

test('destroy removes both click and keyboard navigation listeners', t => {
  const f = init(t);
  f.tabs[0].focus();
  f.controller.destroy();
  f.scroll.scrollTop = 125;
  f.tabs[1].dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(press(f.tabs[0], 'ArrowRight').defaultPrevented, false);
  assertSelected(f, 'controls');
  assert.equal(f.doc.activeElement, f.tabs[0]);
  assert.equal(f.scroll.scrollTop, 125);
});

test('selection remains usable without a scroll container or any settings tabs', t => {
  const f = fixture();
  const querySelector = f.root.querySelector;
  f.root.querySelector = selector => selector === '.settings-scroll' ? null : querySelector(selector);
  const { controller } = init(t, f);
  assert.equal(controller.select('access'), 'access');
  assertSelected(f, 'access');
  const empty = init(t, fixture([]));
  assert.equal(empty.controller.select('video'), undefined);
  assert.equal(selectSettingsTab([], [], 'video'), undefined);
});
