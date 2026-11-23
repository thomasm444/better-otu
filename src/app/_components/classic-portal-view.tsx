"use client";

import Link from "next/link";
import {
  GoogleLogoIcon,
  GoogleMeetIcon,
  GoogleServiceIcon,
} from "@/app/_components/google-shortcuts-modal";
import type { DegreePlanRecord } from "@/lib/degree-plan-storage";
import {
  GOOGLE_SERVICES,
  normalizeMeetUrl,
  type GoogleServiceId,
  type GoogleShortcutsState,
} from "@/lib/google-shortcuts";
import type { StudentProfileWithPrograms } from "@/lib/student-courses";
import React, { useMemo } from "react";

export interface DefaultShortcutItem {
  readonly id: string;
  readonly label: string;
  readonly short: string;
  readonly href: string;
  readonly title: string;
  readonly imageUrl: string;
}

export interface CustomShortcutItem {
  id: string;
  label: string;
  url: string;
}

export interface DegreeProgressSummary {
  title: string;
  plannedCourses: number;
  plannedCredits: number;
  percent: number;
}

interface ClassicPortalViewProps {
  termLabel: string;
  profile: StudentProfileWithPrograms | null;
  profileDegreeName: string | null;
  profileMinorName: string | null;
  derivedProfileStartYear: number;
  degreeProgress: DegreeProgressSummary | null;
  latestPlan: DegreePlanRecord | null;
  liveTimeLabel: string | null;
  freeRoomsTotal: number | null;
  quickBuildings: readonly string[];
  defaultShortcuts: readonly DefaultShortcutItem[];
  googleShortcuts: GoogleShortcutsState;
  customShortcuts: CustomShortcutItem[];
  onOpenAddShortcut: () => void;
  onRemoveCustomShortcut: (id: string) => void;
  onOpenGoogleModal: () => void;
  onRemoveMeetShortcut: (id: string) => void;
}

type ShortcutTone = "emerald" | "orange" | "blue";

const SHORTCUT_RING_CLASSES: Record<ShortcutTone, string> = {
  emerald: "border-emerald-300/80 dark:border-emerald-500/40",
  orange: "border-[#E75D2A]/35 dark:border-[#E75D2A]/45",
  blue: "border-[#9AC0EB] dark:border-sky-500/40",
};

const SCHEDULE_TERM_LINKS = [
  { code: "202609", label: "Fall 2026", shortLabel: "F2026" },
  { code: "202701", label: "Winter 2027", shortLabel: "W2027" },
  { code: "202705", label: "Spring/Summer 2027", shortLabel: "S2027" },
] as const;

const CAMPUS_VENUE_LINKS = [
  { key: "north", label: "North" },
  { key: "downtown", label: "Downtown" },
  { key: "whitby", label: "Whitby" },
] as const;

