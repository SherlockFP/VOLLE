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
