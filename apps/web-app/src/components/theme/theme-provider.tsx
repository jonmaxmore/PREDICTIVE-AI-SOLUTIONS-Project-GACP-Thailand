'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ColorScheme = 'light' | 'dark';
const THEME_STORAGE_KEY = 'theme';
const THEME_EXPLICIT_STORAGE_KEY = 'theme:explicit';

interface ThemeContextValue {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleColorScheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** How long the cross-fade runs. Mirrors the duration in globals.css. */
const THEME_TRANSITION_MS = 260;
let themeTransitionTimer: ReturnType<typeof setTimeout> | null = null;

function applyColorScheme(scheme: ColorScheme, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    // Scoped, and only for the length of the change. A permanent transition on
    // `*` would animate every hover and focus in the product; putting it on the
    // root for 260ms animates exactly the swap the user asked for. Measured
    // before this: transition-duration 0s on html and body, background jumping
    // rgb(244,246,245) -> rgb(12,18,15) inside 60ms — a hard flash
    // (evidence/apple-qa-audit-2026-09-07).
    root.classList.add('theme-transition');
    if (themeTransitionTimer) clearTimeout(themeTransitionTimer);
    themeTransitionTimer = setTimeout(() => {
      root.classList.remove('theme-transition');
      themeTransitionTimer = null;
    }, THEME_TRANSITION_MS + 40);
  }
  root.classList.toggle('dark', scheme === 'dark');
  root.setAttribute('data-color-scheme', scheme);
}

function persistColorSchemePreference(scheme: ColorScheme) {
  localStorage.setItem(THEME_STORAGE_KEY, scheme);
  localStorage.setItem(THEME_EXPLICIT_STORAGE_KEY, '1');
}

interface AppThemeProviderProps {
  children: React.ReactNode;
  defaultColorScheme?: ColorScheme;
}

export function AppThemeProvider({ children, defaultColorScheme = 'light' }: AppThemeProviderProps) {
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(defaultColorScheme);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const hasExplicitPreference = localStorage.getItem(THEME_EXPLICIT_STORAGE_KEY) === '1';
    if (hasExplicitPreference && (stored === 'light' || stored === 'dark')) {
      setColorSchemeState(stored);
      return;
    }

    localStorage.setItem(THEME_STORAGE_KEY, defaultColorScheme);
    localStorage.removeItem(THEME_EXPLICIT_STORAGE_KEY);
    setColorSchemeState(defaultColorScheme);
  }, [defaultColorScheme]);

  // The FIRST application must not animate: ThemeScript already set the class
  // before paint, so animating here would fade a theme the user is already
  // looking at into itself, and on a real change of stored preference it would
  // read as a flash on load.
  const hasApplied = useRef(false);
  useEffect(() => {
    if (!hasApplied.current) {
      // The first commit must not touch <html> AT ALL. Effects run in declaration
      // order within one commit: the localStorage effect above SCHEDULES the stored
      // scheme, but React does not re-render mid-flush, so this effect still sees
      // `colorScheme` at defaultColorScheme ('light'). Applying it stripped the
      // .dark class ThemeScript had already put on the element before paint, and the
      // corrected value then arrived as the SECOND application — which animates. A
      // dark-mode user saw dark, a light flash, then a 260ms fade back to dark, on
      // every single page load.
      hasApplied.current = true;
      return;
    }
    applyColorScheme(colorScheme, true);
  }, [colorScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colorScheme,
      setColorScheme: (scheme) => {
        persistColorSchemePreference(scheme);
        setColorSchemeState(scheme);
      },
      toggleColorScheme: () => {
        setColorSchemeState((current) => {
          const next = current === 'dark' ? 'light' : 'dark';
          persistColorSchemePreference(next);
          return next;
        });
      },
    }),
    [colorScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      colorScheme: 'light' as ColorScheme,
      setColorScheme: () => undefined,
      toggleColorScheme: () => undefined,
    };
  }

  return context;
}
