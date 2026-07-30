export function selectSettingsTab(tabs, sections, requested) {
  const ids = tabs.map(tab => tab.dataset.tab);
  const selected = ids.includes(requested) ? requested : ids[0];
  tabs.forEach(tab => {
    const active = tab.dataset.tab === selected;
    tab.classList.toggle('selected', active);
    tab.setAttribute?.('aria-selected', String(active));
  });
  sections.forEach(section => {
    section.hidden = section.dataset.settingsSection !== selected;
  });
  return selected;
}

export function initSettingsTabs(root = document) {
  const tabs = [...root.querySelectorAll('.settings-tab')];
  const sections = [...root.querySelectorAll('[data-settings-section]')];
  const listeners = tabs.map(tab => {
    const listener = () => selectSettingsTab(tabs, sections, tab.dataset.tab);
    tab.addEventListener('click', listener);
    return [tab, listener];
  });
  selectSettingsTab(tabs, sections, tabs[0]?.dataset.tab);
  // main.js calls initSettingsTabs(document) exactly once and never gets a
  // second call site for reset-buttons/saved-indicator wiring, so both live
  // here rather than needing a main.js edit to add one.
  const resetButtons = initSettingsResetButtons(root);
  const savedIndicator = initSettingsSavedIndicator(root);
  return {
    select: id => selectSettingsTab(tabs, sections, id),
    destroy: () => {
      listeners.forEach(([tab, listener]) => tab.removeEventListener('click', listener));
      resetButtons?.destroy();
      savedIndicator?.destroy();
    }
  };
}

// A <select> cannot host color swatches, so #setting-theme stays the labelled
// control and these cards only mirror it: the picker remains the single writer
// of the persisted uiTheme value, and labels come from its own <option> text.
export function buildThemeSwatchCards(options, selected) {
  return (options || [])
    .filter(option => option && option.value)
    .map(option => {
      const label = option.label || option.value;
      return {
        theme: option.value,
        label,
        ariaLabel: `Interface theme: ${label}`,
        selected: option.value === selected
      };
    });
}

export function initThemeSwatches(root = document) {
  const select = root.querySelector?.('#setting-theme');
  const host = root.querySelector?.('#setting-theme-preview');
  if (!select || !host) return null;
  const doc = root.ownerDocument || root;
  const options = [...select.options].map(option => ({
    value: option.value,
    label: option.textContent.trim()
  }));
  function sync() {
    cards.forEach(card => card.setAttribute('aria-pressed', String(card.dataset.theme === select.value)));
  }
  host.replaceChildren();
  const cards = buildThemeSwatchCards(options, select.value).map(card => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'theme-swatch-card';
    button.dataset.theme = card.theme;
    button.setAttribute('aria-label', card.ariaLabel);
    button.setAttribute('aria-pressed', String(card.selected));
    button.innerHTML = '<span class="theme-swatch-strip" aria-hidden="true"><i data-swatch="bg"></i><i data-swatch="surface"></i><i data-swatch="accent"></i></span>';
    const name = doc.createElement('small');
    name.textContent = card.label;
    button.append(name);
    // Route the choice back through the picker so the existing settings
    // listener keeps ownership of persistence and theme application.
    button.addEventListener('click', () => {
      select.value = card.theme;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      sync();
    });
    host.append(button);
    return button;
  });
  select.addEventListener('input', sync);
  return {
    sync,
    destroy: () => {
      select.removeEventListener('input', sync);
      host.replaceChildren();
    }
  };
}

// --- Per-tab reset-to-defaults ----------------------------------------------
// "Reset to defaults" needs no second table of default values to keep in
// sync with index.html: every native control already remembers what it was
// parsed with (input.defaultValue/.defaultChecked, option.defaultSelected),
// so resetting is just writing that back and replaying the input/change
// events every other listener (bindSetting in main.js, the change listeners
// in initSettingsExtras below) already reacts to.
export const RESET_CONFIRM_WINDOW_MS = 3000;

