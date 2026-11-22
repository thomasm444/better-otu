"use client";

import type { User } from "@supabase/supabase-js";
import React, { useEffect, useState } from "react";

import { ClassicPortalView } from "@/app/_components/classic-portal-view";
import {
  GoogleLogoIcon,
  GoogleShortcutsModal,
} from "@/app/_components/google-shortcuts-modal";
import { AuthButton } from "@/components/auth-button";
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
  EMPTY_GOOGLE_STATE,
  loadGoogleShortcutsState,
  saveGoogleShortcutsState,
  type GoogleShortcutsState,
} from "@/lib/google-shortcuts";
import {
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
  const [firstName, setFirstName] = useState<string | null>(null);
  const [profile, setProfile] = useState<StudentProfileWithPrograms | null>(null);
  const [academicStartYear, setAcademicStartYear] = useState<number>(DEFAULT_START_YEAR);
  const [savedCourseCodes, setSavedCourseCodes] = useState<string[]>([]);
  const [latestPlan, setLatestPlan] = useState<DegreePlanRecord | null>(null);

  // Live available rooms & Toronto clock
  const [nowLabel, setNowLabel] = useState<string | null>(null);
  const [liveTimeLabel, setLiveTimeLabel] = useState<string | null>(null);
  const [freeRoomsTotal, setFreeRoomsTotal] = useState<number | null>(null);
  const [freeRoomsSample, setFreeRoomsSample] = useState<string[]>([]);
  const [roomsLoading, setRoomsLoading] = useState<boolean>(true);

  // Custom shortcuts & Google Workspace shortcuts
  const [customShortcuts, setCustomShortcuts] = useState<CustomShortcut[]>([]);
  const [isAddShortcutOpen, setIsAddShortcutOpen] = useState(false);
  const [shortcutName, setShortcutName] = useState("");
  const [shortcutUrl, setShortcutUrl] = useState("");
  const [googleShortcuts, setGoogleShortcuts] = useState<GoogleShortcutsState>(EMPTY_GOOGLE_STATE);
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false);

  // Load saved custom shortcuts and Google shortcuts from localStorage
  useEffect(() => {
    try {
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

  // Client-side Toronto clock for Campus Pulse strip (Next 16 prerender-safe)
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

  // Fetch live currently available rooms summary
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

  const degreeProgress = computeDegreeProgress(latestPlan);
  const visibleCourseCodes = savedCourseCodes.slice(0, 4);
  const profileDegreeName = profile?.degree_program?.name ?? null;
  const profileMinorName =
    profile?.has_minor !== false ? (profile?.minor_program?.name ?? null) : null;
  const derivedProfileStartYear = yearOfStudyToStartYear(
    profile?.year_of_study,
    academicStartYear,
  );

  return (
    <main className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-[#F8FAFC] font-sans text-slate-900 dark:bg-[#070B14] dark:text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(0,60,113,0.1)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_85%_75%_at_50%_15%,#000_60%,transparent_100%)] dark:bg-[radial-gradient(rgba(148,163,184,0.14)_1px,transparent_1px)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(ellipse_62%_58%_at_22%_-6%,rgba(0,60,113,0.15),transparent_70%),radial-gradient(ellipse_50%_46%_at_84%_-8%,rgba(231,93,42,0.13),transparent_68%)] dark:bg-[radial-gradient(ellipse_62%_58%_at_22%_-6%,rgba(0,60,113,0.45),transparent_70%),radial-gradient(ellipse_50%_46%_at_84%_-8%,rgba(231,93,42,0.22),transparent_68%)]"
      />

      <div className="relative z-10 flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-7 sm:px-8 sm:py-10">
          {/* Top Header */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1 space-y-2">
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
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
                  {firstName ? `Welcome back, ${firstName}` : "Welcome to Better OTU"}
                </h1>
                <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Your all-in-one Ontario Tech hub for live room vacancy, course timetables, and degree planning.
                </p>
              </div>
            </div>

            <div className="shrink-0 self-end sm:self-auto">
              <AuthButton />
            </div>
          </header>

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
