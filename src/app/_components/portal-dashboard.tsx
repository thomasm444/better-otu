"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { ClassicPortalView } from "@/app/_components/classic-portal-view";
import { StackedPortalView } from "@/app/_components/stacked-portal-view";
import {
  GoogleLogoIcon,
  GoogleShortcutsModal,
} from "@/app/_components/google-shortcuts-modal";
import {
  EMPTY_GOOGLE_STATE,
  loadGoogleShortcutsState,
  saveGoogleShortcutsState,
  type GoogleShortcutsState,
} from "@/lib/google-shortcuts";
import {
  DAY_SHORT,
  formatShortIsoDate,
  getDayOfWeekMon1,
  getDefaultCampusMapState,
  getTorontoNowParts,
} from "@/lib/campus-map-dates";
import {
  fetchAllDegreePlans,
  type DegreePlanRecord,
} from "@/lib/degree-plan-storage";
import { DEFAULT_START_YEAR } from "@/lib/degree-planner";
import {
  formatYearOfStudy,
  getCurrentAcademicStartYear,
  yearOfStudyToStartYear,
} from "@/lib/onboarding";
import type { CampusMapWeekData } from "@/lib/queries";
import { loadLocalTermSchedule } from "@/lib/schedule-storage";
import {
  fetchStudentCourses,
  fetchStudentProfileWithPrograms,
  type StudentProfileWithPrograms,
} from "@/lib/student-courses";
import { createClient } from "@/lib/supabase/client";

interface PortalDashboardProps {
  termLabel: string;
  footer?: React.ReactNode;
  nonStandardCredits?: Record<string, number>;
}

type HomeView = "classic" | "stacked";

interface CustomShortcut {
  id: string;
  label: string;
  url: string;
}

const CUSTOM_SHORTCUTS_STORAGE_KEY = "better-otu:portal-custom-shortcuts:v1";
const HOME_VIEW_STORAGE_KEY = "better-otu:home-view:v1";

const QUICK_BUILDINGS = ["SHA", "SIR", "ERC", "BIT", "SCI", "ENG", "UP", "U5"] as const;

const DEFAULT_SHORTCUTS = [
  {
    id: "canvas",
    label: "Canvas",
    short: "LMS",
    href: "https://learn.ontariotechu.ca/",
    title: "Canvas LMS",
    imageUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSjTe2Ezo-kf87I47CDzz6sZX90zscDwO_xy-xJQb5Yr2GImwUtWmndGqZS&s=10",
  },
  {
    id: "myotu",
    label: "MyOTU",
    short: "OTU",
    href: "https://my.ontariotechu.ca/",
    title: "MyOntarioTech Portal",
    imageUrl:
      "https://pbs.twimg.com/profile_images/1111288285236731905/y6veEFsr_400x400.png",
  },
  {
    id: "library",
    label: "Library",
    short: "LSR",
    href: "https://apps.library.dc-ot.ca/OTrooms/calendar.aspx",
    title: "Library Study Rooms",
    imageUrl:
      "https://shared.ontariotechu.ca/shared/ontario-tech/images/buildings/north-oshawa/library/photo-gallery/150822-18-1200x800.jpg",
  },
] as const;

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

function formatMinutesToClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function computeDegreeProgress(
  plan: DegreePlanRecord | null,
  nonStandardCredits?: Record<string, number>,
): {
  title: string;
  plannedCourses: number;
  plannedCredits: number;
  percent: number;
} | null {
  if (!plan) return null;
  const customCredits = new Map<string, number>();
  for (const c of plan.customs ?? []) {
    if (c.code) customCredits.set(c.code.toUpperCase(), c.credit_hours ?? 3);
  }
  let plannedCourses = 0;
  let plannedCredits = 0;
  const countedKeys = new Set<string>();
  for (const term of plan.terms ?? []) {
    for (const slot of term.slots ?? []) {
      if (!slot) continue;
      const key = slot.toUpperCase();
      countedKeys.add(key);
      plannedCourses += 1;
      plannedCredits += customCredits.get(key) ?? nonStandardCredits?.[key] ?? 3;
    }
  }
  for (const c of plan.customs ?? []) {
    if (!c.transfer) continue;
    const key = c.code ? c.code.toUpperCase() : "";
    if (key && countedKeys.has(key)) continue;
    if (key) countedKeys.add(key);
    plannedCredits += Number(c.credit_hours) || 0;
  }
  const percent = Math.min(100, Math.round((plannedCredits / 120) * 100));
  return {
    title: plan.degree_name || "Saved Degree Plan",
    plannedCourses,
    plannedCredits,
    percent,
  };
}

