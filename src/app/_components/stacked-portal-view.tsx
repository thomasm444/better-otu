"use client";

import Link from "next/link";
import React from "react";

import {
  GoogleLogoIcon,
  GoogleMeetIcon,
  GoogleServiceIcon,
} from "@/app/_components/google-shortcuts-modal";
import type {
  CustomShortcutItem,
  DefaultShortcutItem,
  DegreeProgressSummary,
} from "@/app/_components/classic-portal-view";
import type { DegreePlanRecord } from "@/lib/degree-plan-storage";
import {
  GOOGLE_SERVICES,
  normalizeMeetUrl,
  type GoogleShortcutsState,
} from "@/lib/google-shortcuts";

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

function getInitials(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) return "?";
  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 3).toUpperCase();
}

export interface StackedPortalViewProps {
  termLabel: string;
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

export function StackedPortalView({
  termLabel,
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
}: StackedPortalViewProps) {
  return (
    <div className="mx-auto my-auto flex w-full max-w-3xl flex-col items-center py-8 sm:py-12">
      <div className="w-full space-y-5">
        {/* CARD 1: Course Schedule | Schedule & Timetable Preview + Term Pills */}
        <div className="group relative flex flex-col overflow-hidden rounded-[26px] border border-[#BFD7F2] bg-[#DCEBFA]/75 shadow-[0_6px_24px_-12px_rgba(0,60,113,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#003C71]/40 hover:bg-[#D4E6F9]/90 hover:shadow-[0_14px_32px_-14px_rgba(0,60,113,0.26)] sm:min-h-[126px] sm:flex-row dark:border-slate-700/80 dark:bg-slate-900/85 dark:hover:border-sky-400/50 dark:hover:bg-slate-900">
          {/* Left Section: Title */}
          <div className="flex shrink-0 flex-col items-center justify-center border-b border-[#B7D1EE] px-6 py-5 text-center sm:w-[32%] sm:rounded-r-[26px] sm:border-b-0 sm:border-r dark:border-slate-700/80">
            <div className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-[#003C71] shadow-2xs ring-1 ring-[#003C71]/10 transition-transform duration-200 group-hover:scale-105 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20">
              <svg
                className="h-4.5 w-4.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect width="18" height="18" x="3" y="4" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </div>
            <Link
              href="/course-schedules"
              className="rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003C71]"
            >
              <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
                Course Schedule
              </span>
            </Link>
            <span className="mt-0.5 text-[11px] font-medium text-[#003C71]/80 dark:text-sky-300/80">
              {termLabel}
            </span>
          </div>

          {/* Right Section: Preview + Classic Term Pills */}
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-5 text-center sm:px-8">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Bi-weekly timetable &amp; section lookup
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              View Week 1 &amp; Week 2 classes, check rooms, and add{" "}
              {termLabel} CRNs
            </p>

            <div className="relative z-10 mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {SCHEDULE_TERM_LINKS.map((term) => {
                const isActive = term.label === termLabel;
                return (
                  <Link
                    key={term.code}
                    href={`/course-schedules?term=${term.code}`}
                    title={term.label}
                    className={`whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold shadow-2xs transition-colors ${
                      isActive
                        ? "border-[#003C71]/30 bg-white/95 text-[#003C71] hover:border-[#003C71] hover:bg-[#003C71] hover:text-white dark:border-sky-400/35 dark:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500 dark:hover:text-slate-950"
                        : "border-white/80 bg-white/80 text-slate-700 hover:border-[#003C71]/45 hover:bg-white hover:text-[#003C71] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-400/45 dark:hover:text-sky-300"
                    }`}
                  >
                    {term.shortLabel}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* CARD 2: Degree Planner | Progress Bar & Roadmap */}
        <Link
          href="/degree-planner"
          className="group flex flex-col overflow-hidden rounded-[26px] border border-[#BFD7F2] bg-[#DCEBFA]/75 shadow-[0_6px_24px_-12px_rgba(0,60,113,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#003C71]/40 hover:bg-[#D4E6F9]/90 hover:shadow-[0_14px_32px_-14px_rgba(0,60,113,0.26)] sm:min-h-[126px] sm:flex-row dark:border-slate-700/80 dark:bg-slate-900/85 dark:hover:border-sky-400/50 dark:hover:bg-slate-900"
        >
          {/* Left Section: Title */}
          <div className="flex shrink-0 flex-col items-center justify-center border-b border-[#B7D1EE] px-6 py-5 text-center sm:w-[32%] sm:rounded-r-[26px] sm:border-b-0 sm:border-r dark:border-slate-700/80">
            <div className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-[#E75D2A] shadow-2xs ring-1 ring-[#E75D2A]/15 transition-transform duration-200 group-hover:scale-105 dark:bg-[#E75D2A]/20 dark:text-[#FF8A5C] dark:ring-[#E75D2A]/30">
              <svg
                className="h-4.5 w-4.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
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
                  {degreeProgress.plannedCourses} courses planned &bull;{" "}
                  {degreeProgress.percent}% toward 120-credit degree
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

        {/* CARD 3: 3-Part Map Card (Map + Venue Pills | Find Library Room + All Open | Building Free Rooms) */}
        <div className="flex flex-col overflow-hidden rounded-[26px] border border-[#BFD7F2] bg-[#DCEBFA]/75 shadow-[0_6px_24px_-12px_rgba(0,60,113,0.18)] transition-all duration-200 hover:border-[#003C71]/40 hover:shadow-[0_14px_32px_-14px_rgba(0,60,113,0.26)] sm:min-h-[134px] sm:flex-row dark:border-slate-700/80 dark:bg-slate-900/85 dark:hover:border-sky-400/50">
          {/* Part 1 (Left): Map + North/Downtown/Whitby pills */}
          <div className="group relative flex shrink-0 flex-col items-center justify-center border-b border-[#B7D1EE] px-4 py-5 text-center transition-colors hover:bg-white/40 sm:w-[32%] sm:rounded-r-[26px] sm:border-b-0 sm:border-r dark:border-slate-700/80 dark:hover:bg-slate-800/60">
            <div className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-emerald-700 shadow-2xs ring-1 ring-emerald-500/15 transition-transform duration-200 group-hover:scale-105 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/20">
              <svg
                className="h-4.5 w-4.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <Link
              href="/campus-map?venue=north"
              className="rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
                Map
              </span>
            </Link>
            <div className="relative z-10 mt-2 flex flex-wrap items-center justify-center gap-1">
              {CAMPUS_VENUE_LINKS.map((venue) => (
                <Link
                  key={venue.key}
                  href={`/campus-map?venue=${venue.key}`}
                  className="rounded-md border border-white/80 bg-white/85 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-emerald-500/50 hover:bg-emerald-50 hover:text-emerald-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-400/50 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300"
                >
                  {venue.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Part 2 (Middle): Find a library room + All Open Rooms */}
          <div className="group relative flex flex-1 flex-col items-center justify-center border-b border-[#B7D1EE] px-5 py-5 text-center transition-colors hover:bg-white/40 sm:border-b-0 dark:border-slate-700/80 dark:hover:bg-slate-800/60">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live Now
            </span>
            <Link
              href="/campus-map?building=LIB&filter=available&now=1"
              className="mt-2 rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <p className="text-sm font-bold leading-snug text-slate-900 group-hover:text-[#003C71] dark:text-white dark:group-hover:text-sky-300">
                Find a library room
              </p>
            </Link>
            {liveTimeLabel && (
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
                {liveTimeLabel}
              </p>
            )}
            <Link
              href="/campus-map?filter=available&now=1"
              className="relative z-10 mt-2 inline-flex items-center rounded-md border border-white/80 bg-white/85 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-[#003C71]/40 hover:bg-white hover:text-[#003C71] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-400/50 dark:hover:text-sky-300"
            >
              All Open Rooms
            </Link>
          </div>

          {/* Part 3 (Right): Building Free Rooms Curved Pill Compartment */}
          <div className="flex shrink-0 flex-col items-center justify-center bg-white/55 px-4 py-4 text-center sm:w-[37%] sm:rounded-l-[26px] sm:border-l sm:border-[#B7D1EE] dark:bg-slate-800/65 dark:sm:border-slate-700/80">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-100">
              <span>Free Rooms Right Now</span>
              {freeRoomsTotal !== null && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                  {freeRoomsTotal}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {quickBuildings.map((bldg) => (
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

      {/* BOTTOM ROW: Circular Quick-Launch Shortcut Buttons (Canvas, MyOTU, Library, Google, + Custom) */}
      <div
        aria-label="Quick shortcuts"
        className="mt-9 flex flex-wrap items-start justify-center gap-6 sm:gap-8"
      >
        {defaultShortcuts.map((item) => (
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
            <div
              key={meet.id}
              className="group relative flex flex-col items-center gap-2"
            >
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
                onClick={() => onRemoveMeetShortcut(meet.id)}
                aria-label={`Remove ${meet.label} Meet shortcut`}
                title="Remove Meet shortcut"
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 opacity-0 shadow-xs transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus-visible:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
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
          <div
            key={item.id}
            className="group relative flex flex-col items-center gap-2"
          >
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
              onClick={() => onRemoveCustomShortcut(item.id)}
              aria-label={`Remove ${item.label} shortcut`}
              title="Remove shortcut"
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 opacity-0 shadow-xs transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus-visible:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
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
          onClick={onOpenGoogleModal}
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
          onClick={onOpenAddShortcut}
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
  );
}
