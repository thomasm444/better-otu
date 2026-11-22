"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { AuthButton } from "@/components/auth-button";
import { ClassicPortalView } from "@/app/_components/classic-portal-view";
import {
  GoogleLogoIcon,
  GoogleMeetIcon,
  GoogleServiceIcon,
  GoogleShortcutsModal,
} from "@/app/_components/google-shortcuts-modal";
import {
  EMPTY_GOOGLE_STATE,
  GOOGLE_SERVICES,
  loadGoogleShortcutsState,
  normalizeMeetUrl,
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
  fetchLatestDegreePlan,
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

type HomeTheme = "stacked" | "classic";

const HOME_THEME_STORAGE_KEY = "better-otu:home-theme:v1";

interface PortalDashboardProps {
  termLabel: string;
  footer?: React.ReactNode;
}

interface CustomShortcut {
  id: string;
  label: string;
  url: string;
}

const CUSTOM_SHORTCUTS_STORAGE_KEY = "better-otu:portal-custom-shortcuts:v1";

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

function getInitials(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) return "?";
  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 3).toUpperCase();
}

function computeDegreeProgress(plan: DegreePlanRecord | null): {
  title: string;
  plannedCourses: number;
  plannedCredits: number;
  percent: number;
} | null {
  if (!plan) return null;
  const customCredits = new Map<string, number>();
  for (const c of plan.customs ?? []) {
    if (c.code) customCredits.set(c.code.toUpperCase(), c.credit_hours || 3);
  }
  let plannedCourses = 0;
  let plannedCredits = 0;
  for (const term of plan.terms ?? []) {
    for (const slot of term.slots ?? []) {
      if (!slot) continue;
      plannedCourses += 1;
      plannedCredits += customCredits.get(slot.toUpperCase()) ?? 3;
    }
  }
  const percent = Math.min(100, Math.round((plannedCredits / 120) * 100));
  return {
    title: plan.degree_name || "Saved Degree Plan",
    plannedCourses,
    plannedCredits,
    percent,
  };
}

