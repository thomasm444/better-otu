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
    <div className="min-h-screen bg-[#F7F8FC] bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(186,230,253,0.40),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(221,214,254,0.32),transparent_60%)] text-slate-800 dark:bg-[#0B0F19] dark:bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(56,189,248,0.11),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(167,139,250,0.10),transparent_60%)] dark:text-slate-100">
      <div className="border-b border-slate-200/80 bg-white/82 px-4 py-3 shadow-[0_1px_12px_rgba(15,23,42,0.04)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/82">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4">
          <div className="h-7 w-20 animate-pulse rounded-xl bg-sky-100/80 dark:bg-slate-800" />
          <div className="h-6 w-48 animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800" />
          <div className="h-8 w-80 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/90" />
        </div>
      </div>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="h-64 animate-pulse rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:border-slate-800/80 dark:bg-slate-900/85" />
        <div className="h-96 animate-pulse rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:border-slate-800/80 dark:bg-slate-900/85" />
      </div>
    </div>
  );
}
