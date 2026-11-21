import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { MIN_PLAN_CATALOG_YEAR } from "@/lib/degree-planner";
import { getProgramSummaries } from "@/lib/degree-queries";
import {
  getCurrentAcademicStartYear,
  getSafeNextPath,
} from "@/lib/onboarding";
import type { RawSearchParams } from "@/lib/queries";
import type { StudentProfile } from "@/lib/student-courses";
import { createClient } from "@/lib/supabase/server";

import { OnboardingFlow } from "./_components/onboarding-flow";

export const metadata: Metadata = {
  title: "Get Started | Better OTU",
  description:
    "Select your year of study, degree program, and optional minor to prefill your Degree Planner.",
};

export default function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <main className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-[#F8FAFD] font-sans text-slate-900 dark:bg-[#090D16] dark:text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(191,219,254,0.45),transparent_72%)] dark:bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(0,60,113,0.35),transparent_72%)]"
      />
      <div className="relative z-10 flex flex-1 flex-col">
        <Suspense fallback={<OnboardingSkeleton />}>
          <OnboardingContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function OnboardingContent({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await connection();

  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const nextPath = getSafeNextPath(rawNext);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase().trim() ?? "";
  if (!user || !email.endsWith("@ontariotechu.net")) {
    redirect("/login?next=%2Fonboarding");
  }

  const [allPrograms, profileResult] = await Promise.all([
    getProgramSummaries(),
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);

  const initialProfile = (profileResult.data as StudentProfile | null) ?? null;

  const filteredPrograms = allPrograms.filter(
    (p) => p.catalog_year >= MIN_PLAN_CATALOG_YEAR,
  );
  const programs = filteredPrograms.length > 0 ? filteredPrograms : allPrograms;

  const availableCatalogYears = [
    ...new Set(programs.map((p) => p.catalog_year).filter(Boolean)),
  ].sort((a, b) => b.localeCompare(a));

  const currentAcademicStartYear = getCurrentAcademicStartYear();

  return (
    <OnboardingFlow
      programs={programs}
      availableCatalogYears={availableCatalogYears}
      initialProfile={initialProfile}
      nextPath={nextPath}
      currentAcademicStartYear={currentAcademicStartYear}
    />
  );
}

function OnboardingSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-[#BFD7F2]/80 bg-white px-6 py-6 shadow-[0_12px_36px_-18px_rgba(0,60,113,0.16)] sm:px-8 sm:py-7 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-12 animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800" />
            <div className="h-6 w-12 animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-5 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800" />
          </div>
        </div>
        <div className="mt-7 h-7 w-56 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800" />
        <div className="mt-6 space-y-2.5">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/80"
            />
          ))}
        </div>
        <div className="mt-8 flex items-center justify-between">
          <div className="h-10 w-10 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800" />
        </div>
      </div>
    </div>
  );
}
