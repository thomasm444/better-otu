"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";

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
  savedCourseCodes: string[];
  visibleCourseCodes: string[];
  degreeProgress: DegreeProgressSummary | null;
  latestPlan: DegreePlanRecord | null;
  nowLabel: string | null;
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

type OrbTone = "emerald" | "orange" | "blue" | "violet";

const ORB_ACCENTS: Record<
  OrbTone,
  {
    ring: string;
    bg: string;
    stem: string;
  }
> = {
  emerald: {
    ring: "border-emerald-300/80 dark:border-emerald-500/40",
    bg: "bg-emerald-50/90 dark:bg-emerald-950/60",
    stem: "stroke-emerald-400/60 dark:stroke-emerald-400/45",
  },
  orange: {
    ring: "border-[#E75D2A]/35 dark:border-[#E75D2A]/45",
    bg: "bg-[#FFF3EE] dark:bg-[#E75D2A]/15",
    stem: "stroke-[#E75D2A]/55 dark:stroke-[#FF8A5C]/45",
  },
  blue: {
    ring: "border-[#9AC0EB] dark:border-sky-500/40",
    bg: "bg-[#EBF3FC] dark:bg-sky-950/60",
    stem: "stroke-[#003C71]/45 dark:stroke-sky-400/45",
  },
  violet: {
    ring: "border-violet-300/80 dark:border-violet-500/40",
    bg: "bg-violet-50/90 dark:bg-violet-950/50",
    stem: "stroke-violet-400/55 dark:stroke-violet-400/45",
  },
};

type BloomEntry =
  | {
      kind: "link";
      id: string;
      label: string;
      title: string;
      href: string;
      tone: OrbTone;
      imageUrl?: string;
      initials?: string;
      googleServiceId?: GoogleServiceId;
      isMeet?: boolean;
      badge?: string;
      onRemove?: () => void;
    }
  | {
      kind: "action";
      id: string;
      label: string;
      title: string;
      tone: OrbTone;
      actionType: "google" | "add";
      onClick: () => void;
    };

function getInitials(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) return "?";
  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 3).toUpperCase();
}

