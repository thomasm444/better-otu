import { Suspense } from "react";
import Link from "next/link";
import { AuthButton } from "@/components/auth-button";
import {
  TERM_LABEL,
  getSampleScheduleSections,
  getSearchVocab,
} from "@/lib/queries";
import { ScheduleContainer } from "./_components/schedule-container";
import {
  convertSectionToScheduleBlocks,
  type ColorTheme,
  type ScheduleBlock,
} from "./types";

export const metadata = {
  title: "Course Schedules | Better OTU",
  description:
    "Interactive spreadsheet timetable for Ontario Tech University course sections, featuring Week 1 and Week 2 schedules.",
};

const SHARED_COLORS: ColorTheme[] = ["blue", "emerald", "purple", "indigo"];

export default function CourseSchedulesPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 font-sans">
      {/* Header and Navigation */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/"
            className="inline-flex items-center text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            &larr; Back to Home
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
            Course Schedules
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Spreadsheet-style timetables for bi-weekly Ontario Tech schedules ({TERM_LABEL}). Week 1 (odd weeks) on the left and Week 2 (even weeks) on the right.
          </p>
        </div>
        <AuthButton />
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleLoader />
      </Suspense>
    </main>
  );
}

async function ScheduleLoader() {
  const [vocab, sample] = await Promise.all([
    getSearchVocab(),
    getSampleScheduleSections(),
  ]);

  const sharedBlocks: ScheduleBlock[] = sample.shared.flatMap((section, index) =>
    convertSectionToScheduleBlocks(
      section,
      SHARED_COLORS[index % SHARED_COLORS.length],
    ),
  );

  const week1OnlyBlocks: ScheduleBlock[] = sample.week1Only.flatMap((section) =>
    convertSectionToScheduleBlocks(section, "amber"),
  );

  const week2OnlyBlocks: ScheduleBlock[] = sample.week2Only.flatMap((section) =>
    convertSectionToScheduleBlocks(section, "rose"),
  );

  const initialWeek1Courses = [
    ...sharedBlocks.map((b) => ({ ...b, id: `${b.id}-w1` })),
    ...week1OnlyBlocks.map((b) => ({ ...b, id: `${b.id}-w1` })),
  ];

  const initialWeek2Courses = [
    ...sharedBlocks.map((b) => ({ ...b, id: `${b.id}-w2` })),
    ...week2OnlyBlocks.map((b) => ({ ...b, id: `${b.id}-w2` })),
  ];

  return (
    <ScheduleContainer
      initialWeek1Courses={initialWeek1Courses}
      initialWeek2Courses={initialWeek2Courses}
      vocab={vocab}
      termLabel={TERM_LABEL}
    />
  );
}

function ScheduleSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-14 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="h-[580px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="h-[580px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      </div>
    </div>
  );
}
