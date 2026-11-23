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
    <section className="divide-y divide-slate-100 rounded-2xl border border-[#BFD7F2]/80 bg-white shadow-[0_10px_30px_-18px_rgba(0,60,113,0.16)] dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/45">
      {/* Appearance: Light / Dark */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Appearance
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Color theme"
          className="inline-flex shrink-0 items-center rounded-xl border border-slate-200/90 bg-slate-100/80 p-0.5 text-xs font-medium dark:border-slate-700/80 dark:bg-slate-800/80"
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
                className={`rounded-lg px-2.5 py-1 transition ${
                  active
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-950 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Home Layout: Classic / Stacked */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Home layout
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
            {homeView === "stacked" ? "Stacked" : "Classic"}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Home layout"
          className="inline-flex shrink-0 items-center rounded-xl border border-slate-200/90 bg-slate-100/80 p-0.5 text-xs font-medium dark:border-slate-700/80 dark:bg-slate-800/80"
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
                className={`rounded-lg px-2.5 py-1 transition ${
                  active
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-950 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
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
