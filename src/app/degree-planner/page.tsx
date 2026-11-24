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
    <div className="flex-1 bg-canvas text-ink">
      <div className="border-b border-line-subtle bg-surface/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4">
          <div className="h-7 w-20 rounded-lg bg-surface-subtle" />
          <div className="h-6 w-48 rounded-lg bg-surface-subtle" />
          <div className="h-8 w-80 rounded-lg bg-surface-subtle" />
        </div>
      </div>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="h-64 rounded-2xl border border-line bg-surface" />
        <div className="h-96 rounded-2xl border border-line bg-surface" />
      </div>
    </div>
  );
}
