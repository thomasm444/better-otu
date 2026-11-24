"use client";

import Image from "next/image";
import Link from "next/link";
import {
  GoogleLogoIcon,
  GoogleMeetIcon,
  GoogleServiceIcon,
} from "@/app/_components/google-shortcuts-modal";
import type { ColorTheme } from "@/app/course-schedules/types";
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

export interface MiniScheduleBlock {
  id: string;
  dayIndex: 1 | 2 | 3 | 4 | 5;
  startMinutes: number;
  endMinutes: number;
  color: ColorTheme;
  courseCode: string;
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
  todayDayIndex: number | null;
  miniScheduleBlocks: MiniScheduleBlock[];
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
  emerald: "border-line",
  orange: "border-line",
  blue: "border-line",
};

const MINI_WEEKDAYS: ReadonlyArray<{ index: 1 | 2 | 3 | 4 | 5; label: string }> = [
  { index: 1, label: "Mon" },
  { index: 2, label: "Tue" },
  { index: 3, label: "Wed" },
  { index: 4, label: "Thu" },
  { index: 5, label: "Fri" },
];

const MINI_BLOCK_COLOR_CLASSES: Record<ColorTheme, string> = {
  blue: "bg-accent/85 dark:bg-accent/80",
  emerald: "bg-positive/85 dark:bg-positive/80",
  purple: "bg-violet-500/80 dark:bg-violet-400/80",
  amber: "bg-amber-500/80 dark:bg-amber-400/80",
  indigo: "bg-indigo-500/80 dark:bg-indigo-400/80",
  cyan: "bg-cyan-500/85 dark:bg-cyan-400/80",
  teal: "bg-teal-500/85 dark:bg-teal-400/80",
  orange: "bg-orange-500/80 dark:bg-orange-400/80",
  rose: "bg-rose-500/80 dark:bg-rose-400/80",
};

const FALLBACK_PREVIEW_BLOCKS: ReadonlyArray<{
  id: string;
  dayIndex: 1 | 2 | 3 | 4 | 5;
  topPct: number;
  heightPct: number;
  toneClass: string;
}> = [
  { id: "p-m1", dayIndex: 1, topPct: 12, heightPct: 24, toneClass: "bg-accent/30" },
  { id: "p-m2", dayIndex: 1, topPct: 50, heightPct: 22, toneClass: "bg-positive/30" },
  { id: "p-t1", dayIndex: 2, topPct: 24, heightPct: 28, toneClass: "bg-secondary-brand/35" },
  { id: "p-w1", dayIndex: 3, topPct: 12, heightPct: 24, toneClass: "bg-accent/30" },
  { id: "p-w2", dayIndex: 3, topPct: 56, heightPct: 26, toneClass: "bg-accent/22" },
  { id: "p-th1", dayIndex: 4, topPct: 24, heightPct: 28, toneClass: "bg-secondary-brand/35" },
  { id: "p-th2", dayIndex: 4, topPct: 62, heightPct: 20, toneClass: "bg-positive/30" },
  { id: "p-f1", dayIndex: 5, topPct: 18, heightPct: 26, toneClass: "bg-accent/30" },
];

const TIMELINE_START_MINUTES = 8 * 60; // 8:00 AM
const TIMELINE_SPAN_MINUTES = 12 * 60; // 8:00 AM – 8:00 PM

