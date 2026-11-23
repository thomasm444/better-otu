"use client";

import React, { useEffect, useState } from "react";

import {
  HOME_VIEW_CHANGE_EVENT,
  HOME_VIEW_STORAGE_KEY,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  getEffectiveTheme,
  getStoredHomeView,
  setHomeViewPreference,
  setThemePreference,
  type HomeViewMode,
  type ThemeMode,
} from "@/lib/preferences";

export function ProfilePreferencesCard() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [homeView, setHomeView] = useState<HomeViewMode>("classic");

  useEffect(() => {
    const sync = () => {
      setTheme(getEffectiveTheme());
      setHomeView(getStoredHomeView());
    };
    sync();

    const onThemeChange = (e: Event) => {
      const next = (e as CustomEvent<ThemeMode>).detail;
      if (next === "light" || next === "dark") setTheme(next);
    };
    const onHomeViewChange = (e: Event) => {
      const next = (e as CustomEvent<HomeViewMode>).detail;
      if (next === "classic" || next === "stacked") setHomeView(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        setTheme(getEffectiveTheme());
      } else if (e.key === HOME_VIEW_STORAGE_KEY) {
        setHomeView(getStoredHomeView());
      }
    };

    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener(HOME_VIEW_CHANGE_EVENT, onHomeViewChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener(HOME_VIEW_CHANGE_EVENT, onHomeViewChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <section className="divide-y divide-line-subtle rounded-xl border border-line bg-surface shadow-[var(--shadow-sm)]">
      {/* Appearance: Light / Dark */}
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">
            Appearance
          </p>
          <p className="mt-0.5 text-sm font-medium text-ink">
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Color theme"
          className="inline-flex shrink-0 items-center rounded-lg border border-line bg-surface-subtle p-0.5 text-xs font-medium"
        >
          {(
            [
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ] as const
          ).map((opt) => {
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setTheme(opt.id);
                  setThemePreference(opt.id);
                }}
                className={`rounded-md px-2.5 py-1 transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                  active
                    ? "bg-surface text-ink shadow-[var(--shadow-sm)]"
                    : "text-ink-secondary hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Home Layout: Classic / Stacked */}
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">
            Home layout
          </p>
          <p className="mt-0.5 text-sm font-medium text-ink">
            {homeView === "stacked" ? "Stacked" : "Classic"}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Home layout"
          className="inline-flex shrink-0 items-center rounded-lg border border-line bg-surface-subtle p-0.5 text-xs font-medium"
        >
          {(
            [
              { id: "classic", label: "Classic" },
              { id: "stacked", label: "Stacked" },
            ] as const
          ).map((opt) => {
            const active = homeView === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setHomeView(opt.id);
                  setHomeViewPreference(opt.id);
                }}
                className={`rounded-md px-2.5 py-1 transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                  active
                    ? "bg-surface text-ink shadow-[var(--shadow-sm)]"
                    : "text-ink-secondary hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
