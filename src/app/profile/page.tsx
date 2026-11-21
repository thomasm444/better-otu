import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { MIN_PLAN_CATALOG_YEAR } from "@/lib/degree-planner";
import { getProgramSummaries } from "@/lib/degree-queries";
import { getCurrentAcademicStartYear } from "@/lib/onboarding";
import type { StudentProfile } from "@/lib/student-courses";
import { createClient } from "@/lib/supabase/server";

import { ProfileView } from "./_components/profile-view";

export const metadata: Metadata = {
  title: "Profile | Better OTU",
  description:
    "View and update your Ontario Tech year of study, degree program, and minor.",
};

export default function ProfilePage() {
  return (
    <main className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-[#F8FAFD] font-sans text-slate-900 dark:bg-[#090D16] dark:text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(191,219,254,0.45),transparent_72%)] dark:bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(0,60,113,0.35),transparent_72%)]"
      />
      <div className="relative z-10 flex flex-1 flex-col">
        <Suspense fallback={<ProfileSkeleton />}>
          <ProfileContent />
        </Suspense>
      </div>
    </main>
  );
}

async function ProfileContent() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase().trim() ?? "";
  if (!user || !email.endsWith("@ontariotechu.net")) {
    redirect("/login?next=%2Fprofile");
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

  const displayName =
    initialProfile?.full_name?.trim() ||
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.user_metadata?.name as string | undefined)?.trim() ||
    email;

  const currentAcademicStartYear = getCurrentAcademicStartYear();

  return (
    <ProfileView
      programs={programs}
      availableCatalogYears={availableCatalogYears}
      initialProfile={initialProfile}
      displayName={displayName}
      email={email}
      currentAcademicStartYear={currentAcademicStartYear}
    />
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <div className="h-4 w-28 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
      <div className="mt-6 space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800" />
        <div className="h-4 w-56 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
      </div>
      <div className="mt-6 divide-y divide-slate-100 rounded-2xl border border-[#BFD7F2]/80 bg-white shadow-[0_10px_30px_-18px_rgba(0,60,113,0.16)] dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {[1, 2, 3].map((row) => (
          <div key={row} className="flex items-center justify-between px-6 py-5">
            <div className="space-y-2">
              <div className="h-3 w-14 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
              <div className="h-5 w-44 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
            </div>
            <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