// Two-tap confirm, pure: a bare click arms the button (label -> "Sure?") for
// RESET_CONFIRM_WINDOW_MS; a second click inside that window confirms. A
// reducer over one timestamp, so the decision is unit-testable without real
// timers or DOM.
export function nextResetConfirmState(armedAt, now) {
  const stillArmed = typeof armedAt === 'number' && (now - armedAt) <= RESET_CONFIRM_WINDOW_MS;
  return stillArmed ? { action: 'confirm', armedAt: null } : { action: 'arm', armedAt: now };
}

export function resetControlToDefault(el) {
  if (!el) return false;
  if (el.tagName === 'SELECT') {
    const options = [...(el.options || [])];
    const fallback = options.find(o => o.defaultSelected) || options[0];
    if (!fallback || el.value === fallback.value) return false;
    el.value = fallback.value;
    return true;
  }
  if (el.type === 'checkbox') {
    if (el.checked === el.defaultChecked) return false;
    el.checked = el.defaultChecked;
    return true;
  }
  if (typeof el.defaultValue === 'string') {
    if (el.value === el.defaultValue) return false;
    el.value = el.defaultValue;
    return true;
  }
  return false;
}

// Sweeps every native control in one tab's section back to its HTML default
// and replays input+change so every already-registered listener persists
// and applies it exactly as if the user had done it by hand.
export function resetSectionToDefaults(section) {
  if (!section?.querySelectorAll) return [];
  const changed = [];
  for (const el of section.querySelectorAll('input, select')) {
    if (!resetControlToDefault(el)) continue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    changed.push(el);
  }
  return changed;
}

export function initSettingsResetButtons(root = document) {
  const buttons = [...(root.querySelectorAll?.('.settings-reset-btn[data-reset-tab]') || [])];
  const cleanups = buttons.map(btn => {
    const label = btn.textContent;
    let armedAt = null;
    let revertTimer = null;
    const disarm = () => {
      armedAt = null;
      clearTimeout(revertTimer);
      revertTimer = null;
      btn.textContent = label;
      btn.classList?.remove('is-armed');
    };
    const onClick = () => {
      const result = nextResetConfirmState(armedAt, Date.now());
      if (result.action === 'confirm') {
        disarm();
        const section = root.querySelector?.(`[data-settings-section="${btn.dataset.resetTab}"]`);
        resetSectionToDefaults(section);
        return;
      }
      armedAt = result.armedAt;
      btn.textContent = 'Sure?';
      btn.classList?.add('is-armed');
      clearTimeout(revertTimer);
      revertTimer = setTimeout(disarm, RESET_CONFIRM_WINDOW_MS);
    };
    btn.addEventListener('click', onClick);
    return () => {
      btn.removeEventListener('click', onClick);
      clearTimeout(revertTimer);
    };
  });
  return { destroy: () => cleanups.forEach(fn => fn()) };
}

// --- Instant "saved" feedback ------------------------------------------------
// One shared badge (not one per row) pulses whenever any control inside
// .settings-scroll fires input/change. The pulse is a CSS animation
// (css/polish.css), so the existing global .reduce-motion rule in
// css/ui-tokens.css already neutralizes its motion for reduced-motion users
// with no branch needed here. Marked aria-hidden in the markup: it is a
// supplementary visual cue, not information — a live region would spam
// screen readers on every tick of a dragged range slider.
const SAVED_PULSE_HOLD_MS = 1200;

export function pulseSavedIndicator(el) {
  if (!el) return;
  el.classList?.remove('settings-saved-pulse');
  void el.offsetWidth; // restart the CSS animation on repeat triggers
  el.classList?.add('settings-saved-pulse');
}

