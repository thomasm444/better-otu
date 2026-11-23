import { NextResponse } from "next/server";

import {
  buildOnboardingCookieOptions,
  ONBOARDING_COOKIE_NAME,
  yearOfStudyToStartYear,
  type YearOfStudy,
} from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_EMAIL_DOMAIN = "@ontariotechu.net";

interface OnboardingPayload {
  action?: unknown;
  yearOfStudy?: unknown;
  degreeProgramId?: unknown;
  hasMinor?: unknown;
  minorProgramId?: unknown;
}

type ProgramLookupRow = {
  program_id: string;
  name: string;
  catalog_year: string;
  credential: string | null;
};

type ExistingPlanRow = {
  id: string;
  program_id: string;
  degree_name: string | null;
  start_year: number | null;
  terms: unknown;
};

function normalizeProgramNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2013\u2014-]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isSameDegreeProgram(
  a: { name: string; credential?: string | null },
  b: { name: string; credential?: string | null },
): boolean {
  if (normalizeProgramNameKey(a.name) !== normalizeProgramNameKey(b.name)) {
    return false;
  }
  const credA = (a.credential ?? "").trim().toLowerCase();
  const credB = (b.credential ?? "").trim().toLowerCase();
  return !credA || !credB || credA === credB;
}

function parseOptionalStringId(value: unknown): {
  valid: boolean;
  value: string | null;
} {
  if (value === null || value === undefined) {
    return { valid: true, value: null };
  }
  if (typeof value !== "string") {
    return { valid: false, value: null };
  }
  const trimmed = value.trim();
  return { valid: true, value: trimmed || null };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase().trim() ?? "";
  if (authError || !user || !email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  let body: OnboardingPayload;
  try {
    body = (await request.json()) as OnboardingPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 },
    );
  }

  const action = body.action;
  if (action !== "complete" && action !== "skip") {
    return NextResponse.json(
      { error: "Action must be 'complete' or 'skip'." },
      { status: 400 },
    );
  }

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfileError) {
    console.error("Onboarding profile lookup failed:", existingProfileError);
    return NextResponse.json(
      { error: "Failed to save onboarding data." },
      { status: 500 },
    );
  }

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;
  const nowIso = new Date().toISOString();

  if (action === "skip") {
    if (!existingProfile) {
      const { error: insertError } = await supabase.from("profiles").insert({
        id: user.id,
        email,
        full_name: fullName,
        avatar_url: avatarUrl,
        onboarding_skipped_at: nowIso,
      });

      if (insertError) {
        console.error("Onboarding skip profile insert failed:", insertError);
        return NextResponse.json(
          { error: "Failed to save onboarding data." },
          { status: 500 },
        );
      }
    } else if (!existingProfile.onboarding_completed_at) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          onboarding_skipped_at: existingProfile.onboarding_skipped_at ?? nowIso,
        })
        .eq("id", user.id);

      if (updateError) {
        console.error("Onboarding skip profile update failed:", updateError);
        return NextResponse.json(
          { error: "Failed to save onboarding data." },
          { status: 500 },
        );
      }
    }

    const response = NextResponse.json({ ok: true, skipped: true });
    response.cookies.set(
      ONBOARDING_COOKIE_NAME,
      user.id,
      buildOnboardingCookieOptions(),
    );
    return response;
  }

  let yearOfStudy: YearOfStudy | null = null;
  if (body.yearOfStudy !== null && body.yearOfStudy !== undefined) {
    if (
      typeof body.yearOfStudy !== "number" ||
      !Number.isInteger(body.yearOfStudy) ||
      body.yearOfStudy < 1 ||
      body.yearOfStudy > 4
    ) {
      return NextResponse.json(
        { error: "yearOfStudy must be 1, 2, 3, or 4." },
        { status: 400 },
      );
    }
    yearOfStudy = body.yearOfStudy as YearOfStudy;
  }

  const parsedDegree = parseOptionalStringId(body.degreeProgramId);
  if (!parsedDegree.valid) {
    return NextResponse.json(
      { error: "Invalid degreeProgramId." },
      { status: 400 },
    );
  }

  let hasMinor: boolean | null = null;
  if (body.hasMinor !== null && body.hasMinor !== undefined) {
    if (typeof body.hasMinor !== "boolean") {
      return NextResponse.json(
        { error: "hasMinor must be a boolean or null." },
        { status: 400 },
      );
    }
    hasMinor = body.hasMinor;
  }

  const parsedMinor = parseOptionalStringId(body.minorProgramId);
  if (!parsedMinor.valid) {
    return NextResponse.json(
      { error: "Invalid minorProgramId." },
      { status: 400 },
    );
  }

  const degreeProgramId = parsedDegree.value;
  const minorProgramId = hasMinor === true ? parsedMinor.value : null;

  const idsToVerify = [degreeProgramId, minorProgramId].filter(
    (id): id is string => Boolean(id),
  );

  const programMap = new Map<string, ProgramLookupRow>();
  if (idsToVerify.length > 0) {
    const { data: programRows, error: programError } = await supabase
      .from("degree_programs")
      .select("program_id, name, catalog_year, credential")
      .in("program_id", idsToVerify);

    if (programError) {
      console.error("Onboarding degree_programs lookup failed:", programError);
      return NextResponse.json(
        { error: "Failed to save onboarding data." },
        { status: 500 },
      );
    }

    for (const row of (programRows ?? []) as ProgramLookupRow[]) {
      programMap.set(row.program_id, row);
    }
  }

  const degreeProgram = degreeProgramId
    ? (programMap.get(degreeProgramId) ?? null)
    : null;
  if (degreeProgramId && (!degreeProgram || degreeProgram.credential === "Minor")) {
    return NextResponse.json(
      { error: "Selected degree program was not found." },
      { status: 400 },
    );
  }

  const minorProgram = minorProgramId
    ? (programMap.get(minorProgramId) ?? null)
    : null;
  if (minorProgramId && (!minorProgram || minorProgram.credential !== "Minor")) {
    return NextResponse.json(
      { error: "Selected minor program was not found." },
      { status: 400 },
    );
  }

  let existingPlan: ExistingPlanRow | null = null;
  let effectiveDegreeProgramId: string | null = degreeProgram?.program_id ?? null;

  if (degreeProgram) {
    const { data: userPlansRaw, error: existingPlanError } = await supabase
      .from("degree_plans")
      .select("id, program_id, degree_name, start_year, terms")
      .eq("user_email", email)
      .order("updated_at", { ascending: false });

    if (existingPlanError) {
      console.error("Onboarding degree_plans lookup failed:", existingPlanError);
      return NextResponse.json(
        { error: "Failed to save onboarding data." },
        { status: 500 },
      );
    }

    const userPlans = (userPlansRaw ?? []) as ExistingPlanRow[];
    const hasPlanTerms = (p: ExistingPlanRow) =>
      Array.isArray(p.terms) && p.terms.length > 0;

    const exactMatch =
      userPlans.find((p) => p.program_id === degreeProgram.program_id) ?? null;

    if (exactMatch && hasPlanTerms(exactMatch)) {
      existingPlan = exactMatch;
    } else if (userPlans.length > 0) {
      // Check if the student already has a saved plan for this same degree
      // under a different catalog year (e.g. 2026-27 catalog while in 2nd year).
      const otherIds = [
        ...new Set(
          userPlans
            .map((p) => p.program_id)
            .filter((id) => id && id !== degreeProgram.program_id),
        ),
      ];
      const existingProgMap = new Map<string, ProgramLookupRow>();
      if (otherIds.length > 0) {
        const { data: existingProgRows } = await supabase
          .from("degree_programs")
          .select("program_id, name, catalog_year, credential")
          .in("program_id", otherIds);
        for (const row of (existingProgRows ?? []) as ProgramLookupRow[]) {
          existingProgMap.set(row.program_id, row);
        }
      }

      const sameDegreePlans = userPlans.filter((p) => {
        if (p.program_id === degreeProgram.program_id) return false;
        const prog = existingProgMap.get(p.program_id);
        if (prog) {
          return isSameDegreeProgram(prog, degreeProgram);
        }
        return Boolean(
          p.degree_name &&
            normalizeProgramNameKey(p.degree_name) ===
              normalizeProgramNameKey(degreeProgram.name),
        );
      });

      const nonEmptySameDegree = sameDegreePlans.find(hasPlanTerms) ?? null;
      existingPlan =
        nonEmptySameDegree ?? exactMatch ?? sameDegreePlans[0] ?? null;
    }

    if (existingPlan) {
      effectiveDegreeProgramId = existingPlan.program_id;
    }
  }

  const profileFields = {
    year_of_study: yearOfStudy,
    degree_program_id: effectiveDegreeProgramId,
    has_minor: hasMinor,
    minor_program_id: minorProgram?.program_id ?? null,
    onboarding_completed_at:
      existingProfile?.onboarding_completed_at ?? nowIso,
    onboarding_skipped_at: null,
  };

  const { data: updatedProfile, error: profileSaveError } = existingProfile
    ? await supabase
        .from("profiles")
        .update(profileFields)
        .eq("id", user.id)
        .select("*")
        .single()
    : await supabase
        .from("profiles")
        .insert({
          id: user.id,
          email,
          full_name: fullName,
          avatar_url: avatarUrl,
          ...profileFields,
        })
        .select("*")
        .single();

  if (profileSaveError) {
    console.error("Onboarding profile save failed:", profileSaveError);
    return NextResponse.json(
      { error: "Failed to save onboarding data." },
      { status: 500 },
    );
  }

  if (degreeProgram) {
    const derivedStartYear = yearOfStudyToStartYear(yearOfStudy);

    if (!existingPlan) {
      const { error: planInsertError } = await supabase
        .from("degree_plans")
        .insert({
          user_id: user.id,
          user_email: email,
          degree_name: degreeProgram.name,
          start_year: derivedStartYear,
          catalog_year: degreeProgram.catalog_year,
          program_id: degreeProgram.program_id,
          minor_program_id: minorProgram?.program_id ?? null,
          terms: [],
          customs: [],
        });

      if (planInsertError) {
        console.error("Onboarding degree_plans insert failed:", planInsertError);
        return NextResponse.json(
          { error: "Failed to save onboarding data." },
          { status: 500 },
        );
      }
    } else {
      const hasTerms =
        Array.isArray(existingPlan.terms) && existingPlan.terms.length > 0;
      const planPatch: Record<string, unknown> = {
        updated_at: nowIso,
      };

      if (hasMinor !== null) {
        planPatch.minor_program_id = hasMinor
          ? (minorProgram?.program_id ?? null)
          : null;
      }

      if (
        yearOfStudy !== null &&
        (existingPlan.start_year === null || !hasTerms)
      ) {
        planPatch.start_year = derivedStartYear;
      }

      const { error: planUpdateError } = await supabase
        .from("degree_plans")
        .update(planPatch)
        .eq("id", existingPlan.id);

      if (planUpdateError) {
        console.error("Onboarding degree_plans update failed:", planUpdateError);
        return NextResponse.json(
          { error: "Failed to save onboarding data." },
          { status: 500 },
        );
      }
    }
  }

  const response = NextResponse.json({
    ok: true,
    profile: updatedProfile,
  });
  response.cookies.set(
    ONBOARDING_COOKIE_NAME,
    user.id,
    buildOnboardingCookieOptions(),
  );
  return response;
}