function MiniScheduleCalendarPreview({
  blocks,
  todayDayIndex,
}: {
  blocks: MiniScheduleBlock[];
  todayDayIndex: number | null;
}) {
  const hasRealSchedule = blocks.length > 0;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative mt-4 h-[76px] w-full overflow-hidden rounded-xl border border-line-subtle bg-surface-subtle p-1.5 select-none"
    >
      <div className="grid h-full grid-cols-5 gap-1">
        {MINI_WEEKDAYS.map((day) => {
          const isToday = todayDayIndex === day.index;
          const dayBlocks = hasRealSchedule
            ? blocks.filter((b) => b.dayIndex === day.index)
            : [];
          const fallbackBlocks = hasRealSchedule
            ? []
            : FALLBACK_PREVIEW_BLOCKS.filter((b) => b.dayIndex === day.index);

          return (
            <div
              key={day.index}
              className={`flex min-w-0 flex-col rounded-lg px-1 py-0.5 transition-colors ${
                isToday
                  ? "bg-accent-soft ring-1 ring-accent-line"
                  : "bg-surface/55 dark:bg-surface/35"
              }`}
            >
              <div className="flex items-center justify-center gap-0.5 leading-none">
                <span
                  className={`text-[9.5px] font-medium tracking-tight ${
                    isToday ? "font-semibold text-accent-ink" : "text-ink-muted"
                  }`}
                >
                  {day.label}
                </span>
                {isToday && (
                  <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                )}
              </div>

              <div className="relative mt-1 flex-1 overflow-hidden rounded-[4px]">
                {hasRealSchedule
                  ? dayBlocks.map((block) => {
                      const rawTop =
                        ((block.startMinutes - TIMELINE_START_MINUTES) /
                          TIMELINE_SPAN_MINUTES) *
                        100;
                      const rawHeight =
                        ((block.endMinutes - block.startMinutes) /
                          TIMELINE_SPAN_MINUTES) *
                        100;
                      const topPct = Math.max(2, Math.min(82, rawTop));
                      const heightPct = Math.max(
                        16,
                        Math.min(100 - topPct - 2, rawHeight),
                      );
                      return (
                        <span
                          key={block.id}
                          style={{
                            top: `${topPct}%`,
                            height: `${heightPct}%`,
                          }}
                          className={`absolute inset-x-0.5 rounded-[3px] ${MINI_BLOCK_COLOR_CLASSES[block.color]}`}
                        />
                      );
                    })
                  : fallbackBlocks.map((block) => (
                      <span
                        key={block.id}
                        style={{
                          top: `${block.topPct}%`,
                          height: `${block.heightPct}%`,
                        }}
                        className={`absolute inset-x-0.5 rounded-[3px] ${block.toneClass}`}
                      />
                    ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

function CampusMiniMapPreview() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative mt-4 h-[76px] w-full overflow-hidden rounded-xl border border-line-subtle bg-surface-subtle select-none"
    >
      <Image
        src="/images/north-campus-preview-light.svg"
        alt=""
        width={640}
        height={200}
        priority
        className="block h-full w-full object-cover object-center transition-transform duration-500 ease-[var(--ease-standard)] group-hover:scale-[1.04] dark:hidden"
      />
      <Image
        src="/images/north-campus-preview-dark.svg"
        alt=""
        width={640}
        height={200}
        priority
        className="hidden h-full w-full object-cover object-center transition-transform duration-500 ease-[var(--ease-standard)] group-hover:scale-[1.04] dark:block"
      />

      {/* Subtle campus preview overlay badge */}
      <div className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 rounded-md border border-line/75 bg-surface/90 px-2 py-0.5 text-[10px] font-medium text-ink-secondary shadow-[var(--shadow-sm)] backdrop-blur-[2px]">
        <span>Preview</span>
        <span className="opacity-45">&bull;</span>
        <span>North Campus</span>
      </div>
    </div>
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
  todayDayIndex,
  miniScheduleBlocks,
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

  return (
    <div className="mt-8 flex flex-1 flex-col justify-center pb-4">
      {/* Row 1: 3 Primary Tool Boxes */}
      <nav
        aria-label="Primary student tools"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        {/* 1. Course Schedules Card */}
        <Link
          href="/course-schedules"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-2 hover:scale-[1.02] hover:border-accent-line hover:ring-2 hover:ring-accent/15 hover:shadow-[var(--shadow-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.07] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-subtle text-ink-secondary transition-all duration-300 ease-[var(--ease-standard)] group-hover:scale-110 group-hover:-rotate-3 group-hover:bg-accent-soft group-hover:text-accent-ink group-hover:shadow-[var(--shadow-sm)]">
                <svg
                  className="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
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

              <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {termLabel}
              </span>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-accent-ink">
                Course Schedules
              </h2>
              <ArrowRightIcon className="h-4 w-4 text-ink-muted transition-all duration-300 group-hover:translate-x-1.5 group-hover:text-accent-ink" />
            </div>
          </div>

          <MiniScheduleCalendarPreview
            blocks={miniScheduleBlocks}
            todayDayIndex={todayDayIndex}
          />
        </Link>

        {/* 2. Campus Map Card */}
        <Link
          href="/campus-map"
          className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-2 hover:scale-[1.02] hover:border-positive-line hover:ring-2 hover:ring-positive/15 hover:shadow-[var(--shadow-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-positive/[0.07] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-subtle text-ink-secondary transition-all duration-300 ease-[var(--ease-standard)] group-hover:scale-110 group-hover:-rotate-3 group-hover:bg-positive-soft group-hover:text-positive group-hover:shadow-[var(--shadow-sm)]">
                <svg
                  className="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-md border border-positive-line bg-positive-soft px-2 py-1 text-xs font-medium text-positive">
                <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                {freeRoomsTotal !== null ? (
                  <span className="tabular-nums">{freeRoomsTotal} free now</span>
                ) : (
                  "Live room availability"
                )}
              </span>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-positive">
                Campus Map
              </h2>
              <ArrowRightIcon className="h-4 w-4 text-ink-muted transition-all duration-300 group-hover:translate-x-1.5 group-hover:text-positive" />
            </div>
          </div>

          <CampusMiniMapPreview />
        </Link>

        {/* 3. Degree Planner Card */}
        <Link
          href="/degree-planner"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-2 hover:scale-[1.02] hover:border-accent-line hover:ring-2 hover:ring-accent/15 hover:shadow-[var(--shadow-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.07] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-subtle text-ink-secondary transition-all duration-300 ease-[var(--ease-standard)] group-hover:scale-110 group-hover:-rotate-3 group-hover:bg-accent-soft group-hover:text-accent-ink group-hover:shadow-[var(--shadow-sm)]">
                <svg
                  className="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
                  <path d="M22 10v6" />
                  <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
                </svg>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-1 font-mono text-xs font-medium text-ink-secondary tabular-nums">
                {degreeProgress && degreeProgress.plannedCourses > 0
                  ? `${degreeProgress.percent}% planned`
                  : "Prerequisites"}
              </span>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-accent-ink">
                Degree Planner
              </h2>
              <ArrowRightIcon className="h-4 w-4 text-ink-muted transition-all duration-300 group-hover:translate-x-1.5 group-hover:text-accent-ink" />
            </div>
          </div>

          <div className="relative mt-4 rounded-xl bg-surface-subtle p-3">
            {degreeProgress && degreeProgress.plannedCourses > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2 text-xs font-medium">
                  <span className="truncate text-ink">
                    {degreeProgress.title}
                  </span>
                  <span className="shrink-0 font-mono text-emerald-600 tabular-nums dark:text-emerald-400">
                    {degreeProgress.plannedCredits}/120 cr
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/85 ring-1 ring-inset ring-slate-300/40 dark:bg-slate-900 dark:ring-slate-700/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 via-teal-400 to-emerald-400"
                    style={{ width: `${Math.max(degreeProgress.percent, 6)}%` }}
                  />
                </div>
                <p className="mt-1.5 truncate text-[11px] text-ink-muted">
                  {degreeProgress.plannedCourses} courses
                  {profileMinorName ? ` · Minor: ${profileMinorName}` : ""}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 text-xs font-medium">
                  <span className="truncate text-ink">
                    {latestPlan?.degree_name ||
                      profileDegreeName ||
                      "Program roadmap"}
                  </span>
                  <span className="shrink-0 font-mono text-emerald-600 tabular-nums dark:text-emerald-400">
                    0/120 cr
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/85 ring-1 ring-inset ring-slate-300/40 dark:bg-slate-900 dark:ring-slate-700/60">
                  <div className="h-full w-0 rounded-full bg-gradient-to-r from-sky-400 via-teal-400 to-emerald-400" />
                </div>
                <p className="mt-1.5 truncate text-[11px] text-ink-muted">
                  {latestPlan?.start_year || profile?.year_of_study
                    ? `Start ${latestPlan?.start_year ?? derivedProfileStartYear}`
                    : "Track prerequisites & credits"}
                  {profileMinorName ? ` · Minor: ${profileMinorName}` : ""}
                </p>
              </>
            )}
          </div>
        </Link>
      </nav>

      {/* Row 2: Available Rooms Finder + Essential OTU Shortcuts */}
      <section
        aria-label="Available rooms and quick shortcuts"
        className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12"
      >
        {/* Left: Campus Pulse & Live Room Finder (branded navy/teal moment) */}
        <div className="group/pulse relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[#1f2545] bg-[#1f2545] p-6 text-[#edf3f7] shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:border-accent-line hover:ring-2 hover:ring-accent/25 hover:shadow-[var(--shadow-lg)] dark:border-line-strong dark:bg-surface dark:text-ink lg:col-span-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.12] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover/pulse:opacity-100"
          />
          <div className="relative space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-[#bfd5e2] dark:border-line dark:bg-surface-subtle dark:text-ink-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                <span>Campus Pulse</span>
                {liveTimeLabel && (
                  <>
                    <span className="opacity-45">&bull;</span>
                    <span className="font-mono tabular-nums text-white dark:text-ink">
                      {liveTimeLabel}
                    </span>
                  </>
                )}
              </div>

              {freeRoomsTotal !== null && (
                <span className="inline-flex items-center rounded-md border border-white/15 bg-white/10 px-2.5 py-1 font-mono text-xs font-medium text-[#edf3f7] tabular-nums dark:border-positive-line dark:bg-positive-soft dark:text-positive">
                  {freeRoomsTotal} free right now
                </span>
              )}
            </div>

            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <h2 className="text-xl font-semibold tracking-tight text-white dark:text-ink">
                Need a quiet study spot right now?
              </h2>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link
                  href="/campus-map?building=LIB&filter=available&now=1"
                  className="group/cta inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-fg shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:bg-accent-hover hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span>Find a library room</span>
                  <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover/cta:translate-x-1" />
                </Link>
                <Link
                  href="/campus-map?filter=available&now=1"
                  className="inline-flex items-center rounded-lg border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white dark:border-line dark:bg-surface-subtle dark:text-ink dark:hover:border-accent-line dark:hover:bg-surface-hover"
                >
                  All open rooms
                </Link>
              </div>
            </div>
          </div>

          <div className="relative mt-5 border-t border-white/12 pt-4 dark:border-line-subtle">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[#bfd5e2] dark:text-ink-muted">
                Free rooms by building
              </span>
              <div className="flex flex-wrap gap-1.5">
                {quickBuildings.map((bldg) => (
                  <Link
                    key={bldg}
                    href={`/campus-map?building=${bldg}&filter=available&now=1`}
                    className="rounded-md border border-white/18 bg-white/10 px-2 py-0.5 font-mono text-xs font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-accent hover:bg-accent hover:text-accent-fg hover:shadow-[var(--shadow-sm)] dark:border-line dark:bg-surface-subtle dark:text-ink-secondary dark:hover:border-accent-line dark:hover:bg-accent-soft dark:hover:text-accent-ink"
                  >
                    {bldg}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Single-Click Essential OTU Shortcuts Grid */}
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:border-accent-line hover:ring-2 hover:ring-accent/15 hover:shadow-[var(--shadow-lg)] lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-ink">
                Essential OTU shortcuts
              </h2>
              <p className="text-xs text-ink-muted tabular-nums">
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
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface-subtle px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:border-accent-line hover:text-ink hover:shadow-[var(--shadow-sm)]"
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
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink hover:shadow-[var(--shadow-sm)]"
              >
                <span aria-hidden="true">+</span>
                <span>Add</span>
              </button>
            </div>
          </div>

          <div
            aria-label="Quick shortcuts"
            className="-m-1 grid max-h-[258px] grid-cols-3 gap-2 overflow-y-auto p-1.5 sm:grid-cols-4 lg:grid-cols-3"
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
                    className="flex h-full flex-col items-center justify-center gap-1.5 rounded-xl border border-line-subtle bg-surface-subtle/60 px-2 py-3 text-center transition-all duration-200 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1 hover:scale-[1.05] hover:border-accent-line hover:bg-surface hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border ${ringClass} bg-surface transition-transform duration-200 ease-[var(--ease-standard)] group-hover:scale-110`}
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
                        <span className="font-mono text-xs font-medium text-accent-ink">
                          {entry.initials}
                        </span>
                      )}
                    </span>

                    <span className="w-full truncate text-xs font-medium leading-tight text-ink-secondary transition-colors group-hover:text-ink">
                      {entry.label}
                    </span>

                    {entry.badge && (
                      <span className="max-w-full truncate rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
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
                      className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-xs text-ink-muted opacity-75 transition-opacity hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
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
