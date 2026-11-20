"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";

import { AuthButton } from "@/components/auth-button";
import {
  DAY_SHORT,
  formatShortIsoDate,
  getDayOfWeekMon1,
  getTorontoNowParts,
} from "@/lib/campus-map-dates";
import { createClient } from "@/lib/supabase/client";

interface PortalDashboardProps {
  termLabel: string;
}

type ShortcutColorKey = "emerald" | "orange" | "blue" | "violet" | "rose";

interface ShortcutItem {
  id: string;
  name: string;
  href: string;
  color: ShortcutColorKey;
  icon: "library" | "canvas" | "portal" | "custom";
  imageUrl?: string;
  isCustom?: boolean;
}

const CUSTOM_SHORTCUTS_STORAGE_KEY = "better-otu:custom-shortcuts:v1";

const ORB_THEMES: Record<
  ShortcutColorKey,
  {
    label: string;
    orbGradient: string;
    haloGradient: string;
    orbShadow: string;
    stemColor: string;
    swatchClass: string;
  }
> = {
  emerald: {
    label: "Emerald",
    orbGradient:
      "radial-gradient(circle at 50% 46%, rgba(5, 150, 105, 0.96) 0%, rgba(16, 185, 129, 0.78) 52%, rgba(52, 211, 153, 0.24) 82%, rgba(52, 211, 153, 0.04) 100%)",
    haloGradient:
      "radial-gradient(circle, rgba(16, 185, 129, 0.52) 0%, rgba(52, 211, 153, 0.16) 55%, transparent 78%)",
    orbShadow: "0 0 26px rgba(16, 185, 129, 0.36)",
    stemColor: "stroke-emerald-400/55 dark:stroke-emerald-400/45",
    swatchClass: "bg-emerald-500",
  },
  orange: {
    label: "Tangerine",
    orbGradient:
      "radial-gradient(circle at 50% 46%, rgba(200, 74, 27, 0.96) 0%, rgba(231, 93, 42, 0.78) 52%, rgba(251, 146, 60, 0.24) 82%, rgba(251, 146, 60, 0.04) 100%)",
    haloGradient:
      "radial-gradient(circle, rgba(231, 93, 42, 0.5) 0%, rgba(251, 146, 60, 0.16) 55%, transparent 78%)",
    orbShadow: "0 0 26px rgba(231, 93, 42, 0.38)",
    stemColor: "stroke-[#E75D2A]/55 dark:stroke-[#FF8A5C]/45",
    swatchClass: "bg-[#E75D2A]",
  },
  blue: {
    label: "OTU Blue",
    orbGradient:
      "radial-gradient(circle at 50% 46%, rgba(0, 60, 113, 0.98) 0%, rgba(14, 116, 194, 0.78) 52%, rgba(56, 189, 248, 0.25) 82%, rgba(56, 189, 248, 0.04) 100%)",
    haloGradient:
      "radial-gradient(circle, rgba(14, 116, 194, 0.5) 0%, rgba(56, 189, 248, 0.18) 55%, transparent 78%)",
    orbShadow: "0 0 26px rgba(14, 116, 194, 0.38)",
    stemColor: "stroke-[#003C71]/50 dark:stroke-sky-400/45",
    swatchClass: "bg-[#005096]",
  },
  violet: {
    label: "Cosmic Violet",
    orbGradient:
      "radial-gradient(circle at 50% 46%, rgba(109, 40, 217, 0.96) 0%, rgba(139, 92, 246, 0.76) 52%, rgba(196, 181, 253, 0.24) 82%, rgba(196, 181, 253, 0.04) 100%)",
    haloGradient:
      "radial-gradient(circle, rgba(139, 92, 246, 0.5) 0%, rgba(196, 181, 253, 0.18) 55%, transparent 78%)",
    orbShadow: "0 0 26px rgba(139, 92, 246, 0.38)",
    stemColor: "stroke-violet-400/55 dark:stroke-violet-400/45",
    swatchClass: "bg-violet-600",
  },
  rose: {
    label: "Rose",
    orbGradient:
      "radial-gradient(circle at 50% 46%, rgba(190, 24, 93, 0.96) 0%, rgba(244, 63, 94, 0.76) 52%, rgba(253, 164, 175, 0.24) 82%, rgba(253, 164, 175, 0.04) 100%)",
    haloGradient:
      "radial-gradient(circle, rgba(244, 63, 94, 0.48) 0%, rgba(253, 164, 175, 0.18) 55%, transparent 78%)",
    orbShadow: "0 0 26px rgba(244, 63, 94, 0.36)",
    stemColor: "stroke-rose-400/55 dark:stroke-rose-400/45",
    swatchClass: "bg-rose-500",
  },
};

