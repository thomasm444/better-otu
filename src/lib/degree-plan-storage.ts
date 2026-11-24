import type { SupabaseClient } from "@supabase/supabase-js";

import type { CustomCourse, PlannerTerm } from "@/lib/degree-types";

export const MAX_DEGREE_PLANS = 5;
export const MAX_DEGREE_PLANS_MESSAGE =
  "You can save up to 5 degree plans. Delete an existing plan to add another.";

export interface DegreePlanRecord {
  id: string;
  user_id: string;
  user_email: string;
  degree_name: string | null;
  start_year: number | null;
  catalog_year: string | null;
  program_id: string;
  minor_program_id: string | null;
  terms: PlannerTerm[];
  customs: CustomCourse[];
  created_at: string;
  updated_at: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function fetchAllDegreePlans(
  supabase: SupabaseClient,
  userEmail: string,
): Promise<DegreePlanRecord[]> {
  const { data, error } = await supabase
    .from("degree_plans")
    .select("*")
    .eq("user_email", normalizeEmail(userEmail))
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DegreePlanRecord[];
}

export async function fetchLatestDegreePlan(
  supabase: SupabaseClient,
  userEmail: string,
): Promise<DegreePlanRecord | null> {
  const { data, error } = await supabase
    .from("degree_plans")
    .select("*")
    .eq("user_email", normalizeEmail(userEmail))
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as DegreePlanRecord | null;
}

export async function fetchDegreePlanByProgram(
  supabase: SupabaseClient,
  userEmail: string,
  programId: string,
): Promise<DegreePlanRecord | null> {
  const { data, error } = await supabase
    .from("degree_plans")
    .select("*")
    .eq("user_email", normalizeEmail(userEmail))
    .eq("program_id", programId)
    .maybeSingle();

  if (error) throw error;
  return data as DegreePlanRecord | null;
}

export async function upsertDegreePlan(
  supabase: SupabaseClient,
  params: {
    userId: string;
    userEmail: string;
    degreeName: string;
    startYear: number;
    catalogYear?: string | null;
    programId: string;
    minorProgramId?: string | null;
    terms: PlannerTerm[];
    customs: CustomCourse[];
  },
): Promise<DegreePlanRecord> {
  const { data, error } = await supabase
    .from("degree_plans")
    .upsert(
      {
        user_id: params.userId,
        user_email: normalizeEmail(params.userEmail),
        degree_name: params.degreeName,
        start_year: params.startYear,
        catalog_year: params.catalogYear ?? null,
        program_id: params.programId,
        minor_program_id: params.minorProgramId ?? null,
        terms: params.terms,
        customs: params.customs,
      },
      { onConflict: "user_email,program_id" },
    )
    .select("*")
    .single();

  if (error) {
    if (
      error.code === "23514" ||
      error.message?.toLowerCase().includes("up to 5 degree plans")
    ) {
      throw new Error(MAX_DEGREE_PLANS_MESSAGE);
    }
    throw error;
  }
  return data as DegreePlanRecord;
}

export async function updateDegreePlanProgram(
  supabase: SupabaseClient,
  params: {
    userId: string;
    userEmail: string;
    previousProgramId: string;
    newProgramId: string;
    degreeName: string;
    startYear: number;
    catalogYear?: string | null;
    minorProgramId?: string | null;
    terms: PlannerTerm[];
    customs: CustomCourse[];
  },
): Promise<DegreePlanRecord> {
  const email = normalizeEmail(params.userEmail);
  const { data, error } = await supabase
    .from("degree_plans")
    .update({
      program_id: params.newProgramId,
      degree_name: params.degreeName,
      start_year: params.startYear,
      catalog_year: params.catalogYear ?? null,
      minor_program_id: params.minorProgramId ?? null,
      terms: params.terms,
      customs: params.customs,
    })
    .eq("user_email", email)
    .eq("program_id", params.previousProgramId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (data) return data as DegreePlanRecord;

  return upsertDegreePlan(supabase, {
    userId: params.userId,
    userEmail: email,
    degreeName: params.degreeName,
    startYear: params.startYear,
    catalogYear: params.catalogYear,
    programId: params.newProgramId,
    minorProgramId: params.minorProgramId,
    terms: params.terms,
    customs: params.customs,
  });
}

export async function deleteDegreePlan(
  supabase: SupabaseClient,
  userEmail: string,
  programId: string,
): Promise<void> {
  const { error } = await supabase
    .from("degree_plans")
    .delete()
    .eq("user_email", normalizeEmail(userEmail))
    .eq("program_id", programId);

  if (error) throw error;
}
