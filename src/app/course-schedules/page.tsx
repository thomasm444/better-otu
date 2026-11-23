import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import type { RawSearchParams } from "@/lib/queries";
import {
  SCHEDULE_TERMS,
  getDefaultScheduleTerm,
  getTermScheduleCatalog,
} from "@/lib/schedule-queries";

import { ScheduleContainer } from "./_components/schedule-container";

export const metadata = {
  title: "Course Schedules | Better OTU",
  description:
    "Plan your Ontario Tech University semester timetable with biweekly side-by-side views, course exploration, prerequisite & fit filtering, time blocking, and Google/Apple Calendar sync.",
};

const VALID_TERMS = new Set(SCHEDULE_TERMS.map((t) => t.code));

export default function CourseSchedulesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <div className="min-h-screen bg-[#F7F8FC] bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(186,230,253,0.40),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(221,214,254,0.32),transparent_60%)] font-sans text-slate-800 dark:bg-[#0B0F19] dark:bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(56,189,248,0.11),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(167,139,250,0.10),transparent_60%)] dark:text-slate-100">
      <header className="sticky top-[var(--site-nav-height,2.75rem)] z-40 border-b border-slate-200/80 bg-white/82 px-4 py-3 shadow-[0_1px_12px_rgba(15,23,42,0.04)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/82">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="rounded-xl border border-slate-200/90 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-sky-300 hover:bg-sky-50/50 hover:text-sky-900 dark:border-slate-700/80 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:text-sky-200"
            >
              &larr; Home
            </Link>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl dark:text-slate-100">
                Course Schedule &amp; Planner
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Build your Ontario Tech timetable, explore courses with live
                descriptions &amp; prerequisites, and sync to Apple or Google
                Calendar.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8">
        <Suspense fallback={<ScheduleSkeleton />}>
          <ScheduleLoader searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function ScheduleLoader({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await connection();
  const params = await searchParams;
  const rawTerm = Array.isArray(params.term) ? params.term[0] : params.term;
  const requested = rawTerm?.trim();
  const defaultTerm =
    requested && VALID_TERMS.has(requested)
      ? requested
      : getDefaultScheduleTerm();

  const initialCatalog = await getTermScheduleCatalog(defaultTerm);

  return (
    <ScheduleContainer initialCatalog={initialCatalog} terms={SCHEDULE_TERMS} />
  );
}

function ScheduleSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-8">
        <div className="h-14 animate-pulse rounded-2xl border border-slate-200/80 bg-white/80 dark:border-slate-800/80 dark:bg-slate-900/80" />
        <div className="h-[580px] animate-pulse rounded-2xl border border-slate-200/80 bg-white/80 dark:border-slate-800/80 dark:bg-slate-900/80" />
      </div>
      <div className="h-[650px] animate-pulse rounded-2xl border border-slate-200/80 bg-white/80 lg:col-span-4 dark:border-slate-800/80 dark:bg-slate-900/80" />
    </div>
  );
}