export function initSettingsSavedIndicator(root = document) {
  const scroll = root.querySelector?.('.settings-scroll');
  const indicator = root.querySelector?.('#settings-saved-indicator');
  if (!scroll || !indicator) return null;
  let hideTimer = null;
  const onChange = event => {
    const target = event.target;
    if (!target || !/^(INPUT|SELECT)$/.test(target.tagName || '')) return;
    if (!target.closest?.('.settings-row')) return;
    // Skip the reflow-forcing restart while a pulse is already in flight
    // (e.g. dragging a range fires many input events per second) — just
    // keep extending the hold so it stays visible through the whole drag.
    if (!indicator.classList?.contains('settings-saved-pulse')) {
      pulseSavedIndicator(indicator);
    }
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => indicator.classList?.remove('settings-saved-pulse'), SAVED_PULSE_HOLD_MS);
  };
  scroll.addEventListener('input', onChange);
  scroll.addEventListener('change', onChange);
  return {
    destroy: () => {
      scroll.removeEventListener('input', onChange);
      scroll.removeEventListener('change', onChange);
      if (hideTimer) clearTimeout(hideTimer);
    }
  };
}

// ---------------------------------------------------------------------------
// Performance, audio and input settings. Quality preset, resolution scale,
// FOV and mouse sensitivity already apply live through js/renderer.js and
// js/main.js's own bindSetting calls — the clamps below are independently
// testable copies of those already-shipped bounds, not a second source of
// truth (renderer.js#QUALITY_PRESETS stays canonical for quality; these are
// for validating persisted/typed values before they reach the API calls).
// ---------------------------------------------------------------------------

const FPS_CAP_OPTIONS = [0, 30, 60, 120, 144, 240];
const RESOLUTION_SCALE_MIN = 50;
const RESOLUTION_SCALE_MAX = 150; // matches js/renderer.js#setRenderScale's own 0.5-1.5 clamp

export function clampResolutionScalePercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 100;
  return Math.min(RESOLUTION_SCALE_MAX, Math.max(RESOLUTION_SCALE_MIN, value));
}

export function resolutionScalePercentToFactor(percent) {
  return clampResolutionScalePercent(percent) / 100;
}

// Matches the shipped #setting-fov range (index.html: min="60" max="110").
export function clampFov(value, min = 60, max = 110) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 75;
  return Math.min(max, Math.max(min, num));
}

// Matches the shipped #setting-sensitivity range (index.html: min="1" max="10").
export function clampSensitivity(value, min = 1, max = 10) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 2;
  return Math.min(max, Math.max(min, num));
}

export function clampVolumePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 100;
  return Math.min(100, Math.max(0, num));
}

export function normalizeFpsCap(value) {
  const num = Number(value);
  return FPS_CAP_OPTIONS.includes(num) ? num : 0;
}

// Effective 0-1 gain a channel (music or sound, each already 0-100) should
// play at once the master volume fader and mute toggle are layered on top.
export function computeEffectiveVolume(channelPercent, masterPercent, muted) {
  if (muted) return 0;
  return (clampVolumePercent(channelPercent) / 100) * (clampVolumePercent(masterPercent) / 100);
}

// FPS-cap throttle — pure decision, owns no timers/state. cap <= 0 (Uncapped)
// or a non-finite lastFrameTime (no prior frame yet) always renders. Callers
// only update their stored lastFrameTime when this returns true, so a run of
// skipped frames doesn't compound rounding error.
export function shouldRenderFrame(capFps, lastFrameTime, now) {
  const cap = Number(capFps);
  if (!Number.isFinite(cap) || cap <= 0) return true;
  const last = Number(lastFrameTime);
  if (!Number.isFinite(last) || last <= 0) return true;
  const minInterval = 1000 / cap;
  return (Number(now) - last) >= minInterval;
}

// --- Store-backed persistence for the settings this module adds ------------
// Same shape as the crosshairSettings helpers above: values live inline in
// the existing `settings` object (js/store.js#DEFAULTS already spreads
// unknown keys through on read/write), so no js/store.js edit is needed.
const EXTRA_SETTINGS_DEFAULTS = {
  masterVolume: 100,
  muted: false,
  invertY: false,
  killfeedVisible: true
};