export function PortalDashboard({
  termLabel,
  footer,
  nonStandardCredits,
}: PortalDashboardProps) {
  const [homeView, setHomeView] = useState<HomeView>("classic");
  const [firstName, setFirstName] = useState<string | null>(null);
  const [profile, setProfile] = useState<StudentProfileWithPrograms | null>(null);
  const [academicStartYear, setAcademicStartYear] = useState<number>(DEFAULT_START_YEAR);
  const [savedCourseCodes, setSavedCourseCodes] = useState<string[]>([]);
  const [latestPlan, setLatestPlan] = useState<DegreePlanRecord | null>(null);

  // Live Toronto clock & available rooms shared between Campus Map card and Campus Pulse
  const [liveTimeLabel, setLiveTimeLabel] = useState<string | null>(null);
  const [freeRoomsTotal, setFreeRoomsTotal] = useState<number | null>(null);

  // Custom shortcuts & Google Workspace shortcuts
  const [customShortcuts, setCustomShortcuts] = useState<CustomShortcut[]>([]);
  const [isAddShortcutOpen, setIsAddShortcutOpen] = useState(false);
  const [shortcutName, setShortcutName] = useState("");
  const [shortcutUrl, setShortcutUrl] = useState("");
  const [googleShortcuts, setGoogleShortcuts] = useState<GoogleShortcutsState>(EMPTY_GOOGLE_STATE);
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false);

  // Load saved Home view, custom shortcuts, and Google shortcuts from localStorage
  useEffect(() => {
    try {
      const savedView = window.localStorage.getItem(HOME_VIEW_STORAGE_KEY);
      if (savedView === "classic" || savedView === "stacked") {
        queueMicrotask(() => setHomeView(savedView));
      }
      const loadedGoogle = loadGoogleShortcutsState();
      if (loadedGoogle.accounts.length > 0 || loadedGoogle.meetLinks.length > 0) {
        queueMicrotask(() => setGoogleShortcuts(loadedGoogle));
      }
      const raw = window.localStorage.getItem(CUSTOM_SHORTCUTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CustomShortcut[];
      if (Array.isArray(parsed)) {
        queueMicrotask(() => {
          setCustomShortcuts(
            parsed.filter(
              (item) =>
                item &&
                typeof item.id === "string" &&
                typeof item.label === "string" &&
                typeof item.url === "string",
            ),
          );
        });
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Shared client-side Toronto clock for Campus Map card & Campus Pulse (Next 16 prerender-safe)
  useEffect(() => {
    const updateClock = () => {
      const { date, minutes } = getTorontoNowParts(new Date());
      const dayIdx = getDayOfWeekMon1(date);
      setLiveTimeLabel(
        `${DAY_SHORT[dayIdx]}, ${formatShortIsoDate(date)} · ${formatMinutesToClock(minutes)}`,
      );
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) updateClock();
    };
    queueMicrotask(updateClock);
    const timer = window.setInterval(updateClock, 15_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Load signed-in user profile, saved schedule courses, and latest degree plan
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const loadUserData = async (user: User | null) => {
      if (!active) return;
      setFirstName(extractFirstName(user));

      const localFallback =
        loadLocalTermSchedule("202609")?.plannedCourses
          .map((p) => p.courseCode)
          .filter(Boolean) ?? [];

      if (!user) {
        setProfile(null);
        setSavedCourseCodes(localFallback);
        setLatestPlan(null);
        return;
      }

      const [coursesRes, plansRes, profileRes] = await Promise.allSettled([
        fetchStudentCourses(supabase),
        user.email ? fetchAllDegreePlans(supabase, user.email) : Promise.resolve([]),
        fetchStudentProfileWithPrograms(supabase, user.id),
      ]);

      if (!active) return;
      if (coursesRes.status === "fulfilled") {
        const codes = Array.from(
          new Set(
            coursesRes.value
              .map((c) => c.course_code)
              .filter(
                (code) =>
                  Boolean(code) &&
                  code !== "__BLOCKED__" &&
                  code !== "__CUSTOM__",
              ),
          ),
        );
        setSavedCourseCodes(codes.length > 0 ? codes : localFallback);
      } else {
        setSavedCourseCodes(localFallback);
      }

      const loadedProfile =
        profileRes.status === "fulfilled" ? profileRes.value : null;
      if (profileRes.status === "fulfilled") {
        setProfile(loadedProfile);
      }

      if (plansRes.status === "fulfilled") {
        const allPlans = plansRes.value;
        const profilePlan = loadedProfile?.degree_program_id
          ? allPlans.find(
              (p) => p.program_id === loadedProfile.degree_program_id,
            )
          : undefined;
        setLatestPlan(profilePlan ?? allPlans[0] ?? null);
      }
    };

    supabase.auth.getUser().then(({ data }) => {
      void loadUserData(data.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadUserData(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch live currently available rooms for Campus Map card & Campus Pulse
  useEffect(() => {
    const controller = new AbortController();
    const nowState = getDefaultCampusMapState(new Date());

    queueMicrotask(() => {
      setAcademicStartYear(getCurrentAcademicStartYear());
    });

    async function loadLiveRooms() {
      try {
        const params = new URLSearchParams({
          weekStart: nowState.weekStart,
          summary: "freeCount",
          day: String(nowState.dayIndex),
          slot: String(nowState.slotStart),
        });
        const res = await fetch(
          `/api/campus-map/week?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as Partial<CampusMapWeekData> & {
          freeRoomsTotal?: number;
        };
        if (controller.signal.aborted) return;

        if (typeof payload.freeRoomsTotal === "number") {
          setFreeRoomsTotal(payload.freeRoomsTotal);
          return;
        }

        const dayKey = String(nowState.dayIndex);
        const slotStart = nowState.slotStart;
        const slotEnd = slotStart + 30;
        const freeNow: string[] = [];

        for (const [roomId, byDay] of Object.entries(payload.schedules ?? {})) {
          const intervals = byDay?.[dayKey] ?? [];
          const isBusy = intervals.some(
            (ev) => ev.start < slotEnd && ev.end > slotStart,
          );
          if (!isBusy) {
            freeNow.push(roomId);
          }
        }

        setFreeRoomsTotal(freeNow.length);
      } catch {
        if (!controller.signal.aborted) {
          setFreeRoomsTotal(null);
        }
      }
    }

    void loadLiveRooms();
    return () => controller.abort();
  }, []);

  const handleAddShortcut = (e: React.FormEvent) => {
    e.preventDefault();
    const label = shortcutName.trim();
    const url = normalizeUrl(shortcutUrl);
    if (!label || !url) return;

    const next: CustomShortcut[] = [
      ...customShortcuts,
      { id: `custom-${Date.now()}`, label, url },
    ];
    setCustomShortcuts(next);
    try {
      window.localStorage.setItem(
        CUSTOM_SHORTCUTS_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      // Ignore storage errors
    }
    setShortcutName("");
    setShortcutUrl("");
    setIsAddShortcutOpen(false);
  };

  const handleRemoveShortcut = (id: string) => {
    const next = customShortcuts.filter((s) => s.id !== id);
    setCustomShortcuts(next);
    try {
      window.localStorage.setItem(
        CUSTOM_SHORTCUTS_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      // Ignore storage errors
    }
  };

  const handleSaveGoogleShortcuts = (next: GoogleShortcutsState) => {
    setGoogleShortcuts(next);
    saveGoogleShortcutsState(next);
  };

  const handleRemoveMeetShortcut = (meetId: string) => {
    const next: GoogleShortcutsState = {
      ...googleShortcuts,
      meetLinks: googleShortcuts.meetLinks.filter((m) => m.id !== meetId),
    };
    setGoogleShortcuts(next);
    saveGoogleShortcutsState(next);
  };

  const handleSelectHomeView = (nextView: HomeView) => {
    setHomeView(nextView);
    try {
      window.localStorage.setItem(HOME_VIEW_STORAGE_KEY, nextView);
    } catch {
      // Ignore storage errors
    }
  };

  const degreeProgress = computeDegreeProgress(latestPlan, nonStandardCredits);
  const visibleCourseCodes = savedCourseCodes.slice(0, 4);
  const yearLabel = formatYearOfStudy(profile?.year_of_study);
  const profileDegreeName = profile?.degree_program?.name ?? null;
  const profileMinorName =
    profile?.has_minor !== false ? (profile?.minor_program?.name ?? null) : null;
  const hasAcademicSummary = Boolean(
    yearLabel || profileDegreeName || profileMinorName,
  );
  const derivedProfileStartYear = yearOfStudyToStartYear(
    profile?.year_of_study,
    academicStartYear,
  );

  const sharedProps = {
    termLabel,
    profile,
    profileDegreeName,
    profileMinorName,
    derivedProfileStartYear,
    degreeProgress,
    latestPlan,
    liveTimeLabel,
    freeRoomsTotal,
    quickBuildings: QUICK_BUILDINGS,
    defaultShortcuts: DEFAULT_SHORTCUTS,
    googleShortcuts,
    customShortcuts,
    onOpenAddShortcut: () => setIsAddShortcutOpen(true),
    onRemoveCustomShortcut: handleRemoveShortcut,
    onOpenGoogleModal: () => setIsGoogleModalOpen(true),
    onRemoveMeetShortcut: handleRemoveMeetShortcut,
  };

  return (
    <main
      className={`relative flex min-h-[calc(100dvh-var(--site-nav-height,2.75rem))] flex-1 flex-col overflow-x-clip font-sans text-slate-900 dark:text-slate-100 ${
        homeView === "classic"
          ? "bg-[#F8FAFC] dark:bg-[#070B14]"
          : "bg-[#F8FAFD] dark:bg-[#090D16]"
      }`}
    >
      {homeView === "classic" ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(0,60,113,0.1)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_85%_75%_at_50%_15%,#000_60%,transparent_100%)] dark:bg-[radial-gradient(rgba(148,163,184,0.14)_1px,transparent_1px)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(ellipse_62%_58%_at_22%_-6%,rgba(0,60,113,0.15),transparent_70%),radial-gradient(ellipse_50%_46%_at_84%_-8%,rgba(231,93,42,0.13),transparent_68%)] dark:bg-[radial-gradient(ellipse_62%_58%_at_22%_-6%,rgba(0,60,113,0.45),transparent_70%),radial-gradient(ellipse_50%_46%_at_84%_-8%,rgba(231,93,42,0.22),transparent_68%)]"
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(191,219,254,0.45),transparent_72%)] dark:bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(0,60,113,0.35),transparent_72%)]"
        />
      )}

      <div className="relative z-10 flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-7 sm:px-8 sm:py-10">
          {/* Top Header: Greeting, Academic Summary & Layout Switcher */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
                {firstName ? `Welcome back, ${firstName}` : "Welcome to Better OTU"}
              </h1>
              <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                Ontario Tech University &bull; {termLabel}
              </p>
              {hasAcademicSummary ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-medium text-[#003C71] dark:text-sky-300">
                    {[
                      yearLabel,
                      profileDegreeName,
                      profileMinorName ? `Minor: ${profileMinorName}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-slate-300 dark:text-slate-600"
                  >
                    &bull;
                  </span>
                  <Link
                    href="/profile"
                    className="font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-[#003C71] dark:text-slate-400 dark:decoration-slate-700 dark:hover:text-sky-300"
                  >
                    Edit
                  </Link>
                </p>
              ) : profile?.onboarding_skipped_at ? (
                <p className="mt-1 text-xs">
                  <Link
                    href="/onboarding"
                    className="font-medium text-[#003C71] underline decoration-[#9AC0EB] underline-offset-2 transition-colors hover:text-[#002D56] dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-200"
                  >
                    Personalize your year &amp; degree &rarr;
                  </Link>
                </p>
              ) : null}
            </div>

            <div
              role="radiogroup"
              aria-label="Home layout view"
              className="inline-flex shrink-0 self-start rounded-xl border border-slate-200/90 bg-white/95 p-0.5 shadow-2xs backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/90"
            >
              <button
                type="button"
                role="radio"
                aria-checked={homeView === "stacked"}
                onClick={() => handleSelectHomeView("stacked")}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71] ${
                  homeView === "stacked"
                    ? "bg-[#003C71] text-white shadow-2xs dark:bg-sky-500 dark:text-slate-950"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="18" height="5" x="3" y="4" rx="1.5" />
                  <rect width="18" height="5" x="3" y="10" rx="1.5" />
                  <rect width="18" height="5" x="3" y="16" rx="1.5" />
                </svg>
                <span>Stacked</span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={homeView === "classic"}
                onClick={() => handleSelectHomeView("classic")}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71] ${
                  homeView === "classic"
                    ? "bg-[#003C71] text-white shadow-2xs dark:bg-sky-500 dark:text-slate-950"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="5" height="7" x="3" y="4" rx="1" />
                  <rect width="5" height="7" x="9.5" y="4" rx="1" />
                  <rect width="5" height="7" x="16" y="4" rx="1" />
                  <rect width="10" height="7" x="3" y="13" rx="1" />
                  <rect width="6" height="7" x="15" y="13" rx="1" />
                </svg>
                <span>Classic</span>
              </button>
            </div>
          </header>

          {homeView === "stacked" ? (
            <StackedPortalView {...sharedProps} />
          ) : (
            <ClassicPortalView {...sharedProps} />
          )}
        </div>
      </div>

      {footer}

      {/* Add Custom Shortcut Modal */}
      {isAddShortcutOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddShortcutOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
        >
          <form
            onSubmit={handleAddShortcut}
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Add Quick Shortcut
              </h2>
              <button
                type="button"
                onClick={() => setIsAddShortcutOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gmail, GitHub, Discord"
                  value={shortcutName}
                  onChange={(e) => setShortcutName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003C71] dark:border-slate-700 dark:text-white dark:focus:border-sky-400"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  URL
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. mail.google.com"
                  value={shortcutUrl}
                  onChange={(e) => setShortcutUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003C71] dark:border-slate-700 dark:text-white dark:focus:border-sky-400"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsAddShortcutOpen(false);
                  setIsGoogleModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#003C71] hover:underline dark:text-sky-300"
              >
                <GoogleLogoIcon className="h-3.5 w-3.5" />
                <span>Add Google links instead</span>
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddShortcutOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#003C71] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#002D56]"
                >
                  Save Shortcut
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Google Workspace & Meet Shortcuts Modal */}
      {isGoogleModalOpen && (
        <GoogleShortcutsModal
          initialState={googleShortcuts}
          onSave={handleSaveGoogleShortcuts}
          onClose={() => setIsGoogleModalOpen(false)}
        />
      )}
    </main>
  );
}
