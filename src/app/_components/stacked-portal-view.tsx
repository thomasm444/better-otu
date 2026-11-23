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
      <div className="w-full space-y-4">
        {/* CARD 1: Course Schedule | Schedule & Timetable Preview + Term Pills */}
        <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:border-accent-line hover:ring-2 hover:ring-accent/15 hover:shadow-[var(--shadow-lg)] sm:min-h-[124px] sm:flex-row">
          {/* Left Section: Title */}
          <div className="flex shrink-0 flex-col items-center justify-center border-b border-line-subtle bg-surface-subtle/50 px-6 py-5 text-center sm:w-[32%] sm:border-r sm:border-b-0">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-ink-secondary ring-1 ring-line-subtle transition-all duration-300 ease-[var(--ease-standard)] group-hover:scale-110 group-hover:-rotate-3 group-hover:bg-accent-soft group-hover:text-accent-ink">
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
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </div>
            <Link
              href="/course-schedules"
              className="rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="text-sm font-semibold tracking-tight text-ink transition-colors group-hover:text-accent-ink">
                Course Schedule
              </span>
            </Link>
            <span className="mt-0.5 text-xs text-ink-muted">
              {termLabel}
            </span>
          </div>

          {/* Right Section: Preview + Classic Term Pills */}
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-5 text-center sm:px-8">
            <p className="text-sm font-medium text-ink">
              Bi-weekly timetable &amp; section lookup
            </p>
            <p className="mt-1 text-xs text-ink-muted">
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
                    className={`whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-xs font-medium transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:shadow-[var(--shadow-sm)] ${
                      isActive
                        ? "border-accent-line bg-accent-soft text-accent-ink hover:bg-accent hover:text-accent-fg"
                        : "border-line bg-surface-subtle text-ink-secondary hover:border-accent-line hover:text-ink"
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
          className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:border-accent-line hover:ring-2 hover:ring-accent/15 hover:shadow-[var(--shadow-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-[124px] sm:flex-row"
        >
          {/* Left Section: Title */}
          <div className="flex shrink-0 flex-col items-center justify-center border-b border-line-subtle bg-surface-subtle/50 px-6 py-5 text-center sm:w-[32%] sm:border-r sm:border-b-0">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-ink-secondary ring-1 ring-line-subtle transition-all duration-300 ease-[var(--ease-standard)] group-hover:scale-110 group-hover:-rotate-3 group-hover:bg-accent-soft group-hover:text-accent-ink">
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
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c3 3 9 3 12 0v-5" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight text-ink transition-colors group-hover:text-accent-ink">
              Degree Planner
            </span>
            <span className="mt-0.5 text-xs text-ink-muted">
              Program roadmap
            </span>
          </div>

          {/* Right Section: Progress Bar & Degree Requirements */}
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-5 text-center sm:px-8">
            {degreeProgress && degreeProgress.plannedCourses > 0 ? (
              <div className="w-full max-w-sm">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-ink">
                    {degreeProgress.title}
                  </span>
                  <span className="shrink-0 font-mono font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
                    {degreeProgress.plannedCredits} / 120 cr
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200/85 ring-1 ring-inset ring-slate-300/40 dark:bg-slate-900 dark:ring-slate-700/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 via-teal-400 to-emerald-400"
                    style={{ width: `${Math.max(degreeProgress.percent, 6)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">
                  {degreeProgress.plannedCourses} courses planned &bull;{" "}
                  {degreeProgress.percent}% toward 120-credit degree
                  {profileMinorName ? ` · Minor: ${profileMinorName}` : ""}
                </p>
              </div>
            ) : latestPlan ? (
              <div className="w-full max-w-sm">
                <p className="truncate text-sm font-medium text-ink">
                  {latestPlan.degree_name ||
                    profileDegreeName ||
                    "Saved Degree Plan"}
                </p>
                {profileMinorName && (
                  <p className="mt-0.5 truncate text-xs font-medium text-accent-ink">
                    Minor: {profileMinorName}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-ink-muted">
                  Start {latestPlan.start_year ?? derivedProfileStartYear}{" "}
                  &bull; Open planner to load your roadmap
                </p>
              </div>
            ) : profileDegreeName ? (
              <div className="w-full max-w-sm">
                <p className="truncate text-sm font-medium text-ink">
                  {profileDegreeName}
                </p>
                {profileMinorName && (
                  <p className="mt-0.5 truncate text-xs font-medium text-accent-ink">
                    Minor: {profileMinorName}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-ink-muted">
                  Start {derivedProfileStartYear} &bull; Ready in Degree Planner
                </p>
              </div>
            ) : (
              <div className="w-full max-w-sm">
                <p className="text-sm font-medium text-ink">
                  Progress bar &amp; degree requirements
                </p>
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200/85 ring-1 ring-inset ring-slate-300/40 dark:bg-slate-900 dark:ring-slate-700/60">
                  <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-sky-400 via-teal-400 to-emerald-400" />
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">
                  Track prerequisites, credits, and multi-year course pathways
                </p>
              </div>
            )}
          </div>
        </Link>

        {/* CARD 3: 3-Part Map Card (Map + Venue Pills | Find Library Room + All Open | Building Free Rooms) */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)] transition-all duration-300 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1.5 hover:scale-[1.015] hover:border-positive-line hover:ring-2 hover:ring-positive/15 hover:shadow-[var(--shadow-lg)] sm:min-h-[132px] sm:flex-row">
          {/* Part 1 (Left): Map + North/Downtown/Whitby pills */}
          <div className="group relative flex shrink-0 flex-col items-center justify-center border-b border-line-subtle bg-surface-subtle/50 px-4 py-5 text-center transition-colors hover:bg-surface-subtle sm:w-[32%] sm:border-r sm:border-b-0">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-ink-secondary ring-1 ring-line-subtle transition-all duration-300 ease-[var(--ease-standard)] group-hover:scale-110 group-hover:-rotate-3 group-hover:bg-positive-soft group-hover:text-positive">
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
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <Link
              href="/campus-map?venue=north"
              className="rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="text-sm font-semibold tracking-tight text-ink transition-colors group-hover:text-accent-ink">
                Map
              </span>
            </Link>
            <div className="relative z-10 mt-2 flex flex-wrap items-center justify-center gap-1">
              {CAMPUS_VENUE_LINKS.map((venue) => (
                <Link
                  key={venue.key}
                  href={`/campus-map?venue=${venue.key}`}
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-secondary transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-positive-line hover:bg-positive-soft hover:text-positive hover:shadow-[var(--shadow-sm)]"
                >
                  {venue.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Part 2 (Middle): Find a library room + All Open Rooms */}
          <div className="group relative flex flex-1 flex-col items-center justify-center border-b border-line-subtle px-5 py-5 text-center transition-colors hover:bg-surface-subtle/40 sm:border-b-0">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-positive-line bg-positive-soft px-2 py-0.5 text-[11px] font-medium text-positive">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" />
              Live now
            </span>
            <Link
              href="/campus-map?building=LIB&filter=available&now=1"
              className="mt-2 rounded-md after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <p className="text-sm font-semibold leading-snug text-ink transition-colors group-hover:text-accent-ink">
                Find a library room
              </p>
            </Link>
            {liveTimeLabel && (
              <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-muted">
                {liveTimeLabel}
              </p>
            )}
            <Link
              href="/campus-map?filter=available&now=1"
              className="relative z-10 mt-2 inline-flex items-center rounded-md border border-line bg-surface-subtle px-2.5 py-1 text-xs font-medium text-ink-secondary transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-accent-line hover:text-ink hover:shadow-[var(--shadow-sm)]"
            >
              All open rooms
            </Link>
          </div>

          {/* Part 3 (Right): Building Free Rooms Compartment */}
          <div className="flex shrink-0 flex-col items-center justify-center bg-surface-subtle/50 px-4 py-4 text-center sm:w-[37%] sm:border-l sm:border-line-subtle">
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <span>Free rooms right now</span>
              {freeRoomsTotal !== null && (
                <span className="rounded-md bg-positive-soft px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-positive">
                  {freeRoomsTotal}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {quickBuildings.map((bldg) => (
                <Link
                  key={bldg}
                  href={`/campus-map?building=${bldg}&filter=available&now=1`}
                  className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-xs font-medium text-ink-secondary transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink hover:shadow-[var(--shadow-sm)]"
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
        className="mt-8 flex flex-wrap items-start justify-center gap-6 sm:gap-8"
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
            <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-line bg-surface shadow-[var(--shadow-sm)] transition-all duration-200 ease-[var(--ease-standard)] will-change-transform group-hover:-translate-y-1.5 group-hover:scale-110 group-hover:border-accent-line group-hover:ring-2 group-hover:ring-accent/20 group-hover:shadow-[var(--shadow-md)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl}
                alt={item.title}
                className="h-full w-full object-cover object-center"
              />
            </span>
            <span className="text-xs font-medium text-ink-secondary transition-colors group-hover:text-ink">
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
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface shadow-[var(--shadow-sm)] transition-all duration-200 ease-[var(--ease-standard)] will-change-transform group-hover:-translate-y-1.5 group-hover:scale-110 group-hover:border-accent-line group-hover:ring-2 group-hover:ring-accent/20 group-hover:shadow-[var(--shadow-md)]">
                  <GoogleServiceIcon serviceId={svc.id} className="h-6 w-6" />
                </span>
                {showAccountTag && (
                  <span className="absolute -bottom-0.5 right-0 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">
                    {acct.label}
                  </span>
                )}
                <span className="max-w-[76px] truncate text-xs font-medium text-ink-secondary transition-colors group-hover:text-ink">
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
                className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface shadow-[var(--shadow-sm)] transition-all duration-200 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1.5 hover:scale-110 hover:border-positive-line hover:ring-2 hover:ring-positive/20 hover:shadow-[var(--shadow-md)]"
              >
                <GoogleMeetIcon className="h-6 w-6" />
              </a>
              <button
                type="button"
                onClick={() => onRemoveMeetShortcut(meet.id)}
                aria-label={`Remove ${meet.label} Meet shortcut`}
                title="Remove Meet shortcut"
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-xs text-ink-muted opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
              >
                &times;
              </button>
              <span className="max-w-[76px] truncate text-xs font-medium text-ink-secondary">
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
              className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface-subtle font-mono text-xs font-medium text-accent-ink shadow-[var(--shadow-sm)] transition-all duration-200 ease-[var(--ease-standard)] will-change-transform hover:-translate-y-1.5 hover:scale-110 hover:border-accent-line hover:bg-surface hover:ring-2 hover:ring-accent/20 hover:shadow-[var(--shadow-md)]"
            >
              {getInitials(item.label)}
            </a>
            <button
              type="button"
              onClick={() => onRemoveCustomShortcut(item.id)}
              aria-label={`Remove ${item.label} shortcut`}
              title="Remove shortcut"
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-xs text-ink-muted opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
            >
              &times;
            </button>
            <span className="max-w-[72px] truncate text-xs font-medium text-ink-secondary">
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
          className="group flex cursor-pointer flex-col items-center gap-2"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-line-strong bg-surface transition-all duration-200 ease-[var(--ease-standard)] will-change-transform group-hover:-translate-y-1.5 group-hover:scale-110 group-hover:border-accent-line group-hover:bg-surface-subtle group-hover:ring-2 group-hover:ring-accent/20 group-hover:shadow-[var(--shadow-md)]">
            <GoogleLogoIcon className="h-6 w-6" />
          </span>
          <span className="text-xs font-medium text-ink-muted transition-colors group-hover:text-ink">
            {googleShortcuts.accounts.length > 0 ? "Google" : "Add Google"}
          </span>
        </button>

        {/* "+" Add Shortcut Circle */}
        <button
          type="button"
          onClick={onOpenAddShortcut}
          title="Add custom shortcut"
          className="group flex cursor-pointer flex-col items-center gap-2"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-line-strong bg-surface-subtle text-xl font-normal text-ink-secondary transition-all duration-200 ease-[var(--ease-standard)] will-change-transform group-hover:-translate-y-1.5 group-hover:scale-110 group-hover:border-accent-line group-hover:bg-accent-soft group-hover:text-accent-ink group-hover:ring-2 group-hover:ring-accent/20 group-hover:shadow-[var(--shadow-md)]">
            +
          </span>
          <span className="text-xs font-medium text-ink-muted transition-colors group-hover:text-ink">
            Add
          </span>
        </button>
      </div>
    </div>
  );
}