export function PortalDashboard({ termLabel, footer }: PortalDashboardProps) {
  const [homeTheme, setHomeTheme] = useState<HomeTheme>("classic");
  const [firstName, setFirstName] = useState<string | null>(null);
  const [profile, setProfile] = useState<StudentProfileWithPrograms | null>(null);
  const [academicStartYear, setAcademicStartYear] = useState<number>(DEFAULT_START_YEAR);
  const [savedCourseCodes, setSavedCourseCodes] = useState<string[]>([]);
  const [latestPlan, setLatestPlan] = useState<DegreePlanRecord | null>(null);

  // Live available rooms for Card 3 right compartment & Classic Campus Pulse
  const [nowLabel, setNowLabel] = useState<string | null>(null);
  const [liveTimeLabel, setLiveTimeLabel] = useState<string | null>(null);
  const [freeRoomsTotal, setFreeRoomsTotal] = useState<number | null>(null);
  const [freeRoomsSample, setFreeRoomsSample] = useState<string[]>([]);
  const [roomsLoading, setRoomsLoading] = useState<boolean>(true);

  // Custom circular shortcuts for "+" button & Google Workspace shortcuts
  const [customShortcuts, setCustomShortcuts] = useState<CustomShortcut[]>([]);
  const [isAddShortcutOpen, setIsAddShortcutOpen] = useState(false);
  const [shortcutName, setShortcutName] = useState("");
  const [shortcutUrl, setShortcutUrl] = useState("");
  const [googleShortcuts, setGoogleShortcuts] = useState<GoogleShortcutsState>(EMPTY_GOOGLE_STATE);
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false);

  // Load saved home theme, custom shortcuts, and Google shortcuts from localStorage
  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(HOME_THEME_STORAGE_KEY);
      if (savedTheme === "stacked" || savedTheme === "classic") {
        queueMicrotask(() => setHomeTheme(savedTheme));
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

  // Client-side Toronto clock for Classic Campus Pulse strip (Next 16 prerender-safe)
  useEffect(() => {
    const updateClock = () => {
      const { date, minutes } = getTorontoNowParts(new Date());
      const dayIdx = getDayOfWeekMon1(date);
      setLiveTimeLabel(
        `${DAY_SHORT[dayIdx]}, ${formatShortIsoDate(date)} · ${formatMinutesToClock(minutes)}`,
      );
    };
    queueMicrotask(updateClock);
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
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

      const [coursesRes, planRes, profileRes] = await Promise.allSettled([
        fetchStudentCourses(supabase),
        user.email ? fetchLatestDegreePlan(supabase, user.email) : Promise.resolve(null),
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

      if (planRes.status === "fulfilled") {
        setLatestPlan(planRes.value);
      }

      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value);
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

  // Fetch live currently available rooms for the Map card right compartment
  useEffect(() => {
    const controller = new AbortController();
    const nowState = getDefaultCampusMapState(new Date());

    queueMicrotask(() => {
      setAcademicStartYear(getCurrentAcademicStartYear());
      setNowLabel(
        `${DAY_SHORT[nowState.dayIndex]}, ${formatShortIsoDate(nowState.date)} · ${formatMinutesToClock(nowState.slotStart)}`,
      );
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
          freeRooms?: string[];
        };
        if (controller.signal.aborted) return;

        const pickSample = (rooms: string[]) => {
          const copy = [...rooms];
          for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = copy[i];
            copy[i] = copy[j];
            copy[j] = tmp;
          }
          return copy.slice(0, 6);
        };

        if (typeof payload.freeRoomsTotal === "number") {
          setFreeRoomsTotal(payload.freeRoomsTotal);
          setFreeRoomsSample(
            Array.isArray(payload.freeRooms) ? pickSample(payload.freeRooms) : [],
          );
          setRoomsLoading(false);
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
        setFreeRoomsSample(pickSample(freeNow));
        setRoomsLoading(false);
      } catch {
        if (!controller.signal.aborted) {
          setFreeRoomsTotal(null);
          setFreeRoomsSample([]);
          setRoomsLoading(false);
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

  const handleSelectTheme = (nextTheme: HomeTheme) => {
    setHomeTheme(nextTheme);
    try {
      window.localStorage.setItem(HOME_THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage errors
    }
  };

  const themeToggle = (
    <div
      role="radiogroup"
      aria-label="Home layout theme"
      className="inline-flex items-center rounded-xl border border-slate-200/90 bg-white/90 p-0.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900/90"
    >
      <button
        type="button"
        role="radio"
        aria-checked={homeTheme === "stacked"}
        onClick={() => handleSelectTheme("stacked")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
          homeTheme === "stacked"
            ? "bg-[#003C71] text-white dark:bg-sky-500 dark:text-slate-950"
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
        aria-checked={homeTheme === "classic"}
        onClick={() => handleSelectTheme("classic")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[#003C71]/40 focus-visible:outline-none ${
          homeTheme === "classic"
            ? "bg-[#003C71] text-white dark:bg-sky-500 dark:text-slate-950"
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
  );

  const degreeProgress = computeDegreeProgress(latestPlan);
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

  return (
    <main
      className={`relative flex min-h-screen flex-1 flex-col overflow-x-clip font-sans text-slate-900 dark:text-slate-100 ${
        homeTheme === "classic"
          ? "bg-[#F8FAFC] dark:bg-[#070B14]"
          : "bg-[#F8FAFD] dark:bg-[#090D16]"
      }`}
    >
      {homeTheme === "classic" ? (
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
          {/* Shared Top Header: Greeting on left, Account & Theme switch on top-right */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              {homeTheme === "classic" && (
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
              )}

              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
                  {firstName ? (
                    homeTheme === "classic" ? (
                      <>
                        Welcome back,{" "}
                        <span className="bg-gradient-to-r from-[#003C71] via-[#0A5AA3] to-[#E75D2A] bg-clip-text text-transparent dark:from-sky-300 dark:via-blue-300 dark:to-[#FF8B5E]">
                          {firstName}
                        </span>
                      </>
                    ) : (
                      `Welcome back, ${firstName}`
                    )
                  ) : (
                    "Welcome to Better OTU"
                  )}
                </h1>
                <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {homeTheme === "classic"
                    ? "Your all-in-one Ontario Tech hub for live room vacancy, course timetables, and degree planning."
                    : `Ontario Tech University • ${termLabel}`}
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
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2 self-end sm:self-auto">
              <AuthButton />
              {themeToggle}
            </div>
          </header>

          {homeTheme === "classic" ? (
            <ClassicPortalView
              termLabel={termLabel}
              profile={profile}
              profileDegreeName={profileDegreeName}
              profileMinorName={profileMinorName}
              derivedProfileStartYear={derivedProfileStartYear}
              savedCourseCodes={savedCourseCodes}
              visibleCourseCodes={visibleCourseCodes}
              degreeProgress={degreeProgress}
              latestPlan={latestPlan}
              nowLabel={nowLabel}
              liveTimeLabel={liveTimeLabel}
              freeRoomsTotal={freeRoomsTotal}
              freeRoomsSample={freeRoomsSample}
              roomsLoading={roomsLoading}
              quickBuildings={QUICK_BUILDINGS}
              defaultShortcuts={DEFAULT_SHORTCUTS}
              googleShortcuts={googleShortcuts}
              customShortcuts={customShortcuts}
              onOpenAddShortcut={() => setIsAddShortcutOpen(true)}
              onRemoveCustomShortcut={handleRemoveShortcut}
              onOpenGoogleModal={() => setIsGoogleModalOpen(true)}
              onRemoveMeetShortcut={handleRemoveMeetShortcut}
            />
          ) : (
            <>

      {/* Main Centered Stack: 3 Horizontal Split Cards + 4 Circular Shortcuts */}
      <div className="mx-auto my-auto flex w-full max-w-3xl flex-col items-center py-8 sm:py-12">
        <div className="w-full space-y-5">
          {/* CARD 1: Course Schedule | Schedule & Timetable Preview */}
          <Link
            href="/course-schedules"
            className="group flex flex-col overflow-hidden rounded-[26px] border border-[#BFD7F2] bg-[#DCEBFA]/75 shadow-[0_6px_24px_-12px_rgba(0,60,113,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#003C71]/40 hover:bg-[#D4E6F9]/90 hover:shadow-[0_14px_32px_-14px_rgba(0,60,113,0.26)] sm:min-h-[126px] sm:flex-row dark:border-slate-700/80 dark:bg-slate-900/85 dark:hover:border-sky-400/50 dark:hover:bg-slate-900"
          >
            {/* Left Section: Title */}
            <div className="flex shrink-0 flex-col items-center justify-center border-b border-[#B7D1EE] px-6 py-5 text-center sm:w-[32%] sm:rounded-r-[26px] sm:border-b-0 sm:border-r dark:border-slate-700/80">
              <div className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-[#003C71] shadow-2xs ring-1 ring-[#003C71]/10 transition-transform duration-200 group-hover:scale-105 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20">
                <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="18" height="18" x="3" y="4" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </div>
              <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
                Course Schedule
              </span>
              <span className="mt-0.5 text-[11px] font-medium text-[#003C71]/80 dark:text-sky-300/80">
                {termLabel}
              </span>
            </div>

            {/* Right Section: Preview */}
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-5 text-center sm:px-8">
              {visibleCourseCodes.length > 0 ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#003C71]/80 dark:text-sky-300">
                    Your Saved Courses ({savedCourseCodes.length})
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                    {visibleCourseCodes.map((code) => (
                      <span
                        key={code}
                        className="rounded-full border border-white/80 bg-white/85 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {code}
                      </span>
                    ))}
                    {savedCourseCodes.length > 4 && (
                      <span className="rounded-full bg-[#003C71]/10 px-2.5 py-1 text-xs font-semibold text-[#003C71] dark:bg-sky-500/20 dark:text-sky-200">
                        +{savedCourseCodes.length - 4} more
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Bi-weekly timetable &amp; section lookup
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    View Week 1 &amp; Week 2 classes, check rooms, and add {termLabel} CRNs
                  </p>
                </>
              )}
            </div>
          </Link>

          {/* CARD 2: Degree Planner | Progress Bar & Roadmap */}
          <Link
            href="/degree-planner"
            className="group flex flex-col overflow-hidden rounded-[26px] border border-[#BFD7F2] bg-[#DCEBFA]/75 shadow-[0_6px_24px_-12px_rgba(0,60,113,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#003C71]/40 hover:bg-[#D4E6F9]/90 hover:shadow-[0_14px_32px_-14px_rgba(0,60,113,0.26)] sm:min-h-[126px] sm:flex-row dark:border-slate-700/80 dark:bg-slate-900/85 dark:hover:border-sky-400/50 dark:hover:bg-slate-900"
          >
            {/* Left Section: Title */}
            <div className="flex shrink-0 flex-col items-center justify-center border-b border-[#B7D1EE] px-6 py-5 text-center sm:w-[32%] sm:rounded-r-[26px] sm:border-b-0 sm:border-r dark:border-slate-700/80">
              <div className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-[#E75D2A] shadow-2xs ring-1 ring-[#E75D2A]/15 transition-transform duration-200 group-hover:scale-105 dark:bg-[#E75D2A]/20 dark:text-[#FF8A5C] dark:ring-[#E75D2A]/30">
                <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                  <path d="M6 12v5c3 3 9 3 12 0v-5" />
                </svg>
              </div>
              <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
                Degree Planner
              </span>
              <span className="mt-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                Program Roadmap
              </span>
            </div>

            {/* Right Section: Progress Bar & Degree Requirements */}
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-5 text-center sm:px-8">
              {degreeProgress && degreeProgress.plannedCourses > 0 ? (
                <div className="w-full max-w-sm">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {degreeProgress.title}
                    </span>
                    <span className="shrink-0 font-mono font-bold text-[#003C71] dark:text-sky-300">
                      {degreeProgress.plannedCredits} / 120 cr
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/90 ring-1 ring-[#003C71]/10 dark:bg-slate-800 dark:ring-slate-700">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#003C71] to-[#E75D2A] transition-all duration-500"
                      style={{ width: `${Math.max(degreeProgress.percent, 6)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    {degreeProgress.plannedCourses} courses planned &bull; {degreeProgress.percent}% toward 120-credit degree
                    {profileMinorName ? ` · Minor: ${profileMinorName}` : ""}
                  </p>
                </div>
              ) : latestPlan ? (
                <div className="w-full max-w-sm">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {latestPlan.degree_name ||
                      profileDegreeName ||
                      "Saved Degree Plan"}
                  </p>
                  {profileMinorName && (
                    <p className="mt-0.5 truncate text-xs font-medium text-[#003C71] dark:text-sky-300">
                      Minor: {profileMinorName}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                    Start {latestPlan.start_year ?? derivedProfileStartYear}{" "}
                    &bull; Open planner to load your roadmap
                  </p>
                </div>
              ) : profileDegreeName ? (
                <div className="w-full max-w-sm">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {profileDegreeName}
                  </p>
                  {profileMinorName && (
                    <p className="mt-0.5 truncate text-xs font-medium text-[#003C71] dark:text-sky-300">
                      Minor: {profileMinorName}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                    Start {derivedProfileStartYear} &bull; Ready in Degree Planner
                  </p>
                </div>
              ) : (
                <div className="w-full max-w-sm">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Progress bar &amp; degree requirements
                  </p>
                  <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/85 ring-1 ring-[#003C71]/10 dark:bg-slate-800">
                    <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-[#003C71] to-[#E75D2A]" />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                    Track prerequisites, credits, and multi-year course pathways
                  </p>
                </div>
              )}
            </div>
          </Link>

          {/* CARD 3: 3-Part Map Card (Map | Find Library Room | Building Free Rooms) */}
          <div className="flex flex-col overflow-hidden rounded-[26px] border border-[#BFD7F2] bg-[#DCEBFA]/75 shadow-[0_6px_24px_-12px_rgba(0,60,113,0.18)] transition-all duration-200 hover:border-[#003C71]/40 hover:shadow-[0_14px_32px_-14px_rgba(0,60,113,0.26)] sm:min-h-[134px] sm:flex-row dark:border-slate-700/80 dark:bg-slate-900/85 dark:hover:border-sky-400/50">
            {/* Part 1 (Left): Map (North Campus) */}
            <Link
              href="/campus-map?venue=north"
              className="group flex shrink-0 flex-col items-center justify-center border-b border-[#B7D1EE] px-5 py-5 text-center transition-colors hover:bg-white/40 sm:w-[27%] sm:border-b-0 sm:border-r dark:border-slate-700/80 dark:hover:bg-slate-800/60"
            >
              <div className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-emerald-700 shadow-2xs ring-1 ring-emerald-500/15 transition-transform duration-200 group-hover:scale-105 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20">
                <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
                Map
              </span>
              <span className="mt-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                North Campus
              </span>
            </Link>

            {/* Part 2 (Middle): Find a library room */}
            <Link
              href="/campus-map?building=LIB&filter=available&now=1"
              className="group flex flex-1 flex-col items-center justify-center border-b border-[#B7D1EE] px-5 py-5 text-center transition-colors hover:bg-white/40 sm:border-b-0 dark:border-slate-700/80 dark:hover:bg-slate-800/60"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Live Now
              </span>
              <p className="mt-2 text-sm font-bold leading-snug text-slate-900 group-hover:text-[#003C71] dark:text-white dark:group-hover:text-sky-300">
                Find a library room
              </p>
              {nowLabel && (
                <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                  {nowLabel}
                </p>
              )}
            </Link>

            {/* Part 3 (Right): Building Free Rooms Curved Pill Compartment */}
            <div className="flex shrink-0 flex-col items-center justify-center bg-white/55 px-4 py-4 text-center sm:w-[37%] sm:rounded-l-[26px] sm:border-l sm:border-[#B7D1EE] dark:bg-slate-800/65 dark:sm:border-slate-700/80">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-100">
                <span>Free Rooms Right Now</span>
                {freeRoomsTotal !== null && (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                    {freeRoomsTotal}
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {QUICK_BUILDINGS.map((bldg) => (
                  <Link
                    key={bldg}
                    href={`/campus-map?building=${bldg}&filter=available&now=1`}
                    className="rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800 shadow-2xs transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-500 dark:hover:text-emerald-300"
                  >
                    {bldg}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM ROW: Circular Quick-Launch Shortcut Buttons (Canvas, MyOTU, Library, + Custom) */}
        <div
          aria-label="Quick shortcuts"
          className="mt-9 flex flex-wrap items-start justify-center gap-6 sm:gap-8"
        >
          {DEFAULT_SHORTCUTS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              title={item.title}
              className="group flex flex-col items-center gap-2"
            >
              <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[#BFD7F2] bg-white shadow-xs transition-all duration-200 group-hover:-translate-y-1 group-hover:border-[#003C71]/45 group-hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:group-hover:border-sky-400/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="h-full w-full object-cover object-center"
                />
              </span>
              <span className="text-xs font-semibold text-slate-700 transition-colors group-hover:text-[#003C71] dark:text-slate-300 dark:group-hover:text-sky-300">
                {item.label}
              </span>
            </a>
          ))}

          {/* Google Workspace Service Shortcuts */}
          {googleShortcuts.accounts.flatMap((acct) =>
            GOOGLE_SERVICES.filter((svc) =>
              acct.enabledServices.includes(svc.id),
            ).map((svc) => {
              const href = svc.buildUrl(acct.authIndex);
              const showAccountTag = googleShortcuts.accounts.length > 1;
              return (
                <a
                  key={`${acct.id}-${svc.id}`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${svc.label} — ${acct.label} (u/${acct.authIndex})`}
                  className="group relative flex flex-col items-center gap-2"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#BFD7F2] bg-white shadow-xs transition-all duration-200 group-hover:-translate-y-1 group-hover:border-[#003C71]/45 group-hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:group-hover:border-sky-400/60">
                    <GoogleServiceIcon serviceId={svc.id} className="h-7 w-7" />
                  </span>
                  {showAccountTag && (
                    <span className="absolute -bottom-0.5 right-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.2 text-[9px] font-bold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {acct.label}
                    </span>
                  )}
                  <span className="max-w-[76px] truncate text-xs font-semibold text-slate-700 transition-colors group-hover:text-[#003C71] dark:text-slate-300 dark:group-hover:text-sky-300">
                    {svc.shortLabel}
                  </span>
                </a>
              );
            }),
          )}

          {/* Google Meet Links (?authuser=x) */}
          {googleShortcuts.meetLinks.map((meet) => {
            const acct = googleShortcuts.accounts.find(
              (a) => a.id === meet.accountId,
            );
            const href = normalizeMeetUrl(meet.url, acct?.authIndex ?? 0);
            return (
              <div key={meet.id} className="group relative flex flex-col items-center gap-2">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${meet.label} (${href})`}
                  className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-white shadow-xs transition-all duration-200 hover:-translate-y-1 hover:border-emerald-500/60 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-400/60"
                >
                  <GoogleMeetIcon className="h-7 w-7" />
                </a>
                <button
                  type="button"
                  onClick={() => handleRemoveMeetShortcut(meet.id)}
                  aria-label={`Remove ${meet.label} Meet shortcut`}
                  title="Remove Meet shortcut"
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 opacity-0 shadow-xs transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  &times;
                </button>
                <span className="max-w-[76px] truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {meet.label}
                </span>
              </div>
            );
          })}

          {/* User-Added Custom Circular Shortcuts */}
          {customShortcuts.map((item) => (
            <div key={item.id} className="group relative flex flex-col items-center gap-2">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${item.label} (${item.url})`}
                className="flex h-16 w-16 items-center justify-center rounded-full border border-[#BFD7F2] bg-[#DCEBFA]/85 text-xs font-bold text-[#003C71] shadow-xs transition-all duration-200 hover:-translate-y-1 hover:border-[#003C71]/45 hover:bg-[#CFE3F8] hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-sky-200 dark:hover:border-sky-400/60 dark:hover:bg-slate-800"
              >
                {getInitials(item.label)}
              </a>
              <button
                type="button"
                onClick={() => handleRemoveShortcut(item.id)}
                aria-label={`Remove ${item.label} shortcut`}
                title="Remove shortcut"
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 opacity-0 shadow-xs transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                &times;
              </button>
              <span className="max-w-[72px] truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                {item.label}
              </span>
            </div>
          ))}

          {/* Google Setup / Manage Circle */}
          <button
            type="button"
            onClick={() => setIsGoogleModalOpen(true)}
            title={
              googleShortcuts.accounts.length > 0
                ? "Manage Google accounts, services & Meet links"
                : "Add Google school & personal shortcuts"
            }
            className="group flex flex-col items-center gap-2"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-[#9AC0EB] bg-white/85 shadow-xs transition-all duration-200 group-hover:-translate-y-1 group-hover:border-[#003C71]/50 group-hover:bg-white group-hover:shadow-md dark:border-slate-700 dark:bg-slate-900/80 dark:group-hover:border-sky-400/60 dark:group-hover:bg-slate-800">
              <GoogleLogoIcon className="h-6.5 w-6.5" />
            </span>
            <span className="text-xs font-semibold text-slate-600 transition-colors group-hover:text-[#003C71] dark:text-slate-400 dark:group-hover:text-sky-300">
              {googleShortcuts.accounts.length > 0 ? "Google" : "Add Google"}
            </span>
          </button>

          {/* "+" Add Shortcut Circle */}
          <button
            type="button"
            onClick={() => setIsAddShortcutOpen(true)}
            title="Add custom shortcut"
            className="group flex flex-col items-center gap-2"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-[#9AC0EB] bg-[#DCEBFA]/55 text-2xl font-light text-[#003C71] transition-all duration-200 group-hover:-translate-y-1 group-hover:border-[#003C71]/50 group-hover:bg-[#DCEBFA] group-hover:shadow-md dark:border-slate-700 dark:bg-slate-900/70 dark:text-sky-300 dark:group-hover:border-sky-400/60 dark:group-hover:bg-slate-800">
              +
            </span>
            <span className="text-xs font-semibold text-slate-500 transition-colors group-hover:text-slate-800 dark:text-slate-400 dark:group-hover:text-slate-200">
              Add
            </span>
          </button>
        </div>
      </div>
            </>
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
