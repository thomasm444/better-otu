import Link from "next/link";

import { AuthButton } from "@/components/auth-button";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16 font-sans">
      <header className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Better OTU
          </h1>
          <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
            Ontario Tech University Student Portal
          </p>
        </div>
        <AuthButton />
      </header>

      <nav className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link
          href="/course-schedules"
          className="group rounded-xl border border-black/[.08] p-6 transition-all hover:border-black/20 hover:bg-black/[.02] dark:border-white/[.12] dark:hover:border-white/25 dark:hover:bg-white/[.04]"
        >
          <span className="text-3xl">🗓️</span>
          <h2 className="mt-4 text-lg font-medium text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
            Course Schedules &rarr;
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Browse course sections &amp; timetables
          </p>
        </Link>

        <Link
          href="/campus-map"
          className="group rounded-xl border border-black/[.08] p-6 transition-all hover:border-black/20 hover:bg-black/[.02] dark:border-white/[.12] dark:hover:border-white/25 dark:hover:bg-white/[.04]"
        >
          <span className="text-3xl">📍</span>
          <h2 className="mt-4 text-lg font-medium text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
            Campus Map &rarr;
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            North &amp; Downtown campus navigation
          </p>
        </Link>

        <Link
          href="/degree-planner"
          className="group rounded-xl border border-black/[.08] p-6 transition-all hover:border-black/20 hover:bg-black/[.02] dark:border-white/[.12] dark:hover:border-white/25 dark:hover:bg-white/[.04]"
        >
          <span className="text-3xl">🎓</span>
          <h2 className="mt-4 text-lg font-medium text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
            Degree Planner &rarr;
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Program requirements &amp; course pathways
          </p>
        </Link>
      </nav>
    </main>
  );
}
