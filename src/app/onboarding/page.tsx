import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getProgramSummaries } from "@/lib/degree-queries";
import { MIN_PLAN_CATALOG_YEAR } from "@/lib/degree-planner";
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
    "Tell Better OTU your year of study, degree program, and optional minor to prefill your Degree Planner.",
};

function extractFirstName(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string | null {
  if (fullName?.trim()) {
    return fullName.trim().split(/\s+/)[0] ?? null;
  }
  if (email) {
    const local = email.split("@")[0]?.split(/[._-]/)[0];
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return null;
}

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

  const metadataName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  const firstName = extractFirstName(
    initialProfile?.full_name ?? metadataName,
    user.email,
  );
  const currentAcademicStartYear = getCurrentAcademicStartYear();

  return (
    <OnboardingFlow
      programs={programs}
      availableCatalogYears={availableCatalogYears}
      initialProfile={initialProfile}
      firstName={firstName}
      nextPath={nextPath}
      currentAcademicStartYear={currentAcademicStartYear}
    />
  );
}

function OnboardingSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-10">
      <div className="rounded-2xl border border-[#BFD7F2]/80 bg-white p-7 shadow-lg shadow-[#003C71]/5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4">
          <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800" />
          <div className="h-7 w-40 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800" />
          <div className="h-7 w-20 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800" />
        </div>
        <div className="mt-8 space-y-3">
          <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800" />
          <div className="h-4 w-80 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800" />
        </div>
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/80"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