function getRadialOffset(index: number, total: number) {
  const startAngle = total === 6 ? -Math.PI / 3 : -Math.PI / 2;
  const angle = startAngle + (index / Math.max(total, 1)) * Math.PI * 2;
  const cos = Number(Math.cos(angle).toFixed(3));
  const sin = Number(Math.sin(angle).toFixed(3));
  return {
    xCss: `calc(${cos} * min(28vw, 114px))`,
    yPx: Math.round(sin * 86),
    lineX: Math.round(cos * 112),
    lineY: Math.round(sin * 86),
  };
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
  savedCourseCodes,
  visibleCourseCodes,
  degreeProgress,
  latestPlan,
  nowLabel,
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shortcutsOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (
        shortcutsRef.current &&
        !shortcutsRef.current.contains(event.target as Node)
      ) {
        setShortcutsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShortcutsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shortcutsOpen]);

  const bloomEntries = useMemo<BloomEntry[]>(() => {
    const entries: BloomEntry[] = [];

    for (const item of defaultShortcuts) {
      const tone: OrbTone =
        item.id === "library"
          ? "emerald"
          : item.id === "canvas"
            ? "orange"
            : "blue";
      entries.push({
        kind: "link",
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
          kind: "link",
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
        kind: "link",
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
        kind: "link",
        id: `custom-${custom.id}`,
        label: custom.label,
        title: `${custom.label} (${custom.url})`,
        href: custom.url,
        tone: "blue",
        initials: getInitials(custom.label),
        onRemove: () => onRemoveCustomShortcut(custom.id),
      });
    }

    entries.push({
      kind: "action",
      id: "action-google",
      label: googleShortcuts.accounts.length > 0 ? "Google" : "Add Google",
      title:
        googleShortcuts.accounts.length > 0
          ? "Manage Google accounts, services & Meet links"
          : "Add Google school & personal shortcuts",
      tone: "blue",
      actionType: "google",
      onClick: onOpenGoogleModal,
    });

    entries.push({
      kind: "action",
      id: "action-add",
      label: "Add",
      title: "Add custom shortcut",
      tone: "violet",
      actionType: "add",
      onClick: onOpenAddShortcut,
    });

    return entries;
  }, [
    defaultShortcuts,
    googleShortcuts,
    customShortcuts,
    onOpenGoogleModal,
    onOpenAddShortcut,
    onRemoveMeetShortcut,
    onRemoveCustomShortcut,
  ]);

  const linkCount = bloomEntries.filter((e) => e.kind === "link").length;
  const useRadialBloom = bloomEntries.length <= 6;
  const activeStudyYear = profile?.year_of_study ?? 3;
  const pulseTimeText = liveTimeLabel ?? nowLabel;

  return (
    <div className="mt-8 flex flex-1 flex-col justify-center pb-4">
      {/* Row 1: 3 Primary Tool Boxes */}
      <nav
        aria-label="Primary student tools"
        className="grid grid-cols-1 gap-5 md:grid-cols-3"
      >
        {/* 1. Course Schedules Card */}
        <Link
          href="/course-schedules"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-xs transition-all duration-200 hover:-translate-y-1 hover:border-[#003C71]/40 hover:shadow-[0_18px_38px_-14px_rgba(0,60,113,0.22)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-sky-400/45 dark:hover:shadow-[0_18px_38px_-14px_rgba(56,189,248,0.2)]"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#003C71]/10 text-[#003C71] ring-1 ring-[#003C71]/15 transition-transform duration-200 group-hover:scale-105 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20">
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
              <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-[#003C71] dark:text-white dark:group-hover:text-sky-300">
                Course Schedules
              </h2>
              <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-[#003C71] dark:group-hover:text-sky-300" />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            {visibleCourseCodes.length > 0 ? (
              <>
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <span>Saved Courses</span>
                  <span className="tabular-nums text-[#003C71] dark:text-sky-300">
                    {savedCourseCodes.length}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {visibleCourseCodes.map((code) => (
                    <span
                      key={code}
                      className="rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-2xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {code}
                    </span>
                  ))}
                  {savedCourseCodes.length > 4 && (
                    <span className="rounded-md bg-[#003C71]/10 px-2 py-0.5 text-[11px] font-semibold text-[#003C71] dark:bg-sky-500/20 dark:text-sky-200">
                      +{savedCourseCodes.length - 4} more
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <span>Bi-weekly Grid</span>
                  <span className="text-[#003C71] dark:text-sky-300">
                    W1 &bull; W2 Sync
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  <div className="space-y-1">
                    <div className="h-2.5 rounded-xs bg-[#003C71]/80 dark:bg-sky-400/80" />
                    <div className="h-1.5 rounded-xs bg-slate-200 dark:bg-slate-800" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-xs bg-slate-200 dark:bg-slate-800" />
                    <div className="h-2.5 rounded-xs bg-emerald-500/80" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-2.5 rounded-xs bg-[#003C71]/80 dark:bg-sky-400/80" />
                    <div className="h-2 rounded-xs bg-[#E75D2A]/80" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 rounded-xs bg-indigo-500/75" />
                    <div className="h-1.5 rounded-xs bg-slate-200 dark:bg-slate-800" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-2.5 rounded-xs bg-emerald-500/75" />
                    <div className="h-1.5 rounded-xs bg-slate-200 dark:bg-slate-800" />
                  </div>
                </div>
              </>
            )}
          </div>
        </Link>

        {/* 2. Campus Map Card */}
        <Link
          href="/campus-map?venue=north"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-xs transition-all duration-200 hover:-translate-y-1 hover:border-emerald-500/45 hover:shadow-[0_18px_38px_-14px_rgba(16,185,129,0.22)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-emerald-400/45"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/20 transition-transform duration-200 group-hover:scale-105 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20">
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
              <h2 className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-300">
                Campus Map
              </h2>
              <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-300" />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <span>North Campus</span>
              <span className="font-mono text-[10.5px] text-emerald-700 dark:text-emerald-300">
                {nowLabel ?? "B – Fl 4"}
              </span>
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

        {/* 3. Degree Planner Card */}
        <Link
          href="/degree-planner"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-xs backdrop-blur-xs transition-all duration-200 hover:-translate-y-1 hover:border-[#E75D2A]/45 hover:shadow-[0_18px_38px_-14px_rgba(231,93,42,0.22)] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-[#FF8B5E]/45"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E75D2A]/12 text-[#C84A1B] ring-1 ring-[#E75D2A]/20 transition-transform duration-200 group-hover:scale-105 dark:bg-[#E75D2A]/20 dark:text-[#FF8A5C] dark:ring-[#E75D2A]/30">
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
              <ArrowRightIcon className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-[#E75D2A] dark:group-hover:text-[#FF8A5C]" />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
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

      {/* Row 2: Available Rooms Finder + Essential OTU Shortcuts Bloom Hub */}
      <section
        aria-label="Available rooms and quick shortcuts"
        className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12"
      >
        {/* Left: Campus Pulse & Live Room Finder */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-[#003C71] via-[#00305C] to-[#002244] p-6 text-white shadow-[0_18px_40px_-16px_rgba(0,60,113,0.45)] lg:col-span-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#E75D2A]/30 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 left-10 h-40 w-40 rounded-full bg-sky-400/15 blur-3xl"
          />

          <div className="relative space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-100 backdrop-blur-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>Campus Pulse</span>
                {pulseTimeText && (
                  <>
                    <span className="text-white/40">&bull;</span>
                    <span className="tabular-nums text-white">
                      {pulseTimeText}
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
                  className="group inline-flex items-center gap-2 rounded-xl bg-[#E75D2A] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#F06835] hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <span>Find a Library Room</span>
                  <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/campus-map?filter=available&now=1"
                  className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
                    className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white transition-colors hover:border-emerald-300/60 hover:bg-emerald-400/20"
                  >
                    {bldg}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Single Essential OTU Shortcuts Bloom Hub */}
        <div
          ref={shortcutsRef}
          className="relative flex min-h-[290px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-xs backdrop-blur-xs lg:col-span-5 dark:border-slate-800 dark:bg-slate-900/90"
        >
          {shortcutsOpen && !useRadialBloom ? (
            <div className="flex h-full w-full flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-bold tracking-wider text-slate-700 uppercase dark:text-slate-200">
                    Essential OTU Shortcuts
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {linkCount} active shortcuts
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShortcutsOpen(false)}
                  aria-label="Close Essential OTU Shortcuts"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid max-h-[214px] grid-cols-4 gap-3 overflow-y-auto px-1 py-1">
                {bloomEntries.map((entry) => {
                  const accent = ORB_ACCENTS[entry.tone];
                  if (entry.kind === "action") {
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={entry.onClick}
                        title={entry.title}
                        className="group flex flex-col items-center gap-1.5 text-center"
                      >
                        <span
                          className={`flex h-12 w-12 items-center justify-center rounded-full border border-dashed ${accent.ring} ${accent.bg} shadow-2xs transition-transform duration-150 group-hover:-translate-y-0.5`}
                        >
                          {entry.actionType === "google" ? (
                            <GoogleLogoIcon className="h-5 w-5" />
                          ) : (
                            <svg
                              className="h-5 w-5 text-violet-700 dark:text-violet-300"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              aria-hidden="true"
                            >
                              <path d="M12 5v14" />
                              <path d="M5 12h14" />
                            </svg>
                          )}
                        </span>
                        <span className="max-w-[68px] truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          {entry.label}
                        </span>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={entry.id}
                      className="group relative flex flex-col items-center gap-1.5 text-center"
                    >
                      <a
                        href={entry.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={entry.title}
                        className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border ${accent.ring} bg-white shadow-2xs transition-transform duration-150 group-hover:-translate-y-0.5 dark:bg-slate-950`}
                      >
                        {entry.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={entry.imageUrl}
                            alt={entry.title}
                            className="h-full w-full object-cover object-center"
                          />
                        ) : entry.googleServiceId ? (
                          <GoogleServiceIcon
                            serviceId={entry.googleServiceId}
                            className="h-5.5 w-5.5"
                          />
                        ) : entry.isMeet ? (
                          <GoogleMeetIcon className="h-5.5 w-5.5" />
                        ) : (
                          <span className="text-xs font-bold text-[#003C71] dark:text-sky-200">
                            {entry.initials}
                          </span>
                        )}
                      </a>

                      {entry.badge && (
                        <span className="pointer-events-none absolute top-8 right-1 rounded-full border border-slate-200 bg-white px-1 text-[9px] font-bold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {entry.badge}
                        </span>
                      )}

                      {entry.onRemove && (
                        <button
                          type="button"
                          onClick={entry.onRemove}
                          aria-label={`Remove ${entry.label} shortcut`}
                          title="Remove shortcut"
                          className="absolute -top-1 right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-bold text-slate-500 opacity-0 shadow-xs transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          &times;
                        </button>
                      )}

                      <span className="max-w-[68px] truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        {entry.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="relative h-[258px] w-full">
              {/* Soft orbital dashed ring & tint glow */}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute top-1/2 left-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-slate-200/90 transition-all duration-500 dark:border-slate-800 ${
                  shortcutsOpen
                    ? "scale-125 rotate-45 opacity-100"
                    : "scale-80 rotate-0 opacity-70"
                }`}
              />
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute top-1/2 left-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-[#003C71]/12 via-emerald-500/10 to-[#E75D2A]/12 blur-xl transition-all duration-500 ${
                  shortcutsOpen
                    ? "scale-150 opacity-100"
                    : "scale-95 opacity-75"
                }`}
              />

              {/* Animated stems connecting center hub to radial petals */}
              <svg
                aria-hidden="true"
                viewBox="-160 -120 320 240"
                className="pointer-events-none absolute top-1/2 left-1/2 h-[240px] w-[320px] -translate-x-1/2 -translate-y-1/2"
              >
                {bloomEntries.map((entry, index) => {
                  const pos = getRadialOffset(index, bloomEntries.length);
                  const accent = ORB_ACCENTS[entry.tone];
                  return (
                    <line
                      key={entry.id}
                      x1="0"
                      y1="0"
                      x2={shortcutsOpen ? pos.lineX : 0}
                      y2={shortcutsOpen ? pos.lineY : 0}
                      strokeWidth="1.5"
                      strokeDasharray="3 5"
                      className={`${accent.stem} transition-all duration-300`}
                      style={{
                        opacity: shortcutsOpen ? 0.9 : 0,
                        transitionDelay: shortcutsOpen
                          ? `${index * 40}ms`
                          : "0ms",
                      }}
                    />
                  );
                })}
              </svg>

              {/* Radial Petals */}
              {bloomEntries.map((entry, index) => {
                const pos = getRadialOffset(index, bloomEntries.length);
                const accent = ORB_ACCENTS[entry.tone];
                const sharedWrapperClass = `group absolute top-1/2 left-1/2 z-10 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  shortcutsOpen
                    ? "pointer-events-auto opacity-100"
                    : "pointer-events-none opacity-0"
                }`;
                const sharedTransform = {
                  transform: shortcutsOpen
                    ? `translate(calc(-50% + ${pos.xCss}), calc(-50% + ${pos.yPx}px)) scale(1)`
                    : "translate(-50%, -50%) scale(0.3)",
                  transitionDelay: shortcutsOpen
                    ? `${index * 45}ms`
                    : `${(bloomEntries.length - 1 - index) * 25}ms`,
                };

                if (entry.kind === "action") {
                  return (
                    <div
                      key={entry.id}
                      className={sharedWrapperClass}
                      style={sharedTransform}
                    >
                      <button
                        type="button"
                        tabIndex={shortcutsOpen ? 0 : -1}
                        aria-hidden={!shortcutsOpen}
                        onClick={entry.onClick}
                        title={entry.title}
                        className={`flex h-[74px] w-[74px] flex-col items-center justify-center gap-1 rounded-full border border-dashed ${accent.ring} ${accent.bg} px-1.5 text-center shadow-sm transition-transform duration-150 hover:scale-108 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71]`}
                      >
                        {entry.actionType === "google" ? (
                          <GoogleLogoIcon className="h-5.5 w-5.5" />
                        ) : (
                          <svg
                            className="h-5 w-5 text-violet-700 dark:text-violet-300"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.3"
                            strokeLinecap="round"
                            aria-hidden="true"
                          >
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        )}
                        <span className="max-w-[60px] truncate text-[10px] leading-tight font-bold text-slate-800 dark:text-slate-100">
                          {entry.label}
                        </span>
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={entry.id}
                    className={sharedWrapperClass}
                    style={sharedTransform}
                  >
                    <a
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      tabIndex={shortcutsOpen ? 0 : -1}
                      aria-hidden={!shortcutsOpen}
                      title={entry.title}
                      className={`relative flex h-[74px] w-[74px] flex-col items-center justify-center gap-1 rounded-full border ${accent.ring} bg-white px-1.5 text-center shadow-sm transition-transform duration-150 hover:scale-108 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71] dark:bg-slate-900`}
                    >
                      {entry.imageUrl ? (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-slate-200 dark:ring-slate-700">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={entry.imageUrl}
                            alt=""
                            aria-hidden="true"
                            className="h-full w-full object-cover object-center"
                          />
                        </span>
                      ) : entry.googleServiceId ? (
                        <GoogleServiceIcon
                          serviceId={entry.googleServiceId}
                          className="h-6 w-6"
                        />
                      ) : entry.isMeet ? (
                        <GoogleMeetIcon className="h-6 w-6" />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#DCEBFA] text-[10px] font-bold text-[#003C71] dark:bg-sky-900/60 dark:text-sky-200">
                          {entry.initials}
                        </span>
                      )}

                      <span className="max-w-[62px] truncate text-[10px] leading-tight font-bold text-slate-800 dark:text-slate-100">
                        {entry.label}
                      </span>
                    </a>

                    {entry.onRemove && (
                      <button
                        type="button"
                        tabIndex={shortcutsOpen ? 0 : -1}
                        onClick={entry.onRemove}
                        aria-label={`Remove ${entry.label} shortcut`}
                        title="Remove shortcut"
                        className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 opacity-0 shadow-xs transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Center Hub Orb */}
              <button
                type="button"
                onClick={() => setShortcutsOpen((open) => !open)}
                aria-expanded={shortcutsOpen}
                aria-label={
                  shortcutsOpen
                    ? "Close Essential OTU Shortcuts"
                    : "Open Essential OTU Shortcuts"
                }
                className={`group absolute top-1/2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border px-2 text-center shadow-md transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71] ${
                  shortcutsOpen
                    ? "h-20 w-20 border-[#003C71]/35 bg-[#003C71] text-white shadow-[0_12px_28px_-10px_rgba(0,60,113,0.55)] dark:border-sky-400/40 dark:bg-sky-600"
                    : "h-[104px] w-[104px] border-slate-200 bg-white text-slate-900 hover:scale-105 hover:border-[#003C71]/35 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-sky-400/40"
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
                      <circle cx="7" cy="7" r="3.6" fill="#10B981" />
                      <circle cx="17" cy="7" r="3.6" fill="#E75D2A" />
                      <circle cx="17" cy="17" r="3.6" fill="#0A5AA3" />
                      <circle cx="7" cy="17" r="3.6" fill="#7C3AED" />
                    </svg>
                  )}
                </span>

                <span
                  className={`leading-tight font-bold ${
                    shortcutsOpen ? "text-[10px]" : "text-[10.5px]"
                  }`}
                >
                  {shortcutsOpen ? "Close" : "Essential OTU Shortcuts"}
                </span>
              </button>

              {!shortcutsOpen && (
                <p className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {linkCount} shortcuts &bull; Click to expand
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
