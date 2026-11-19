"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import React, { useEffect, useState } from "react";

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

const SHORTCUTS = [
  {
    name: "Canvas",
    description: "Courses, assignments & grades",
    href: "https://learn.ontariotechu.ca/",
    accent:
      "bg-[#E75D2A]/12 text-[#C84A1B] ring-[#E75D2A]/20 dark:bg-[#E75D2A]/20 dark:text-[#FF8A5C]",
    icon: "canvas",
  },
  {
    name: "MyOntarioTech",
    description: "Registration, Banner & records",
    href: "https://my.ontariotechu.ca/",
    accent:
      "bg-[#003C71]/10 text-[#003C71] ring-[#003C71]/20 dark:bg-sky-500/15 dark:text-sky-300",
    icon: "portal",
  },
  {
    name: "Library Study Rooms",
    description: "Book North & Downtown study rooms",
    href: "https://apps.library.dc-ot.ca/OTrooms/calendar.aspx",
    accent:
      "bg-emerald-500/12 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300",
    icon: "library",
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
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Build conflict-free Week 1 &amp; Week 2 timetables with live Ontario Tech section and CRN search.
              </p>
            </div>
          </div>

          {/* Subtle Timetable Micro-Preview */}
          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
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
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Explore interactive indoor floorplans with real-time classroom schedules, exams, and library study rooms.
              </p>
            </div>
          </div>

          {/* Campus Tags Micro-Preview */}
          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
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
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Map your degree term by term with live prerequisite checks, credit tracking, and program maps.
              </p>
            </div>
          </div>

          {/* Mini Prerequisite Node / Progress Graphic */}
          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-950/60">
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
              <p className="text-sm leading-relaxed text-sky-100/85">
                Jump straight into the interactive map pre-filtered to rooms that are open at this exact time.
              </p>
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

        {/* Essential OTU Shortcuts */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-xs backdrop-blur-sm lg:col-span-5 dark:border-slate-800 dark:bg-slate-900/90">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Essential OTU Shortcuts
            </h2>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Quick Launch
            </span>
          </div>

          <div className="space-y-2">
            {SHORTCUTS.map((item) => (
              <a
                key={item.name}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 transition-all hover:border-[#003C71]/30 hover:bg-white hover:shadow-xs dark:border-slate-800 dark:bg-slate-950/50 dark:hover:border-slate-700 dark:hover:bg-slate-800/80"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${item.accent}`}
                  >
                    {item.icon === "canvas" ? (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                      </svg>
                    ) : item.icon === "portal" ? (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="7" height="7" x="3" y="3" rx="1" />
                        <rect width="7" height="7" x="14" y="3" rx="1" />
                        <rect width="7" height="7" x="14" y="14" rx="1" />
                        <rect width="7" height="7" x="3" y="14" rx="1" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.name}
                    </div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {item.description}
                    </div>
                  </div>
                </div>

                <svg
                  className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#003C71] dark:group-hover:text-sky-300"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
