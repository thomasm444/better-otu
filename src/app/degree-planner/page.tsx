import { Suspense } from "react";

import { getDegreeBootstrap, getProgramDetail } from "@/lib/degree-queries";
import type { RawSearchParams } from "@/lib/queries";

import { DegreePlannerClient } from "./_components/degree-planner-client";

export const metadata = {
  title: "Degree Planner | Better OTU",
  description:
    "Plan your Ontario Tech University degree term by term with live prerequisite checking, course offerings, and requirement tracking.",
};

export default function DegreePlannerPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <Suspense fallback={<DegreePlannerSkeleton />}>
      <DegreePlannerContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DegreePlannerContent({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const rawProgram = Array.isArray(params.program)
    ? params.program[0]
    : params.program;
  const programId = rawProgram?.trim() || undefined;

  const [bootstrap, initialProgram] = await Promise.all([
    getDegreeBootstrap(),
    programId ? getProgramDetail(programId) : Promise.resolve(null),
  ]);

  return (
    <DegreePlannerClient
      bootstrap={bootstrap}
      initialProgram={initialProgram}
    />
  );
}

function DegreePlannerSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4">
          <div className="h-7 w-20 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-6 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-8 w-80 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="h-96 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
      </div>
    </div>
  );
}
