import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { AuthButton } from "@/components/auth-button";
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
    <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 font-sans">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/"
            className="inline-flex items-center text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            &larr; Back to Home
          </Link>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
            Course Schedule &amp; Planner
          </h1>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            Build your Ontario Tech timetable, explore courses with live
            descriptions &amp; prerequisites, and sync to Apple or Google
            Calendar.
          </p>
        </div>
        <AuthButton />
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleLoader searchParams={searchParams} />
      </Suspense>
    </main>
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
        <div className="h-14 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="h-[580px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      </div>
      <div className="h-[650px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 lg:col-span-4 dark:border-zinc-800 dark:bg-zinc-900" />
    </div>
  );
}