export function readExtraSettings(store) {
  const s = store?.get?.('settings') || {};
  return {
    masterVolume: clampVolumePercent(s.masterVolume ?? EXTRA_SETTINGS_DEFAULTS.masterVolume),
    muted: Boolean(s.muted ?? EXTRA_SETTINGS_DEFAULTS.muted),
    invertY: Boolean(s.invertY ?? EXTRA_SETTINGS_DEFAULTS.invertY),
    killfeedVisible: s.killfeedVisible !== false
  };
}

export function writeExtraSetting(store, key, value) {
  const settings = { ...(store.get('settings') || {}), [key]: value };
  store.set('settings', settings);
  return settings;
}

export function applyKillfeedVisibility(el, visible) {
  el?.classList?.toggle('hidden', !visible);
}

// --- DOM wiring --------------------------------------------------------------
// Single entry point main.js calls once (after this.store/this.audio/
// this.game/this.player exist, and after its own setting-music-volume /
// setting-sound-volume bindSetting calls are registered so this module's
// secondary 'input' listeners recompute using their already-updated values)
// to hydrate and bind every control this module adds. Every live-apply call
// is optional-chained so this degrades to "persists but doesn't yet drive
// gameplay" until the paired IRC handoff (player.js#setInvertY) lands.
export function initSettingsExtras({ store, audio, game, player, root } = {}) {
  if (!store?.get || !store?.set) return null;
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc?.querySelector) return null;
  const state = readExtraSettings(store);

  const applyAudio = () => {
    const settings = store.get('settings') || {};
    const extra = readExtraSettings(store);
    const music = settings.musicVolume ?? settings.volume ?? 2;
    const sound = settings.soundVolume ?? settings.volume ?? 50;
    audio?.setSoundVolume?.(computeEffectiveVolume(sound, extra.masterVolume, extra.muted));
    game?.setMusicVolume?.(computeEffectiveVolume(music, extra.masterVolume, extra.muted));
  };

  const masterVolume = doc.querySelector('#setting-master-volume');
  const masterVolumeOut = doc.querySelector('#setting-master-volume-value');
  if (masterVolume) {
    masterVolume.value = state.masterVolume;
    if (masterVolumeOut) masterVolumeOut.textContent = `${state.masterVolume}%`;
    masterVolume.addEventListener('input', e => {
      const value = clampVolumePercent(e.target.value);
      writeExtraSetting(store, 'masterVolume', value);
      if (masterVolumeOut) masterVolumeOut.textContent = `${value}%`;
      applyAudio();
    });
  }

  const mute = doc.querySelector('#setting-mute');
  if (mute) {
    mute.checked = state.muted;
    mute.addEventListener('change', e => {
      writeExtraSetting(store, 'muted', Boolean(e.target.checked));
      applyAudio();
    });
  }

  // Re-apply master/mute on top of the existing music/sound sliders too, so
  // moving them after Master Volume doesn't silently undo it. This is a
  // second, additive 'input' listener on elements main.js already owns and
  // binds itself — DOM elements accept multiple listeners without conflict.
  doc.querySelector('#setting-music-volume')?.addEventListener('input', applyAudio);
  doc.querySelector('#setting-sound-volume')?.addEventListener('input', applyAudio);
  applyAudio();

  const invertY = doc.querySelector('#setting-invert-y');
  if (invertY) {
    invertY.checked = state.invertY;
    invertY.addEventListener('change', e => {
      const value = Boolean(e.target.checked);
      writeExtraSetting(store, 'invertY', value);
      player?.setInvertY?.(value);
    });
    player?.setInvertY?.(state.invertY);
  }

  const killfeedToggle = doc.querySelector('#setting-killfeed');
  const killfeedEl = doc.querySelector('#kill-feed');
  if (killfeedToggle) {
    killfeedToggle.checked = state.killfeedVisible;
    killfeedToggle.addEventListener('change', e => {
      const value = Boolean(e.target.checked);
      writeExtraSetting(store, 'killfeedVisible', value);
      applyKillfeedVisibility(killfeedEl, value);
    });
  }
  applyKillfeedVisibility(killfeedEl, state.killfeedVisible);

  return { applyAudio };
}
