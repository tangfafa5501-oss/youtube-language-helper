import type { ThemeSetting } from './settings.ts';

export function applyTheme(theme: ThemeSetting) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
}