interface ShortcutEntry {
  id: string;
  label: string;
  title: string;
  href: string;
  tone: ShortcutTone;
  imageUrl?: string;
  initials?: string;
  googleServiceId?: GoogleServiceId;
  isMeet?: boolean;
  badge?: string;
  onRemove?: () => void;
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

export function ClassicPortalView({
  termLabel,
  profile,
  profileDegreeName,
  profileMinorName,
  derivedProfileStartYear,
  degreeProgress,
  latestPlan,
  liveTimeLabel,
  freeRoomsTotal,
  quickBuildings,
  defaultShortcuts,
  googleShortcuts,
  customShortcuts,
  onOpenAddShortcut,
  onRemoveCustomShortcut,
  onOpenGoogleModal,
  onRemoveMeetShortcut,
}: ClassicPortalViewProps) {
  const shortcutEntries = useMemo<ShortcutEntry[]>(() => {
    const entries: ShortcutEntry[] = [];

    for (const item of defaultShortcuts) {
      const tone: ShortcutTone =
        item.id === "library"
          ? "emerald"
          : item.id === "canvas"
            ? "orange"
            : "blue";
      entries.push({
        id: `default-${item.id}`,
        label: item.label,
        title: item.title,
        href: item.href,
        tone,
        imageUrl: item.imageUrl,
      });
    }

    const showAccountTag = googleShortcuts.accounts.length > 1;
    for (const acct of googleShortcuts.accounts) {
      for (const svc of GOOGLE_SERVICES) {
        if (!acct.enabledServices.includes(svc.id)) continue;
        entries.push({
          id: `g-${acct.id}-${svc.id}`,
          label: svc.shortLabel,
          title: `${svc.label} — ${acct.label} (u/${acct.authIndex})`,
          href: svc.buildUrl(acct.authIndex),
          tone: "blue",
          googleServiceId: svc.id,
          badge: showAccountTag ? acct.label : undefined,
        });
      }
    }

    for (const meet of googleShortcuts.meetLinks) {
      const acct = googleShortcuts.accounts.find(
        (a) => a.id === meet.accountId,
      );
      const href = normalizeMeetUrl(meet.url, acct?.authIndex ?? 0);
      entries.push({
        id: `meet-${meet.id}`,
        label: meet.label,
        title: `${meet.label} (${href})`,
        href,
        tone: "emerald",
        isMeet: true,
        onRemove: () => onRemoveMeetShortcut(meet.id),
      });
    }

    for (const custom of customShortcuts) {
      entries.push({
        id: `custom-${custom.id}`,
        label: custom.label,
        title: `${custom.label} (${custom.url})`,
        href: custom.url,
        tone: "blue",
        initials: getInitials(custom.label),
        onRemove: () => onRemoveCustomShortcut(custom.id),
      });
    }

    return entries;
  }, [
    defaultShortcuts,
    googleShortcuts,
    customShortcuts,
    onRemoveMeetShortcut,
    onRemoveCustomShortcut,
  ]);

  const activeStudyYear = profile?.year_of_study ?? 3;

  return (
    <div className="mt-8 flex flex-1 flex-col justify-center pb-4">
      {/* Row 1: 3 Primary Tool Boxes */}
      <nav
        aria-label="Primary student tools"
        className="grid grid-cols-1 gap-5 md:grid-cols-3"
      >
        {/* 1. Course Schedules Card */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-xs transition-all duration-300 ease-out will-change-transform hover:-translate-y-2 hover:scale-[1.02] hover:border-[#003C71]/60 hover:ring-2 hover:ring-[#003C71]/15 hover:shadow-[0_24px_48px_-14px_rgba(0,60,113,0.32)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-sky-400/65 dark:hover:ring-sky-400/20 dark:hover:shadow-[0_24px_48px_-14px_rgba(56,189,248,0.28)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#003C71]/[0.06] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-sky-400/[0.1]"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#003C71]/10 text-[#003C71] ring-1 ring-[#003C71]/15 transition-all duration-300 ease-out group-hover:scale-110 group-hover:-rotate-3 group-hover:shadow-md dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20">
                <svg
                  className="h-5.5 w-5.5"
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

            <div className="mt-5 flex items-center justify-between gap-2">
              <Link
                href="/course-schedules"
                className="rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71]"
              >
                <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-[#003C71] dark:text-white dark:group-hover:text-sky-300">
                  Course Schedules
                </h2>
              </Link>
              <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-300 group-hover:translate-x-1.5 group-hover:text-[#003C71] dark:group-hover:text-sky-300" />
            </div>
          </div>

          <div className="relative mt-5 rounded-xl border border-slate-100 bg-slate-50/90 p-3 transition-colors duration-300 group-hover:border-[#003C71]/15 dark:border-slate-800 dark:bg-slate-950/60 dark:group-hover:border-sky-400/20">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <span>Schedules</span>
            </div>
            <div className="relative z-10 mt-2 flex items-center gap-1.5">
              {SCHEDULE_TERM_LINKS.map((term) => {
                const isActive = term.label === termLabel;
                return (
                  <Link
                    key={term.code}
                    href={`/course-schedules?term=${term.code}`}
                    title={term.label}
                    className={`whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:shadow-sm ${
                      isActive
                        ? "border-[#003C71]/30 bg-[#003C71]/8 text-[#003C71] hover:border-[#003C71] hover:bg-[#003C71] hover:text-white dark:border-sky-400/35 dark:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500 dark:hover:text-slate-950"
                        : "border-slate-200/90 bg-white text-slate-700 hover:border-[#003C71]/45 hover:bg-[#EBF3FC] hover:text-[#003C71] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-400/45 dark:hover:text-sky-300"
                    }`}
                  >
                    {term.shortLabel}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. Campus Map Card */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-xs transition-all duration-300 ease-out will-change-transform hover:-translate-y-2 hover:scale-[1.02] hover:border-emerald-500/65 hover:ring-2 hover:ring-emerald-500/15 hover:shadow-[0_24px_48px_-14px_rgba(16,185,129,0.32)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-emerald-400/65 dark:hover:ring-emerald-400/20 dark:hover:shadow-[0_24px_48px_-14px_rgba(52,211,153,0.26)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.06] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-emerald-400/[0.1]"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/20 transition-all duration-300 ease-out group-hover:scale-110 group-hover:-rotate-3 group-hover:shadow-md dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20">
                <svg
                  className="h-5.5 w-5.5"
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
                {freeRoomsTotal !== null ? (
                  <span className="tabular-nums">{freeRoomsTotal} Free Now</span>
                ) : (
                  "Live Room Availability"
                )}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <Link
                href="/campus-map?venue=north"
                className="rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-300">
                  Campus Map
                </h2>
              </Link>
              <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-300 group-hover:translate-x-1.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-300" />
            </div>
          </div>

          <div className="relative mt-5 rounded-xl border border-slate-100 bg-slate-50/90 p-3 transition-colors duration-300 group-hover:border-emerald-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:group-hover:border-emerald-400/20">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <span>Campuses</span>
              <span className="font-mono text-[10.5px] tabular-nums text-emerald-700 dark:text-emerald-300">
                {liveTimeLabel ?? "B – Fl 4"}
              </span>
            </div>
            <div className="relative z-10 mt-2 flex flex-wrap items-center gap-1.5">
              {CAMPUS_VENUE_LINKS.map((venue) => (
                <Link
                  key={venue.key}
                  href={`/campus-map?venue=${venue.key}`}
                  className="rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-emerald-500/50 hover:bg-emerald-50 hover:text-emerald-800 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-400/50 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300"
                >
                  {venue.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* 3. Degree Planner Card */}
        <Link
          href="/degree-planner"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-xs transition-all duration-300 ease-out will-change-transform hover:-translate-y-2 hover:scale-[1.02] hover:border-[#E75D2A]/65 hover:ring-2 hover:ring-[#E75D2A]/15 hover:shadow-[0_24px_48px_-14px_rgba(231,93,42,0.32)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-[#FF8B5E]/65 dark:hover:ring-[#FF8B5E]/20 dark:hover:shadow-[0_24px_48px_-14px_rgba(255,139,94,0.28)]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#E75D2A]/[0.06] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-[#FF8B5E]/[0.1]"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E75D2A]/12 text-[#C84A1B] ring-1 ring-[#E75D2A]/20 transition-all duration-300 ease-out group-hover:scale-110 group-hover:-rotate-3 group-hover:shadow-md dark:bg-[#E75D2A]/20 dark:text-[#FF8A5C] dark:ring-[#E75D2A]/30">
                <svg
                  className="h-5.5 w-5.5"
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

              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E75D2A]/25 bg-[#E75D2A]/10 px-2.5 py-1 text-[11px] font-semibold text-[#B84316] tabular-nums dark:border-[#E75D2A]/30 dark:bg-[#E75D2A]/20 dark:text-[#FFA27D]">
                {degreeProgress && degreeProgress.plannedCourses > 0
                  ? `${degreeProgress.percent}% Planned`
                  : "Prerequisite Pathways"}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-[#C84A1B] dark:text-white dark:group-hover:text-[#FF8A5C]">
                Degree Planner
              </h2>
              <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-300 group-hover:translate-x-1.5 group-hover:text-[#E75D2A] dark:group-hover:text-[#FF8A5C]" />
            </div>
          </div>

          <div className="relative mt-5 rounded-xl border border-slate-100 bg-slate-50/90 p-3 transition-colors duration-300 group-hover:border-[#E75D2A]/20 dark:border-slate-800 dark:bg-slate-950/60 dark:group-hover:border-[#FF8B5E]/25">
            {degreeProgress && degreeProgress.plannedCourses > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                  <span className="truncate text-slate-700 dark:text-slate-200">
                    {degreeProgress.title}
                  </span>
                  <span className="shrink-0 font-mono text-[#C84A1B] dark:text-[#FF8A5C]">
                    {degreeProgress.plannedCredits}/120 cr
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#003C71] to-[#E75D2A] transition-all duration-500"
                    style={{ width: `${Math.max(degreeProgress.percent, 6)}%` }}
                  />
                </div>
                <p className="mt-1.5 truncate text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
                  {degreeProgress.plannedCourses} courses
                  {profileMinorName ? ` · Minor: ${profileMinorName}` : ""}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <span className="truncate">
                    {latestPlan?.degree_name ||
                      profileDegreeName ||
                      "Term Progression"}
                  </span>
                  <span className="shrink-0 text-[#C84A1B] tabular-nums dark:text-[#FF8A5C]">
                    {latestPlan?.start_year || profile?.year_of_study
                      ? `Start ${latestPlan?.start_year ?? derivedProfileStartYear}`
                      : "120 Credits"}
                  </span>
                </div>
                {profileMinorName && (
                  <p className="mt-0.5 truncate text-[10.5px] font-medium text-[#003C71] dark:text-sky-300">
                    Minor: {profileMinorName}
                  </p>
                )}
                <div className="mt-2.5 flex items-center justify-between gap-1">
                  {[1, 2, 3, 4].map((yr, index) => {
                    const done = yr < activeStudyYear;
                    const current = yr === activeStudyYear;
                    return (
                      <React.Fragment key={yr}>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                            done
                              ? "bg-[#003C71] text-white dark:bg-sky-500"
                              : current
                                ? "border-2 border-[#E75D2A] bg-[#E75D2A]/15 text-[#C84A1B] dark:text-[#FF8A5C]"
                                : "border border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                          }`}
                        >
                          Y{yr}
                        </span>
                        {index < 3 && (
                          <div
                            className={`h-0.5 flex-1 rounded-full ${
                              yr + 1 < activeStudyYear
                                ? "bg-[#003C71] dark:bg-sky-500"
                                : yr + 1 === activeStudyYear
                                  ? "bg-gradient-to-r from-[#003C71] to-[#E75D2A]"
                                  : "bg-slate-200 dark:bg-slate-800"
                            }`}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </Link>
      </nav>

      {/* Row 2: Available Rooms Finder + Essential OTU Shortcuts */}
      <section
        aria-label="Available rooms and quick shortcuts"
        className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12"
      >
        {/* Left: Campus Pulse & Live Room Finder */}
        <div className="group/pulse relative flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-[#003C71] via-[#00305C] to-[#002244] p-6 text-white shadow-[0_18px_40px_-16px_rgba(0,60,113,0.45)] transition-all duration-300 ease-out will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:ring-2 hover:ring-sky-300/30 hover:shadow-[0_28px_56px_-14px_rgba(0,60,113,0.6)] lg:col-span-7 dark:hover:ring-sky-400/35 dark:hover:shadow-[0_28px_56px_-14px_rgba(56,189,248,0.28)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#E75D2A]/30 blur-3xl transition-transform duration-500 ease-out group-hover/pulse:scale-125"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 left-10 h-40 w-40 rounded-full bg-sky-400/15 blur-3xl transition-transform duration-500 ease-out group-hover/pulse:scale-125"
          />

          <div className="relative space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-100 backdrop-blur-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>Campus Pulse</span>
                {liveTimeLabel && (
                  <>
                    <span className="text-white/40">&bull;</span>
                    <span className="tabular-nums text-white">
                      {liveTimeLabel}
                    </span>
                  </>
                )}
              </div>

              {freeRoomsTotal !== null && (
                <span className="inline-flex items-center rounded-full border border-emerald-300/25 bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-100 tabular-nums">
                  {freeRoomsTotal} free right now
                </span>
              )}
            </div>

            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <h2 className="text-xl font-bold tracking-tight text-white">
                Need a quiet study spot right now?
              </h2>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link
                  href="/campus-map?building=LIB&filter=available&now=1"
                  className="group inline-flex items-center gap-2 rounded-xl bg-[#E75D2A] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-black/20 transition-all duration-200 ease-out hover:-translate-y-1 hover:scale-[1.03] hover:bg-[#F06835] hover:shadow-[0_14px_28px_-8px_rgba(231,93,42,0.58)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <span>Find a Library Room</span>
                  <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/campus-map?filter=available&now=1"
                  className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.03] hover:border-white/40 hover:bg-white/20 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  All Open Rooms
                </Link>
              </div>
            </div>
          </div>

          <div className="relative mt-5 border-t border-white/15 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-sky-100/85">
                Free rooms by building
              </span>
              <div className="flex flex-wrap gap-1.5">
                {quickBuildings.map((bldg) => (
                  <Link
                    key={bldg}
                    href={`/campus-map?building=${bldg}&filter=available&now=1`}
                    className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-105 hover:border-emerald-300/75 hover:bg-emerald-400/25 hover:shadow-sm"
                  >
                    {bldg}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Single-Click Essential OTU Shortcuts Grid */}
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-xs backdrop-blur-xs transition-all duration-300 ease-out will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:border-[#003C71]/45 hover:ring-2 hover:ring-[#003C71]/12 hover:shadow-[0_24px_48px_-14px_rgba(0,60,113,0.24)] lg:col-span-5 dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-sky-400/50 dark:hover:ring-sky-400/18 dark:hover:shadow-[0_24px_48px_-14px_rgba(56,189,248,0.22)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold tracking-wider text-slate-700 uppercase dark:text-slate-200">
                Essential OTU Shortcuts
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {shortcutEntries.length}{" "}
                {shortcutEntries.length === 1 ? "shortcut" : "shortcuts"}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenGoogleModal}
                title={
                  googleShortcuts.accounts.length > 0
                    ? "Edit Google accounts, services & Meet links"
                    : "Add Google school & personal shortcuts"
                }
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/90 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:border-[#003C71]/45 hover:bg-white hover:text-[#003C71] hover:shadow-xs dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-sky-400/50 dark:hover:bg-slate-800 dark:hover:text-sky-300"
              >
                <GoogleLogoIcon className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {googleShortcuts.accounts.length > 0
                    ? "Edit Google"
                    : "Add Google"}
                </span>
              </button>

              <button
                type="button"
                onClick={onOpenAddShortcut}
                title="Add custom shortcut"
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:border-[#003C71]/50 hover:bg-[#EBF3FC]/70 hover:text-[#003C71] hover:shadow-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-400/50 dark:hover:text-sky-300"
              >
                <span aria-hidden="true">+</span>
                <span>Add</span>
              </button>
            </div>
          </div>

          <div
            aria-label="Quick shortcuts"
            className="-m-1 grid max-h-[258px] grid-cols-3 gap-2.5 overflow-y-auto p-1.5 sm:grid-cols-4 lg:grid-cols-3"
          >
            {shortcutEntries.map((entry) => {
              const ringClass = SHORTCUT_RING_CLASSES[entry.tone];
              return (
                <div key={entry.id} className="group relative">
                  <a
                    href={entry.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={entry.title}
                    className="flex h-full flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200/85 bg-slate-50/75 px-2 py-3 text-center transition-all duration-200 ease-out will-change-transform hover:-translate-y-1 hover:scale-[1.05] hover:border-[#003C71]/50 hover:bg-white hover:shadow-[0_12px_24px_-8px_rgba(0,60,113,0.26)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71] dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-sky-400/55 dark:hover:bg-slate-800/90 dark:hover:shadow-[0_12px_24px_-8px_rgba(56,189,248,0.24)]"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border ${ringClass} bg-white shadow-2xs transition-transform duration-200 ease-out group-hover:scale-110 dark:bg-slate-900`}
                    >
                      {entry.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.imageUrl}
                          alt=""
                          aria-hidden="true"
                          className="h-full w-full object-cover object-center"
                        />
                      ) : entry.googleServiceId ? (
                        <GoogleServiceIcon
                          serviceId={entry.googleServiceId}
                          className="h-5 w-5"
                        />
                      ) : entry.isMeet ? (
                        <GoogleMeetIcon className="h-5 w-5" />
                      ) : (
                        <span className="text-[11px] font-bold text-[#003C71] dark:text-sky-200">
                          {entry.initials}
                        </span>
                      )}
                    </span>

                    <span className="w-full truncate text-[11.5px] font-semibold leading-tight text-slate-800 transition-colors group-hover:text-[#003C71] dark:text-slate-200 dark:group-hover:text-sky-300">
                      {entry.label}
                    </span>

                    {entry.badge && (
                      <span className="max-w-full truncate rounded-full bg-slate-200/75 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {entry.badge}
                      </span>
                    )}
                  </a>

                  {entry.onRemove && (
                    <button
                      type="button"
                      onClick={entry.onRemove}
                      aria-label={`Remove ${entry.label} shortcut`}
                      title="Remove shortcut"
                      className="absolute top-1 right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-bold text-slate-500 opacity-75 shadow-2xs transition hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                    >
                      &times;
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
