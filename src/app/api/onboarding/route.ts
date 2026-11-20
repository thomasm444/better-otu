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
  start_year: number | null;
  terms: unknown;
};

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
    return NextResponse.json(
      { error: existingProfileError.message },
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
        return NextResponse.json(
          { error: insertError.message },
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
        return NextResponse.json(
          { error: updateError.message },
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
      return NextResponse.json(
        { error: programError.message },
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

  const profileFields = {
    year_of_study: yearOfStudy,
    degree_program_id: degreeProgram?.program_id ?? null,
    has_minor: hasMinor,
    minor_program_id: minorProgram?.program_id ?? null,
    onboarding_completed_at: nowIso,
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
    return NextResponse.json(
      { error: profileSaveError.message },
      { status: 500 },
    );
  }

  if (degreeProgram) {
    const derivedStartYear = yearOfStudyToStartYear(yearOfStudy);

    const { data: existingPlanRaw, error: existingPlanError } = await supabase
      .from("degree_plans")
      .select("id, start_year, terms")
      .eq("user_email", email)
      .eq("program_id", degreeProgram.program_id)
      .maybeSingle();

    if (existingPlanError) {
      return NextResponse.json(
        { error: existingPlanError.message },
        { status: 500 },
      );
    }

    const existingPlan = existingPlanRaw as ExistingPlanRow | null;
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
        return NextResponse.json(
          { error: planInsertError.message },
          { status: 500 },
        );
      }
    } else {
      const hasTerms =
        Array.isArray(existingPlan.terms) && existingPlan.terms.length > 0;
      const planPatch: Record<string, unknown> = {};

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

      if (Object.keys(planPatch).length > 0) {
        planPatch.updated_at = nowIso;
        const { error: planUpdateError } = await supabase
          .from("degree_plans")
          .update(planPatch)
          .eq("id", existingPlan.id);

        if (planUpdateError) {
          return NextResponse.json(
            { error: planUpdateError.message },
            { status: 500 },
          );
        }
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
