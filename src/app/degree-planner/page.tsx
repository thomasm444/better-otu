import Link from "next/link";

export default function DegreePlannerPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 font-sans">
      <Link
        href="/"
        className="text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        &larr; Back to Home
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Degree Planner
      </h1>
      {/* Group member can build their feature here */}
    </main>
  );
}

