import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'troskovi.theme';
const COLORS = { light: '#f4f5f9', dark: '#0f1115' };
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  const effective = pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[effective]);
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(getThemePref);

  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const onChange = () => apply('system');
    darkQuery.addEventListener('change', onChange);
    return () => darkQuery.removeEventListener('change', onChange);
  }, [pref]);

  const set = (p: ThemePref) => {
    try {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      /* ignore */
    }
    setPref(p);
  };
  return [pref, set];
}
