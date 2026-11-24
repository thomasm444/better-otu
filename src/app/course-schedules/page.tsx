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
    <div className="flex flex-1 flex-col bg-canvas font-sans text-ink">
      <header className="border-b border-line-subtle bg-surface/95 px-4 py-2.5 backdrop-blur-sm sm:sticky sm:top-[var(--site-nav-height,2.75rem)] sm:z-40 sm:px-6 sm:py-3 lg:px-8">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-ink sm:text-xl">
              Course Schedule &amp; Planner
            </h1>
            <p className="mt-0.5 text-xs text-ink-muted sm:mt-0 sm:hidden">
              Build your timetable &amp; sync to Calendar
            </p>
            <p className="hidden text-xs text-ink-muted sm:block">
              Build your Ontario Tech timetable, explore courses with live
              descriptions &amp; prerequisites, and sync to Apple or Google
              Calendar
            </p>
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
        <div className="h-14 rounded-2xl border border-line bg-surface" />
        <div className="h-[580px] rounded-2xl border border-line bg-surface" />
      </div>
      <div className="h-[650px] rounded-2xl border border-line bg-surface lg:col-span-4" />
    </div>
  );
}
