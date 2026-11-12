import Link from "next/link";
import { AuthButton } from "@/components/auth-button";
import { ScheduleContainer } from "./_components/schedule-container";

export const metadata = {
  title: "Course Schedules | Better OTU",
  description:
    "Interactive spreadsheet timetable for Ontario Tech University course sections, featuring Week 1 and Week 2 schedules.",
};

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
            Spreadsheet-style timetables for bi-weekly Ontario Tech schedules. Week 1 (odd weeks) on the left and Week 2 (even weeks) on the right.
          </p>
        </div>
        <AuthButton />
      </div>

      {/* Spreadsheet Elements Container */}
      <ScheduleContainer />
    </main>
  );
}
