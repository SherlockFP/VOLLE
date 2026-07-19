export const UI_THEMES = Object.freeze(['dark', 'soft-spectrum']);

export function normalizeTheme(value) {
  return UI_THEMES.includes(value) ? value : 'dark';
}

export function normalizeUiScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) ? Math.min(1.2, Math.max(0.8, scale)) : 1;
}

export function loadUiPreferences(store) {
  const settings = store?.get?.('settings') || {};
  return {
    theme: normalizeTheme(store?.get?.('uiTheme')),
    scale: normalizeUiScale(store?.get?.('uiScale')),
    reduceMotion: settings.reduceMotion === true,
    highContrast: settings.highContrast === true
  };
}

export function applyUiPreferences(root, preferences) {
  if (!root) return;
  const theme = normalizeTheme(preferences?.theme);
  const scale = normalizeUiScale(preferences?.scale);
  root.dataset.theme = theme;
  root.style.setProperty('--ui-scale', String(scale));
  root.classList.toggle('reduce-motion', preferences?.reduceMotion === true);
  root.classList.toggle('high-contrast', preferences?.highContrast === true);
}
