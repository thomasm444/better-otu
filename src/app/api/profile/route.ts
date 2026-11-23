import { NextResponse, connection } from "next/server";

import { MIN_PLAN_CATALOG_YEAR } from "@/lib/degree-planner";
import { getProgramSummaries } from "@/lib/degree-queries";
import { getCurrentAcademicStartYear } from "@/lib/onboarding";
import type { StudentProfile } from "@/lib/student-courses";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase().trim() ?? "";
  if (!user || !email.endsWith("@ontariotechu.net")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  return NextResponse.json({
    initialProfile,
    programs,
    availableCatalogYears,
    currentAcademicStartYear: getCurrentAcademicStartYear(),
  });
}