const BUILTIN_SHORTCUTS: ShortcutItem[] = [
  {
    id: "builtin-library",
    name: "Library Study Rooms",
    href: "https://apps.library.dc-ot.ca/OTrooms/calendar.aspx",
    color: "emerald",
    icon: "library",
    imageUrl:
      "https://shared.ontariotechu.ca/shared/ontario-tech/images/buildings/north-oshawa/library/photo-gallery/150822-18-1200x800.jpg",
  },
  {
    id: "builtin-canvas",
    name: "Canvas",
    href: "https://learn.ontariotechu.ca/",
    color: "orange",
    icon: "canvas",
    imageUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSjTe2Ezo-kf87I47CDzz6sZX90zscDwO_xy-xJQb5Yr2GImwUtWmndGqZS&s=10",
  },
  {
    id: "builtin-portal",
    name: "MyOntarioTech",
    href: "https://my.ontariotechu.ca/",
    color: "blue",
    icon: "portal",
    imageUrl:
      "https://pbs.twimg.com/profile_images/1111288285236731905/y6veEFsr_400x400.png",
  },
];

function getFlowerPetalOffset(index: number, total: number) {
  if (total === 4) {
    const corners = [
      { xSign: -1, ySign: -1 },
      { xSign: 1, ySign: -1 },
      { xSign: 1, ySign: 1 },
      { xSign: -1, ySign: 1 },
    ];
    const corner = corners[index] ?? corners[0];
    return {
      xCss: `calc(${corner.xSign} * min(23vw, 114px))`,
      yPx: corner.ySign * 74,
      lineX: corner.xSign * 108,
      lineY: corner.ySign * 74,
    };
  }

  const angle = -Math.PI * 0.75 + (index / Math.max(total, 1)) * Math.PI * 2;
  const cos = Number(Math.cos(angle).toFixed(3));
  const sin = Number(Math.sin(angle).toFixed(3));
  return {
    xCss: `calc(${cos} * min(26vw, 134px))`,
    yPx: Math.round(sin * 86),
    lineX: Math.round(cos * 124),
    lineY: Math.round(sin * 86),
  };
}

function normalizeShortcutUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractFirstName(user: User | null): string | null {
  if (!user) return null;
  const rawName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined);
  if (rawName?.trim()) {
    return rawName.trim().split(/\s+/)[0] ?? null;
  }
  if (user.email) {
    const local = user.email.split("@")[0]?.split(/[._-]/)[0];
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return null;
}

function formatTorontoClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function ArrowRightIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function PortalDashboard({ termLabel }: PortalDashboardProps) {
  const [firstName, setFirstName] = useState<string | null>(null);
  const [liveTimeLabel, setLiveTimeLabel] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [customShortcuts, setCustomShortcuts] = useState<ShortcutItem[]>([]);
  const [addShortcutOpen, setAddShortcutOpen] = useState(false);
  const [shortcutNameDraft, setShortcutNameDraft] = useState("");
  const [shortcutUrlDraft, setShortcutUrlDraft] = useState("");
  const [shortcutColorDraft, setShortcutColorDraft] =
    useState<ShortcutColorKey>("blue");
  const [shortcutFormError, setShortcutFormError] = useState<string | null>(
    null,
  );
  const shortcutsRef = useRef<HTMLDivElement>(null);

  // Hydrate user-added shortcuts from localStorage after mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_SHORTCUTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(
        (item): item is ShortcutItem =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as ShortcutItem).id === "string" &&
          typeof (item as ShortcutItem).name === "string" &&
          typeof (item as ShortcutItem).href === "string" &&
          (item as ShortcutItem).color in ORB_THEMES,
      );
      setCustomShortcuts(
        valid.map((item) => ({ ...item, icon: "custom", isCustom: true })),
      );
    } catch {
      // Ignore malformed localStorage data
    }
  }, []);

  const persistCustomShortcuts = (next: ShortcutItem[]) => {
    setCustomShortcuts(next);
    try {
      window.localStorage.setItem(
        CUSTOM_SHORTCUTS_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      // Ignore storage quota errors
    }
  };

  const handleAddShortcutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = shortcutNameDraft.trim();
    const cleanUrl = normalizeShortcutUrl(shortcutUrlDraft);
    if (!cleanName) {
      setShortcutFormError("Please enter a shortcut name.");
      return;
    }
    if (!cleanUrl) {
      setShortcutFormError("Please enter a valid http:// or https:// link.");
      return;
    }

    const nextItem: ShortcutItem = {
      id: `custom-${Date.now()}`,
      name: cleanName,
      href: cleanUrl,
      color: shortcutColorDraft,
      icon: "custom",
      isCustom: true,
    };

    persistCustomShortcuts([...customShortcuts, nextItem]);
    setAddShortcutOpen(false);
    setShortcutNameDraft("");
    setShortcutUrlDraft("");
    setShortcutFormError(null);
    setShortcutsOpen(true);
  };

  const handleRemoveCustomShortcut = (id: string) => {
    persistCustomShortcuts(customShortcuts.filter((item) => item.id !== id));
  };

  // Close the flower shortcuts when clicking outside or pressing Escape
  useEffect(() => {
    if (!shortcutsOpen && !addShortcutOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (addShortcutOpen) return;
      if (
        shortcutsRef.current &&
        !shortcutsRef.current.contains(event.target as Node)
      ) {
        setShortcutsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (addShortcutOpen) {
          setAddShortcutOpen(false);
        } else {
          setShortcutsOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shortcutsOpen, addShortcutOpen]);

  // Pull personalized name from logged-in Supabase user (falls back to "Better OTU" if logged out)
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setFirstName(extractFirstName(data.user ?? null));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setFirstName(extractFirstName(session?.user ?? null));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Client-side Toronto clock for Campus Pulse strip (Next 16 prerender-safe)
  useEffect(() => {
    const updateClock = () => {
      const { date, minutes } = getTorontoNowParts(new Date());
      const dayIdx = getDayOfWeekMon1(date);
      setLiveTimeLabel(
        `${DAY_SHORT[dayIdx]}, ${formatShortIsoDate(date)} • ${formatTorontoClock(minutes)}`,
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-8 sm:px-8 sm:py-12">
      {/* Top Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#003C71]/15 bg-white/85 px-3 py-1 text-xs font-semibold text-[#003C71] shadow-2xs backdrop-blur-sm dark:border-sky-400/20 dark:bg-slate-900/80 dark:text-sky-200">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#003C71] dark:bg-sky-400" />
              <span className="h-2 w-2 rounded-full bg-[#E75D2A]" />
            </span>
            <span>Better OTU</span>
            <span className="text-slate-300 dark:text-slate-600">&bull;</span>
            <span className="font-medium text-slate-600 dark:text-slate-300">
              Ontario Tech University
            </span>
          </div>

          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              {firstName ? (
                <>
                  Welcome back,{" "}
                  <span className="bg-gradient-to-r from-[#003C71] via-[#0A5AA3] to-[#E75D2A] bg-clip-text text-transparent dark:from-sky-300 dark:via-blue-300 dark:to-[#FF8B5E]">
                    {firstName}
                  </span>
                </>
              ) : (
                "Better OTU"
              )}
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-slate-600 sm:text-[15px] dark:text-slate-300">
              Your all-in-one Ontario Tech hub for live room vacancy, course timetables, and degree planning.
            </p>
          </div>
        </div>

        <div className="shrink-0 sm:pt-1">
          <AuthButton />
        </div>
      </header>

      {/* Main Feature Cards — Interactive Live Widgets */}
      <nav
        aria-label="Primary student tools"
        className="mt-9 grid grid-cols-1 gap-5 md:grid-cols-3"
      >
        {/* 1. Course Schedules Widget Card */}
        <Link
          href="/course-schedules"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#003C71]/40 hover:shadow-[0_18px_38px_-14px_rgba(0,60,113,0.22)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-sky-400/45 dark:hover:shadow-[0_18px_38px_-14px_rgba(56,189,248,0.2)]"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#003C71]/10 text-[#003C71] ring-1 ring-[#003C71]/15 transition-transform duration-200 group-hover:scale-105 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20">
                <svg
                  className="h-6 w-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.85"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="18" height="18" x="3" y="4" rx="2" />
                  <path d="M16 2v4" />
                  <path d="M8 2v4" />
                  <path d="M3 10h18" />
                  <path d="M8 14h.01" />
                  <path d="M12 14h.01" />
                  <path d="M16 14h.01" />
                  <path d="M8 18h.01" />
                  <path d="M12 18h.01" />
                </svg>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#003C71]/15 bg-[#003C71]/8 px-2.5 py-1 text-[11px] font-semibold text-[#003C71] dark:border-sky-400/25 dark:bg-sky-500/15 dark:text-sky-200">
                <span className="h-1.5 w-1.5 rounded-full bg-[#003C71] dark:bg-sky-300" />
                {termLabel} Active
              </span>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-[#003C71] dark:text-white dark:group-hover:text-sky-300">
                  Course Schedules
                </h2>
                <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-[#003C71] dark:group-hover:text-sky-300" />
              </div>
            </div>
          </div>

          {/* Subtle Timetable Micro-Preview */}
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <span>Bi-weekly Grid</span>
              <span className="text-[#003C71] dark:text-sky-300">W1 &bull; W2 Sync</span>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              <div className="space-y-1">
                <div className="h-2.5 rounded-sm bg-[#003C71]/80 dark:bg-sky-400/80" />
                <div className="h-1.5 rounded-sm bg-slate-200 dark:bg-slate-800" />
              </div>
              <div className="space-y-1">
                <div className="h-1.5 rounded-sm bg-slate-200 dark:bg-slate-800" />
                <div className="h-2.5 rounded-sm bg-emerald-500/80" />
              </div>
              <div className="space-y-1">
                <div className="h-2.5 rounded-sm bg-[#003C71]/80 dark:bg-sky-400/80" />
                <div className="h-2 rounded-sm bg-[#E75D2A]/80" />
              </div>
              <div className="space-y-1">
                <div className="h-2 rounded-sm bg-indigo-500/75" />
                <div className="h-1.5 rounded-sm bg-slate-200 dark:bg-slate-800" />
              </div>
              <div className="space-y-1">
                <div className="h-2.5 rounded-sm bg-emerald-500/75" />
                <div className="h-1.5 rounded-sm bg-slate-200 dark:bg-slate-800" />
              </div>
            </div>
          </div>
        </Link>

        {/* 2. Campus Map Widget Card */}
        <Link
          href="/campus-map"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-emerald-500/45 hover:shadow-[0_18px_38px_-14px_rgba(16,185,129,0.22)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-emerald-400/45"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/20 transition-transform duration-200 group-hover:scale-105 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20">
                <svg
                  className="h-6 w-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.85"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/60 dark:text-emerald-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live Room Availability
              </span>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-300">
                  Campus Map
                </h2>
                <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-300" />
              </div>
            </div>
          </div>

          {/* Campus Tags Micro-Preview */}
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <span>Interactive Floorplans</span>
              <span className="text-emerald-700 dark:text-emerald-300">B &ndash; Fl 4</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {["North", "Downtown", "Whitby"].map((campus) => (
                <span
                  key={campus}
                  className="rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {campus}
                </span>
              ))}
            </div>
          </div>
        </Link>

        {/* 3. Degree Planner Widget Card */}
        <Link
          href="/degree-planner"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#E75D2A]/45 hover:shadow-[0_18px_38px_-14px_rgba(231,93,42,0.22)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-[#FF8B5E]/45"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E75D2A]/12 text-[#C84A1B] ring-1 ring-[#E75D2A]/20 transition-transform duration-200 group-hover:scale-105 dark:bg-[#E75D2A]/20 dark:text-[#FF8A5C] dark:ring-[#E75D2A]/30">
                <svg
                  className="h-6 w-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.85"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
                  <path d="M22 10v6" />
                  <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
                </svg>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E75D2A]/25 bg-[#E75D2A]/10 px-2.5 py-1 text-[11px] font-semibold text-[#B84316] dark:border-[#E75D2A]/30 dark:bg-[#E75D2A]/20 dark:text-[#FFA27D]">
                Prerequisite Pathways
              </span>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-[#C84A1B] dark:text-white dark:group-hover:text-[#FF8A5C]">
                  Degree Planner
                </h2>
                <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-[#E75D2A] dark:group-hover:text-[#FF8A5C]" />
              </div>
            </div>
          </div>

          {/* Mini Prerequisite Node / Progress Graphic */}
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <span>Term Progression</span>
              <span className="text-[#C84A1B] dark:text-[#FF8A5C]">120 Credits</span>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-1">
              {[
                { label: "Y1", done: true },
                { label: "Y2", done: true },
                { label: "Y3", done: false, current: true },
                { label: "Y4", done: false },
              ].map((step, index) => (
                <React.Fragment key={step.label}>
                  <div className="flex items-center gap-1">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                        step.done
                          ? "bg-[#003C71] text-white dark:bg-sky-500"
                          : step.current
                            ? "border-2 border-[#E75D2A] bg-[#E75D2A]/15 text-[#C84A1B] dark:text-[#FF8A5C]"
                            : "border border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < 3 && (
                    <div
                      className={`h-0.5 flex-1 rounded-full ${
                        index < 1
                          ? "bg-[#003C71] dark:bg-sky-500"
                          : index === 1
                            ? "bg-gradient-to-r from-[#003C71] to-[#E75D2A]"
                            : "bg-slate-200 dark:bg-slate-800"
                      }`}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </Link>
      </nav>

      {/* Lower Strip: Campus Pulse & Quick Actions */}
      <section
        aria-label="Campus pulse and quick actions"
        className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-12"
      >
        {/* Quick Action CTA Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#003C71] via-[#00305C] to-[#002244] p-6 text-white shadow-[0_18px_40px_-16px_rgba(0,60,113,0.45)] lg:col-span-7">
          {/* Warm Tech Tangerine ambient highlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#E75D2A]/30 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 left-10 h-40 w-40 rounded-full bg-sky-400/15 blur-3xl"
          />

          <div className="relative flex h-full flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <div className="max-w-md space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-100 backdrop-blur-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>Campus Pulse</span>
                {liveTimeLabel && (
                  <>
                    <span className="text-white/40">&bull;</span>
                    <span className="tabular-nums text-white">{liveTimeLabel}</span>
                  </>
                )}
              </div>

              <h2 className="text-xl font-bold tracking-tight text-white">
                Need a quiet study spot right now?
              </h2>
            </div>

            <div className="shrink-0">
              <Link
                href="/campus-map?filter=available&now=1"
                className="group inline-flex items-center gap-2 rounded-xl bg-[#E75D2A] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#F06835] hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span>Find an Empty Study Spot Now</span>
                <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </div>

        {/* Essential OTU Shortcuts — Starry Flower Bloom Hub */}
        <div
          ref={shortcutsRef}
          className="relative flex min-h-[290px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-xs backdrop-blur-sm lg:col-span-5 dark:border-slate-800 dark:bg-slate-900/90"
        >
          {(() => {
            const allLinkShortcuts = [...BUILTIN_SHORTCUTS, ...customShortcuts];
            const totalPetals = allLinkShortcuts.length + 1;

            return (
              <div className="relative h-[250px] w-full">
                {/* Decorative soft starry aura rings behind the center hub */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-slate-200/90 transition-all duration-500 dark:border-slate-800 ${
                    shortcutsOpen
                      ? "scale-125 rotate-45 opacity-100"
                      : "scale-75 rotate-0 opacity-60"
                  }`}
                />
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-[#003C71]/15 via-violet-500/12 to-[#E75D2A]/15 blur-xl transition-all duration-500 ${
                    shortcutsOpen
                      ? "scale-150 opacity-100"
                      : "scale-95 opacity-75"
                  }`}
                />

                {/* Animated flower stems connecting center hub to petals */}
                <svg
                  aria-hidden="true"
                  viewBox="-160 -120 320 240"
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[240px] w-[320px] -translate-x-1/2 -translate-y-1/2"
                >
                  {allLinkShortcuts.map((item, index) => {
                    const pos = getFlowerPetalOffset(index, totalPetals);
                    const theme = ORB_THEMES[item.color];
                    return (
                      <line
                        key={item.id}
                        x1="0"
                        y1="0"
                        x2={shortcutsOpen ? pos.lineX : 0}
                        y2={shortcutsOpen ? pos.lineY : 0}
                        strokeWidth="1.5"
                        strokeDasharray="3 5"
                        className={`${theme.stemColor} transition-all duration-300`}
                        style={{
                          opacity: shortcutsOpen ? 0.9 : 0,
                          transitionDelay: shortcutsOpen
                            ? `${index * 45}ms`
                            : "0ms",
                        }}
                      />
                    );
                  })}
                  {(() => {
                    const addPos = getFlowerPetalOffset(
                      allLinkShortcuts.length,
                      totalPetals,
                    );
                    return (
                      <line
                        x1="0"
                        y1="0"
                        x2={shortcutsOpen ? addPos.lineX : 0}
                        y2={shortcutsOpen ? addPos.lineY : 0}
                        strokeWidth="1.5"
                        strokeDasharray="3 5"
                        className={`${ORB_THEMES.violet.stemColor} transition-all duration-300`}
                        style={{
                          opacity: shortcutsOpen ? 0.9 : 0,
                          transitionDelay: shortcutsOpen
                            ? `${allLinkShortcuts.length * 45}ms`
                            : "0ms",
                        }}
                      />
                    );
                  })()}
                </svg>

                {/* Link Petals — Glowing Starry Circles */}
                {allLinkShortcuts.map((item, index) => {
                  const pos = getFlowerPetalOffset(index, totalPetals);
                  const theme = ORB_THEMES[item.color];
                  return (
                    <div
                      key={item.id}
                      className={`group absolute left-1/2 top-1/2 z-10 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                        shortcutsOpen
                          ? "pointer-events-auto opacity-100"
                          : "pointer-events-none opacity-0"
                      }`}
                      style={{
                        transform: shortcutsOpen
                          ? `translate(calc(-50% + ${pos.xCss}), calc(-50% + ${pos.yPx}px)) scale(1)`
                          : "translate(-50%, -50%) scale(0.3)",
                        transitionDelay: shortcutsOpen
                          ? `${index * 55}ms`
                          : `${(totalPetals - 1 - index) * 30}ms`,
                      }}
                    >
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        tabIndex={shortcutsOpen ? 0 : -1}
                        aria-hidden={!shortcutsOpen}
                        className="relative flex h-[90px] w-[90px] flex-col items-center justify-center rounded-full px-2 text-center text-white transition-transform duration-200 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71]"
                        style={{
                          background: theme.orbGradient,
                          boxShadow: theme.orbShadow,
                        }}
                      >
                        {/* Outer soft blurred starry halo */}
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute -inset-2.5 -z-10 rounded-full blur-md transition-opacity duration-200 group-hover:opacity-100"
                          style={{ background: theme.haloGradient }}
                        />
                        {/* Subtle twinkling star specks near the softer rim */}
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3.5 top-3 h-1 w-1 animate-pulse rounded-full bg-white/80"
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-3.5 right-3 h-0.5 w-0.5 animate-pulse rounded-full bg-white/75"
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-4 top-3.5 h-0.5 w-0.5 rounded-full bg-white/65"
                        />

                        {item.imageUrl ? (
                          <span className="mb-1 flex aspect-square h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/15 shadow-xs ring-1 ring-white/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.imageUrl}
                              alt=""
                              aria-hidden="true"
                              className="h-full w-full object-cover object-center"
                            />
                          </span>
                        ) : (
                          <span className="mb-1 flex h-5 w-5 items-center justify-center text-white drop-shadow-xs">
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                          </span>
                        )}

                        <span className="line-clamp-2 text-[10.5px] leading-tight font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]">
                          {item.name}
                        </span>
                      </a>

                      {item.isCustom && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemoveCustomShortcut(item.id);
                          }}
                          title={`Remove ${item.name}`}
                          aria-label={`Remove ${item.name}`}
                          className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/80 text-[11px] font-bold text-white opacity-0 shadow-sm backdrop-blur-xs transition-opacity hover:bg-red-600 group-hover:opacity-100"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* "Add your own shortcut" Glowing Starry Circle */}
                {(() => {
                  const addPos = getFlowerPetalOffset(
                    allLinkShortcuts.length,
                    totalPetals,
                  );
                  const addTheme = ORB_THEMES.violet;
                  return (
                    <button
                      type="button"
                      tabIndex={shortcutsOpen ? 0 : -1}
                      aria-hidden={!shortcutsOpen}
                      onClick={() => {
                        setShortcutNameDraft("");
                        setShortcutUrlDraft("");
                        setShortcutFormError(null);
                        setAddShortcutOpen(true);
                      }}
                      className={`group absolute left-1/2 top-1/2 z-10 flex h-[90px] w-[90px] flex-col items-center justify-center rounded-full px-2 text-center text-white transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                        shortcutsOpen
                          ? "pointer-events-auto opacity-100 hover:scale-110"
                          : "pointer-events-none opacity-0"
                      }`}
                      style={{
                        background: addTheme.orbGradient,
                        boxShadow: addTheme.orbShadow,
                        transform: shortcutsOpen
                          ? `translate(calc(-50% + ${addPos.xCss}), calc(-50% + ${addPos.yPx}px)) scale(1)`
                          : "translate(-50%, -50%) scale(0.3)",
                        transitionDelay: shortcutsOpen
                          ? `${allLinkShortcuts.length * 55}ms`
                          : "0ms",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -inset-2.5 -z-10 rounded-full blur-md transition-opacity duration-200 group-hover:opacity-100"
                        style={{ background: addTheme.haloGradient }}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-4 top-3 h-1 w-1 animate-pulse rounded-full bg-white/80"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-3 right-3.5 h-0.5 w-0.5 animate-pulse rounded-full bg-white/75"
                      />

                      <span className="mb-0.5 text-base leading-none font-bold text-white drop-shadow-xs">
                        +
                      </span>
                      <span className="text-[10px] leading-tight font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]">
                        Add your own shortcut
                      </span>
                    </button>
                  );
                })()}

                {/* Center Flower Hub Orb */}
                <button
                  type="button"
                  onClick={() => setShortcutsOpen((open) => !open)}
                  aria-expanded={shortcutsOpen}
                  aria-label={
                    shortcutsOpen
                      ? "Close Essential OTU Shortcuts"
                      : "Open Essential OTU Shortcuts"
                  }
                  className={`group absolute left-1/2 top-1/2 z-20 flex h-[98px] w-[98px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border px-2 text-center shadow-md transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71] ${
                    shortcutsOpen
                      ? "scale-95 border-[#003C71]/35 bg-[#003C71] text-white shadow-[0_12px_28px_-10px_rgba(0,60,113,0.55)] dark:border-sky-400/40 dark:bg-sky-600"
                      : "border-slate-200 bg-white text-slate-900 hover:scale-105 hover:border-[#003C71]/35 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-sky-400/40"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-300 ${
                      shortcutsOpen
                        ? "rotate-45 bg-white/15 text-white"
                        : "bg-slate-100/90 group-hover:scale-110 dark:bg-slate-800/90"
                    }`}
                  >
                    {shortcutsOpen ? (
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    ) : (
                      <svg
                        className="h-4.5 w-4.5"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        {/* Top-left: Library Study Rooms (Emerald) */}
                        <circle cx="7" cy="7" r="3.6" fill="#10B981" />
                        {/* Top-right: Canvas (Tangerine) */}
                        <circle cx="17" cy="7" r="3.6" fill="#E75D2A" />
                        {/* Bottom-right: MyOntarioTech (OTU Blue) */}
                        <circle cx="17" cy="17" r="3.6" fill="#0A5AA3" />
                        {/* Bottom-left: Add your own shortcut (Cosmic Violet) */}
                        <circle cx="7" cy="17" r="3.6" fill="#7C3AED" />
                      </svg>
                    )}
                  </span>

                  <span className="text-[10.5px] leading-tight font-bold">
                    Essential OTU Shortcuts
                  </span>
                </button>
              </div>
            );
          })()}
        </div>
      </section>

      {/* Add Your Own Shortcut Modal */}
      {addShortcutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          onClick={() => setAddShortcutOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Add your own shortcut
              </h2>
              <button
                type="button"
                onClick={() => setAddShortcutOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleAddShortcutSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Name
                </label>
                <input
                  type="text"
                  autoFocus
                  maxLength={24}
                  value={shortcutNameDraft}
                  onChange={(e) => {
                    setShortcutNameDraft(e.target.value);
                    setShortcutFormError(null);
                  }}
                  placeholder="e.g. OTU Email"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#003C71] focus:ring-2 focus:ring-[#003C71]/20 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Link URL
                </label>
                <input
                  type="text"
                  value={shortcutUrlDraft}
                  onChange={(e) => {
                    setShortcutUrlDraft(e.target.value);
                    setShortcutFormError(null);
                  }}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#003C71] focus:ring-2 focus:ring-[#003C71]/20 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Circle color
                </span>
                <div className="flex items-center gap-2">
                  {(Object.keys(ORB_THEMES) as ShortcutColorKey[]).map(
                    (key) => {
                      const active = shortcutColorDraft === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setShortcutColorDraft(key)}
                          title={ORB_THEMES[key].label}
                          aria-label={ORB_THEMES[key].label}
                          className={`h-7 w-7 rounded-full transition-transform ${ORB_THEMES[key].swatchClass} ${
                            active
                              ? "scale-110 ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-900"
                              : "opacity-75 hover:opacity-100"
                          }`}
                        />
                      );
                    },
                  )}
                </div>
              </div>

              {shortcutFormError && (
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  {shortcutFormError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAddShortcutOpen(false)}
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#003C71] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#0A5AA3]"
                >
                  Add shortcut
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
