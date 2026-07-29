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
  return {
    select: id => selectSettingsTab(tabs, sections, id),
    destroy: () => listeners.forEach(([tab, listener]) => tab.removeEventListener('click', listener))
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
