"use client";

export type ThemeMode = "light" | "dark";
export type HomeViewMode = "classic" | "stacked";

export const THEME_STORAGE_KEY = "better-otu:theme:v1";
export const HOME_VIEW_STORAGE_KEY = "better-otu:home-view:v1";

export const THEME_CHANGE_EVENT = "better-otu:theme-change";
export const HOME_VIEW_CHANGE_EVENT = "better-otu:home-view-change";

export function getEffectiveTheme(): ThemeMode {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }
  return "light";
}

export function setThemePreference(mode: ThemeMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota errors
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }),
    );
  }
}

export function getStoredHomeView(): HomeViewMode {
  if (typeof window === "undefined") return "classic";
  try {
    const saved = window.localStorage.getItem(HOME_VIEW_STORAGE_KEY);
    if (saved === "stacked" || saved === "classic") return saved;
  } catch {
    // Ignore storage access errors
  }
  return "classic";
}

export function setHomeViewPreference(view: HomeViewMode): void {
  try {
    window.localStorage.setItem(HOME_VIEW_STORAGE_KEY, view);
  } catch {
    // Ignore storage quota errors
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<HomeViewMode>(HOME_VIEW_CHANGE_EVENT, { detail: view }),
    );
  }
}
